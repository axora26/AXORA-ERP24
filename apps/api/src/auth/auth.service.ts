import { ConflictException, Injectable, UnauthorizedException } from "@nestjs/common";
import { hashPassword, verifyPassword, createSessionToken } from "@axora24/security";
import { CORE_PERMISSIONS } from "@axora24/contracts";
import { PrismaService } from "../core/prisma.service.js";
import type { LoginDto, RegisterOrganizationDto } from "./auth.dto.js";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 jours

export interface SessionResult {
  plainToken: string;
  expiresAt: Date;
  user: { id: string; email: string; fullName: string; organizationId: string };
}

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

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

      await tx.company.create({
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

      // Assure que toutes les permissions Core existent (idempotent).
      const permissionKeys = Object.values(CORE_PERMISSIONS);
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

  async login(input: LoginDto): Promise<SessionResult> {
    // NOTE : email n'est pas garanti unique globalement (unique par organizationId),
    // donc on prend le premier utilisateur actif correspondant. Une evolution
    // multi-organisation par email necessitera un ecran de selection d'organisation.
    const user = await this.prisma.user.findFirst({
      where: { email: input.email, isActive: true },
    });

    if (!user) {
      throw new UnauthorizedException("Invalid credentials");
    }

    const validPassword = await verifyPassword(input.password, user.passwordHash);
    if (!validPassword) {
      throw new UnauthorizedException("Invalid credentials");
    }

    const session = await this.createSession(user.id);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

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

  async logout(plainToken: string): Promise<void> {
    const { hashSessionToken } = await import("@axora24/security");
    const tokenHash = hashSessionToken(plainToken);
    await this.prisma.session.updateMany({
      where: { tokenHash },
      data: { revokedAt: new Date() },
    });
  }

  private async createSession(userId: string): Promise<{ plainToken: string; expiresAt: Date }> {
    const { plainToken, tokenHash } = createSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await this.prisma.session.create({
      data: { userId, tokenHash, expiresAt },
    });
    return { plainToken, expiresAt };
  }
}
