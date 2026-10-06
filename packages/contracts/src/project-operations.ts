import type { ProjectPresenceView } from "./hr-operations.js";
import type { TimesheetStatus } from "./hr.js";

/** Inclusive UTC calendar dates, at most 31 days. Defaults to the last seven days. */
export interface ProjectOperationsQuery { from?: string; to?: string; companyId?: string }
export interface ProjectOperationsCostFigure {
  /** Null when a source is forbidden or uses another currency. */
  amount: string | null;
  available: boolean;
  source: string;
}
export interface ProjectOperationsView {
  projectId: string;
  from: string;
  to: string;
  timezone: "UTC";
  currency: string;
  attendance: ProjectPresenceView | null;
  timesheets: {
    rows: Array<{ id: string; employeeId: string; employeeCode: string; employeeName: string; date: string; hours: string; status: TimesheetStatus; description: string | null; wbsItemId: string | null; costAmount: string | null }>;
    validatedHours: string;
    validatedCost: string | null;
  } | null;
  materials: {
    rows: Array<{ id: string; itemId: string; itemCode: string; itemName: string; unitCode: string; warehouseId: string; warehouseName: string; date: string; type: "ISSUE" | "RETURN"; quantityDelta: string; valueDelta: string; unitCost: string; wbsItemId: string | null; reference: string | null }>;
    netCost: string;
    /** Current stock in project site warehouses; independent of the selected period. */
    siteBalances: Array<{ itemId: string; itemCode: string; itemName: string; unitCode: string; warehouseId: string; warehouseName: string; quantity: string; value: string }>;
    balancesAsOf: string;
  } | null;
  equipment: {
    fleetAssignments: Array<{ id: string; vehicleId: string; code: string; name: string; employeeId: string | null; employeeName: string | null; startAt: string; endAt: string | null; purpose: string }> | null;
    /** Asset.projectId describes commissioning origin, never a temporary assignment. */
    assets: Array<{ id: string; code: string; name: string; status: "IN_SERVICE" | "OUT_OF_SERVICE" | "RETIRED"; location: string; source: "PROJECT_ORIGIN" }> | null;
  } | null;
  costs: {
    materials: ProjectOperationsCostFigure;
    labor: ProjectOperationsCostFigure;
    subcontract: ProjectOperationsCostFigure;
    directReceipts: ProjectOperationsCostFigure;
    /** Available only when every component is visible and currency-compatible. */
    total: ProjectOperationsCostFigure;
  };
  actions: { recordAttendance: boolean; manageTimesheets: boolean; recordStockMovement: boolean; manageFleetAssignments: boolean };
}
