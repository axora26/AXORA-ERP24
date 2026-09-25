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

/** INC-08 — Finance. Saisie, approbation et paiement des factures fournisseurs sont separes. */
export const FINANCE_PERMISSIONS = {
  INVOICE_READ: "finance.invoice.read",
  INVOICE_MANAGE: "finance.invoice.manage",
  PAYABLE_READ: "finance.payable.read",
  PAYABLE_MANAGE: "finance.payable.manage",
  PAYABLE_APPROVE: "finance.payable.approve",
  PAYMENT_CREATE: "finance.payment.create",
  BANK_MANAGE: "finance.bank.manage",
  SETTINGS_MANAGE: "finance.settings.manage",
} as const;

/** INC-09 — RH. Donnees salariales et paie derriere une permission distincte. */
export const HR_PERMISSIONS = {
  EMPLOYEE_READ: "hr.employee.read",
  EMPLOYEE_MANAGE: "hr.employee.manage",
  ATTENDANCE_CREATE: "hr.attendance.create",
  TIMESHEET_MANAGE: "hr.timesheet.manage",
  TIMESHEET_VALIDATE: "hr.timesheet.validate",
  LEAVE_REQUEST: "hr.leave.request",
  LEAVE_APPROVE: "hr.leave.approve",
  PAYROLL_READ: "hr.payroll.read",
  PAYROLL_MANAGE: "hr.payroll.manage",
} as const;

/** INC-10 — GED : documents versionnes, approbation par un tiers, fichiers immuables. */
export const DOCUMENTS_PERMISSIONS = {
  DOCUMENT_READ: "documents.document.read",
  DOCUMENT_MANAGE: "documents.document.manage",
  DOCUMENT_APPROVE: "documents.document.approve",
  FILE_UPLOAD: "documents.file.upload",
} as const;

/** INC-10 — Chantier : journal, preuves horodatees, reserves, synchronisation hors ligne. */
export const FIELD_PERMISSIONS = {
  SITE_READ: "field.site.read",
  LOG_MANAGE: "field.log.manage",
  LOG_SIGN: "field.log.sign",
  EVIDENCE_CREATE: "field.evidence.create",
  ISSUE_MANAGE: "field.issue.manage",
  ISSUE_CLOSE: "field.issue.close",
} as const;

/** INC-11 — QHSE : NCR immuables, verification et cloture par un tiers. */
export const QHSE_PERMISSIONS = {
  READ: "qhse.inspection.read",
  INSPECTION_MANAGE: "qhse.inspection.manage",
  FINDING_CREATE: "qhse.finding.create",
  ACTION_MANAGE: "qhse.action.manage",
  FINDING_CLOSE: "qhse.finding.close",
  INCIDENT_REPORT: "qhse.incident.report",
  INCIDENT_MANAGE: "qhse.incident.manage",
  PERMIT_REQUEST: "qhse.permit.request",
  PERMIT_APPROVE: "qhse.permit.approve",
  TOOLBOX_MANAGE: "qhse.toolbox.manage",
} as const;

/** INC-13 — MEP : notes de calcul transparentes, validees par un autre ingenieur. */
export const MEP_PERMISSIONS = {
  READ: "mep.system.read",
  MANAGE: "mep.system.manage",
  CALCULATION_MANAGE: "mep.calculation.manage",
  CALCULATION_VALIDATE: "mep.calculation.validate",
} as const;

/** INC-12 — Commissioning : sequence d'essais non contournable, reception par un tiers. */
export const COMMISSIONING_PERMISSIONS = {
  READ: "commissioning.activity.read",
  MANAGE: "commissioning.activity.manage",
  ACCEPT: "commissioning.activity.accept",
} as const;

/** INC-14 — BIM : versions IFC verifiees par empreinte, visa et resolution de conflits par un tiers. */
export const BIM_PERMISSIONS = {
  MODEL_READ: "bim.model.read",
  MODEL_MANAGE: "bim.model.manage",
  MODEL_APPROVE: "bim.model.approve",
  CLASH_MANAGE: "bim.clash.manage",
} as const;

/** INC-15 — Actifs / GMAO : passeports, preventif, tickets, OT, MTBF/MTTR reels. */
export const ASSETS_PERMISSIONS = {
  ASSET_READ: "assets.asset.read",
  ASSET_MANAGE: "assets.asset.manage",
  TICKET_CREATE: "assets.ticket.create",
  WORKORDER_MANAGE: "assets.workorder.manage",
} as const;

/** INC-16 — Smart Building. Les essais reels et les consignes sont des permissions distinctes. */
export const SMART_PERMISSIONS = {
  READ: "smart.building.read",
  MANAGE: "smart.building.manage",
  ALARM_ACK: "smart.alarm.acknowledge",
  SETPOINT_REQUEST: "smart.setpoint.request",
  GATEWAY_TEST: "smart.gateway.test",
} as const;

