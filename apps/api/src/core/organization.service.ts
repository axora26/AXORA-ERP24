import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { parseEncryptionKey } from "@axora24/security";
import { PrismaService } from "./prisma.service.js";
import { assertBody } from "../common/validation.js";
import type { AuthenticatedUser } from "../auth/session.guard.js";

/**
 * INVARIANT NON NEGOCIABLE (docs/foundation/02-domain-model.md,
 * docs/foundation/03-security.md) : Organization est la racine du tenant.
 * Un utilisateur ne doit JAMAIS pouvoir lire ou lister une organisation
 * autre que la sienne — il n'existe pas de role "super-admin cross-tenant"
 * dans ce module. Toute methode ici prend organizationId en parametre et
 * l'utilise comme filtre serveur, jamais deduit d'une valeur cliente libre.
 */
@Injectable()
export class OrganizationService {
  constructor(private readonly prisma: PrismaService) {}

  /** Retourne UNIQUEMENT l'organisation de l'appelant (jamais une liste globale). */
  async getOwn(organizationId: string) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!organization) {
      throw new NotFoundException("Organization not found");
    }
    return organization;
  }

  async updateSecurityPolicy(user: AuthenticatedUser, body: unknown) {
    const input = assertBody(body);
    if (Object.keys(input).some((key) => key !== "mfaRequired") || typeof input.mfaRequired !== "boolean") {
      throw new BadRequestException("mfaRequired must be a boolean");
    }
    const mfaRequired = input.mfaRequired;
    if (mfaRequired && !parseEncryptionKey(process.env.MFA_ENCRYPTION_KEY)) {
      throw new ServiceUnavailableException("MFA is not configured on this server (MFA_ENCRYPTION_KEY missing or invalid)");
    }
    return this.prisma.$transaction(async (tx) => {
      // Organization first, then actor: disableMfa uses the same lock order so
      // policy activation and factor removal cannot both commit from stale reads.
      await tx.$queryRaw`SELECT "id" FROM "organizations" WHERE "id" = ${user.organizationId} FOR UPDATE`;
      if (mfaRequired) {
        await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${user.id} AND "organizationId" = ${user.organizationId} FOR UPDATE`;
        const actor = await tx.user.findFirst({
          where: { id: user.id, organizationId: user.organizationId },
          select: { mfaEnabled: true },
        });
        if (!actor?.mfaEnabled) throw new BadRequestException("Enable MFA on your account before requiring it for the organization");
      }
      const organization = await tx.organization.update({
        where: { id: user.organizationId },
        data: { mfaRequired },
      });
      await tx.auditLog.create({
        data: {
          organizationId: user.organizationId,
          actorUserId: user.id,
          action: "organization.security.mfa_policy.updated",
          resourceType: "Organization",
          resourceId: user.organizationId,
          metadata: { mfaRequired },
        },
      });
      return organization;
    });
  }
}
