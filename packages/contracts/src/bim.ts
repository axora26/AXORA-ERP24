/** INC-14 — BIM / IFC. Versions verifiees par empreinte ; connecteur Revit jamais simule. */

export type BimDiscipline = "ARCHITECTURE" | "STRUCTURE" | "HVAC" | "ELECTRICAL" | "PLUMBING" | "FIRE_PROTECTION" | "COORDINATION" | "OTHER";
export type BimVersionStatus = "IMPORTED" | "APPROVED" | "REJECTED" | "SUPERSEDED";

export interface BimVersionSummary {
  spatial: Array<{ globalId: string; ifcType: string; name: string | null; parentGlobalId: string | null }>;
  systems: Array<{ globalId: string; name: string | null; ifcType: string; memberCount: number }>;
  elementTypes: Record<string, number>;
  warnings: string[];
  projectName: string | null;
}

export interface BimVersionView {
  id: string;
  versionNumber: number;
  fileId: string;
  fileUrl: string;
  fileName: string;
  sha256: string;
  schema: string;
  application: string | null;
  entityCount: number;
  elementCount: number;
  status: BimVersionStatus;
  importedByName: string;
  importedByUserId: string;
  importedAt: string;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  summary: BimVersionSummary;
}

export interface BimModelView {
  id: string;
  code: string;
  projectId: string;
  projectCode: string | null;
  name: string;
  discipline: BimDiscipline;
  createdAt: string;
  latestVersion: BimVersionView | null;
  approvedVersionNumber: number | null;
  versionCount: number;
  openClashes: number;
  versions?: BimVersionView[];
}

export interface BimElementView {
  id: string;
  globalId: string;
  ifcType: string;
  name: string | null;
  description: string | null;
  objectType: string | null;
  tag: string | null;
  storeyName: string | null;
  typeName: string | null;
  systems: string[];
  classifications: string[];
  properties: Record<string, string>;
  quantities: Record<string, string>;
  /** Equipement MEP lie a cet element (identite de reference), le cas echeant. */
  equipment: { id: string; tag: string; name: string } | null;
}

export interface BimVersionDiffView {
  fromVersion: number;
  toVersion: number;
  added: Array<{ globalId: string; ifcType: string; name: string | null }>;
  removed: Array<{ globalId: string; ifcType: string; name: string | null }>;
  changed: Array<{ globalId: string; fields: string[]; name: string | null }>;
  unchanged: number;
}

export interface BimClashView {
  id: string;
  code: string;
  modelId: string;
  versionNumber: number;
  elementA: { globalId: string; ifcType: string | null; name: string | null };
  elementB: { globalId: string; ifcType: string | null; name: string | null };
  description: string;
  status: "OPEN" | "RESOLUTION_PROPOSED" | "RESOLVED";
  proposal: string | null;
  proposedByUserId: string | null;
  proposedByName: string | null;
  proposedAt: string | null;
  resolvedByName: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  createdByName: string;
  createdAt: string;
  comments: Array<{ id: string; authorName: string; body: string; createdAt: string }>;
}

export type ConnectorState = "AVAILABLE" | "NOT_AVAILABLE" | "NOT_TESTED" | "TESTED" | "FAILED";

/** Six etats distincts, jamais fusionnes en un statut optimiste (docs/foundation BC-14). */
export interface RevitConnectorStatusView {
  connectorAvailable: { state: ConnectorState; evidence: string };
  revitDetected: { state: ConnectorState; evidence: string };
  connectionEstablished: { state: ConnectorState; evidence: string };
  documentOpen: { state: ConnectorState; evidence: string };
  readTested: { state: ConnectorState; evidence: string };
  writeTested: { state: ConnectorState; evidence: string };
  interoperability: { format: string; schemas: string[]; state: ConnectorState; evidence: string };
}