/** INC-17 — Energie. L'import d'intervalles est une permission distincte de la configuration. */
export const ENERGY_PERMISSIONS = {
  READ: "energy.meter.read",
  MANAGE: "energy.meter.manage",
  IMPORT: "energy.interval.import",
  ALERT_ACK: "energy.alert.acknowledge",
} as const;

/** INC-18 — Parc. Affectation, carburant et incidents sont des permissions distinctes de la gestion du parc. */
export const FLEET_PERMISSIONS = {
  READ: "fleet.vehicle.read",
  MANAGE: "fleet.vehicle.manage",
  ASSIGN: "fleet.assignment.manage",
  FUEL: "fleet.fuel.record",
  INCIDENT: "fleet.incident.report",
} as const;

/** INC-19 — Sous-traitants. Qualification, preparation et approbation des situations sont separees. */
export const SUBCONTRACTING_PERMISSIONS = {
  READ: "subcontracting.package.read",
  MANAGE: "subcontracting.package.manage",
  QUALIFY: "subcontracting.subcontractor.qualify",
  STATEMENT_PREPARE: "subcontracting.statement.prepare",
  STATEMENT_APPROVE: "subcontracting.statement.approve",
  RETENTION_RELEASE: "subcontracting.retention.release",
} as const;

/** INC-20 — Portails externes : gestion des identites externes et des expositions (jamais d'heritage RBAC). */
export const PORTAL_PERMISSIONS = {
  READ: "portal.principal.read",
  MANAGE: "portal.principal.manage",
  GRANT: "portal.grant.manage",
} as const;

/** INC-21 — Workflow & automatisation. Decider une approbation exige aussi le role approbateur designe. */
export const WORKFLOW_PERMISSIONS = {
  READ: "workflow.definition.read",
  MANAGE: "workflow.definition.manage",
  APPROVE: "workflow.approval.decide",
} as const;

/**
 * INC-22 — Copilote IA. Utiliser le copilote n'accorde AUCUN acces : chaque
 * outil de lecture exige en plus la permission de lecture de son module.
 */
export const AI_PERMISSIONS = {
  USE: "ai.copilot.use",
  AUDIT: "ai.evidence.read",
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
/** Groupes de permissions par module, dans l'ordre d'affichage du catalogue. */
export const PERMISSION_GROUPS = [
  CORE_PERMISSIONS,
  CRM_PERMISSIONS,
  ESTIMATION_PERMISSIONS,
  SALES_PERMISSIONS,
  PROJECT_PERMISSIONS,
  PROCUREMENT_PERMISSIONS,
  INVENTORY_PERMISSIONS,
  FINANCE_PERMISSIONS,
  HR_PERMISSIONS,
  DOCUMENTS_PERMISSIONS,
  FIELD_PERMISSIONS,
  QHSE_PERMISSIONS,
  MEP_PERMISSIONS,
  COMMISSIONING_PERMISSIONS,
  BIM_PERMISSIONS,
  ASSETS_PERMISSIONS,
  SMART_PERMISSIONS,
  ENERGY_PERMISSIONS,
  FLEET_PERMISSIONS,
  SUBCONTRACTING_PERMISSIONS,
  PORTAL_PERMISSIONS,
  WORKFLOW_PERMISSIONS,
  AI_PERMISSIONS,
  DASHBOARD_PERMISSIONS,
] as const;

type GroupValues<T> = T extends Record<string, infer V> ? V : never;

/** Toute cle de permission connue du produit. */
export type PermissionKey = GroupValues<(typeof PERMISSION_GROUPS)[number]>;

/**
 * Catalogue indexe par la cle de permission elle-meme : deux modules peuvent
 * nommer leurs constantes READ/MANAGE sans jamais s'ecraser (une fusion
 * d'objets par nom de constante perdait silencieusement des permissions).
 */
export const ALL_PERMISSIONS = Object.freeze(
  Object.fromEntries(PERMISSION_GROUPS.flatMap((group) => Object.values(group)).map((key) => [key, key])),
) as { readonly [K in PermissionKey]: K };

export type CorePermissionKey =
  (typeof CORE_PERMISSIONS)[keyof typeof CORE_PERMISSIONS];

export type CrmPermissionKey =
  (typeof CRM_PERMISSIONS)[keyof typeof CRM_PERMISSIONS];

export type EstimationPermissionKey =
  (typeof ESTIMATION_PERMISSIONS)[keyof typeof ESTIMATION_PERMISSIONS];

export type SalesPermissionKey =
  (typeof SALES_PERMISSIONS)[keyof typeof SALES_PERMISSIONS];


export interface PermissionCheck {
  key: PermissionKey | string;
  organizationId: string;
  companyId?: string;
  projectId?: string;
}
