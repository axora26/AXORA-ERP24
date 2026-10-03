import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { HR_PERMISSIONS, type EmployeeView, type PayrollRunView, type TimesheetView, type PayrollPolicyView, type PayrollWarning } from "@axora24/contracts";
import { Prisma } from "@axora24/database";
import { PrismaService } from "../core/prisma.service.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import { NumberingService } from "../common/numbering.service.js";
import { writeAudit } from "../common/audit.js";
import { dec, money, sumDecimals } from "../common/decimal.js";
import { attendanceIntervals, splitIntervalUtc } from "./attendance-intervals.js";
import { loadAttendanceFacts } from "./project-presence.js";
import { calculateAutomaticPay } from "./payroll-calculation.js";
import { payrollPolicyView } from "./payroll-policy.service.js";
import { serviceCardView } from "./service-card.service.js";
import {
  assertBody,
  currencyCode,
  optionalDate,
  optionalDecimal,
  optionalEnum,
  optionalId,
  optionalText,
  requiredDate,
  requiredDecimal,
  requiredEnum,
  requiredId,
  requiredInt,
  requiredText,
} from "../common/validation.js";

type Tx = Prisma.TransactionClient;

const CONTRACT_TYPES = ["PERMANENT", "FIXED_TERM", "TEMPORARY", "CONTRACTOR", "INTERN"] as const;
const EMPLOYEE_STATUSES = ["ACTIVE", "SUSPENDED", "TERMINATED"] as const;
const LEAVE_TYPES = ["PAID", "SICK", "UNPAID", "TRAINING", "OTHER"] as const;
const SCAN_SOURCES = ["PIN", "BADGE"] as const;
const DAY_MS = 86_400_000;

/**
 * INC-09 — Ressources humaines (docs/foundation/02-domain-model.md BC-08).
 * Capture -> identification -> presence -> validation -> paie, sans regle
 * fiscale ou sociale presumee.
 */
