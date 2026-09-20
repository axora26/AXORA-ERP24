/**
 * Cles de permission declaratives — evaluees UNIQUEMENT cote serveur.
 * Reference : docs/foundation/03-security.md.
 *
 * Convention : "<module>.<ressource>.<action>". Ajouter une cle ici ne
 * l'active pas automatiquement : chaque module doit la faire respecter
 * explicitement via un guard NestJS (packages/security).
 */

export const CORE_PERMISSIONS = {
  ORG_MANAGE: "core.organization.manage",
  COMPANY_MANAGE: "core.company.manage",
  USER_MANAGE: "core.user.manage",
  ROLE_MANAGE: "core.role.manage",
  AUDIT_READ: "core.audit.read",
} as const;

export type PermissionKey =
  (typeof CORE_PERMISSIONS)[keyof typeof CORE_PERMISSIONS];

export interface PermissionCheck {
  key: PermissionKey | string;
  organizationId: string;
  companyId?: string;
  projectId?: string;
}
