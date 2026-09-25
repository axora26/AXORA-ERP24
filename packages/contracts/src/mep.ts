/** INC-13 — MEP. Tout calcul expose entrees, formule et substitution. */

export type MepDiscipline = "HVAC" | "ELECTRICAL" | "LOW_CURRENT" | "PLUMBING" | "FIRE_PROTECTION";
export type MepEquipmentStatus = "SPECIFIED" | "SELECTED" | "INSTALLED" | "COMMISSIONED";

export interface MepSystemView {
  id: string;
  projectId: string;
  code: string;
  name: string;
  discipline: MepDiscipline;
  description: string | null;
  equipmentCount: number;
}

export interface MepEquipmentView {
  id: string;
  projectId: string;
  projectCode: string | null;
  systemId: string;
  systemCode: string;
  tag: string;
  name: string;
  discipline: MepDiscipline;
  manufacturer: string | null;
  model: string | null;
  location: string | null;
  quantity: number;
  specs: Array<{ name: string; value: string; unit: string }>;
  status: MepEquipmentStatus;
  technicalDocumentId: string | null;
  technicalDocumentCode: string | null;
  calculations?: EngineeringCalculationView[];
}

export interface CalculationTypeView {
  type: string;
  disciplines: MepDiscipline[];
  title: string;
  description: string;
  formula: string;
  inputs: Array<{ name: string; symbol: string; label: string; unit: string; greaterThan?: string; atMost?: string; hint?: string }>;
  outputs: Array<{ name: string; symbol: string; label: string; unit: string; decimals: number }>;
  assumptions: string[];
}

export interface CalculationValue {
  name: string;
  symbol: string;
  label: string;
  unit: string;
  value: string;
}

export interface CalculationRevisionView {
  id: string;
  revision: number;
  inputs: CalculationValue[];
  outputs: CalculationValue[];
  formula: string;
  substitution: string;
  assumptions: string[];
  sources: string | null;
  notes: string | null;
  kernelVersion: string;
  status: "DRAFT" | "VALIDATED" | "SUPERSEDED";
  authorUserId: string;
  authorName: string;
  validatedByName: string | null;
  validatedAt: string | null;
  validationNote: string | null;
  createdAt: string;
}

export interface EngineeringCalculationView {
  id: string;
  code: string;
  projectId: string;
  projectCode: string | null;
  systemId: string | null;
  systemCode: string | null;
  equipmentId: string | null;
  equipmentTag: string | null;
  calcType: string;
  calcTitle: string;
  title: string;
  currentRevision: number;
  /** Revision validee applicable (null si aucune). */
  validatedRevision: number | null;
  current: CalculationRevisionView;
  revisions?: CalculationRevisionView[];
}

export interface CalculationCatalogView {
  kernelVersion: string;
  types: CalculationTypeView[];
  notCovered: Array<{ domain: string; reason: string }>;
}
