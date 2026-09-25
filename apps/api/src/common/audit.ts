import type { Prisma } from "@axora24/database";
import type { CompanyScope } from "./company-scope.service.js";

type AuditClient = Pick<Prisma.TransactionClient, "auditLog">;

/**
 * Ecriture d'une entree du journal d'audit append-only, dans la MEME
 * transaction que la mutation auditee : si la mutation echoue, aucune trace
 * orpheline ; si l'audit echoue, la mutation est annulee.
 *
 * Ne jamais y placer de secret (mot de passe, token, cle) — seulement des
 * identifiants et des valeurs metier.
 */
export async function writeAudit(
  tx: AuditClient,
  scope: Pick<CompanyScope, "organizationId"> & { companyId?: string },
  actorUserId: string | null,
  action: string,
  resourceType: string,
  resourceId: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await tx.auditLog.create({
    data: {
      organizationId: scope.organizationId,
      actorUserId,
      action,
      resourceType,
      resourceId,
      metadata: JSON.parse(
        JSON.stringify({ ...(scope.companyId ? { companyId: scope.companyId } : {}), ...metadata }),
      ) as Prisma.InputJsonValue,
    },
  });
}
