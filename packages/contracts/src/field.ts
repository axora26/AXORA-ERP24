/** INC-10 — Chantier. Preuves horodatees append-only ; synchronisation hors ligne controlee. */
import type { StoredFileView } from "./documents.js";

export type SiteIssueStatus = "OPEN" | "CORRECTION_SUBMITTED" | "CLOSED";
export type SiteIssueCategory = "QUALITY" | "SAFETY" | "ENVIRONMENT" | "PROGRESS" | "OTHER";
export type SiteIssueSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type SiteEvidenceKind = "PHOTO" | "OBSERVATION" | "CORRECTION";

export interface SiteZoneView {
  id: string;
  projectId: string;
  code: string;
  name: string;
  openIssues: number;
}

export interface SiteEvidenceView {
  id: string;
  kind: SiteEvidenceKind;
  note: string | null;
  file: StoredFileView | null;
  takenAt: string;
  recordedAt: string;
  latitude: string | null;
  longitude: string | null;
  issueId: string | null;
  issueCode: string | null;
  taskId: string | null;
  taskName: string | null;
  zoneId: string | null;
  zoneName: string | null;
  dailyLogId: string | null;
  createdByName: string;
}

export interface SiteIssueView {
  id: string;
  code: string;
  projectId: string;
  projectCode: string | null;
  title: string;
  description: string;
  category: SiteIssueCategory;
  severity: SiteIssueSeverity;
  zoneId: string | null;
  zoneName: string | null;
  taskId: string | null;
  taskName: string | null;
  assigneeName: string;
  assigneeUserId: string | null;
  dueDate: string;
  overdue: boolean;
  status: SiteIssueStatus;
  /** Version lue : a renvoyer avec toute modification (verrou optimiste). */
  version: number;
  createdByUserId: string;
  createdByName: string;
  createdAt: string;
  correctionSubmittedAt: string | null;
  correctionSubmittedByUserId: string | null;
  correctionNote: string | null;
  closedAt: string | null;
  closedByName: string | null;
  closureNote: string | null;
  evidenceCount: number;
  /** Fiche detail uniquement. */
  evidence?: SiteEvidenceView[];
}

export interface SiteDailyLogView {
  id: string;
  projectId: string;
  projectCode: string | null;
  logDate: string;
  weather: string | null;
  temperature: string | null;
  workforceCount: number;
  /** Personnes ayant pointe une entree sur ce chantier ce jour-la (RH). */
  clockedInCount: number;
  summary: string;
  safetyNotes: string | null;
  status: "DRAFT" | "SIGNED";
  version: number;
  createdByName: string;
  signedByName: string | null;
  signedAt: string | null;
  evidence: SiteEvidenceView[];
  /** Sorties de stock imputees au projet ce jour-la (Stock). */
  stockIssues: Array<{ itemCode: string; itemName: string; quantity: string; unitCode: string }>;
}

export type FieldSyncOperationType = "issue.create" | "evidence.create" | "issue.submitCorrection" | "log.save";

/** Operation saisie sur le terrain (eventuellement hors ligne) puis synchronisee. */
export interface FieldSyncOperation {
  /** Identifiant genere sur l'appareil : rejouer l'operation ne cree jamais de doublon. */
  clientId: string;
  type: FieldSyncOperationType;
  payload: Record<string, unknown>;
  /** Version lue avant modification (issue.submitCorrection, log.save sur un journal existant). */
  baseVersion?: number;
}

export interface FieldSyncResult {
  clientId: string;
  status: "APPLIED" | "DUPLICATE" | "CONFLICT" | "REJECTED";
  entityId?: string;
  message?: string;
  /** Etat serveur courant en cas de conflit, pour une resolution explicite. */
  server?: SiteIssueView | SiteDailyLogView;
}
