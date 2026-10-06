/** INC-09 — Ressources humaines. Heures a 2 decimales, montants a 2 decimales. */
import type { EmployeeServiceCardView, PayrollPolicyView, PayrollWarning } from "./hr-operations.js";

export type EmployeeStatus = "ACTIVE" | "SUSPENDED" | "TERMINATED";
export type ContractTypeHr = "PERMANENT" | "FIXED_TERM" | "TEMPORARY" | "CONTRACTOR" | "INTERN";
export type TimesheetStatus = "DRAFT" | "SUBMITTED" | "VALIDATED" | "REJECTED";
export type LeaveStatus = "REQUESTED" | "APPROVED" | "REJECTED" | "CANCELLED";

export interface DepartmentView {
  id: string;
  code: string;
  name: string;
  employeeCount: number;
}

export interface EmployeeView {
  id: string;
  code: string;
  firstName: string;
  lastName: string;
  fullName: string;
  jobTitle: string;
  departmentId: string | null;
  departmentName: string | null;
  userId: string | null;
  email: string | null;
  phone: string | null;
  hireDate: string;
  contractType: ContractTypeHr;
  status: EmployeeStatus;
  badgeCode: string | null;
  serviceCard?: EmployeeServiceCardView | null;
  /** null sans la permission hr.payroll.read (donnees sensibles). */
  hourlyCost: string | null;
  baseSalary: string | null;
  currency: string;
  skills: Array<{ name: string; level: number; certifiedUntil: string | null; expired: boolean }>;
}

export interface AttendanceEventView {
  id: string;
  employeeId: string;
  employeeName: string;
  type: "IN" | "OUT";
  source: "MANUAL" | "QR" | "PIN" | "BADGE" | "BIOMETRIC";
  occurredAt: string;
  projectId: string | null;
  projectCode: string | null;
  note: string | null;
}

export interface TimesheetEntryView {
  id: string;
  workDate: string;
  hours: string;
  projectId: string | null;
  projectCode: string | null;
  wbsItemId: string | null;
  description: string | null;
  costAmount: string | null;
}

export interface TimesheetView {
  id: string;
  employeeId: string;
  employeeName: string;
  /** Compte utilisateur de l'employe (separation des devoirs : il ne valide pas sa propre feuille). */
  employeeUserId: string | null;
  submittedByUserId: string | null;
  weekStart: string;
  status: TimesheetStatus;
  totalHours: string;
  submittedAt: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  entries: TimesheetEntryView[];
  /** Heures derivees des pointages de la semaine (aide a la saisie, jamais imposees). */
  attendanceHours: string;
}

export interface LeaveRequestView {
  id: string;
  employeeId: string;
  employeeName: string;
  type: "PAID" | "SICK" | "UNPAID" | "TRAINING" | "OTHER";
  startDate: string;
  endDate: string;
  days: string;
  reason: string | null;
  status: LeaveStatus;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
}

export type EmployeeAdvanceStatus = "REQUESTED" | "APPROVED" | "REJECTED" | "PAID" | "PARTIALLY_REPAID" | "SETTLED" | "CANCELLED";
export type EmployeeAdvanceRepaymentMethod = "PAYROLL" | "BANK" | "CASH";

export interface EmployeeAdvanceRepaymentView {
  id: string;
  amount: string;
  method: EmployeeAdvanceRepaymentMethod;
  repaymentDate: string;
  note: string | null;
  createdByName: string;
  createdAt: string;
}

export interface EmployeeAdvanceView {
  id: string;
  employeeId: string;
  employeeName: string;
  amount: string;
  repaidAmount: string;
  remainingAmount: string;
  currency: string;
  reason: string;
  status: EmployeeAdvanceStatus;
  requestedAt: string;
  requestedByUserId: string;
  decidedAt: string | null;
  decisionNote: string | null;
  paidAt: string | null;
  settledAt: string | null;
  repayments: EmployeeAdvanceRepaymentView[];
}

export interface PayrollRunView {
  id: string;
  period: string;
  status: "DRAFT" | "CLOSED";
  currency: string;
  closedAt: string | null;
  totalGross: string;
  totalDeductions: string;
  netAmount: string | null;
  statutoryDeductions: "CONFIGURED" | "NOT_CONFIGURED";
  policy?: PayrollPolicyView;
  warnings?: PayrollWarning[];
  lines: Array<{
    employeeId: string;
    employeeName: string;
    baseSalary: string;
    validatedHours: string;
    adjustments: string;
    adjustmentNotes: string | null;
    grossAmount: string;
    attendanceHours?: string;
    regularHours?: string;
    overtimeHours?: string;
    hourlyRate?: string;
    automaticAmount?: string;
    incomeTax?: string;
    socialContribution?: string;
    healthContribution?: string;
    totalDeductions?: string;
    netAmount?: string;
  }>;
}
