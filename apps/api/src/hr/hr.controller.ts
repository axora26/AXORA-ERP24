import { Body, Controller, Get, Param, Patch, Post, Put, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { HR_PERMISSIONS as H } from "@axora24/contracts";
import { RequirePermission } from "../auth/require-permission.decorator.js";
import { CurrentUser, Scope, ScopedController } from "../common/scope.guard.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import type { AuthenticatedUser } from "../auth/session.guard.js";
import { HrService } from "./hr.service.js";

/** INC-09 — Ressources humaines. Les pointages sont append-only (aucune route de modification). */
@Controller("hr")
@ScopedController()
export class HrController {
  constructor(private readonly hr: HrService) {}

  private permissions(request: Request): Set<string> {
    return request.axoraPermissions ?? new Set<string>();
  }

  @Get("departments")
  @RequirePermission(H.EMPLOYEE_READ)
  departments(@Scope() scope: CompanyScope) {
    return this.hr.listDepartments(scope);
  }

  @Post("departments")
  @RequirePermission(H.EMPLOYEE_MANAGE)
  createDepartment(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.hr.createDepartment(scope, body, user.id);
  }

  @Get("employees")
  @RequirePermission(H.EMPLOYEE_READ)
  employees(@Req() request: Request, @Scope() scope: CompanyScope) {
    return this.hr.listEmployees(scope, this.permissions(request));
  }

  @Post("employees")
  @RequirePermission(H.EMPLOYEE_MANAGE)
  createEmployee(@Req() request: Request, @Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.hr.createEmployee(scope, body, user.id, this.permissions(request));
  }

  @Patch("employees/:id")
  @RequirePermission(H.EMPLOYEE_MANAGE)
  updateEmployee(
    @Req() request: Request,
    @Scope() scope: CompanyScope,
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.hr.updateEmployee(scope, id, body, user.id, this.permissions(request));
  }

  @Post("employees/:id/skills")
  @RequirePermission(H.EMPLOYEE_MANAGE)
  addSkill(
    @Req() request: Request,
    @Scope() scope: CompanyScope,
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.hr.addSkill(scope, id, body, user.id, this.permissions(request));
  }

  @Get("attendance")
  @RequirePermission(H.EMPLOYEE_READ)
  attendance(@Scope() scope: CompanyScope, @Query() query: Record<string, unknown>) {
    return this.hr.listAttendance(scope, query);
  }

  @Post("attendance")
  @RequirePermission(H.ATTENDANCE_CREATE)
  recordAttendance(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.hr.recordAttendance(scope, body, user.id);
  }

  @Post("attendance/scan")
  @RequirePermission(H.ATTENDANCE_CREATE)
  scanAttendance(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.hr.scanAttendance(scope, body, user.id);
  }

  @Get("timesheets")
  @RequirePermission(H.EMPLOYEE_READ)
  timesheets(@Scope() scope: CompanyScope, @Query() query: Record<string, unknown>) {
    return this.hr.listTimesheets(scope, query);
  }

  @Get("timesheets/:id")
  @RequirePermission(H.EMPLOYEE_READ)
  timesheet(@Scope() scope: CompanyScope, @Param("id") id: string) {
    return this.hr.getTimesheet(scope, id);
  }

  @Post("timesheets")
  @RequirePermission(H.TIMESHEET_MANAGE)
  createTimesheet(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.hr.createTimesheet(scope, body, user.id);
  }

  @Put("timesheets/:id/entries")
  @RequirePermission(H.TIMESHEET_MANAGE)
  setEntries(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.hr.setTimesheetEntries(scope, id, body, user.id);
  }

  @Post("timesheets/:id/submit")
  @RequirePermission(H.TIMESHEET_MANAGE)
  submitTimesheet(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.hr.submitTimesheet(scope, id, user.id);
  }

  @Post("timesheets/:id/validate")
  @RequirePermission(H.TIMESHEET_VALIDATE)
  validateTimesheet(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.hr.decideTimesheet(scope, id, "VALIDATED", body, user.id);
  }

  @Post("timesheets/:id/reject")
  @RequirePermission(H.TIMESHEET_VALIDATE)
  rejectTimesheet(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.hr.decideTimesheet(scope, id, "REJECTED", body, user.id);
  }

  @Get("leaves")
  @RequirePermission(H.EMPLOYEE_READ)
  leaves(@Scope() scope: CompanyScope) {
    return this.hr.listLeaves(scope);
  }

  @Post("leaves")
  @RequirePermission(H.LEAVE_REQUEST)
  requestLeave(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.hr.requestLeave(scope, body, user.id);
  }

  @Post("leaves/:id/approve")
  @RequirePermission(H.LEAVE_APPROVE)
  approveLeave(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.hr.decideLeave(scope, id, "APPROVED", body, user.id);
  }

  @Post("leaves/:id/reject")
  @RequirePermission(H.LEAVE_APPROVE)
  rejectLeave(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.hr.decideLeave(scope, id, "REJECTED", body, user.id);
  }

  @Post("leaves/:id/cancel")
  @RequirePermission(H.LEAVE_REQUEST)
  cancelLeave(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.hr.decideLeave(scope, id, "CANCELLED", body, user.id);
  }

  @Get("payroll")
  @RequirePermission(H.PAYROLL_READ)
  payrollRuns(@Scope() scope: CompanyScope) {
    return this.hr.listPayrollRuns(scope);
  }

  @Get("payroll/:id")
  @RequirePermission(H.PAYROLL_READ)
  payrollRun(@Scope() scope: CompanyScope, @Param("id") id: string) {
    return this.hr.getPayrollRun(scope, id);
  }

  @Post("payroll")
  @RequirePermission(H.PAYROLL_MANAGE)
  preparePayroll(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.hr.preparePayroll(scope, body, user.id);
  }

  @Post("payroll/:id/adjustments")
  @RequirePermission(H.PAYROLL_MANAGE)
  adjustPayroll(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.hr.addPayrollAdjustment(scope, id, body, user.id);
  }

  @Post("payroll/:id/close")
  @RequirePermission(H.PAYROLL_MANAGE)
  closePayroll(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.hr.closePayroll(scope, id, user.id);
  }
}
