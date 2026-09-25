import type {
  SmartAlarmView,
  SmartBuildingView,
  SmartGatewayTokenView,
  SmartGatewayView,
  SmartPointDetailView,
  SmartPointView,
  SmartSetpointView,
  SmartSummaryView,
  SmartTrendView,
} from "@axora24/contracts";
import { api } from "../api";

export const smartApi = {
  summary: () => api.get<SmartSummaryView>("/smart/summary"),
  buildings: () => api.get<SmartBuildingView[]>("/smart/buildings"),
  createBuilding: (input: Record<string, unknown>) => api.post<SmartBuildingView[]>("/smart/buildings", input),
  gateways: () => api.get<SmartGatewayView[]>("/smart/gateways"),
  gateway: (id: string) => api.get<SmartGatewayView>(`/smart/gateways/${id}`),
  createGateway: (input: Record<string, unknown>) => api.post<SmartGatewayTokenView>("/smart/gateways", input),
  updateGateway: (id: string, input: Record<string, unknown>) => api.patch<SmartGatewayView>(`/smart/gateways/${id}`, input),
  rotateToken: (id: string) => api.post<SmartGatewayTokenView>(`/smart/gateways/${id}/rotate-token`),
  attest: (id: string, input: Record<string, unknown>) => api.post<SmartGatewayView>(`/smart/gateways/${id}/tests`, input),
  points: (gatewayId?: string) => api.get<SmartPointView[]>(`/smart/points${gatewayId ? `?gatewayId=${gatewayId}` : ""}`),
  point: (id: string) => api.get<SmartPointDetailView>(`/smart/points/${id}`),
  trend: (id: string, hours: number) => api.get<SmartTrendView>(`/smart/points/${id}/trend?hours=${hours}`),
  createPoint: (input: Record<string, unknown>) => api.post<SmartPointDetailView>("/smart/points", input),
  updatePoint: (id: string, input: Record<string, unknown>) => api.patch<SmartPointDetailView>(`/smart/points/${id}`, input),
  createRule: (input: Record<string, unknown>) => api.post<SmartPointDetailView>("/smart/rules", input),
  setRuleActive: (id: string, active: boolean) => api.patch<SmartPointDetailView>(`/smart/rules/${id}`, { active }),
  alarms: (status?: string) => api.get<SmartAlarmView[]>(`/smart/alarms${status ? `?status=${status}` : ""}`),
  acknowledge: (id: string, note: string) => api.post<SmartAlarmView>(`/smart/alarms/${id}/acknowledge`, { note }),
  setpoints: (pointId?: string) => api.get<SmartSetpointView[]>(`/smart/setpoints${pointId ? `?pointId=${pointId}` : ""}`),
  requestSetpoint: (input: { pointId: string; value: string; reason: string }) => api.post<SmartSetpointView[]>("/smart/setpoints", input),
  cancelSetpoint: (id: string) => api.post<SmartSetpointView[]>(`/smart/setpoints/${id}/cancel`),
};

export const PROTOCOL_LABEL: Record<string, string> = { HTTP_API: "API HTTP (générique)", MQTT: "MQTT", BACNET_IP: "BACnet/IP", MODBUS_TCP: "Modbus TCP", KNX_IP: "KNXnet/IP" };
export const KIND_LABEL: Record<string, string> = { ANALOG: "Analogique", BINARY: "Tout-ou-rien", MULTISTATE: "Multi-états" };
export const CONDITION_LABEL: Record<string, string> = { ABOVE: "au-dessus de", BELOW: "en dessous de", EQUALS: "égal à" };
export const SEVERITY_LABEL: Record<string, string> = { INFO: "Information", WARNING: "Avertissement", CRITICAL: "Critique" };
export const SEVERITY_CHIP: Record<string, string> = { INFO: "low", WARNING: "warning", CRITICAL: "critical" };
export const ALARM_STATUS_LABEL: Record<string, string> = { ACTIVE: "Active", ACKNOWLEDGED: "Acquittée", CLEARED: "Revenue à la normale" };
export const ALARM_STATUS_CHIP: Record<string, string> = { ACTIVE: "critical", ACKNOWLEDGED: "warning", CLEARED: "closed" };
export const SETPOINT_STATUS_LABEL: Record<string, string> = {
  REQUESTED: "Demandée",
  DISPATCHED: "Transmise à la passerelle",
  ACKNOWLEDGED: "Acquittée — relecture attendue",
  CONFIRMED: "Confirmée par relecture",
  FAILED: "Refusée par la passerelle",
  CANCELLED: "Annulée",
};
export const SETPOINT_STATUS_CHIP: Record<string, string> = { REQUESTED: "pending", DISPATCHED: "in_progress", ACKNOWLEDGED: "warning", CONFIRMED: "verified", FAILED: "failed", CANCELLED: "cancelled" };
export const LEVEL_STATE_LABEL: Record<string, string> = { YES: "Prouvé", NO: "Non développé", NOT_TESTED: "Non testé", SIMULATED: "Simulateur — aucune preuve" };
export const LEVEL_STATE_CHIP: Record<string, string> = { YES: "passed", NO: "blocked", NOT_TESTED: "not_tested", SIMULATED: "warning" };

export function formatValue(value: string | null, unit: string | null, kind?: string): string {
  if (value === null) return "—";
  if (kind === "BINARY") return value === "1" ? "Marche / Ouvert (1)" : "Arrêt / Fermé (0)";
  return `${value.replace(".", ",")}${unit ? ` ${unit}` : ""}`;
}
