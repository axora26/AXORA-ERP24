/** INC-15 — Actifs / GMAO. Indicateurs de fiabilite calcules sur l'historique reel. */

export type AssetStatus = "IN_SERVICE" | "OUT_OF_SERVICE" | "RETIRED";
export type AssetCriticality = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type MaintenancePriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

export interface ReliabilityView {
  periodHours: string;
  downtimeHours: string;
  failures: number;
  /** null : aucune defaillance enregistree, non calculable (jamais estime). */
  mttrHours: string | null;
  mtbfHours: string | null;
  availabilityPercent: string | null;
  formula: string;
}

export interface AssetView {
  id: string;
  code: string;
  name: string;
  projectId: string | null;
  projectCode: string | null;
  equipmentId: string | null;
  equipmentTag: string | null;
  commissioningActivityId: string | null;
  commissioningCode: string | null;
  origin: "COMMISSIONING" | "MANUAL";
  originJustification: string | null;
  serialNumber: string | null;
  manufacturer: string | null;
  model: string | null;
  location: string;
  installedAt: string;
  warrantyEndsAt: string | null;
  underWarranty: boolean;
  criticality: AssetCriticality;
  status: AssetStatus;
  openWorkOrders: number;
  reliability: ReliabilityView;
  maintenanceCost: string;
  currency: string;
  /** Documents de la remise (DOE) issus du commissioning. */
  documents?: Array<{ id: string; code: string; title: string }>;
  plans?: MaintenancePlanView[];
  workOrders?: WorkOrderView[];
}

export interface MaintenancePlanView {
  id: string;
  assetId: string;
  assetCode: string;
  title: string;
  instructions: string;
  intervalDays: number;
  nextDueDate: string;
  due: boolean;
  estimatedHours: string | null;
  active: boolean;
}

export interface MaintenanceTicketView {
  id: string;
  code: string;
  assetId: string;
  assetCode: string;
  assetName: string;
  title: string;
  description: string;
  priority: MaintenancePriority;
  failureAt: string | null;
  status: "OPEN" | "CONVERTED" | "REJECTED";
  reportedByName: string;
  createdAt: string;
  workOrderId: string | null;
  workOrderCode: string | null;
  decisionNote: string | null;
}

export interface WorkOrderView {
  id: string;
  code: string;
  assetId: string;
  assetCode: string;
  assetName: string;
  type: "PREVENTIVE" | "CORRECTIVE";
  ticketId: string | null;
  ticketCode: string | null;
  planId: string | null;
  plannedFor: string | null;
  title: string;
  instructions: string;
  priority: MaintenancePriority;
  dueDate: string;
  overdue: boolean;
  status: "OPEN" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  assignedEmployeeId: string | null;
  assignedEmployeeName: string | null;
  failureAt: string | null;
  restoredAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  completionReport: string | null;
  completedOnTime: boolean | null;
  laborCost: string;
  partsCost: string;
  totalCost: string;
  currency: string;
  labor?: Array<{ id: string; employeeName: string; workDate: string; hours: string; hourlyCost: string; cost: string }>;
  parts?: Array<{ id: string; itemCode: string; itemName: string; warehouseCode: string; quantity: string; unitCode: string; cost: string; stockMovementId: string }>;
}

export interface MaintenanceSummaryView {
  assets: number;
  inService: number;
  openTickets: number;
  openWorkOrders: number;
  overdueWorkOrders: number;
  duePlans: number;
  onTimeRate: string | null;
  fleet: ReliabilityView;
  maintenanceCost: string;
  currency: string;
}
