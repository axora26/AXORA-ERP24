/** INC-10 — GED (fondation). Les versions publiees sont immuables. */

export type DocumentStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED" | "ARCHIVED";
export type DocumentVersionStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED" | "SUPERSEDED";
export type DocumentCategory =
  | "PLAN"
  | "SPECIFICATION"
  | "TECHNICAL_SHEET"
  | "REPORT"
  | "MINUTES"
  | "CONTRACT"
  | "PHOTO"
  | "DOE"
  | "CERTIFICATE"
  | "OTHER";

export interface StoredFileView {
  id: string;
  sha256: string;
  size: number;
  /** Type detecte a partir du contenu, jamais celui annonce par le client. */
  mimeType: string;
  originalName: string;
  createdAt: string;
  /** URL relative (meme origine) du contenu, soumise aux permissions. */
  url: string;
}

export interface DocumentFolderView {
  id: string;
  name: string;
  parentId: string | null;
  projectId: string | null;
  documentCount: number;
}

export interface DocumentVersionView {
  id: string;
  versionNumber: number;
  revision: string;
  status: DocumentVersionStatus;
  fileName: string;
  file: StoredFileView;
  changeNote: string | null;
  uploadedByUserId: string;
  uploadedByName: string;
  createdAt: string;
  submittedByUserId: string | null;
  submittedAt: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
}

export interface ManagedDocumentView {
  id: string;
  code: string;
  title: string;
  category: DocumentCategory;
  projectId: string | null;
  projectCode: string | null;
  folderId: string | null;
  folderName: string | null;
  keywords: string | null;
  status: DocumentStatus;
  currentVersionNumber: number;
  currentRevision: string;
  /** Derniere revision approuvee (reference applicable), null si aucune. */
  approvedRevision: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  /** Historique complet (fiche detail uniquement). */
  versions?: DocumentVersionView[];
}
