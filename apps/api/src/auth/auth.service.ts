import { ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { hashPassword, verifyPassword, createSessionToken, parseEncryptionKey } from "@axora24/security";
import { AccountService } from "./account.service.js";
import { ALL_PERMISSIONS } from "@axora24/contracts";
import { DEFAULT_PIPELINE_STAGES } from "../crm/pipeline.defaults.js";
import { PrismaService } from "../core/prisma.service.js";
import type { LoginDto, RegisterOrganizationDto } from "./auth.dto.js";
import type { AuthenticatedUser } from "./session.guard.js";
import { LoginThrottleService } from "./login-throttle.service.js";
import { parseLogin, parseRegistration } from "./credentials.js";
import { SESSION_MAX_AGE_MS, SESSION_IDLE_MS } from "./session-policy.js";
import { registrationAllowed, registrationMode, type RegistrationMode } from "./registration-policy.js";

const SESSION_TTL_MS = SESSION_MAX_AGE_MS;

export interface SessionResult {
  plainToken: string;
  expiresAt: Date;
  user: { id: string; email: string; fullName: string; organizationId: string };
}

export interface MfaChallengeResult {
  mfaRequired: true;
  challengeToken: string;
}

export interface RequestMetadata {
  ipAddress: string;
  userAgent: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly loginThrottle: LoginThrottleService,
    private readonly account: AccountService,
  ) {}

  /** Politique publique d'inscription : le mode configure et son effet actuel. */
  async registrationStatus(): Promise<{ mode: RegistrationMode; open: boolean }> {
    const mode = registrationMode();
    if (mode !== "first-organization") return { mode, open: mode === "open" };
    return { mode, open: registrationAllowed(mode, await this.prisma.organization.count()) };
  }

  /**
   * Bootstrap d'un nouveau tenant : Organization + Company + role OWNER
   * (toutes les permissions Core) + premier utilisateur + session ouverte.
   * Operation transactionnelle — invariant docs/foundation/01-architecture.md §5.1.
   */
  async registerOrganization(body: RegisterOrganizationDto, metadata: RequestMetadata): Promise<SessionResult> {
    // Avant toute consommation du budget anti-abus : une instance fermee ne doit rien enregistrer.
    if (!(await this.registrationStatus()).open) {
      throw new ForbiddenException("Organization registration is closed on this instance");
    }
    const configuredLimit = Number(process.env.REGISTRATION_LIMIT ?? 5);
    const maxAttempts = Number.isInteger(configuredLimit) && configuredLimit >= 1 && configuredLimit <= 1000 ? configuredLimit : 5;
    const budget = await this.loginThrottle.reserveAttempt("register-organization", metadata.ipAddress, maxAttempts);
    if (!budget.allowed) throw new HttpException({ message: "Too many registration attempts. Try again later.", retryAfterSeconds: budget.retryAfterSeconds }, HttpStatus.TOO_MANY_REQUESTS);
    const input = parseRegistration(body);
    const existing = await this.prisma.organization.findUnique({
      where: { slug: input.organizationSlug },
    });
    if (existing) {
      throw new ConflictException(`Organization slug "${input.organizationSlug}" already exists`);
    }

    const passwordHash = await hashPassword(input.ownerPassword);

    const result = await this.prisma.$transaction(async (tx) => {
      if (registrationMode() === "first-organization") {
        // Deux inscriptions simultanees sur une instance vide : une seule devient la premiere organisation.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('axora:first-organization', 0))`;
        if ((await tx.organization.count()) > 0) {
          throw new ForbiddenException("Organization registration is closed on this instance");
        }
      }
      const organization = await tx.organization.create({
        data: { name: input.organizationName, slug: input.organizationSlug },
      });

      const company = await tx.company.create({
        data: { organizationId: organization.id, name: input.companyName },
      });

      const user = await tx.user.create({
        data: {
          organizationId: organization.id,
          email: input.ownerEmail,
          passwordHash,
          fullName: input.ownerFullName,
        },
      });

      // Le proprietaire doit etre membre de sa propre entreprise : le scope
      // entreprise des modules metier (INC-02 et suivants) est resolu depuis
      // CompanyMembership, jamais depuis un identifiant transmis par le client.
      await tx.companyMembership.create({
        data: { userId: user.id, companyId: company.id },
      });

      // Pipeline commercial par defaut de l'entreprise (INC-02) — etapes
      // reconfigurables ensuite via crm.pipeline.manage.
      await tx.crmPipelineStage.createMany({
        data: DEFAULT_PIPELINE_STAGES.map((stage) => ({
          organizationId: organization.id,
          companyId: company.id,
          name: stage.name,
          position: stage.position,
          probability: stage.probability,
          isWon: stage.isWon,
          isLost: stage.isLost,
        })),
      });

      // Assure que toutes les permissions du produit existent (idempotent).
      const permissionKeys = Object.values(ALL_PERMISSIONS);
      for (const key of permissionKeys) {
        await tx.permission.upsert({
          where: { key },
          update: {},
          create: { key, description: `Permission systeme: ${key}` },
        });
      }

      const ownerRole = await tx.role.create({
        data: {
          organizationId: organization.id,
          name: "OWNER",
          isSystem: true,
        },
      });

      const permissions = await tx.permission.findMany({
        where: { key: { in: permissionKeys } },
      });
      await tx.rolePermission.createMany({
        data: permissions.map((permission) => ({
          roleId: ownerRole.id,
          permissionId: permission.id,
        })),
      });

      await tx.roleAssignment.create({
        data: { userId: user.id, roleId: ownerRole.id },
      });

      await tx.auditLog.create({
        data: {
          organizationId: organization.id,
          actorUserId: user.id,
          action: "organization.bootstrap",
          resourceType: "Organization",
          resourceId: organization.id,
          metadata: { ipAddress: metadata.ipAddress },
        },
      });

      return { organization, user };
    });

    const session = await this.createSession(result.user.id);
    return {
      plainToken: session.plainToken,
      expiresAt: session.expiresAt,
      user: {
        id: result.user.id,
        email: result.user.email,
        fullName: result.user.fullName,
        organizationId: result.organization.id,
      },
    };
  }

  async login(body: LoginDto, metadata: RequestMetadata): Promise<SessionResult | MfaChallengeResult> {
    const input = parseLogin(body);
    const normalizedEmail = input.email.trim().toLowerCase();
    await this.loginThrottle.enforce(normalizedEmail, metadata.ipAddress);

    // Email is unique per tenant. Never silently pick a tenant when two
    // organisations contain the same email; the optional slug disambiguates.
    const candidates = await this.prisma.user.findMany({
      where: { email: normalizedEmail, ...(input.organizationSlug ? { organization: { slug: input.organizationSlug } } : {}) }, take: 2,
    });
    const user = candidates.length === 1 ? candidates[0] : undefined;
    const validPassword = await verifyPassword(input.password, user?.passwordHash ?? `${"0".repeat(32)}:${"0".repeat(128)}`);
    if (!user || !user.isActive || !validPassword) {
      await this.loginThrottle.recordFailure(normalizedEmail, metadata.ipAddress);
      throw new UnauthorizedException("Invalid credentials");
    }

    await this.loginThrottle.recordSuccess(normalizedEmail, metadata.ipAddress);

    if (user.mfaEnabled) {
      // Mot de passe valide mais second facteur requis : aucun cookie de
      // session n'est emis avant la verification du code TOTP.
      if (!parseEncryptionKey(process.env.MFA_ENCRYPTION_KEY) && user.mfaRecoveryCodeHashes.length === 0) {
        throw new ServiceUnavailableException("MFA is required for this account but not configured on this server");
      }
      return { mfaRequired: true, challengeToken: await this.account.issueChallenge(user.id, metadata) };
    }

    const session = await this.createAuditedLoginSession(user, metadata);

    return {
      plainToken: session.plainToken,
      expiresAt: session.expiresAt,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        organizationId: user.organizationId,
      },
    };
  }

  async context(user: AuthenticatedUser) {
    const [organization, memberships, assignments] = await Promise.all([
      this.prisma.organization.findUnique({
        where: { id: user.organizationId },
        select: { id: true, name: true, slug: true, isDemo: true },
      }),
      this.prisma.companyMembership.findMany({
        where: { userId: user.id, company: { organizationId: user.organizationId } },
        include: { company: { select: { id: true, name: true, currency: true } } },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.roleAssignment.findMany({
        where: { userId: user.id, role: { organizationId: user.organizationId } },
        include: { role: { include: { permissions: { include: { permission: true } } } } },
      }),
    ]);

    const permissions = new Set<string>();
    const roles = new Set<string>();
    for (const assignment of assignments) {
      roles.add(assignment.role.name);
      for (const grant of assignment.role.permissions) permissions.add(grant.permission.key);
    }

    return {
      user,
      organization,
      companies: memberships.map((membership) => ({ ...membership.company, currency: membership.company.currency.trim() })),
      roles: [...roles].sort(),
      permissions: [...permissions].sort(),
    };
  }

  async logout(plainToken: string): Promise<void> {
    const { hashSessionToken } = await import("@axora24/security");
    const tokenHash = hashSessionToken(plainToken);
    const session = await this.prisma.session.findUnique({
      where: { tokenHash },
      include: { user: { select: { organizationId: true } } },
    });

    if (!session || session.revokedAt) {
      return;
    }

    await this.prisma.$transaction([
      this.prisma.session.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      }),
      this.prisma.auditLog.create({
        data: {
          organizationId: session.user.organizationId,
          actorUserId: session.userId,
          action: "auth.logout.succeeded",
          resourceType: "Session",
          resourceId: session.tokenHash,
          metadata: { outcome: "SUCCESS" },
        },
      }),
    ]);
  }

  private async createSession(userId: string): Promise<{ plainToken: string; expiresAt: Date }> {
    const { plainToken, tokenHash } = createSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await this.prisma.session.create({
      data: { userId, tokenHash, expiresAt: new Date(Date.now() + SESSION_IDLE_MS) },
    });
    return { plainToken, expiresAt };
  }

  private async createAuditedLoginSession(
    user: { id: string; organizationId: string },
    metadata: RequestMetadata,
  ): Promise<{ plainToken: string; expiresAt: Date }> {
    const { plainToken, tokenHash } = createSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    await this.prisma.$transaction([
      this.prisma.session.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt: new Date(Date.now() + SESSION_IDLE_MS),
          ipAddress: metadata.ipAddress,
          userAgent: metadata.userAgent,
        },
      }),
      this.prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      }),
      this.prisma.auditLog.create({
        data: {
          organizationId: user.organizationId,
          actorUserId: user.id,
          action: "auth.login.succeeded",
          resourceType: "Session",
          resourceId: tokenHash,
          metadata: {
            outcome: "SUCCESS",
            ipAddress: metadata.ipAddress,
            userAgent: metadata.userAgent,
          },
        },
      }),
    ]);

    return { plainToken, expiresAt };
  }
}
