/**
 * Socle multi-tenant partage : Organization -> Company -> Branch/Site -> Project.
 * Reference : docs/foundation/02-domain-model.md §"Socle multi-tenant partage".
 *
 * INVARIANT NON NEGOCIABLE : un identifiant tenant transmis par le client
 * (header, body, query) n'est JAMAIS une preuve d'autorisation a lui seul.
 * L'autorisation reelle est toujours recalculee cote serveur a partir de la
 * session (voir packages/security).
 */

export interface TenantScope {
  organizationId: string;
  companyId: string;
  branchId?: string;
  projectId?: string;
}

export interface DemoFlagged {
  /** true si l'enregistrement appartient a l'organisation DEMO — jamais confondu avec une donnee reelle. */
  isDemo: boolean;
}

export type EntityId = string;

export interface AuditableEntity {
  id: EntityId;
  createdAt: string;
  createdBy: EntityId;
  updatedAt: string;
  updatedBy: EntityId;
}
