import type { AssetView, MaintenancePlanView, MaintenanceSummaryView, MaintenanceTicketView, WorkOrderView } from "@axora24/contracts";
import { api } from "../api";
import { formatDecimal } from "../format";

function query(params: Record<string, string | undefined>): string {
  const entries = Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1]));
  return entries.length ? `?${new URLSearchParams(entries).toString()}` : "";
}

export const assetsApi = {
  summary: () => api.get<MaintenanceSummaryView>("/assets/summary"),
  list: (params: { status?: string; projectId?: string } = {}) => api.get<AssetView[]>(`/assets${query(params)}`),
  get: (id: string) => api.get<AssetView>(`/assets/items/${id}`),
  fromCommissioning: (input: Record<string, unknown>) => api.post<AssetView>("/assets/from-commissioning", input),
  manual: (input: Record<string, unknown>) => api.post<AssetView>("/assets/manual", input),
  update: (id: string, input: Record<string, unknown>) => api.patch<AssetView>(`/assets/items/${id}`, input),
  plans: (assetId?: string) => api.get<MaintenancePlanView[]>(`/assets/plans${query({ assetId })}`),
  createPlan: (input: Record<string, unknown>) => api.post<MaintenancePlanView[]>("/assets/plans", input),
  generate: (horizonDays = 0) => api.post<{ created: string[] }>("/assets/plans/generate", { horizonDays }),
  tickets: (status?: string) => api.get<MaintenanceTicketView[]>(`/assets/tickets${query({ status })}`),
  createTicket: (input: Record<string, unknown>) => api.post<MaintenanceTicketView[]>("/assets/tickets", input),
  convertTicket: (id: string, input: Record<string, unknown>) => api.post<WorkOrderView>(`/assets/tickets/${id}/convert`, input),
  rejectTicket: (id: string, note: string) => api.post<MaintenanceTicketView[]>(`/assets/tickets/${id}/reject`, { note }),
  workOrders: (params: { status?: string; assetId?: string } = {}) => api.get<WorkOrderView[]>(`/assets/work-orders${query(params)}`),
  workOrder: (id: string) => api.get<WorkOrderView>(`/assets/work-orders/${id}`),
  start: (id: string, assignedEmployeeId?: string) => api.post<WorkOrderView>(`/assets/work-orders/${id}/start`, { assignedEmployeeId: assignedEmployeeId || undefined }),
  labor: (id: string, input: { employeeId: string; workDate: string; hours: string }) => api.post<WorkOrderView>(`/assets/work-orders/${id}/labor`, input),
  part: (id: string, input: { itemId: string; warehouseId: string; quantity: string }) => api.post<WorkOrderView>(`/assets/work-orders/${id}/parts`, input),
  complete: (id: string, input: { report: string; restoredAt?: string }) => api.post<WorkOrderView>(`/assets/work-orders/${id}/complete`, input),
  cancel: (id: string, reason: string) => api.post<WorkOrderView>(`/assets/work-orders/${id}/cancel`, { reason }),
};

export const ASSET_STATUS_LABEL: Record<string, string> = { IN_SERVICE: "En service", OUT_OF_SERVICE: "À l'arrêt", RETIRED: "Réformé" };
export const ASSET_STATUS_CHIP: Record<string, string> = { IN_SERVICE: "operational", OUT_OF_SERVICE: "out_of_service", RETIRED: "archived" };
export const CRITICALITY_LABEL: Record<string, string> = { LOW: "Faible", MEDIUM: "Moyenne", HIGH: "Haute", CRITICAL: "Critique" };
export const CRITICALITY_CHIP: Record<string, string> = { LOW: "low", MEDIUM: "medium", HIGH: "high", CRITICAL: "critical" };
export const PRIORITY_LABEL: Record<string, string> = { LOW: "Basse", NORMAL: "Normale", HIGH: "Haute", URGENT: "Urgente" };
export const PRIORITY_CHIP: Record<string, string> = { LOW: "low", NORMAL: "planned", HIGH: "warning", URGENT: "critical" };
export const WO_STATUS_LABEL: Record<string, string> = { OPEN: "À faire", IN_PROGRESS: "En cours", COMPLETED: "Clôturé", CANCELLED: "Annulé" };
export const WO_TYPE_LABEL: Record<string, string> = { PREVENTIVE: "Préventif", CORRECTIVE: "Correctif" };
export const TICKET_STATUS_LABEL: Record<string, string> = { OPEN: "À qualifier", CONVERTED: "Converti en OT", REJECTED: "Rejeté" };
export const TICKET_STATUS_CHIP: Record<string, string> = { OPEN: "pending", CONVERTED: "done", REJECTED: "rejected" };
export const ORIGIN_LABEL: Record<string, string> = { COMMISSIONING: "Mise en service réceptionnée", MANUAL: "Reprise d'un existant" };

/** Heures -> libelle lisible (les valeurs restent calculees cote serveur). */
export function formatHours(value: string | null): string {
  if (value === null) return "—";
  const hours = Number(value);
  if (hours >= 48) return `${(hours / 24).toFixed(1).replace(".", ",")} j`;
  return `${value.replace(".", ",")} h`;
}

/** Disponibilite a 2 decimales : 99,93 % ne doit pas s'afficher 100 %. */
export function formatAvailability(value: string | null): string {
  return value === null ? "—" : `${formatDecimal(value, 2)} %`;
}