@Injectable()
export class HrService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
  ) {}

  // ---------------------------------------------------------------------
  // Departements et employes
  // ---------------------------------------------------------------------

  async listDepartments(scope: CompanyScope) {
    const departments = await this.prisma.department.findMany({
      where: scope,
      include: { _count: { select: { employees: true } } },
      orderBy: { code: "asc" },
    });
    return departments.map((department) => ({
      id: department.id,
      code: department.code,
      name: department.name,
      employeeCount: department._count.employees,
    }));
  }

  async createDepartment(scope: CompanyScope, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const code = requiredText(input.code, "code", 20).toUpperCase();
    const name = requiredText(input.name, "name", 120);
    const duplicate = await this.prisma.department.findFirst({ where: { companyId: scope.companyId, code }, select: { id: true } });
    if (duplicate) throw new ConflictException(`Department "${code}" already exists`);
    await this.prisma.$transaction(async (tx) => {
      const department = await tx.department.create({ data: { ...scope, code, name } });
      await writeAudit(tx, scope, actorUserId, "hr.department.created", "Department", department.id, { code });
    });
    return this.listDepartments(scope);
  }

  async listEmployees(scope: CompanyScope, permissions: Set<string>): Promise<EmployeeView[]> {
    const employees = await this.prisma.employee.findMany({
      where: scope,
      include: { department: { select: { name: true } }, skills: { orderBy: { name: "asc" } } },
      orderBy: [{ status: "asc" }, { lastName: "asc" }],
    });
    const canSeePay = permissions.has(HR_PERMISSIONS.PAYROLL_READ);
    const cards = await this.prisma.employeeServiceCard.findMany({ where: { ...scope, employeeId: { in: employees.map((employee) => employee.id) } }, orderBy: { issuedAt: "desc" }, select: { id: true, employeeId: true, issuedAt: true, expiresAt: true, revokedAt: true } });
    const currentCards = new Map<string, (typeof cards)[number]>();
    for (const card of cards) if (!currentCards.has(card.employeeId)) currentCards.set(card.employeeId, card);
    const now = new Date();
    return employees.map((employee) => ({
      id: employee.id,
      code: employee.code,
      firstName: employee.firstName,
      lastName: employee.lastName,
      fullName: `${employee.firstName} ${employee.lastName}`,
      jobTitle: employee.jobTitle,
      departmentId: employee.departmentId,
      departmentName: employee.department?.name ?? null,
      userId: employee.userId,
      email: employee.email,
      phone: employee.phone,
      hireDate: employee.hireDate.toISOString(),
      contractType: employee.contractType,
      status: employee.status,
      badgeCode: employee.badgeCode,
      serviceCard: currentCards.has(employee.id) ? serviceCardView(currentCards.get(employee.id)!) : null,
      hourlyCost: canSeePay ? money(employee.hourlyCost) : null,
      baseSalary: canSeePay ? money(employee.baseSalary) : null,
      currency: employee.currency.trim(),
      skills: employee.skills.map((skill) => ({
        name: skill.name,
        level: skill.level,
        certifiedUntil: skill.certifiedUntil?.toISOString() ?? null,
        expired: skill.certifiedUntil !== null && skill.certifiedUntil < now,
      })),
    }));
  }

  async createEmployee(scope: CompanyScope, body: unknown, actorUserId: string, permissions: Set<string>) {
    const input = assertBody(body);
    const firstName = requiredText(input.firstName, "firstName", 80);
    const lastName = requiredText(input.lastName, "lastName", 80);
    const jobTitle = requiredText(input.jobTitle, "jobTitle", 120);
    const hireDate = requiredDate(input.hireDate, "hireDate");
    const contractType = requiredEnum(input.contractType, "contractType", CONTRACT_TYPES);
    const departmentId = optionalId(input.departmentId, "departmentId");
    const userId = optionalId(input.userId, "userId");
    const badgeCode = optionalText(input.badgeCode, "badgeCode", 60);
    const hourlyCost = optionalDecimal(input.hourlyCost, "hourlyCost");
    const baseSalary = optionalDecimal(input.baseSalary, "baseSalary");
    if ((hourlyCost || baseSalary) && !permissions.has(HR_PERMISSIONS.PAYROLL_MANAGE)) {
      throw new ForbiddenException("Setting pay data requires hr.payroll.manage");
    }

    const id = await this.prisma.$transaction(async (tx) => {
      const company = await tx.company.findUniqueOrThrow({ where: { id: scope.companyId }, select: { currency: true } });
      const currency = input.currency === undefined ? company.currency.trim() : currencyCode(input.currency);
      if (departmentId) await this.requireDepartment(tx, scope, departmentId);
      if (userId) await this.requireMemberUser(tx, scope, userId);
      if (badgeCode) {
        const taken = await tx.employee.findFirst({ where: { companyId: scope.companyId, badgeCode }, select: { id: true } });
        if (taken) throw new ConflictException("This badge code is already assigned");
      }
      const code = await this.numbering.next(tx, scope, "EMP");
      const employee = await tx.employee.create({
        data: {
          ...scope,
          code,
          firstName,
          lastName,
          jobTitle,
          hireDate,
          contractType,
          departmentId,
          userId,
          badgeCode,
          email: optionalText(input.email, "email", 180),
          phone: optionalText(input.phone, "phone", 60),
          hourlyCost: hourlyCost ?? new Prisma.Decimal(0),
          baseSalary: baseSalary ?? new Prisma.Decimal(0),
          currency,
        },
      });
      await writeAudit(tx, scope, actorUserId, "hr.employee.created", "Employee", employee.id, { code, contractType });
      return employee.id;
    });
    return (await this.listEmployees(scope, permissions)).find((employee) => employee.id === id);
  }

  async updateEmployee(scope: CompanyScope, employeeId: string, body: unknown, actorUserId: string, permissions: Set<string>) {
    const input = assertBody(body);
    const employee = await this.prisma.employee.findFirst({ where: { id: employeeId, ...scope } });
    if (!employee) throw new NotFoundException("Employee not found");
    const status = optionalEnum(input.status, "status", EMPLOYEE_STATUSES);
    const terminationDate = optionalDate(input.terminationDate, "terminationDate");
    const hourlyCost = optionalDecimal(input.hourlyCost, "hourlyCost");
    const baseSalary = optionalDecimal(input.baseSalary, "baseSalary");
    if ((hourlyCost || baseSalary) && !permissions.has(HR_PERMISSIONS.PAYROLL_MANAGE)) {
      throw new ForbiddenException("Changing pay data requires hr.payroll.manage");
    }
    if (status === "TERMINATED" && !terminationDate) throw new BadRequestException("terminationDate is required to terminate");
    if (employee.status === "TERMINATED" && status && status !== "TERMINATED") {
      throw new BadRequestException("A terminated employee cannot be reactivated; create a new record");
    }
    await this.prisma.$transaction(async (tx) => {
      const departmentId = input.departmentId === undefined ? undefined : optionalId(input.departmentId, "departmentId");
      await tx.$queryRaw`SELECT "id" FROM "hr_employees" WHERE "id" = ${employee.id} AND "organizationId" = ${scope.organizationId} AND "companyId" = ${scope.companyId} FOR UPDATE`;
      const currentEmployee = await tx.employee.findFirst({ where: { id: employee.id, ...scope } });
      if (!currentEmployee) throw new NotFoundException("Employee not found");
      if (currentEmployee.status === "TERMINATED" && status && status !== "TERMINATED") throw new BadRequestException("A terminated employee cannot be reactivated");
      if (departmentId) await this.requireDepartment(tx, scope, departmentId);
      await tx.employee.update({
        where: { id: employee.id },
        data: {
          ...(status ? { status } : {}),
          ...(status === "TERMINATED" ? { terminationDate } : {}),
          ...(hourlyCost ? { hourlyCost } : {}),
          ...(baseSalary ? { baseSalary } : {}),
          ...(departmentId !== undefined ? { departmentId } : {}),
          ...(input.jobTitle !== undefined ? { jobTitle: requiredText(input.jobTitle, "jobTitle", 120) } : {}),
          ...(input.badgeCode !== undefined ? { badgeCode: optionalText(input.badgeCode, "badgeCode", 60) } : {}),
        },
      });
      await writeAudit(tx, scope, actorUserId, "hr.employee.updated", "Employee", employee.id, {
        status,
        payDataChanged: Boolean(hourlyCost || baseSalary),
      });
    });
    return (await this.listEmployees(scope, permissions)).find((candidate) => candidate.id === employee.id);
  }

  async addSkill(scope: CompanyScope, employeeId: string, body: unknown, actorUserId: string, permissions: Set<string>) {
    const input = assertBody(body);
    const name = requiredText(input.name, "name", 120);
    const level = requiredInt(input.level, "level", { min: 1, max: 5 });
    const certifiedUntil = optionalDate(input.certifiedUntil, "certifiedUntil");
    const employee = await this.prisma.employee.findFirst({ where: { id: employeeId, ...scope } });
    if (!employee) throw new NotFoundException("Employee not found");
    await this.prisma.$transaction(async (tx) => {
      await tx.employeeSkill.upsert({
        where: { employeeId_name: { employeeId, name } },
        create: { employeeId, name, level, certifiedUntil },
        update: { level, certifiedUntil },
      });
      await writeAudit(tx, scope, actorUserId, "hr.skill.recorded", "Employee", employeeId, { name, level });
    });
    return (await this.listEmployees(scope, permissions)).find((candidate) => candidate.id === employeeId);
  }

  // ---------------------------------------------------------------------
  // Presence : capture -> identification -> evenement
  // ---------------------------------------------------------------------

  async listAttendance(scope: CompanyScope, query: Record<string, unknown>) {
    const employeeId = optionalId(query.employeeId, "employeeId");
    const date = optionalDate(query.date, "date");
    const events = await this.prisma.attendanceEvent.findMany({
      where: {
        ...scope,
        ...(employeeId ? { employeeId } : {}),
        ...(date ? { occurredAt: { gte: date, lt: new Date(date.getTime() + DAY_MS) } } : {}),
      },
      orderBy: { occurredAt: "desc" },
      take: 300,
    });
    const [employees, projects] = await Promise.all([
      this.prisma.employee.findMany({ where: { id: { in: [...new Set(events.map((event) => event.employeeId))] }, ...scope } }),
      this.prisma.project.findMany({
        where: { id: { in: [...new Set(events.map((event) => event.projectId).filter((id): id is string => Boolean(id)))] }, ...scope },
        select: { id: true, code: true },
      }),
    ]);
    const names = new Map(employees.map((employee) => [employee.id, `${employee.firstName} ${employee.lastName}`]));
    const codes = new Map(projects.map((project) => [project.id, project.code]));
    return events.map((event) => ({
      id: event.id,
      employeeId: event.employeeId,
      employeeName: names.get(event.employeeId) ?? "—",
      type: event.type,
      source: event.source,
      occurredAt: event.occurredAt.toISOString(),
      projectId: event.projectId,
      projectCode: event.projectId ? (codes.get(event.projectId) ?? null) : null,
      note: event.note,
    }));
  }

  /** Saisie manuelle par un responsable (source MANUAL, tracee). */
  async recordAttendance(scope: CompanyScope, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const employeeId = requiredId(input.employeeId, "employeeId");
    const employee = await this.prisma.employee.findFirst({ where: { id: employeeId, ...scope } });
    if (!employee) throw new NotFoundException("Employee not found");
    return this.createAttendance(scope, employee, input, "MANUAL", actorUserId);
  }

  /** Identification par badge / QR / PIN, puis creation de l'evenement de presence. */
  async scanAttendance(scope: CompanyScope, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const badgeCode = requiredText(input.badgeCode, "badgeCode", 60);
    const source = requiredEnum(input.source ?? "BADGE", "source", SCAN_SOURCES);
    const employee = await this.prisma.employee.findFirst({ where: { badgeCode, ...scope } });
    if (!employee) throw new NotFoundException("Badge not recognized");
    return this.createAttendance(scope, employee, input, source, actorUserId);
  }

  private async createAttendance(
    scope: CompanyScope,
    employee: { id: string; status: string; firstName: string; lastName: string },
    input: Record<string, unknown>,
    source: "MANUAL" | "QR" | "PIN" | "BADGE",
    actorUserId: string,
  ) {
    const type = requiredEnum(input.type, "type", ["IN", "OUT"] as const);
    const occurredAt = optionalDate(input.occurredAt, "occurredAt") ?? new Date();
    if (occurredAt.getTime() > Date.now() + 5 * 60_000) throw new BadRequestException("occurredAt cannot be in the future");
    const projectId = optionalId(input.projectId, "projectId");
    if (employee.status !== "ACTIVE") throw new BadRequestException(`Employee is ${employee.status}`);
    const event = await this.prisma.$transaction(async (tx) => {
      if (projectId) {
        const project = await tx.project.findFirst({ where: { id: projectId, ...scope }, select: { id: true } });
        if (!project) throw new NotFoundException("Project not found");
      }
      // Coherence : pas deux entrees (ou deux sorties) consecutives.
      await tx.$queryRaw`SELECT "id" FROM "hr_employees" WHERE "id" = ${employee.id} FOR UPDATE`;
      const currentEmployee = await tx.employee.findFirst({ where: { id: employee.id, ...scope } });
      if (!currentEmployee || currentEmployee.status !== "ACTIVE") throw new BadRequestException("Attendance requires an active employee");
      const last = await tx.attendanceEvent.findFirst({
        where: { employeeId: employee.id, occurredAt: { lte: occurredAt } },
        orderBy: { occurredAt: "desc" },
      });
      if (type === "IN" && last?.type === "IN") throw new BadRequestException("Employee is already clocked in");
      if (type === "OUT" && last?.type !== "IN") throw new BadRequestException("Employee is not clocked in");
      const next = await tx.attendanceEvent.findFirst({ where: { employeeId: employee.id, ...scope, occurredAt: { gte: occurredAt } }, orderBy: { occurredAt: "asc" } });
      if (next && (next.occurredAt.getTime() === occurredAt.getTime() || next.type === type)) throw new BadRequestException("Attendance must preserve chronological entry and exit pairs");
      const created = await tx.attendanceEvent.create({
        data: {
          ...scope,
          employeeId: employee.id,
          type,
          source,
          occurredAt,
          projectId,
          deviceRef: optionalText(input.deviceRef, "deviceRef", 80),
          note: optionalText(input.note, "note", 500),
          capturedByUserId: actorUserId,
        },
      });
      await writeAudit(tx, scope, actorUserId, "hr.attendance.recorded", "AttendanceEvent", created.id, {
        employeeId: employee.id,
        type,
        source,
      });
      return created;
    });
    return {
      id: event.id,
      employeeId: employee.id,
      employeeName: `${employee.firstName} ${employee.lastName}`,
      type: event.type,
      source: event.source,
      occurredAt: event.occurredAt.toISOString(),
      projectId: event.projectId,
    };
  }

  // ---------------------------------------------------------------------
  // Feuilles de temps
  // ---------------------------------------------------------------------

  async listTimesheets(scope: CompanyScope, query: Record<string, unknown>, permissions: Set<string> = new Set()): Promise<TimesheetView[]> {
    const status = optionalEnum(query.status, "status", ["DRAFT", "SUBMITTED", "VALIDATED", "REJECTED"] as const);
    const employeeId = optionalId(query.employeeId, "employeeId");
    const sheets = await this.prisma.timesheet.findMany({
      where: { ...scope, ...(status ? { status } : {}), ...(employeeId ? { employeeId } : {}) },
      select: { id: true },
      orderBy: [{ weekStart: "desc" }],
      take: 200,
    });
    return Promise.all(sheets.map((sheet) => this.getTimesheet(scope, sheet.id, permissions)));
  }

  async getTimesheet(scope: CompanyScope, timesheetId: string, permissions: Set<string> = new Set()): Promise<TimesheetView> {
    const sheet = await this.prisma.timesheet.findFirst({
      where: { id: timesheetId, ...scope },
      include: { employee: true, entries: { orderBy: { workDate: "asc" } } },
    });
    if (!sheet) throw new NotFoundException("Timesheet not found");
    const projects = await this.prisma.project.findMany({
      where: { id: { in: [...new Set(sheet.entries.map((entry) => entry.projectId).filter((id): id is string => Boolean(id)))] }, ...scope },
      select: { id: true, code: true },
    });
    const codes = new Map(projects.map((project) => [project.id, project.code]));
    const attendance = await this.attendanceHours(scope, sheet.employeeId, sheet.weekStart, new Date(sheet.weekStart.getTime() + 7 * DAY_MS));
    return {
      id: sheet.id,
      employeeId: sheet.employeeId,
      employeeName: `${sheet.employee.firstName} ${sheet.employee.lastName}`,
      employeeUserId: sheet.employee.userId,
      submittedByUserId: sheet.submittedByUserId,
      weekStart: sheet.weekStart.toISOString(),
      status: sheet.status,
      totalHours: dec(sheet.totalHours).toFixed(2),
      submittedAt: sheet.submittedAt?.toISOString() ?? null,
      decidedAt: sheet.decidedAt?.toISOString() ?? null,
      decisionNote: sheet.decisionNote,
      entries: sheet.entries.map((entry) => ({
        id: entry.id,
        workDate: entry.workDate.toISOString(),
        hours: dec(entry.hours).toFixed(2),
        projectId: entry.projectId,
        projectCode: entry.projectId ? (codes.get(entry.projectId) ?? null) : null,
        wbsItemId: entry.wbsItemId,
        description: entry.description,
        costAmount: permissions.has(HR_PERMISSIONS.PAYROLL_READ) && entry.costAmount !== null ? money(entry.costAmount) : null,
      })),
      attendanceHours: attendance.toFixed(2),
    };
  }

  async importAttendance(scope: CompanyScope, timesheetId: string, body: unknown, actorUserId: string): Promise<TimesheetView> {
    const input = assertBody(body);
    if (input.replaceExisting !== undefined && typeof input.replaceExisting !== "boolean") throw new BadRequestException("replaceExisting must be a boolean");
    await this.prisma.$transaction(async (tx) => {
      const sheet = await this.lockTimesheet(tx, scope, timesheetId);
      if (sheet.status !== "DRAFT" && sheet.status !== "REJECTED") throw new BadRequestException("Only a draft (or rejected) timesheet can be edited");
      await tx.$queryRaw`SELECT "id" FROM "hr_employees" WHERE "id" = ${sheet.employeeId} AND "organizationId" = ${scope.organizationId} AND "companyId" = ${scope.companyId} FOR UPDATE`;
      const existing = await tx.timesheetEntry.count({ where: { timesheetId: sheet.id, ...scope } });
      if (existing && input.replaceExisting !== true) throw new ConflictException("The timesheet already has entries; explicitly confirm replacement before importing attendance");
      const end = new Date(sheet.weekStart.getTime() + 7 * DAY_MS);
      const facts = await loadAttendanceFacts(tx, scope, sheet.weekStart, end, [sheet.employeeId]);
      const intervals = attendanceIntervals(facts, sheet.weekStart, end);
      if (intervals.some((interval) => !interval.to || interval.anomalies.length)) throw new BadRequestException("Attendance has an open or inconsistent interval; correct the attendance facts before preparing the timesheet");
      const entries = intervals.flatMap(splitIntervalUtc).map((segment) => ({ ...scope, timesheetId: sheet.id, workDate: new Date(`${segment.date}T00:00:00Z`), hours: new Prisma.Decimal(segment.minutes).div(60).toDecimalPlaces(2), projectId: segment.projectId, description: "Présence issue des pointages", attendanceInId: segment.attendanceInId, attendanceOutId: segment.attendanceOutId })).filter((entry) => entry.hours.greaterThan(0));
      if (!entries.length) throw new BadRequestException("No closed attendance interval exists in this timesheet week");
      const projectIds = [...new Set(entries.map((entry) => entry.projectId).filter((id): id is string => id !== null))];
      const projects = await tx.project.findMany({ where: { ...scope, id: { in: projectIds } }, select: { id: true, status: true } });
      if (projects.length !== projectIds.length) throw new NotFoundException("Project not found");
      for (const project of projects) {
        if (project.status === "COMPLETED" || project.status === "CANCELLED") {
          throw new BadRequestException(`Time cannot be booked on a ${project.status} project`);
        }
      }
      await tx.timesheetEntry.deleteMany({ where: { timesheetId: sheet.id, ...scope } });
      await tx.timesheetEntry.createMany({ data: entries });
      await tx.timesheet.update({ where: { id: sheet.id }, data: { totalHours: sumDecimals(entries.map((entry) => entry.hours)), status: "DRAFT" } });
      await writeAudit(tx, scope, actorUserId, "hr.timesheet.attendance_imported", "Timesheet", sheet.id, { employeeId: sheet.employeeId, entries: entries.length, replacedEntries: existing });
    });
    return this.getTimesheet(scope, timesheetId);
  }

  async createTimesheet(scope: CompanyScope, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const employeeId = requiredId(input.employeeId, "employeeId");
    const weekStart = mondayOf(requiredDate(input.weekStart, "weekStart"));
    const id = await this.prisma.$transaction(async (tx) => {
      const employee = await tx.employee.findFirst({ where: { id: employeeId, ...scope } });
      if (!employee) throw new NotFoundException("Employee not found");
      const existing = await tx.timesheet.findFirst({ where: { employeeId, weekStart }, select: { id: true } });
      if (existing) throw new ConflictException("A timesheet already exists for this employee and week");
      const sheet = await tx.timesheet.create({ data: { ...scope, employeeId, weekStart, createdByUserId: actorUserId } });
      await writeAudit(tx, scope, actorUserId, "hr.timesheet.created", "Timesheet", sheet.id, {
        employeeId,
        weekStart: weekStart.toISOString().slice(0, 10),
      });
      return sheet.id;
    });
    return this.getTimesheet(scope, id);
  }

  async setTimesheetEntries(scope: CompanyScope, timesheetId: string, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    if (!Array.isArray(input.entries)) throw new BadRequestException("entries must be an array");
    await this.prisma.$transaction(async (tx) => {
      const sheet = await this.lockTimesheet(tx, scope, timesheetId);
      if (sheet.status !== "DRAFT" && sheet.status !== "REJECTED") {
        throw new BadRequestException("Only a draft (or rejected) timesheet can be edited");
      }
      const weekEnd = new Date(sheet.weekStart.getTime() + 7 * DAY_MS);
      const perDay = new Map<string, Prisma.Decimal>();
      const projectCache = new Map<string, { status: string; leaves: Set<string> }>();
      const entries = [];
      for (const [index, raw] of (input.entries as unknown[]).entries()) {
        const entry = assertBody(raw);
        const workDate = requiredDate(entry.workDate, `entries[${index}].workDate`);
        if (workDate < sheet.weekStart || workDate >= weekEnd) {
          throw new BadRequestException(`entries[${index}].workDate is outside the timesheet week`);
        }
        const hours = requiredDecimal(entry.hours, `entries[${index}].hours`, { positive: true });
        const day = workDate.toISOString().slice(0, 10);
        const dayTotal = dec(perDay.get(day)).plus(hours);
        if (dayTotal.greaterThan(24)) throw new BadRequestException(`More than 24 hours declared on ${day}`);
        perDay.set(day, dayTotal);
        const projectId = optionalId(entry.projectId, `entries[${index}].projectId`);
        const wbsItemId = optionalId(entry.wbsItemId, `entries[${index}].wbsItemId`);
        if (wbsItemId && !projectId) throw new BadRequestException("wbsItemId requires a projectId");
        if (projectId) {
          let project = projectCache.get(projectId);
          if (!project) {
            const found = await tx.project.findFirst({
              where: { id: projectId, ...scope },
              include: { wbsItems: { include: { _count: { select: { children: true } } } } },
            });
            if (!found) throw new NotFoundException("Project not found");
            project = {
              status: found.status,
              leaves: new Set(found.wbsItems.filter((item) => item._count.children === 0).map((item) => item.id)),
            };
            projectCache.set(projectId, project);
          }
          if (project.status === "COMPLETED" || project.status === "CANCELLED") {
            throw new BadRequestException(`Time cannot be booked on a ${project.status} project`);
          }
          if (wbsItemId && !project.leaves.has(wbsItemId)) {
            throw new BadRequestException(`entries[${index}].wbsItemId must be a leaf WBS item of the project`);
          }
        }
        entries.push({
          ...scope,
          timesheetId: sheet.id,
          workDate,
          hours,
          projectId,
          wbsItemId,
          description: optionalText(entry.description, `entries[${index}].description`, 240),
        });
      }
      await tx.timesheetEntry.deleteMany({ where: { timesheetId: sheet.id } });
      if (entries.length > 0) await tx.timesheetEntry.createMany({ data: entries });
      const totalHours = sumDecimals(entries.map((entry) => entry.hours));
      await tx.timesheet.update({ where: { id: sheet.id }, data: { totalHours, status: "DRAFT" } });
      await writeAudit(tx, scope, actorUserId, "hr.timesheet.edited", "Timesheet", sheet.id, {
        entryCount: entries.length,
        totalHours: totalHours.toFixed(2),
      });
    });
    return this.getTimesheet(scope, timesheetId);
  }

  async submitTimesheet(scope: CompanyScope, timesheetId: string, actorUserId: string) {
    await this.prisma.$transaction(async (tx) => {
      const sheet = await this.lockTimesheet(tx, scope, timesheetId);
      if (sheet.status !== "DRAFT") throw new BadRequestException("Only a draft timesheet can be submitted");
      const count = await tx.timesheetEntry.count({ where: { timesheetId } });
      if (count === 0) throw new BadRequestException("An empty timesheet cannot be submitted");
      await tx.timesheet.update({
        where: { id: sheet.id },
        data: { status: "SUBMITTED", submittedAt: new Date(), submittedByUserId: actorUserId, decisionNote: null },
      });
      await writeAudit(tx, scope, actorUserId, "hr.timesheet.submitted", "Timesheet", sheet.id, { totalHours: dec(sheet.totalHours).toFixed(2) });
    });
    return this.getTimesheet(scope, timesheetId);
  }

  /** Validation par un tiers : fige le cout (heures x cout horaire) de chaque ligne. */
  async decideTimesheet(scope: CompanyScope, timesheetId: string, decision: "VALIDATED" | "REJECTED", body: unknown, actorUserId: string) {
    const note = optionalText(assertBody(body ?? {}).note, "note", 1000);
    if (decision === "REJECTED" && !note) throw new BadRequestException("A note is required to reject a timesheet");
    await this.prisma.$transaction(async (tx) => {
      const sheet = await this.lockTimesheet(tx, scope, timesheetId);
      if (sheet.status !== "SUBMITTED") throw new BadRequestException("Only a submitted timesheet can be decided");
      const employee = await tx.employee.findUniqueOrThrow({ where: { id: sheet.employeeId } });
      if (employee.userId === actorUserId || sheet.submittedByUserId === actorUserId) {
        throw new ForbiddenException("A timesheet is validated by someone other than the employee and the submitter");
      }
      if (decision === "VALIDATED") {
        const entries = await tx.timesheetEntry.findMany({ where: { timesheetId } });
        for (const entry of entries) {
          await tx.timesheetEntry.update({
            where: { id: entry.id },
            data: { costAmount: dec(entry.hours).mul(employee.hourlyCost).toDecimalPlaces(2) },
          });
        }
      }
      await tx.timesheet.update({
        where: { id: sheet.id },
        data: { status: decision, decidedByUserId: actorUserId, decidedAt: new Date(), decisionNote: note },
      });
      await writeAudit(tx, scope, actorUserId, decision === "VALIDATED" ? "hr.timesheet.validated" : "hr.timesheet.rejected", "Timesheet", sheet.id, {
        employeeId: sheet.employeeId,
        totalHours: dec(sheet.totalHours).toFixed(2),
        note,
      });
    });
    return this.getTimesheet(scope, timesheetId);
  }

  // ---------------------------------------------------------------------
  // Conges
  // ---------------------------------------------------------------------

  async listLeaves(scope: CompanyScope) {
    const leaves = await this.prisma.leaveRequest.findMany({
      where: scope,
      include: { employee: { select: { firstName: true, lastName: true } } },
      orderBy: { startDate: "desc" },
      take: 300,
    });
    return leaves.map((leave) => ({
      id: leave.id,
      employeeId: leave.employeeId,
      employeeName: `${leave.employee.firstName} ${leave.employee.lastName}`,
      type: leave.type,
      startDate: leave.startDate.toISOString(),
      endDate: leave.endDate.toISOString(),
      days: dec(leave.days).toFixed(1),
      reason: leave.reason,
      status: leave.status,
      decidedAt: leave.decidedAt?.toISOString() ?? null,
      decisionNote: leave.decisionNote,
      createdAt: leave.createdAt.toISOString(),
    }));
  }

  async requestLeave(scope: CompanyScope, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const employeeId = requiredId(input.employeeId, "employeeId");
    const type = requiredEnum(input.type, "type", LEAVE_TYPES);
    const startDate = requiredDate(input.startDate, "startDate");
    const endDate = requiredDate(input.endDate, "endDate");
    if (endDate < startDate) throw new BadRequestException("endDate must be on or after startDate");
    const days = businessDays(startDate, endDate);
    if (days === 0) throw new BadRequestException("The period contains no working day");
    await this.prisma.$transaction(async (tx) => {
      const employee = await tx.employee.findFirst({ where: { id: employeeId, ...scope } });
      if (!employee) throw new NotFoundException("Employee not found");
      const overlap = await tx.leaveRequest.findFirst({
        where: {
          employeeId,
          status: { in: ["REQUESTED", "APPROVED"] },
          startDate: { lte: endDate },
          endDate: { gte: startDate },
        },
        select: { id: true },
      });
      if (overlap) throw new ConflictException("This period overlaps another leave request");
      const leave = await tx.leaveRequest.create({
        data: {
          ...scope,
          employeeId,
          type,
          startDate,
          endDate,
          days: new Prisma.Decimal(days),
          reason: optionalText(input.reason, "reason", 500),
          requestedByUserId: actorUserId,
        },
      });
      await writeAudit(tx, scope, actorUserId, "hr.leave.requested", "LeaveRequest", leave.id, { employeeId, type, days });
    });
    return this.listLeaves(scope);
  }

  async decideLeave(scope: CompanyScope, leaveId: string, decision: "APPROVED" | "REJECTED" | "CANCELLED", body: unknown, actorUserId: string) {
    const note = optionalText(assertBody(body ?? {}).note, "note", 500);
    await this.prisma.$transaction(async (tx) => {
      const leave = await tx.leaveRequest.findFirst({ where: { id: leaveId, ...scope }, include: { employee: true } });
      if (!leave) throw new NotFoundException("Leave request not found");
      if (decision === "CANCELLED") {
        if (leave.requestedByUserId !== actorUserId) throw new ForbiddenException("Only the requester can cancel a leave request");
        if (!["REQUESTED", "APPROVED"].includes(leave.status)) throw new BadRequestException("This leave request cannot be cancelled");
      } else {
        if (leave.status !== "REQUESTED") throw new BadRequestException("Only a pending leave request can be decided");
        if (leave.requestedByUserId === actorUserId || leave.employee.userId === actorUserId) {
          throw new ForbiddenException("A leave request is decided by someone other than the requester and the employee");
        }
        if (decision === "REJECTED" && !note) throw new BadRequestException("A note is required to reject a leave request");
      }
      await tx.leaveRequest.update({
        where: { id: leave.id },
        data: { status: decision, decidedByUserId: actorUserId, decidedAt: new Date(), decisionNote: note },
      });
      await writeAudit(tx, scope, actorUserId, `hr.leave.${decision.toLowerCase()}`, "LeaveRequest", leave.id, { note });
    });
    return this.listLeaves(scope);
  }

  // ---------------------------------------------------------------------
  // Preparation de paie
  // ---------------------------------------------------------------------

  async listPayrollRuns(scope: CompanyScope): Promise<PayrollRunView[]> {
    const runs = await this.prisma.payrollRun.findMany({ where: scope, select: { id: true }, orderBy: { period: "desc" } });
    return Promise.all(runs.map((run) => this.getPayrollRun(scope, run.id)));
  }

  async getPayrollRun(scope: CompanyScope, runId: string): Promise<PayrollRunView> {
    const run = await this.prisma.payrollRun.findFirst({ where: { id: runId, ...scope }, include: { lines: true } });
    if (!run) throw new NotFoundException("Payroll run not found");
    const employees = await this.prisma.employee.findMany({ where: { id: { in: run.lines.map((line) => line.employeeId) }, ...scope } });
    const names = new Map(employees.map((employee) => [employee.id, `${employee.firstName} ${employee.lastName}`]));
    const snapshot = run.policySnapshot && typeof run.policySnapshot === "object" && !Array.isArray(run.policySnapshot) ? run.policySnapshot : {};
    const policy: PayrollPolicyView = { mode: snapshot.mode === "VALIDATED_HOURS" ? "VALIDATED_HOURS" : "MONTHLY_BASE", version: run.policyVersion ?? 0, configured: snapshot.configured === true, standardMonthlyHours: typeof snapshot.standardMonthlyHours === "string" ? snapshot.standardMonthlyHours : null, overtimeCoefficient: typeof snapshot.overtimeCoefficient === "string" ? snapshot.overtimeCoefficient : null };
    const warnings: PayrollWarning[] = Array.isArray(snapshot.warnings) ? snapshot.warnings.flatMap((warning) => warning && typeof warning === "object" && !Array.isArray(warning) && typeof warning.employeeId === "string" && typeof warning.code === "string" && typeof warning.message === "string" ? [{ employeeId: warning.employeeId, code: warning.code, message: warning.message }] : []) : [];
    const frozenNames = new Map<string, string>();
    if (Array.isArray(snapshot.employees)) for (const employee of snapshot.employees) if (employee && typeof employee === "object" && !Array.isArray(employee) && typeof employee.employeeId === "string" && typeof employee.fullName === "string") frozenNames.set(employee.employeeId, employee.fullName);
    return {
      id: run.id,
      period: run.period,
      status: run.status,
      currency: run.currency.trim(),
      closedAt: run.closedAt?.toISOString() ?? null,
      totalGross: money(sumDecimals(run.lines.map((line) => line.grossAmount))),
      statutoryDeductions: "NOT_CONFIGURED",
      policy,
      warnings,
      netAmount: null,
      lines: run.lines
        .map((line) => ({
          employeeId: line.employeeId,
          employeeName: frozenNames.get(line.employeeId) ?? names.get(line.employeeId) ?? "—",
          baseSalary: money(line.baseSalary),
          validatedHours: dec(line.validatedHours).toFixed(2),
          adjustments: money(line.adjustments),
          adjustmentNotes: line.adjustmentNotes,
          grossAmount: money(line.grossAmount),
        ...(run.policySnapshot === null ? {} : {
          attendanceHours: dec(line.attendanceHours).toFixed(2),
          regularHours: dec(line.regularHours).toFixed(2),
          overtimeHours: dec(line.overtimeHours).toFixed(2),
          hourlyRate: dec(line.hourlyRate).toFixed(6),
        }),
          automaticAmount: money(line.automaticAmount),
        }))
        .sort((left, right) => left.employeeName.localeCompare(right.employeeName)),
    };
  }

  /** Prepare la paie d'un mois : refusee tant qu'une feuille de temps de la periode n'est pas validee. */
  async preparePayroll(scope: CompanyScope, body: unknown, actorUserId: string) {
    const period = requiredText(assertBody(body).period, "period", 7);
    const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period);
    if (!match) throw new BadRequestException("period must be YYYY-MM");
    const start = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
    const end = new Date(Date.UTC(Number(match[1]), Number(match[2]), 1));

    const id = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "companies" WHERE "id" = ${scope.companyId} AND "organizationId" = ${scope.organizationId} FOR UPDATE`;
      const existing = await tx.payrollRun.findFirst({ where: { ...scope, period }, select: { id: true } });
      if (existing) throw new ConflictException(`Payroll for ${period} already exists`);
      const company = await tx.company.findUniqueOrThrow({ where: { id: scope.companyId }, select: { currency: true } });
      const currency = company.currency.trim();
      const employees = await tx.employee.findMany({
        where: {
          ...scope,
          hireDate: { lt: end },
          OR: [{ status: { not: "TERMINATED" } }, { terminationDate: { gte: start } }],
        },
      });
      const otherCurrency = employees.filter((employee) => employee.currency.trim() !== currency);
      if (otherCurrency.length > 0) {
        throw new BadRequestException(
          `${otherCurrency.length} employee(s) are paid in another currency than ${currency}: no implicit conversion`,
        );
      }
      const pending = await tx.timesheet.findMany({
        where: {
          ...scope,
          employeeId: { in: employees.map((employee) => employee.id) },
          status: { in: ["DRAFT", "SUBMITTED", "REJECTED"] },
          weekStart: { lt: end, gte: new Date(start.getTime() - 6 * DAY_MS) },
        },
        include: { employee: { select: { firstName: true, lastName: true } } },
      });
      if (pending.length > 0) {
        const who = [...new Set(pending.map((sheet) => `${sheet.employee.firstName} ${sheet.employee.lastName}`))].join(", ");
        throw new BadRequestException(`${pending.length} timesheet(s) of the period are not validated (${who}): no payroll without validation`);
      }
      const hours = await tx.timesheetEntry.groupBy({
        by: ["timesheetId"],
        where: { ...scope, workDate: { gte: start, lt: end }, timesheet: { status: "VALIDATED" } },
        _sum: { hours: true },
      });
      const sheets = await tx.timesheet.findMany({ where: { id: { in: hours.map((row) => row.timesheetId) } }, select: { id: true, employeeId: true } });
      const hoursByEmployee = new Map<string, Prisma.Decimal>();
      for (const row of hours) {
        const employeeId = sheets.find((sheet) => sheet.id === row.timesheetId)?.employeeId;
        if (employeeId) hoursByEmployee.set(employeeId, dec(hoursByEmployee.get(employeeId)).plus(dec(row._sum.hours)));
      }
      const policy = payrollPolicyView(await tx.companyPayrollPolicy.findFirst({ where: scope }));
      const facts = await loadAttendanceFacts(tx, scope, start, end, employees.map((employee) => employee.id));
      const intervals = attendanceIntervals(facts, start, end);
      const attendanceByEmployee = new Map<string, Prisma.Decimal>();
      const warnings: PayrollWarning[] = [];
      for (const interval of intervals) {
        if (interval.to) attendanceByEmployee.set(interval.employeeId, dec(attendanceByEmployee.get(interval.employeeId)).plus(new Prisma.Decimal(interval.to.getTime() - interval.from.getTime()).div(3_600_000)));
        else warnings.push({ employeeId: interval.employeeId, code: "OPEN_ATTENDANCE", message: "Un pointage de la période ne possède pas de sortie ; aucune durée n’a été inventée." });
      }
      for (const employee of employees) {
        const validated = hoursByEmployee.get(employee.id);
        if (!validated || validated.isZero()) {
          if (policy.mode === "VALIDATED_HOURS") throw new BadRequestException("Hourly payroll requires validated timesheet hours for every employee of the period");
          warnings.push({ employeeId: employee.id, code: "NO_VALIDATED_HOURS", message: "Aucune heure validée pour cet employé ; le mode salaire mensuel conserve le salaire de base." });
        }
        if (!dec(attendanceByEmployee.get(employee.id)).toDecimalPlaces(2).equals(dec(validated).toDecimalPlaces(2))) warnings.push({ employeeId: employee.id, code: "ATTENDANCE_TIMESHEET_DIFFERENCE", message: "Les heures pointées et les heures validées diffèrent ; la paie utilise uniquement les heures validées." });
      }
      const policySnapshot: Prisma.InputJsonObject = { ...policy, warnings: warnings.map((warning) => ({ ...warning })), employees: employees.map((employee) => ({ employeeId: employee.id, code: employee.code, fullName: `${employee.firstName} ${employee.lastName}`, jobTitle: employee.jobTitle, sourceTimesheetIds: sheets.filter((sheet) => sheet.employeeId === employee.id).map((sheet) => sheet.id) })) };
      const run = await tx.payrollRun.create({ data: { ...scope, period, currency, createdByUserId: actorUserId, policySnapshot, policyVersion: policy.version } });
      if (employees.length > 0) {
        await tx.payrollLine.createMany({
          data: employees.map((employee) => ({
            ...scope,
            runId: run.id,
            employeeId: employee.id,
            baseSalary: employee.baseSalary,
            validatedHours: hoursByEmployee.get(employee.id) ?? new Prisma.Decimal(0),
            attendanceHours: dec(attendanceByEmployee.get(employee.id)).toDecimalPlaces(2),
            ...calculateAutomaticPay(employee.baseSalary, hoursByEmployee.get(employee.id) ?? new Prisma.Decimal(0), policy),
            grossAmount: calculateAutomaticPay(employee.baseSalary, hoursByEmployee.get(employee.id) ?? new Prisma.Decimal(0), policy).automaticAmount,
          })),
        });
      }
      await writeAudit(tx, scope, actorUserId, "hr.payroll.prepared", "PayrollRun", run.id, { period, employeeCount: employees.length });
      return run.id;
    });
    return this.getPayrollRun(scope, id);
  }

  async addPayrollAdjustment(scope: CompanyScope, runId: string, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const employeeId = requiredId(input.employeeId, "employeeId");
    const amount = requiredDecimal(input.amount, "amount", { allowNegative: true });
    const label = requiredText(input.label, "label", 120);
    if (amount.isZero()) throw new BadRequestException("amount must not be zero");
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "hr_payroll_runs" WHERE "id" = ${runId} AND "organizationId" = ${scope.organizationId} AND "companyId" = ${scope.companyId} FOR UPDATE`;
      const run = await tx.payrollRun.findFirst({ where: { id: runId, ...scope } });
      if (!run) throw new NotFoundException("Payroll run not found");
      if (run.status !== "DRAFT") throw new BadRequestException("A closed payroll cannot be modified");
      const line = await tx.payrollLine.findFirst({ where: { runId, employeeId } });
      if (!line) throw new NotFoundException("Employee is not part of this payroll");
      const adjustments = dec(line.adjustments).plus(amount);
      const gross = dec(line.automaticAmount).plus(adjustments);
      if (gross.isNegative()) throw new BadRequestException("Gross amount cannot become negative");
      const note = `${label} : ${amount.greaterThan(0) ? "+" : ""}${money(amount)}`;
      await tx.payrollLine.update({
        where: { id: line.id },
        data: { adjustments, grossAmount: gross, adjustmentNotes: line.adjustmentNotes ? `${line.adjustmentNotes} · ${note}` : note },
      });
      await writeAudit(tx, scope, actorUserId, "hr.payroll.adjusted", "PayrollRun", runId, { employeeId, label, amount: money(amount) });
    });
    return this.getPayrollRun(scope, runId);
  }

  async closePayroll(scope: CompanyScope, runId: string, actorUserId: string) {
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.payrollRun.updateMany({
        where: { id: runId, ...scope, status: "DRAFT" },
        data: { status: "CLOSED", closedAt: new Date(), closedByUserId: actorUserId },
      });
      if (updated.count !== 1) throw new BadRequestException("Payroll run not found or already closed");
      await writeAudit(tx, scope, actorUserId, "hr.payroll.closed", "PayrollRun", runId, {});
    });
    return this.getPayrollRun(scope, runId);
  }

  // ---------------------------------------------------------------------
  // Internes
  // ---------------------------------------------------------------------

  /** Heures de presence derivees des paires IN/OUT sur une periode. */
  private async attendanceHours(scope: CompanyScope, employeeId: string, from: Date, to: Date): Promise<Prisma.Decimal> {
    const facts = await loadAttendanceFacts(this.prisma, scope, from, to, [employeeId]);
    const milliseconds = attendanceIntervals(facts, from, to).reduce((sum, interval) => sum + (interval.to ? interval.to.getTime() - interval.from.getTime() : 0), 0);
    return new Prisma.Decimal(milliseconds).div(3_600_000).toDecimalPlaces(2);
  }

  private async lockTimesheet(tx: Tx, scope: CompanyScope, timesheetId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "hr_timesheets"
      WHERE "id" = ${timesheetId} AND "organizationId" = ${scope.organizationId} AND "companyId" = ${scope.companyId}
      FOR UPDATE
    `;
    if (rows.length === 0) throw new NotFoundException("Timesheet not found");
    return tx.timesheet.findUniqueOrThrow({ where: { id: timesheetId } });
  }

  private async requireDepartment(tx: Tx, scope: CompanyScope, departmentId: string) {
    const department = await tx.department.findFirst({ where: { id: departmentId, ...scope }, select: { id: true } });
    if (!department) throw new NotFoundException("Department not found");
  }

  private async requireMemberUser(tx: Tx, scope: CompanyScope, userId: string) {
    const membership = await tx.companyMembership.findFirst({ where: { userId, companyId: scope.companyId }, select: { id: true } });
    if (!membership) throw new BadRequestException("userId must be a member of this company");
  }
}

export function mondayOf(date: Date): Date {
  const copy = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = copy.getUTCDay();
  copy.setUTCDate(copy.getUTCDate() - ((day + 6) % 7));
  return copy;
}

export function businessDays(start: Date, end: Date): number {
  let count = 0;
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  while (cursor <= last) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}
