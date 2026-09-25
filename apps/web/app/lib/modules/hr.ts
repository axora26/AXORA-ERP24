import type { AttendanceEventView, DepartmentView, EmployeeView, LeaveRequestView, PayrollRunView, TimesheetView } from "@axora24/contracts";
import { api } from "../api";

export const hrApi = {
  departments: () => api.get<DepartmentView[]>("/hr/departments"),
  createDepartment: (input: { code: string; name: string }) => api.post<DepartmentView[]>("/hr/departments", input),
  employees: () => api.get<EmployeeView[]>("/hr/employees"),
  createEmployee: (input: Record<string, unknown>) => api.post<EmployeeView>("/hr/employees", input),
  updateEmployee: (id: string, input: Record<string, unknown>) => api.patch<EmployeeView>(`/hr/employees/${id}`, input),
  addSkill: (id: string, input: { name: string; level: number; certifiedUntil?: string }) => api.post<EmployeeView>(`/hr/employees/${id}/skills`, input),
  attendance: (date?: string) => api.get<AttendanceEventView[]>(`/hr/attendance${date ? `?date=${encodeURIComponent(date)}` : ""}`),
  recordAttendance: (input: Record<string, unknown>) => api.post<AttendanceEventView>("/hr/attendance", input),
  scan: (input: { badgeCode: string; type: "IN" | "OUT"; source?: string; projectId?: string }) => api.post<AttendanceEventView>("/hr/attendance/scan", input),
  timesheets: (status?: string) => api.get<TimesheetView[]>(`/hr/timesheets${status ? `?status=${status}` : ""}`),
  timesheet: (id: string) => api.get<TimesheetView>(`/hr/timesheets/${id}`),
  createTimesheet: (input: { employeeId: string; weekStart: string }) => api.post<TimesheetView>("/hr/timesheets", input),
  setEntries: (id: string, entries: Array<Record<string, unknown>>) => api.put<TimesheetView>(`/hr/timesheets/${id}/entries`, { entries }),
  submitTimesheet: (id: string) => api.post<TimesheetView>(`/hr/timesheets/${id}/submit`),
  validateTimesheet: (id: string, note?: string) => api.post<TimesheetView>(`/hr/timesheets/${id}/validate`, { note }),
  rejectTimesheet: (id: string, note: string) => api.post<TimesheetView>(`/hr/timesheets/${id}/reject`, { note }),
  leaves: () => api.get<LeaveRequestView[]>("/hr/leaves"),
  requestLeave: (input: Record<string, unknown>) => api.post<LeaveRequestView[]>("/hr/leaves", input),
  approveLeave: (id: string, note?: string) => api.post<LeaveRequestView[]>(`/hr/leaves/${id}/approve`, { note }),
  rejectLeave: (id: string, note: string) => api.post<LeaveRequestView[]>(`/hr/leaves/${id}/reject`, { note }),
  cancelLeave: (id: string) => api.post<LeaveRequestView[]>(`/hr/leaves/${id}/cancel`),
  payrollRuns: () => api.get<PayrollRunView[]>("/hr/payroll"),
  payrollRun: (id: string) => api.get<PayrollRunView>(`/hr/payroll/${id}`),
  preparePayroll: (period: string) => api.post<PayrollRunView>("/hr/payroll", { period }),
  adjustPayroll: (id: string, input: { employeeId: string; amount: string; label: string }) => api.post<PayrollRunView>(`/hr/payroll/${id}/adjustments`, input),
  closePayroll: (id: string) => api.post<PayrollRunView>(`/hr/payroll/${id}/close`),
};

export const CONTRACT_LABEL: Record<string, string> = {
  PERMANENT: "CDI",
  FIXED_TERM: "CDD",
  TEMPORARY: "Intérim",
  CONTRACTOR: "Prestataire",
  INTERN: "Stagiaire",
};

export const EMPLOYEE_STATUS_LABEL: Record<string, string> = { ACTIVE: "Actif", SUSPENDED: "Suspendu", TERMINATED: "Sorti" };

export const TIMESHEET_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Brouillon",
  SUBMITTED: "À valider",
  VALIDATED: "Validée",
  REJECTED: "Rejetée",
};

export const LEAVE_TYPE_LABEL: Record<string, string> = {
  PAID: "Congé payé",
  SICK: "Maladie",
  UNPAID: "Sans solde",
  TRAINING: "Formation",
  OTHER: "Autre",
};

export const LEAVE_STATUS_LABEL: Record<string, string> = {
  REQUESTED: "Demandé",
  APPROVED: "Approuvé",
  REJECTED: "Refusé",
  CANCELLED: "Annulé",
};

export const SOURCE_LABEL: Record<string, string> = { MANUAL: "Saisie", QR: "QR code", PIN: "Code PIN", BADGE: "Badge", BIOMETRIC: "Biométrie" };

/** Lundi (AAAA-MM-JJ) de la semaine contenant la date donnee. */
export function mondayOf(date: Date): string {
  const copy = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  copy.setUTCDate(copy.getUTCDate() - ((copy.getUTCDay() + 6) % 7));
  return copy.toISOString().slice(0, 10);
}

export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
