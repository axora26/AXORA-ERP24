/** INC-09 — Ressources humaines. Heures a 2 decimales, montants a 2 decimales. */

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

export interface PayrollRunView {
  id: string;
  period: string;
  status: "DRAFT" | "CLOSED";
  currency: string;
  closedAt: string | null;
  totalGross: string;
  /** Rappel explicite : aucune retenue legale n'est calculee. */
  statutoryDeductions: "NOT_CONFIGURED";
  lines: Array<{
    employeeId: string;
    employeeName: string;
    baseSalary: string;
    validatedHours: string;
    adjustments: string;
    adjustmentNotes: string | null;
    grossAmount: string;
  }>;
}
