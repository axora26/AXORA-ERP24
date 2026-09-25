import type { SiteDailyLogView, SiteEvidenceView, SiteIssueView, SiteZoneView } from "@axora24/contracts";
import { api } from "../api";

export const fieldApi = {
  zones: (projectId: string) => api.get<SiteZoneView[]>(`/field/zones?projectId=${projectId}`),
  createZone: (input: { projectId: string; code: string; name: string }) => api.post<SiteZoneView[]>("/field/zones", input),
  logs: (projectId: string) => api.get<SiteDailyLogView[]>(`/field/logs?projectId=${projectId}`),
  log: (id: string) => api.get<SiteDailyLogView>(`/field/logs/${id}`),
  signLog: (id: string, version: number) => api.post<SiteDailyLogView>(`/field/logs/${id}/sign`, { version }),
  issues: (projectId: string) => api.get<SiteIssueView[]>(`/field/issues?projectId=${projectId}`),
  issue: (id: string) => api.get<SiteIssueView>(`/field/issues/${id}`),
  closeIssue: (id: string, version: number, note?: string) => api.post<SiteIssueView>(`/field/issues/${id}/close`, { version, note }),
  reopenIssue: (id: string, note: string) => api.post<SiteIssueView>(`/field/issues/${id}/reopen`, { note }),
  evidence: (projectId: string) => api.get<SiteEvidenceView[]>(`/field/evidence?projectId=${projectId}`),
};

export const CATEGORY_LABEL: Record<string, string> = {
  QUALITY: "Qualité",
  SAFETY: "Sécurité",
  ENVIRONMENT: "Environnement",
  PROGRESS: "Avancement",
  OTHER: "Autre",
};

export const SEVERITY_LABEL: Record<string, string> = { LOW: "Faible", MEDIUM: "Moyenne", HIGH: "Haute", CRITICAL: "Critique" };

export const ISSUE_STATUS_LABEL: Record<string, string> = {
  OPEN: "Ouverte",
  CORRECTION_SUBMITTED: "Correction à vérifier",
  CLOSED: "Levée",
};

export const ISSUE_STATUS_CHIP: Record<string, string> = { OPEN: "open", CORRECTION_SUBMITTED: "pending", CLOSED: "closed" };

/** Position GPS facultative (3 s max) ; aucune position si refusee ou indisponible. */
export function currentPosition(): Promise<{ latitude: string; longitude: string } | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ latitude: position.coords.latitude.toFixed(6), longitude: position.coords.longitude.toFixed(6) }),
      () => resolve(null),
      { timeout: 3000, maximumAge: 60_000 },
    );
  });
}
