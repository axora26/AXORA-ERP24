import type { BimClashView, BimElementView, BimModelView, BimVersionDiffView, RevitConnectorStatusView, StoredFileView } from "@axora24/contracts";
import { api } from "../api";

export const bimApi = {
  revit: () => api.get<RevitConnectorStatusView>("/bim/connectors/revit"),
  models: (projectId?: string) => api.get<BimModelView[]>(`/bim/models${projectId ? `?projectId=${projectId}` : ""}`),
  model: (id: string) => api.get<BimModelView>(`/bim/models/${id}`),
  createModel: (input: { projectId: string; name: string; discipline: string }) => api.post<BimModelView>("/bim/models", input),
  upload: (file: File) => api.upload<StoredFileView>("/files", file, file.name),
  importVersion: (id: string, input: { fileId: string; expectedSha256?: string }) => api.post<{ model: BimModelView; versionId: string }>(`/bim/models/${id}/versions`, input),
  verify: (versionId: string) => api.get<{ verified: boolean; sha256: string; recomputed: string; checkedAt: string }>(`/bim/versions/${versionId}/verify`),
  approve: (versionId: string, note?: string) => api.post<BimModelView>(`/bim/versions/${versionId}/approve`, { note }),
  reject: (versionId: string, note: string) => api.post<BimModelView>(`/bim/versions/${versionId}/reject`, { note }),
  elements: (versionId: string, query: { ifcType?: string; q?: string } = {}) => {
    const params = new URLSearchParams(Object.entries(query).filter((entry): entry is [string, string] => Boolean(entry[1])));
    return api.get<BimElementView[]>(`/bim/versions/${versionId}/elements${params.toString() ? `?${params}` : ""}`);
  },
  diff: (versionId: string, againstId: string) => api.get<BimVersionDiffView>(`/bim/versions/${versionId}/diff?against=${againstId}`),
  bind: (modelId: string, input: { equipmentId: string; globalId: string }) => api.post<BimElementView[]>(`/bim/models/${modelId}/bindings`, input),
  clashes: (modelId: string) => api.get<BimClashView[]>(`/bim/models/${modelId}/clashes`),
  createClash: (modelId: string, input: { elementAGlobalId: string; elementBGlobalId: string; description: string }) => api.post<BimClashView[]>(`/bim/models/${modelId}/clashes`, input),
  comment: (clashId: string, body: string) => api.post<BimClashView[]>(`/bim/clashes/${clashId}/comments`, { body }),
  propose: (clashId: string, proposal: string) => api.post<BimClashView[]>(`/bim/clashes/${clashId}/propose`, { proposal }),
  resolve: (clashId: string, note?: string) => api.post<BimClashView[]>(`/bim/clashes/${clashId}/resolve`, { note }),
  refuse: (clashId: string, note: string) => api.post<BimClashView[]>(`/bim/clashes/${clashId}/refuse`, { note }),
};

/** Empreinte SHA-256 calculee dans le navigateur (contexte securise requis), null sinon. */
export async function sha256Hex(file: Blob): Promise<string | null> {
  if (typeof crypto === "undefined" || !crypto.subtle) return null;
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export const BIM_DISCIPLINE_LABEL: Record<string, string> = {
  ARCHITECTURE: "Architecture",
  STRUCTURE: "Structure",
  HVAC: "CVC",
  ELECTRICAL: "Électricité",
  PLUMBING: "Plomberie",
  FIRE_PROTECTION: "Protection incendie",
  COORDINATION: "Synthèse",
  OTHER: "Autre",
};
export const VERSION_STATUS_LABEL: Record<string, string> = { IMPORTED: "Importée", APPROVED: "Approuvée", REJECTED: "Refusée", SUPERSEDED: "Remplacée" };
export const VERSION_STATUS_CHIP: Record<string, string> = { IMPORTED: "pending", APPROVED: "approved", REJECTED: "rejected", SUPERSEDED: "closed" };
export const CLASH_STATUS_LABEL: Record<string, string> = { OPEN: "Ouvert", RESOLUTION_PROPOSED: "Résolution proposée", RESOLVED: "Résolu" };
export const CONNECTOR_STATE_LABEL: Record<string, string> = { AVAILABLE: "Disponible", NOT_AVAILABLE: "Non disponible", NOT_TESTED: "Non testé", TESTED: "Testé", FAILED: "En échec" };
export const CONNECTOR_STEPS: Array<{ key: "connectorAvailable" | "revitDetected" | "connectionEstablished" | "documentOpen" | "readTested" | "writeTested"; label: string }> = [
  { key: "connectorAvailable", label: "Connecteur disponible" },
  { key: "revitDetected", label: "Revit détecté" },
  { key: "connectionEstablished", label: "Connexion établie" },
  { key: "documentOpen", label: "Document ouvert" },
  { key: "readTested", label: "Lecture testée" },
  { key: "writeTested", label: "Écriture testée" },
];
