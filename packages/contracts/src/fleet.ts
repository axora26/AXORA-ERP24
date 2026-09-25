/** INC-18 — Gestion de parc. Compteurs et carburant sont des series append-only. */

export type FleetVehicleKind = "VEHICLE" | "ENGINE" | "MACHINE";
export type FleetUsageUnit = "KM" | "HOURS";
export type FleetDocumentKind = "INSURANCE" | "REGISTRATION" | "INSPECTION" | "PERMIT" | "OTHER";
export type FleetIncidentKind = "ACCIDENT" | "BREAKDOWN" | "DAMAGE" | "THEFT" | "FINE";

export interface FleetComplianceItem {
  kind: FleetDocumentKind;
  state: "VALID" | "EXPIRING" | "EXPIRED" | "MISSING";
  validUntil: string | null;
  reference: string | null;
  required: boolean;
}

export interface FleetAssignmentView {
  id: string;
  code: string;
  vehicleId: string;
  vehicleCode: string;
  vehicleLabel: string;
  employeeId: string;
  employeeName: string;
  projectId: string | null;
  projectCode: string | null;
  purpose: string;
  startAt: string;
  startReading: string;
  endAt: string | null;
  endReading: string | null;
  usage: string | null;
  endNote: string | null;
}

export interface FleetConsumptionView {
  /** L/100 km ou L/h, calcule plein a plein ; null tant que deux pleins complets n'encadrent pas un usage. */
  value: string | null;
  unit: "L/100 km" | "L/h";
  windows: number;
  note: string;
}

export interface FleetCostView {
  fuel: string;
  maintenance: string;
  documents: string;
  incidents: string;
  total: string;
  usage: string | null;
  /** Cout par km ou par heure ; null si l'usage mesure de la periode est nul ou inconnu. */
  perUnit: string | null;
  currency: string;
}

export interface FleetVehicleView {
  id: string;
  code: string;
  kind: FleetVehicleKind;
  category: string;
  registration: string | null;
  serialNumber: string | null;
  make: string;
  model: string;
  year: number | null;
  fuelType: "DIESEL" | "PETROL" | "ELECTRIC" | "NONE";
  usageUnit: FleetUsageUnit;
  requiredLicence: string | null;
  assetId: string;
  assetCode: string;
  acquisitionDate: string;
  acquisitionCost: string | null;
  homeBase: string;
  status: "ACTIVE" | "IMMOBILIZED" | "DISPOSED";
  lastReading: string | null;
  lastReadingAt: string | null;
  currentAssignment: FleetAssignmentView | null;
  compliance: FleetComplianceItem[];
  openIncidents: number;
  openWorkOrders: number;
}

export interface FleetFuelLogView {
  id: string;
  vehicleId: string;
  vehicleCode: string;
  filledAt: string;
  liters: string;
  unitPrice: string;
  totalCost: string;
  reading: string;
  fullTank: boolean;
  station: string | null;
  projectCode: string | null;
  recordedByName: string;
}

export interface FleetDocumentView {
  id: string;
  kind: FleetDocumentKind;
  reference: string;
  issuer: string | null;
  validFrom: string;
  validUntil: string;
  cost: string | null;
  fileId: string | null;
  fileUrl: string | null;
}

export interface FleetIncidentView {
  id: string;
  code: string;
  vehicleId: string;
  vehicleCode: string;
  kind: FleetIncidentKind;
  occurredAt: string;
  description: string;
  location: string | null;
  driverName: string | null;
  assignmentCode: string | null;
  cost: string | null;
  maintenanceTicketId: string | null;
  maintenanceTicketCode: string | null;
  status: "OPEN" | "CLOSED";
  closureNote: string | null;
}

export interface FleetVehicleDetailView extends FleetVehicleView {
  readings: Array<{ readAt: string; value: string; source: string; recordedByName: string }>;
  assignments: FleetAssignmentView[];
  fuelLogs: FleetFuelLogView[];
  documents: FleetDocumentView[];
  incidents: FleetIncidentView[];
  consumption: FleetConsumptionView;
  costs12m: FleetCostView;
}

export interface FleetSummaryView {
  vehicles: number;
  assigned: number;
  immobilized: number;
  complianceIssues: number;
  openIncidents: number;
  fuelCost30d: string;
  currency: string;
}

export interface FleetProjectCostView {
  projectId: string;
  projectCode: string;
  fuelCost: string;
  liters: string;
  fills: number;
}
