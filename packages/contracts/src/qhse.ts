/** INC-11 — QHSE. Faits (NCR, incidents) immuables ; cloture par un tiers. */
import type { StoredFileView } from "./documents.js";

export type QhseDomain = "QUALITY" | "SAFETY" | "ENVIRONMENT";
export type QhseSeverity = "MINOR" | "MAJOR" | "CRITICAL";
export type QhseCheckResult = "CONFORM" | "NON_CONFORM" | "NOT_APPLICABLE";

export interface QhseChecklistTemplateView {
  id: string;
  code: string;
  name: string;
  domain: QhseDomain;
  items: Array<{ label: string; critical: boolean }>;
}

export interface QhseInspectionItemView {
  id: string;
  position: number;
  label: string;
  critical: boolean;
  result: QhseCheckResult | null;
  comment: string | null;
  file: StoredFileView | null;
  answeredByName: string | null;
  answeredAt: string | null;
  findingId: string | null;
  findingCode: string | null;
}

export interface QhseInspectionView {
  id: string;
  code: string;
  projectId: string;
  projectCode: string | null;
  zoneId: string | null;
  zoneName: string | null;
  title: string;
  domain: QhseDomain;
  scheduledAt: string;
  inspectorUserId: string;
  inspectorName: string;
  status: "PLANNED" | "IN_PROGRESS" | "COMPLETED";
  startedAt: string | null;
  completedAt: string | null;
  /** Taux de conformite (%) sur les points applicables, calcule a la cloture. */
  conformityRate: string | null;
  answered: number;
  total: number;
  nonConform: number;
  notes: string | null;
  items?: QhseInspectionItemView[];
}

export interface QhseCorrectiveActionView {
  id: string;
  findingId: string;
  findingCode: string;
  description: string;
  assigneeName: string;
  assigneeUserId: string | null;
  dueDate: string;
  overdue: boolean;
  status: "OPEN" | "DONE" | "VERIFIED";
  completedByUserId: string | null;
  completedByName: string | null;
  completedAt: string | null;
  completionNote: string | null;
  file: StoredFileView | null;
  verifiedByName: string | null;
  verifiedAt: string | null;
  verificationNote: string | null;
  createdAt: string;
}

export interface QhseFindingView {
  id: string;
  code: string;
  projectId: string | null;
  projectCode: string | null;
  category: QhseDomain;
  severity: QhseSeverity;
  title: string;
  description: string;
  detectedAt: string;
  inspectionId: string | null;
  inspectionCode: string | null;
  incidentId: string | null;
  incidentCode: string | null;
  status: "OPEN" | "IN_PROGRESS" | "CLOSED";
  createdByUserId: string;
  createdByName: string;
  closedByName: string | null;
  closedAt: string | null;
  closureNote: string | null;
  createdAt: string;
  actionCount: number;
  verifiedActions: number;
  overdueActions: number;
  actions?: QhseCorrectiveActionView[];
}

export interface SafetyIncidentView {
  id: string;
  code: string;
  projectId: string | null;
  projectCode: string | null;
  type: "NEAR_MISS" | "FIRST_AID" | "MEDICAL_TREATMENT" | "LOST_TIME" | "PROPERTY_DAMAGE" | "ENVIRONMENTAL";
  severity: QhseSeverity;
  occurredAt: string;
  location: string;
  description: string;
  injuredPerson: string | null;
  immediateActions: string | null;
  reportedByName: string;
  lostDays: number;
  status: "REPORTED" | "INVESTIGATED" | "CLOSED";
  investigationSummary: string | null;
  investigatedAt: string | null;
  closedAt: string | null;
  findingIds: string[];
}

export interface WorkPermitView {
  id: string;
  code: string;
  projectId: string;
  projectCode: string | null;
  zoneId: string | null;
  zoneName: string | null;
  type: "HOT_WORK" | "WORK_AT_HEIGHT" | "CONFINED_SPACE" | "ELECTRICAL" | "EXCAVATION" | "LIFTING" | "OTHER";
  description: string;
  precautions: string;
  validFrom: string;
  validTo: string;
  status: "REQUESTED" | "APPROVED" | "REJECTED" | "CLOSED";
  /** Approuve et dans sa fenetre de validite a l'instant de la lecture. */
  active: boolean;
  expired: boolean;
  requestedByUserId: string;
  requestedByName: string;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  closedAt: string | null;
}

export interface ToolboxMeetingView {
  id: string;
  projectId: string;
  projectCode: string | null;
  heldAt: string;
  topic: string;
  content: string;
  facilitatorName: string;
  attendees: Array<{ employeeId: string; name: string }>;
}

export interface QhseSummaryView {
  openFindings: number;
  criticalOpenFindings: number;
  overdueActions: number;
  actionsToVerify: number;
  incidents30d: number;
  lostTimeIncidents12m: number;
  /** null si aucun accident avec arret n'a jamais ete declare. */
  daysSinceLastLostTime: number | null;
  /** Heures validees (RH) sur 12 mois glissants : base du taux de frequence. */
  hoursWorked12m: string;
  /** Accidents avec arret x 1 000 000 / heures validees ; null sans heures validees. */
  frequencyRate: string | null;
  inspectionsCompleted30d: number;
  averageConformity30d: string | null;
  activePermits: number;
}
