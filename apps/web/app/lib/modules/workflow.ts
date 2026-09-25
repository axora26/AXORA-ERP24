import {
  AUTOMATION_EVENTS,
  type AutomationEventType,
  type AutomationExecutionView,
  type NotificationView,
  type WebhookDeliveryView,
  type WorkflowApprovalView,
  type WorkflowCondition,
  type WorkflowDefinitionCreated,
  type WorkflowDefinitionView,
  type WorkflowOperator,
  type WorkflowSummaryView,
} from "@axora24/contracts";
import { api } from "../api";

export const workflowApi = {
  summary: () => api.get<WorkflowSummaryView>("/workflow/summary"),
  roles: () => api.get<Array<{ id: string; name: string }>>("/workflow/roles"),
  definitions: () => api.get<WorkflowDefinitionView[]>("/workflow/definitions"),
  create: (input: Record<string, unknown>) => api.post<WorkflowDefinitionCreated>("/workflow/definitions", input),
  setActive: (id: string, active: boolean) => api.post<WorkflowDefinitionView>(`/workflow/definitions/${id}/active`, { active }),
  executions: (status?: string) => api.get<AutomationExecutionView[]>(`/workflow/executions${status ? `?status=${status}` : ""}`),
  approvals: () => api.get<WorkflowApprovalView[]>("/workflow/approvals"),
  decide: (id: string, decision: "APPROVED" | "REJECTED", note?: string) => api.post<WorkflowApprovalView>(`/workflow/approvals/${id}/decision`, { decision, note }),
  deliveries: () => api.get<WebhookDeliveryView[]>("/workflow/deliveries"),
  retry: (id: string) => api.post<WebhookDeliveryView>(`/workflow/deliveries/${id}/retry`),
  run: () => api.post<{ events: number; executions: number; deliveries: number; escalations: number }>("/workflow/run"),
};

export const notificationsApi = {
  mine: () => api.get<{ unread: number; items: NotificationView[] }>("/notifications"),
  read: (id: string) => api.post<{ unread: number; items: NotificationView[] }>(`/notifications/${id}/read`),
  readAll: () => api.post<{ unread: number; items: NotificationView[] }>("/notifications/read-all"),
};

export const EVENT_OPTIONS = (Object.keys(AUTOMATION_EVENTS) as AutomationEventType[]).map((type) => ({ value: type, label: AUTOMATION_EVENTS[type].label }));

export const FIELD_LABEL: Record<string, string> = {
  code: "Code",
  title: "Intitulé",
  estimatedTotal: "Montant estimé",
  currency: "Devise",
  supplierName: "Fournisseur",
  total: "Montant TTC",
  matchStatus: "Rapprochement",
  severity: "Gravité",
  domain: "Domaine",
  priority: "Priorité",
  assetCode: "Actif",
  message: "Message",
  triggerValue: "Valeur déclenchante",
  pointName: "Point",
  kind: "Nature",
  vehicleCode: "Véhicule",
  cost: "Coût",
  grossAmount: "Montant brut",
  netAmount: "Net à payer",
};

export const OPERATOR_LABEL: Record<WorkflowOperator, string> = { eq: "=", neq: "≠", gt: ">", gte: "≥", lt: "<", lte: "≤", contains: "contient" };

export function operatorsFor(eventType: AutomationEventType, field: string): WorkflowOperator[] {
  const type = (AUTOMATION_EVENTS[eventType].fields as Record<string, string>)[field];
  return type === "decimal" ? ["gt", "gte", "lt", "lte", "eq", "neq"] : ["eq", "neq", "contains"];
}

export function describeConditions(conditions: WorkflowCondition[]): string {
  if (conditions.length === 0) return "Toujours";
  return conditions.map((condition) => `${FIELD_LABEL[condition.field] ?? condition.field} ${OPERATOR_LABEL[condition.operator]} ${condition.value}`).join(" et ");
}

export type ActionDraft =
  | { type: "NOTIFY"; roleId: string; title: string; body: string }
  | { type: "REQUIRE_APPROVAL"; approverRoleId: string; escalationRoleId: string; slaHours: string; title: string }
  | { type: "WEBHOOK"; url: string };

export function emptyAction(type: ActionDraft["type"]): ActionDraft {
  if (type === "NOTIFY") return { type, roleId: "", title: "", body: "" };
  if (type === "REQUIRE_APPROVAL") return { type, approverRoleId: "", escalationRoleId: "", slaHours: "24", title: "" };
  return { type, url: "" };
}

/** Corps de creation : conditions vides ignorees, SLA en entier, escalade optionnelle. */
export function definitionPayload(draft: { code: string; name: string; description: string; eventType: string; conditions: WorkflowCondition[]; actions: ActionDraft[] }): Record<string, unknown> {
  return {
    code: draft.code.trim(),
    name: draft.name.trim(),
    description: draft.description.trim() || undefined,
    eventType: draft.eventType,
    conditions: draft.conditions.filter((condition) => condition.field && condition.value.trim() !== "").map((condition) => ({ ...condition, value: condition.value.trim() })),
    actions: draft.actions.map((action) =>
      action.type === "REQUIRE_APPROVAL" ? { ...action, slaHours: Number(action.slaHours), escalationRoleId: action.escalationRoleId || undefined } : action,
    ),
  };
}

export const APPROVAL_STATUS_LABEL: Record<string, string> = { PENDING: "En attente", APPROVED: "Approuvée", REJECTED: "Refusée" };
export const APPROVAL_STATUS_CHIP: Record<string, string> = { PENDING: "pending", APPROVED: "done", REJECTED: "blocked" };
export const DELIVERY_STATUS_LABEL: Record<string, string> = { PENDING: "À livrer", DELIVERED: "Livrée", FAILED: "Échec" };
export const DELIVERY_STATUS_CHIP: Record<string, string> = { PENDING: "pending", DELIVERED: "done", FAILED: "blocked" };
export const ACTION_LABEL: Record<string, string> = { NOTIFY: "Notifier", REQUIRE_APPROVAL: "Exiger une approbation", WEBHOOK: "Webhook signé" };
export const RESOURCE_LABEL: Record<string, string> = {
  PurchaseRequest: "Demande d'achat",
  SupplierInvoice: "Facture fournisseur",
  SubcontractStatement: "Situation de sous-traitance",
  QhseFinding: "Non-conformité",
  MaintenanceTicket: "Ticket GMAO",
  SmartAlarm: "Alarme technique",
  FleetIncident: "Incident de parc",
};
