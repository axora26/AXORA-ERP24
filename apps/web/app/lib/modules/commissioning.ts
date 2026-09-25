import type { CommissioningActivityView } from "@axora24/contracts";
import { api } from "../api";

export const commissioningApi = {
  list: (projectId?: string) => api.get<CommissioningActivityView[]>(`/commissioning/activities${projectId ? `?projectId=${projectId}` : ""}`),
  get: (id: string) => api.get<CommissioningActivityView>(`/commissioning/activities/${id}`),
  create: (input: { equipmentId: string; procedure: string }) => api.post<CommissioningActivityView>("/commissioning/activities", input),
  recordTest: (id: string, input: Record<string, unknown>) => api.post<CommissioningActivityView>(`/commissioning/activities/${id}/tests`, input),
  correct: (punchItemId: string, input: { note: string; fileId?: string }) => api.post<CommissioningActivityView>(`/commissioning/punch-items/${punchItemId}/correct`, input),
  accept: (id: string, note: string) => api.post<CommissioningActivityView>(`/commissioning/activities/${id}/accept`, { note }),
  handover: (id: string, input: { recipient: string; documentIds: string[] }) => api.post<CommissioningActivityView>(`/commissioning/activities/${id}/handover`, input),
};

export const STAGES: Array<{ key: string; label: string }> = [
  { key: "PRECOMMISSIONING", label: "Précommissioning" },
  { key: "FUNCTIONAL_TEST", label: "Essai fonctionnel" },
  { key: "CORRECTIONS", label: "Corrections" },
  { key: "RETEST", label: "Retest" },
  { key: "READY_FOR_ACCEPTANCE", label: "Prêt à réceptionner" },
  { key: "ACCEPTED", label: "Réceptionné" },
  { key: "HANDED_OVER", label: "Remis au client" },
];

export const STAGE_LABEL: Record<string, string> = Object.fromEntries(STAGES.map((stage) => [stage.key, stage.label]));
export const STAGE_CHIP: Record<string, string> = {
  PRECOMMISSIONING: "planned",
  FUNCTIONAL_TEST: "in_progress",
  CORRECTIONS: "critical",
  RETEST: "warning",
  READY_FOR_ACCEPTANCE: "pending",
  ACCEPTED: "done",
  HANDED_OVER: "closed",
};
export const TEST_KIND_LABEL: Record<string, string> = { PRECOMMISSIONING: "Précommissioning", FUNCTIONAL: "Essai fonctionnel", RETEST: "Retest" };
export const PUNCH_STATUS_LABEL: Record<string, string> = { OPEN: "À corriger", CORRECTED: "Corrigée — retest attendu", CLOSED: "Soldée par retest" };
