import type { DocumentFolderView, ManagedDocumentView, StoredFileView } from "@axora24/contracts";
import { api } from "../api";

export const documentsApi = {
  folders: (projectId?: string) => api.get<DocumentFolderView[]>(`/documents/folders${projectId ? `?projectId=${projectId}` : ""}`),
  createFolder: (input: { name: string; projectId?: string; parentId?: string }) => api.post<DocumentFolderView[]>("/documents/folders", input),
  list: (query: { q?: string; projectId?: string; folderId?: string; status?: string; category?: string } = {}) => {
    const params = new URLSearchParams(Object.entries(query).filter((entry): entry is [string, string] => Boolean(entry[1])));
    const search = params.toString();
    return api.get<ManagedDocumentView[]>(`/documents${search ? `?${search}` : ""}`);
  },
  get: (id: string) => api.get<ManagedDocumentView>(`/documents/${id}`),
  create: (input: Record<string, unknown>) => api.post<ManagedDocumentView>("/documents", input),
  addVersion: (id: string, input: { fileId: string; changeNote: string }) => api.post<ManagedDocumentView>(`/documents/${id}/versions`, input),
  submit: (id: string) => api.post<ManagedDocumentView>(`/documents/${id}/submit`),
  approve: (id: string, note?: string) => api.post<ManagedDocumentView>(`/documents/${id}/approve`, { note }),
  reject: (id: string, note: string) => api.post<ManagedDocumentView>(`/documents/${id}/reject`, { note }),
  archive: (id: string, reason: string) => api.post<ManagedDocumentView>(`/documents/${id}/archive`, { reason }),
  upload: (file: File) => api.upload<StoredFileView>("/files", file, file.name),
};

export const CATEGORY_LABEL: Record<string, string> = {
  PLAN: "Plan",
  SPECIFICATION: "CCTP / spécification",
  TECHNICAL_SHEET: "Fiche technique",
  REPORT: "Rapport",
  MINUTES: "PV / compte rendu",
  CONTRACT: "Pièce contractuelle",
  PHOTO: "Photo",
  DOE: "DOE",
  CERTIFICATE: "Certificat",
  OTHER: "Autre",
};

export const DOCUMENT_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Brouillon",
  SUBMITTED: "En visa",
  APPROVED: "Approuvé",
  REJECTED: "Refusé",
  ARCHIVED: "Archivé",
  SUPERSEDED: "Remplacé",
};

export const DOCUMENT_STATUS_CHIP: Record<string, string> = {
  DRAFT: "draft",
  SUBMITTED: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
  ARCHIVED: "archived",
  SUPERSEDED: "closed",
};

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} o`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1).replace(".", ",")} Ko`;
  return `${(size / (1024 * 1024)).toFixed(1).replace(".", ",")} Mo`;
}
