import type { ProjectDetailView, ProjectSummaryView } from "@axora24/contracts";
import { api } from "../api";

export const projectsApi = {
  list: () => api.get<ProjectSummaryView[]>("/projects"),
  detail: (id: string) => api.get<ProjectDetailView>(`/projects/${id}`),
  create: (input: {
    name: string;
    contractId?: string;
    importContractLines?: boolean;
    currency?: string;
    clientName?: string;
    location?: string;
    description?: string;
    plannedStart?: string;
    plannedEnd?: string;
  }) => api.post<ProjectDetailView>("/projects", input),
  setStatus: (id: string, status: string, reason?: string) =>
    api.post<ProjectDetailView>(`/projects/${id}/status`, { status, reason }),
  addWbs: (id: string, input: { code: string; name: string; kind?: string; parentId?: string }) =>
    api.post<ProjectDetailView>(`/projects/${id}/wbs`, input),
  addBudgetLine: (id: string, input: { wbsItemId: string; category: string; description: string; amount: string }) =>
    api.post<ProjectDetailView>(`/projects/${id}/budget-lines`, input),
  removeBudgetLine: (id: string, lineId: string) => api.delete<ProjectDetailView>(`/projects/${id}/budget-lines/${lineId}`),
  baseline: (id: string) => api.post<ProjectDetailView>(`/projects/${id}/baseline`),
  requestChangeOrder: (id: string, input: { wbsItemId: string; title: string; reason: string; amount: string }) =>
    api.post<ProjectDetailView>(`/projects/${id}/change-orders`, input),
  approveChangeOrder: (id: string, orderId: string, note?: string) =>
    api.post<ProjectDetailView>(`/projects/${id}/change-orders/${orderId}/approve`, { note }),
  rejectChangeOrder: (id: string, orderId: string, note: string) =>
    api.post<ProjectDetailView>(`/projects/${id}/change-orders/${orderId}/reject`, { note }),
  addTask: (
    id: string,
    input: { wbsItemId: string; name: string; weight?: string; plannedStart?: string; plannedEnd?: string },
  ) => api.post<ProjectDetailView>(`/projects/${id}/tasks`, input),
  setTaskStatus: (id: string, taskId: string, status: string) =>
    api.patch<ProjectDetailView>(`/projects/${id}/tasks/${taskId}/status`, { status }),
  addMilestone: (id: string, input: { name: string; dueDate: string }) =>
    api.post<ProjectDetailView>(`/projects/${id}/milestones`, input),
  achieveMilestone: (id: string, milestoneId: string) =>
    api.post<ProjectDetailView>(`/projects/${id}/milestones/${milestoneId}/achieve`),
  addRisk: (id: string, input: { title: string; probability: number; impact: number; mitigation?: string }) =>
    api.post<ProjectDetailView>(`/projects/${id}/risks`, input),
  updateRisk: (id: string, riskId: string, input: { status?: string; mitigation?: string }) =>
    api.patch<ProjectDetailView>(`/projects/${id}/risks/${riskId}`, input),
};

export const PROJECT_STATUS_LABEL: Record<string, string> = {
  PLANNED: "Planifié",
  IN_PROGRESS: "En cours",
  ON_HOLD: "Suspendu",
  COMPLETED: "Terminé",
  CANCELLED: "Annulé",
};

export const TASK_STATUS_LABEL: Record<string, string> = {
  TODO: "À faire",
  IN_PROGRESS: "En cours",
  BLOCKED: "Bloquée",
  DONE: "Terminée",
};

export const COST_CATEGORY_LABEL: Record<string, string> = {
  MATERIAL: "Matériaux",
  LABOR: "Main-d'œuvre",
  EQUIPMENT: "Matériel",
  SUBCONTRACT: "Sous-traitance",
  OVERHEAD: "Frais généraux",
  OTHER: "Autre",
};

export const WBS_KIND_LABEL: Record<string, string> = {
  LOT: "Lot",
  PHASE: "Phase",
  WORK_PACKAGE: "Lot de travaux",
};

export const CHANGE_ORDER_STATUS_LABEL: Record<string, string> = {
  PENDING: "En attente",
  APPROVED: "Approuvé",
  REJECTED: "Rejeté",
};

export const RISK_STATUS_LABEL: Record<string, string> = {
  OPEN: "Ouvert",
  MITIGATED: "Maîtrisé",
  CLOSED: "Clos",
};
