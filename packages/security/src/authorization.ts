/**
 * Moteur d'autorisation deny-by-default.
 * Reference : docs/foundation/03-security.md, docs/foundation/02-domain-model.md.
 *
 * Un identifiant tenant transmis par le client N'EST JAMAIS une preuve
 * d'autorisation : cette fonction ne fait confiance qu'aux grants resolus
 * cote serveur (ex: charges depuis la base a partir de la session).
 */
import type { PermissionCheck } from "@axora24/contracts";

export interface ResolvedGrant {
  permissionKey: string;
  organizationId: string;
  companyId?: string;
  projectId?: string;
}

/**
 * Verifie qu'un grant serveur autorise explicitement la permission demandee,
 * dans le meme scope tenant (organisation/societe/projet). Retourne false
 * par defaut si aucun grant ne correspond exactement.
 */
export function isAuthorized(
  check: PermissionCheck,
  serverResolvedGrants: ResolvedGrant[],
): boolean {
  return serverResolvedGrants.some((grant) => {
    if (grant.permissionKey !== check.key) return false;
    if (grant.organizationId !== check.organizationId) return false;
    if (check.companyId && grant.companyId !== check.companyId) return false;
    if (check.projectId && grant.projectId !== check.projectId) return false;
    return true;
  });
}

/**
 * Garde d'assertion : leve une erreur si non autorise. A utiliser dans les
 * services/guards NestJS avant toute mutation ou lecture sensible.
 */
export function assertAuthorized(
  check: PermissionCheck,
  serverResolvedGrants: ResolvedGrant[],
): void {
  if (!isAuthorized(check, serverResolvedGrants)) {
    throw new Error(`FORBIDDEN: missing permission "${check.key}" in tenant scope`);
  }
}
