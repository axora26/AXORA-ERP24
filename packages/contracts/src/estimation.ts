export type EstimationStudyStatus = "DRAFT" | "READY_FOR_DQE" | "ARCHIVED";
export type DqeStatus = "DRAFT" | "FINALIZED" | "ARCHIVED";
export type StudyRequirementCategory =
  | "FACT"
  | "ASSUMPTION"
  | "CONSTRAINT"
  | "RISK"
  | "NOTE";

export interface EstimationRequirementView {
  id: string;
  position: number;
  category: StudyRequirementCategory;
  statement: string;
  sourceReference: string | null;
  createdAt: string;
}

/** La route de liste renvoie le même contrat complet que la route de détail. */
export interface EstimationStudyView {
  id: string;
  companyId: string;
  opportunityId: string;
  code: string;
  title: string;
  objective: string;
  sourceReference: string | null;
  status: EstimationStudyStatus;
  createdAt: string;
  requirements: EstimationRequirementView[];
}

export type EstimationStudySummaryView = EstimationStudyView;

export interface DqeLineView {
  id: string;
  position: number;
  reference: string | null;
  designation: string;
  unitCode: string;
  /** Decimal exact sérialisé à six décimales. */
  quantity: string;
  /** Decimal exact sérialisé à six décimales. */
  unitPrice: string;
  /** Decimal exact calculé côté serveur. */
  lineTotal: string;
}

export interface DqeSourceView {
  studyId: string;
  studyCode: string;
  studyOpportunityId: string;
  createdAt: string;
}

/** La route de liste renvoie le même contrat complet que la route de détail. */
export interface DqeView {
  id: string;
  companyId: string;
  opportunityId: string | null;
  code: string;
  title: string;
  currency: string;
  status: DqeStatus;
  revision: number;
  finalizedAt: string | null;
  createdAt: string;
  /** Somme exacte des lignes, calculée côté serveur. */
  subtotal: string;
  lines: DqeLineView[];
  source: DqeSourceView | null;
}

export type DqeSummaryView = DqeView;
