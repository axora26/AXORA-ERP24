import { ConflictException, Injectable, UnauthorizedException } from "@nestjs/common";
import { hashPassword, verifyPassword, createSessionToken } from "@axora24/security";
import { ALL_PERMISSIONS } from "@axora24/contracts";
import { DEFAULT_PIPELINE_STAGES } from "../crm/pipeline.defaults.js";
import { PrismaService } from "../core/prisma.service.js";
import type { LoginDto, RegisterOrganizationDto } from "./auth.dto.js";
import type { AuthenticatedUser } from "./session.guard.js";
import { LoginThrottleService } from "./login-throttle.service.js";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 jours

export interface SessionResult {
  plainToken: string;
  expiresAt: Date;
  user: { id: string; email: string; fullName: string; organizationId: string };
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
  ) {}

  /**
   * Bootstrap d'un nouveau tenant : Organization + Company + role OWNER
   * (toutes les permissions Core) + premier utilisateur + session ouverte.
   * Operation transactionnelle — invariant docs/foundation/01-architecture.md §5.1.
   */
  async registerOrganization(input: RegisterOrganizationDto): Promise<SessionResult> {
    const existing = await this.prisma.organization.findUnique({
      where: { slug: input.organizationSlug },
    });
    if (existing) {
      throw new ConflictException(`Organization slug "${input.organizationSlug}" already exists`);
    }

    const passwordHash = await hashPassword(input.ownerPassword);

    const result = await this.prisma.$transaction(async (tx) => {
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

  async login(input: LoginDto, metadata: RequestMetadata): Promise<SessionResult> {
    const normalizedEmail = input.email.trim().toLowerCase();
    await this.loginThrottle.enforce(normalizedEmail, metadata.ipAddress);

    // NOTE : email n'est pas garanti unique globalement (unique par organizationId),
    // donc on prend le premier utilisateur actif correspondant. Une evolution
    // multi-organisation par email necessitera un ecran de selection d'organisation.
    const user = await this.prisma.user.findFirst({
      where: { email: input.email, isActive: true },
    });

    if (!user) {
      await this.loginThrottle.recordFailure(normalizedEmail, metadata.ipAddress);
      throw new UnauthorizedException("Invalid credentials");
    }

    const validPassword = await verifyPassword(input.password, user.passwordHash);
    if (!validPassword) {
      await this.loginThrottle.recordFailure(normalizedEmail, metadata.ipAddress);
      throw new UnauthorizedException("Invalid credentials");
    }

    await this.loginThrottle.recordSuccess(normalizedEmail, metadata.ipAddress);
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
        include: { company: { select: { id: true, name: true } } },
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
      companies: memberships.map((membership) => membership.company),
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
      data: { userId, tokenHash, expiresAt },
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
          expiresAt,
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
