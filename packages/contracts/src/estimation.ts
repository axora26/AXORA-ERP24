export type EstimationStudyStatus = "DRAFT" | "READY_FOR_DQE" | "ARCHIVED";
export type DqeStatus = "DRAFT" | "FINALIZED" | "ARCHIVED";
export type DqeCostCategory = "MATERIAL" | "LABOR" | "EQUIPMENT" | "SUBCONTRACTING" | "OTHER";
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
  version: number;
  updatedAt: string;
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
  costCategory?: DqeCostCategory;
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

export interface DqeVariantView {
  id: string;
  dqeId: string;
  code: string;
  title: string;
  currency: string;
  revision: number;
  overheadRate: string;
  marginRate: string;
  taxRate: string;
  subtotal: string;
  total: string;
  createdAt: string;
  /** Écart calculé par rapport au DQE courant, jamais persisté. */
  deltaSubtotal: string;
  deltaTotal: string;
}

export interface DqeLibraryItemView {
  id: string;
  code: string;
  designation: string;
  unitCode: string;
  costCategory: DqeCostCategory;
  unitPrice: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
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
  overheadRate?: string;
  marginRate?: string;
  taxRate?: string;
  revision: number;
  version: number;
  updatedAt: string;
  finalizedAt: string | null;
  createdAt: string;
  /** Somme exacte des lignes, calculée côté serveur. */
  subtotal: string;
  overheadAmount?: string;
  costBase?: string;
  marginAmount?: string;
  taxableTotal?: string;
  taxAmount?: string;
  total?: string;
  categoryTotals?: Record<DqeCostCategory, string>;
  variants?: DqeVariantView[];
  lines: DqeLineView[];
  source: DqeSourceView | null;
}

export type DqeSummaryView = DqeView;

/** Optimistic version belongs to the containing draft, not the individual row. */
export interface EstimationDraftVersionInput {
  companyId?: string;
  expectedVersion: number;
}
export interface EstimationRequirementUpdateInput extends EstimationDraftVersionInput {
  position?: number;
  category?: StudyRequirementCategory;
  statement?: string;
  sourceReference?: string | null;
}
export interface DqeLineUpdateInput extends EstimationDraftVersionInput {
  position?: number;
  reference?: string | null;
  designation?: string;
  unitCode?: string;
  costCategory?: DqeCostCategory;
  quantity?: string;
  unitPrice?: string;
}

export interface DqePricingUpdateInput extends EstimationDraftVersionInput {
  overheadRate?: string;
  marginRate?: string;
  taxRate?: string;
}
