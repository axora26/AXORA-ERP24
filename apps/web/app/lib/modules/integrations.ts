import type { ApiKeyIssued, ApiKeyView, ApiRequestLogView, ConnectorEntry, InboundEndpointIssued, InboundEndpointView, InboundEventView } from "@axora24/contracts";
import { api } from "../api";

export const integrationsApi = {
  keys: () => api.get<ApiKeyView[]>("/integrations/api-keys"),
  delegable: () => api.get<Array<{ permission: string; granted: boolean }>>("/integrations/delegable"),
  issue: (input: Record<string, unknown>) => api.post<ApiKeyIssued>("/integrations/api-keys", input),
  revoke: (id: string, reason: string) => api.post<ApiKeyView>(`/integrations/api-keys/${id}/revoke`, { reason }),
  requests: (id: string) => api.get<ApiRequestLogView[]>(`/integrations/api-keys/${id}/requests`),
  endpoints: () => api.get<InboundEndpointView[]>("/integrations/inbound"),
  createEndpoint: (name: string) => api.post<InboundEndpointIssued>("/integrations/inbound", { name, kind: "CRM_LEAD" }),
  setEndpointActive: (id: string, active: boolean) => api.post<InboundEndpointView>(`/integrations/inbound/${id}/active`, { active }),
  events: (id: string) => api.get<InboundEventView[]>(`/integrations/inbound/${id}/events`),
  connectors: () => api.get<ConnectorEntry[]>("/integrations/connectors"),
  openapi: () => api.get<{ paths: Record<string, Record<string, { summary?: string; "x-axora-permission"?: string | null }>> }>("/public/openapi.json"),
};

export const KEY_STATUS_LABEL: Record<string, string> = { ACTIVE: "Active", REVOKED: "Révoquée", EXPIRED: "Expirée" };
export const KEY_STATUS_CHIP: Record<string, string> = { ACTIVE: "active", REVOKED: "blocked", EXPIRED: "archived" };
export const CONNECTOR_STATUS_LABEL: Record<string, string> = { IMPLEMENTED_NOT_VERIFIED: "Vérifié en local", NOT_TESTED: "NOT_TESTED", NOT_IMPLEMENTED: "Non développé" };
export const CONNECTOR_STATUS_CHIP: Record<string, string> = { IMPLEMENTED_NOT_VERIFIED: "done", NOT_TESTED: "pending", NOT_IMPLEMENTED: "archived" };
export const PERMISSION_LABEL: Record<string, string> = {
  "projects.project.read": "Projets (lecture)",
  "finance.invoice.read": "Factures clients (lecture)",
  "finance.payable.read": "Factures fournisseurs (lecture)",
  "procurement.order.read": "Commandes (lecture)",
  "assets.asset.read": "Maintenance (lecture)",
  "analytics.report.read": "Analyses (lecture)",
  "crm.lead.manage": "Prospects CRM (création)",
};

/** Case de la grille de verite d'un connecteur. */
export function truthCell(value: boolean | null): string {
  return value === null ? "sans objet" : value ? "oui" : "non";
}

/** Liste d'adresses saisie (virgules, espaces ou retours a la ligne). */
export function parseIps(text: string): string[] {
  return [...new Set(text.split(/[\s,;]+/).map((entry) => entry.trim()).filter(Boolean))];
}
