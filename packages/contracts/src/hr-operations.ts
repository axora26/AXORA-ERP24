export type PayrollCalculationMode = "MONTHLY_BASE" | "VALIDATED_HOURS";
export interface PayrollPolicyView {
  version: number;
  mode: PayrollCalculationMode;
  standardMonthlyHours: string | null;
  overtimeCoefficient: string | null;
  configured: boolean;
}
export interface PayrollPolicyUpdateInput {
  expectedVersion: number;
  mode: PayrollCalculationMode;
  standardMonthlyHours?: string;
  overtimeCoefficient?: string;
}
export interface PayrollWarning { employeeId: string; code: string; message: string }
export interface EmployeeServiceCardView {
  id: string;
  employeeId: string;
  issuedAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  status: "ACTIVE" | "EXPIRED" | "REVOKED";
}
/** QR credentials are returned only to hr.card.manage and must never enter analytics or logs. */
export interface EmployeeServiceCardDocument {
  card: EmployeeServiceCardView;
  qrPayload: string;
  employee: { code: string; fullName: string; jobTitle: string };
  company: { name: string };
}
export interface CardAttendanceInput {
  cardToken: string;
  type: "IN" | "OUT";
  projectId?: string;
  idempotencyKey: string;
}
export interface ProjectPresenceView {
  timezone: "UTC";
  rows: Array<{ employeeId: string; employeeCode: string; employeeName: string; date: string; clockInAt: string; clockOutAt: string | null; minutes: number; open: boolean; anomalies: string[] }>;
  summary: { employeeCount: number; workedMinutes: number; openIntervals: number };
}
