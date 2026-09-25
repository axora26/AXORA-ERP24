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

/**
 * INC-02 — CRM. Lecture et ecriture separees : un commercial peut consulter
 * le pipeline sans pouvoir reconfigurer ses etapes.
 */
export const CRM_PERMISSIONS = {
  ACCOUNT_READ: "crm.account.read",
  ACCOUNT_MANAGE: "crm.account.manage",
  CONTACT_READ: "crm.contact.read",
  CONTACT_MANAGE: "crm.contact.manage",
  LEAD_READ: "crm.lead.read",
  LEAD_MANAGE: "crm.lead.manage",
  OPPORTUNITY_READ: "crm.opportunity.read",
  OPPORTUNITY_MANAGE: "crm.opportunity.manage",
  ACTIVITY_READ: "crm.activity.read",
  ACTIVITY_CREATE: "crm.activity.create",
  PIPELINE_MANAGE: "crm.pipeline.manage",
} as const;

/** INC-03 — Study, DQE/BPU et sources de prix. */
export const ESTIMATION_PERMISSIONS = {
  STUDY_READ: "estimation.study.read",
  STUDY_MANAGE: "estimation.study.manage",
  DQE_READ: "estimation.dqe.read",
  DQE_MANAGE: "estimation.dqe.manage",
  PRICING_READ: "estimation.pricing.read",
  PRICING_MANAGE: "estimation.pricing.manage",
  LIBRARY_READ: "estimation.library.read",
  LIBRARY_MANAGE: "estimation.library.manage",
} as const;

/** INC-04 — Devis (issus d'un DQE finalise) et contrat (issu d'un devis accepte). */
export const SALES_PERMISSIONS = {
  QUOTE_READ: "sales.quote.read",
  QUOTE_MANAGE: "sales.quote.manage",
  CONTRACT_READ: "sales.contract.read",
  CONTRACT_MANAGE: "sales.contract.manage",
} as const;

/** INC-05 — Projets & Construction. L'approbation d'avenant est separee de leur saisie. */
export const PROJECT_PERMISSIONS = {
  PROJECT_READ: "projects.project.read",
  PROJECT_MANAGE: "projects.project.manage",
  BUDGET_MANAGE: "projects.budget.manage",
  CHANGE_ORDER_APPROVE: "projects.changeorder.approve",
  TASK_MANAGE: "projects.task.manage",
} as const;

/** INC-06 — Achats. L'approbation des demandes est separee de leur saisie. */
export const PROCUREMENT_PERMISSIONS = {
  SUPPLIER_READ: "procurement.supplier.read",
  SUPPLIER_MANAGE: "procurement.supplier.manage",
  REQUEST_READ: "procurement.request.read",
  REQUEST_CREATE: "procurement.request.create",
  REQUEST_APPROVE: "procurement.request.approve",
  ORDER_READ: "procurement.order.read",
  ORDER_MANAGE: "procurement.order.manage",
  RECEIPT_CREATE: "procurement.receipt.create",
} as const;

/** INC-07 — Stock & Logistique. Les ajustements (hors flux) sont une permission distincte. */
export const INVENTORY_PERMISSIONS = {
  ITEM_READ: "inventory.item.read",
  ITEM_MANAGE: "inventory.item.manage",
  MOVEMENT_CREATE: "inventory.movement.create",
  ADJUSTMENT_CREATE: "inventory.adjustment.create",
  COUNT_MANAGE: "inventory.count.manage",
} as const;

/** Vue d'ensemble : chaque section reste soumise a la permission de lecture de son module. */
export const DASHBOARD_PERMISSIONS = {
  OVERVIEW_READ: "dashboard.overview.read",
} as const;

/**
 * Toutes les permissions connues du produit. Le role systeme OWNER cree au
 * bootstrap d'une organisation les recoit toutes ; les autres roles sont
 * construits explicitement (deny-by-default, docs/foundation/03-security.md).
 */
export const ALL_PERMISSIONS = {
  ...CORE_PERMISSIONS,
  ...CRM_PERMISSIONS,
  ...ESTIMATION_PERMISSIONS,
  ...SALES_PERMISSIONS,
  ...PROJECT_PERMISSIONS,
  ...PROCUREMENT_PERMISSIONS,
  ...INVENTORY_PERMISSIONS,
  ...DASHBOARD_PERMISSIONS,
} as const;

export type CorePermissionKey =
  (typeof CORE_PERMISSIONS)[keyof typeof CORE_PERMISSIONS];

export type CrmPermissionKey =
  (typeof CRM_PERMISSIONS)[keyof typeof CRM_PERMISSIONS];

export type EstimationPermissionKey =
  (typeof ESTIMATION_PERMISSIONS)[keyof typeof ESTIMATION_PERMISSIONS];

export type SalesPermissionKey =
  (typeof SALES_PERMISSIONS)[keyof typeof SALES_PERMISSIONS];

export type PermissionKey =
  (typeof ALL_PERMISSIONS)[keyof typeof ALL_PERMISSIONS];

export interface PermissionCheck {
  key: PermissionKey | string;
  organizationId: string;
  companyId?: string;
  projectId?: string;
}
