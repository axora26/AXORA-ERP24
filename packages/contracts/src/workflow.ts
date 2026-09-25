/**
 * INC-21 — Workflow Engine & Automatisation. Evenements types emis par les
 * modules ; definitions configurables Evenement -> Condition -> Action.
 */

export type AutomationFieldType = "text" | "decimal";

/** Catalogue des evenements emis par les modules (le moteur ne connait que ces types). */
export const AUTOMATION_EVENTS = {
  "procurement.request.submitted": {
    label: "Demande d'achat soumise",
    resourceType: "PurchaseRequest",
    link: "/procurement",
    fields: { code: "text", title: "text", estimatedTotal: "decimal", currency: "text" },
  },
  "finance.payable.recorded": {
    label: "Facture fournisseur enregistrée",
    resourceType: "SupplierInvoice",
    link: "/finance",
    fields: { code: "text", supplierName: "text", total: "decimal", currency: "text", matchStatus: "text" },
  },
  "qhse.finding.created": {
    label: "Non-conformité ouverte",
    resourceType: "QhseFinding",
    link: "/qhse",
    fields: { code: "text", title: "text", severity: "text", domain: "text" },
  },
  "assets.ticket.created": {
    label: "Ticket de maintenance signalé",
    resourceType: "MaintenanceTicket",
    link: "/assets",
    fields: { code: "text", title: "text", priority: "text", assetCode: "text" },
  },
  "smart.alarm.raised": {
    label: "Alarme technique déclenchée",
    resourceType: "SmartAlarm",
    link: "/smart",
    fields: { message: "text", severity: "text", triggerValue: "decimal", pointName: "text" },
  },
  "fleet.incident.reported": {
    label: "Incident de parc déclaré",
    resourceType: "FleetIncident",
    link: "/fleet",
    fields: { code: "text", kind: "text", vehicleCode: "text", cost: "decimal" },
  },
  "subcontracting.statement.prepared": {
    label: "Situation de sous-traitance préparée",
    resourceType: "SubcontractStatement",
    link: "/subcontracting",
    fields: { code: "text", supplierName: "text", grossAmount: "decimal", netAmount: "decimal" },
  },
} as const satisfies Record<string, { label: string; resourceType: string; link: string; fields: Record<string, AutomationFieldType> }>;

export type AutomationEventType = keyof typeof AUTOMATION_EVENTS;

/** Ressources dont l'action metier sensible attend la levee des approbations de workflow. */
export const WORKFLOW_GATED_RESOURCES = ["PurchaseRequest", "SupplierInvoice", "SubcontractStatement"] as const;

export type WorkflowOperator = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "contains";

export interface WorkflowCondition {
  field: string;
  operator: WorkflowOperator;
  value: string;
}

export type WorkflowActionView =
  | { type: "NOTIFY"; roleId: string; roleName: string; title: string; body: string }
  | { type: "REQUIRE_APPROVAL"; approverRoleId: string; approverRoleName: string; escalationRoleId: string | null; escalationRoleName: string | null; slaHours: number; title: string }
  | { type: "WEBHOOK"; url: string };

export interface WorkflowDefinitionView {
  id: string;
  code: string;
  version: number;
  name: string;
  description: string | null;
  eventType: string;
  eventLabel: string;
  conditions: WorkflowCondition[];
  actions: WorkflowActionView[];
  active: boolean;
  createdByName: string;
  createdAt: string;
  executions: number;
  failures: number;
}

/** Creation : les secrets de signature des webhooks ne sont montres qu'une fois. */
export interface WorkflowDefinitionCreated {
  definition: WorkflowDefinitionView;
  webhookSecrets: Array<{ url: string; secret: string }>;
}

export interface AutomationExecutionView {
  id: string;
  definitionId: string;
  definitionCode: string;
  definitionName: string;
  eventType: string;
  eventLabel: string;
  resourceType: string;
  resourceId: string;
  status: "SUCCEEDED" | "FAILED";
  log: Array<{ action: string; ok: boolean; detail: string }>;
  error: string | null;
  finishedAt: string;
}

export interface WorkflowApprovalView {
  id: string;
  code: string;
  title: string;
  resourceType: string;
  resourceId: string;
  link: string | null;
  requesterName: string | null;
  approverRoleName: string;
  dueAt: string;
  overdue: boolean;
  escalatedAt: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  canDecide: boolean;
}

export interface NotificationView {
  id: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface WebhookDeliveryView {
  id: string;
  definitionId: string;
  definitionCode: string;
  url: string;
  status: "PENDING" | "DELIVERED" | "FAILED";
  attempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  nextAttemptAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

export interface WorkflowSummaryView {
  activeDefinitions: number;
  pendingApprovals: number;
  overdueApprovals: number;
  failedExecutions: number;
  failedDeliveries: number;
  pendingEvents: number;
}
