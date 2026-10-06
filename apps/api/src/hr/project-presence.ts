import { Prisma } from "@axora24/database";
import type { PrismaService } from "../core/prisma.service.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import type { ProjectPresenceView } from "@axora24/contracts";
import { attendanceIntervals, splitIntervalUtc, type AttendanceFact } from "./attendance-intervals.js";

/** Include the immediately preceding and following facts to clip overnight sessions accurately. */
export async function loadAttendanceFacts(prisma: PrismaService | Prisma.TransactionClient, scope: CompanyScope, from: Date, to: Date, employeeIds?: string[]): Promise<AttendanceFact[]> {
  if (employeeIds?.length === 0) return [];
  const employeeClause = employeeIds ? Prisma.sql`AND "employeeId" IN (${Prisma.join(employeeIds)})` : Prisma.empty;
  const [inside, previous, following] = await Promise.all([
    prisma.attendanceEvent.findMany({ where: { ...scope, occurredAt: { gte: from, lt: to }, ...(employeeIds ? { employeeId: { in: employeeIds } } : {}) }, select: { id: true, employeeId: true, type: true, occurredAt: true, projectId: true } }),
    prisma.$queryRaw<AttendanceFact[]>(Prisma.sql`SELECT DISTINCT ON ("employeeId") "id", "employeeId", "type", "occurredAt", "projectId" FROM "hr_attendance_events" WHERE "organizationId" = ${scope.organizationId} AND "companyId" = ${scope.companyId} AND "occurredAt" < ${from} ${employeeClause} ORDER BY "employeeId", "occurredAt" DESC, "createdAt" DESC, "id" DESC`),
    prisma.$queryRaw<AttendanceFact[]>(Prisma.sql`SELECT DISTINCT ON ("employeeId") "id", "employeeId", "type", "occurredAt", "projectId" FROM "hr_attendance_events" WHERE "organizationId" = ${scope.organizationId} AND "companyId" = ${scope.companyId} AND "occurredAt" >= ${to} ${employeeClause} ORDER BY "employeeId", "occurredAt", "createdAt", "id"`),
  ]);
  return [...previous, ...inside, ...following];
}

/** Caller must hold hr.employee.read in addition to its project permission. No pay data is selected. */
export async function projectPresence(prisma: PrismaService | Prisma.TransactionClient, scope: CompanyScope, projectId: string, from: Date, to: Date): Promise<ProjectPresenceView> {
  const facts = await loadAttendanceFacts(prisma, scope, from, to);
  const intervals = attendanceIntervals(facts, from, to).filter((interval) => interval.projectId === projectId);
  const employees = await prisma.employee.findMany({ where: { ...scope, id: { in: [...new Set(intervals.map((interval) => interval.employeeId))] } }, select: { id: true, code: true, firstName: true, lastName: true } });
  const names = new Map(employees.map((employee) => [employee.id, employee]));
  const rows: ProjectPresenceView["rows"] = [];
  for (const interval of intervals) {
    const employee = names.get(interval.employeeId);
    if (!employee) continue;
    for (const segment of splitIntervalUtc(interval)) rows.push({ employeeId: employee.id, employeeCode: employee.code, employeeName: `${employee.firstName} ${employee.lastName}`, date: segment.date, clockInAt: segment.from.toISOString(), clockOutAt: segment.to?.toISOString() ?? null, minutes: segment.minutes, open: !segment.to, anomalies: segment.anomalies });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.employeeName.localeCompare(b.employeeName) || a.clockInAt.localeCompare(b.clockInAt));
  return { timezone: "UTC", rows, summary: { employeeCount: new Set(rows.map((row) => row.employeeId)).size, workedMinutes: rows.reduce((sum, row) => sum + row.minutes, 0), openIntervals: intervals.filter((interval) => !interval.to).length } };
}
