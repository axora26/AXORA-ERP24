/** INC-12 — Commissioning. Sequence essai -> anomalie -> correction -> retest -> reception. */

export type CommissioningStage =
  | "PRECOMMISSIONING"
  | "FUNCTIONAL_TEST"
  | "CORRECTIONS"
  | "RETEST"
  | "READY_FOR_ACCEPTANCE"
  | "ACCEPTED"
  | "HANDED_OVER";

export interface CommissioningMeasurement {
  name: string;
  unit: string;
  min: string | null;
  max: string | null;
  measured: string;
  pass: boolean;
}

export interface CommissioningTestView {
  id: string;
  sequence: number;
  kind: "PRECOMMISSIONING" | "FUNCTIONAL" | "RETEST";
  outcome: "PASS" | "FAIL";
  measurements: CommissioningMeasurement[];
  checks: Array<{ label: string; ok: boolean }>;
  notes: string | null;
  files: Array<{ id: string; url: string; originalName: string; mimeType: string }>;
  performedByUserId: string;
  performedByName: string;
  performedAt: string;
}

export interface CommissioningPunchItemView {
  id: string;
  testSequence: number;
  description: string;
  severity: string;
  status: "OPEN" | "CORRECTED" | "CLOSED";
  correctionNote: string | null;
  correctedByName: string | null;
  correctedAt: string | null;
  closedAt: string | null;
  closedByTestSequence: number | null;
}

export interface CommissioningActivityView {
  id: string;
  code: string;
  projectId: string;
  projectCode: string | null;
  equipmentId: string;
  equipmentTag: string;
  equipmentName: string;
  systemCode: string;
  procedure: string;
  status: "PLANNED" | "IN_PROGRESS" | "ACCEPTED" | "HANDED_OVER";
  /** Etape courante deduite des faits (essais, anomalies). */
  stage: CommissioningStage;
  /** Raisons pour lesquelles la reception est impossible (vide si possible). */
  blockers: string[];
  acceptedByName: string | null;
  acceptedAt: string | null;
  acceptanceNote: string | null;
  handedOverAt: string | null;
  handoverRecipient: string | null;
  lastTesterUserId: string | null;
  openPunchItems: number;
  tests?: CommissioningTestView[];
  punchItems?: CommissioningPunchItemView[];
  documents?: Array<{ id: string; code: string; title: string; status: string }>;
}
