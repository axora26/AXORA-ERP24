import type {
  QhseChecklistTemplateView,
  QhseFindingView,
  QhseInspectionView,
  QhseSummaryView,
  SafetyIncidentView,
  ToolboxMeetingView,
  WorkPermitView,
} from "@axora24/contracts";
import { api } from "../api";

const withProject = (path: string, projectId?: string) => (projectId ? `${path}?projectId=${projectId}` : path);

export const qhseApi = {
  summary: (projectId?: string) => api.get<QhseSummaryView>(withProject("/qhse/summary", projectId)),
  templates: () => api.get<QhseChecklistTemplateView[]>("/qhse/templates"),
  createTemplate: (input: { code: string; name: string; domain: string; items: Array<{ label: string; critical: boolean }> }) =>
    api.post<QhseChecklistTemplateView[]>("/qhse/templates", input),
  inspections: (projectId?: string) => api.get<QhseInspectionView[]>(withProject("/qhse/inspections", projectId)),
  inspection: (id: string) => api.get<QhseInspectionView>(`/qhse/inspections/${id}`),
  createInspection: (input: Record<string, unknown>) => api.post<QhseInspectionView>("/qhse/inspections", input),
  answer: (id: string, itemId: string, input: { result: string; comment?: string; fileId?: string }) => api.put<QhseInspectionView>(`/qhse/inspections/${id}/items/${itemId}`, input),
  completeInspection: (id: string) => api.post<QhseInspectionView>(`/qhse/inspections/${id}/complete`),
  findings: (projectId?: string) => api.get<QhseFindingView[]>(withProject("/qhse/findings", projectId)),
  finding: (id: string) => api.get<QhseFindingView>(`/qhse/findings/${id}`),
  createFinding: (input: Record<string, unknown>) => api.post<QhseFindingView>("/qhse/findings", input),
  addAction: (id: string, input: { description: string; assigneeName: string; dueDate: string }) => api.post<QhseFindingView>(`/qhse/findings/${id}/actions`, input),
  completeAction: (id: string, input: { note: string; fileId?: string }) => api.post<QhseFindingView>(`/qhse/actions/${id}/complete`, input),
  verifyAction: (id: string, note?: string) => api.post<QhseFindingView>(`/qhse/actions/${id}/verify`, { note }),
  rejectAction: (id: string, note: string) => api.post<QhseFindingView>(`/qhse/actions/${id}/reject`, { note }),
  closeFinding: (id: string, note: string) => api.post<QhseFindingView>(`/qhse/findings/${id}/close`, { note }),
  incidents: (projectId?: string) => api.get<SafetyIncidentView[]>(withProject("/qhse/incidents", projectId)),
  reportIncident: (input: Record<string, unknown>) => api.post<SafetyIncidentView[]>("/qhse/incidents", input),
  investigateIncident: (id: string, input: { summary: string; lostDays?: number }) => api.post<SafetyIncidentView[]>(`/qhse/incidents/${id}/investigate`, input),
  closeIncident: (id: string) => api.post<SafetyIncidentView[]>(`/qhse/incidents/${id}/close`),
  permits: (projectId?: string) => api.get<WorkPermitView[]>(withProject("/qhse/permits", projectId)),
  requestPermit: (input: Record<string, unknown>) => api.post<WorkPermitView[]>("/qhse/permits", input),
  approvePermit: (id: string, note?: string) => api.post<WorkPermitView[]>(`/qhse/permits/${id}/approve`, { note }),
  rejectPermit: (id: string, note: string) => api.post<WorkPermitView[]>(`/qhse/permits/${id}/reject`, { note }),
  closePermit: (id: string) => api.post<WorkPermitView[]>(`/qhse/permits/${id}/close`),
  toolbox: (projectId?: string) => api.get<ToolboxMeetingView[]>(withProject("/qhse/toolbox", projectId)),
  recordToolbox: (input: Record<string, unknown>) => api.post<ToolboxMeetingView[]>("/qhse/toolbox", input),
};

export const DOMAIN_LABEL: Record<string, string> = { QUALITY: "Qualité", SAFETY: "Sécurité", ENVIRONMENT: "Environnement" };
export const SEVERITY_LABEL: Record<string, string> = { MINOR: "Mineure", MAJOR: "Majeure", CRITICAL: "Critique" };
export const SEVERITY_CHIP: Record<string, string> = { MINOR: "low", MAJOR: "high", CRITICAL: "critical" };
export const RESULT_LABEL: Record<string, string> = { CONFORM: "Conforme", NON_CONFORM: "Non conforme", NOT_APPLICABLE: "Sans objet" };
export const INSPECTION_STATUS_LABEL: Record<string, string> = { PLANNED: "Planifiée", IN_PROGRESS: "En cours", COMPLETED: "Terminée" };
export const FINDING_STATUS_LABEL: Record<string, string> = { OPEN: "Ouverte", IN_PROGRESS: "Actions en cours", CLOSED: "Clôturée" };
export const ACTION_STATUS_LABEL: Record<string, string> = { OPEN: "À réaliser", DONE: "À vérifier", VERIFIED: "Vérifiée" };
export const INCIDENT_TYPE_LABEL: Record<string, string> = {
  NEAR_MISS: "Presque-accident",
  FIRST_AID: "Soins sur place",
  MEDICAL_TREATMENT: "Soins médicaux",
  LOST_TIME: "Accident avec arrêt",
  PROPERTY_DAMAGE: "Dommage matériel",
  ENVIRONMENTAL: "Atteinte à l'environnement",
};
export const INCIDENT_STATUS_LABEL: Record<string, string> = { REPORTED: "Déclaré", INVESTIGATED: "Analysé", CLOSED: "Clôturé" };
export const PERMIT_TYPE_LABEL: Record<string, string> = {
  HOT_WORK: "Permis feu",
  WORK_AT_HEIGHT: "Travail en hauteur",
  CONFINED_SPACE: "Espace confiné",
  ELECTRICAL: "Consignation électrique",
  EXCAVATION: "Fouille / terrassement",
  LIFTING: "Levage",
  OTHER: "Autre",
};
export const PERMIT_STATUS_LABEL: Record<string, string> = { REQUESTED: "Demandé", APPROVED: "Délivré", REJECTED: "Refusé", CLOSED: "Clôturé" };

/** "! Libelle" = point critique ; une ligne par point de controle. */
export function parseChecklist(text: string): Array<{ label: string; critical: boolean }> {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => (line.startsWith("!") ? { label: line.slice(1).trim(), critical: true } : { label: line, critical: false }))
    .filter((item) => item.label.length > 0);
}
