import type { CopilotAskResult, CopilotCapabilityView, CopilotEvidenceView, CopilotSessionDetail, CopilotSessionView } from "@axora24/contracts";
import { api } from "../api";

export const copilotApi = {
  capabilities: () => api.get<CopilotCapabilityView[]>("/copilot/capabilities"),
  ask: (question: string, sessionId?: string) => api.post<CopilotAskResult>("/copilot/ask", { question, sessionId }),
  sessions: () => api.get<CopilotSessionView[]>("/copilot/sessions"),
  session: (id: string) => api.get<CopilotSessionDetail>(`/copilot/sessions/${id}`),
  evidence: () => api.get<CopilotEvidenceView[]>("/copilot/evidence"),
};

export const MODE_LABEL: Record<string, string> = { BRIEFING: "Synthèse", TOOLS: "Question thématique", LOOKUP: "Consultation de pièce", HELP: "Hors périmètre" };

/** Resume du controle d'acces d'une reponse : outils autorises / refuses. */
export function accessSummary(checks: Array<{ granted: boolean }>): string {
  const allowed = checks.filter((check) => check.granted).length;
  const denied = checks.length - allowed;
  if (checks.length === 0) return "Aucune source consultée";
  return `${allowed} source(s) autorisée(s)${denied ? `, ${denied} refusée(s)` : ""}`;
}

export const SOURCE_TYPE_LABEL: Record<string, string> = {
  DashboardKpi: "indicateur",
  PurchaseRequest: "demande d'achat",
  PurchaseOrder: "commande",
  SupplierInvoice: "facture fournisseur",
  CustomerInvoice: "facture client",
  Project: "projet",
  QhseFinding: "non-conformité",
  WorkOrder: "ordre de travail",
  SmartAlarm: "alarme",
  FleetVehicle: "véhicule",
  FleetIncident: "incident de parc",
  EmployeeRegister: "registre du personnel",
  LeaveRequest: "congé",
  CrmOpportunity: "opportunité",
  WorkflowApproval: "approbation",
};
