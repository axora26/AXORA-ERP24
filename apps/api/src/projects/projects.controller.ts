import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { PROJECT_PERMISSIONS } from "@axora24/contracts";
import { RequirePermission } from "../auth/require-permission.decorator.js";
import { CurrentUser, Scope, ScopedController } from "../common/scope.guard.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import type { AuthenticatedUser } from "../auth/session.guard.js";
import { ProjectsService } from "./projects.service.js";
import { ProjectOperationsService } from "./project-operations.service.js";

/** INC-05 — Projets & Construction. */
@Controller("projects")
@ScopedController()
export class ProjectsController {
  constructor(private readonly projects: ProjectsService, private readonly operations: ProjectOperationsService) {}

  @Get(":id/operations")
  @RequirePermission(PROJECT_PERMISSIONS.PROJECT_READ)
  projectOperations(@Scope() scope: CompanyScope, @Param("id") id: string, @Query() query: Record<string, unknown>, @Req() request: Request) {
    return this.operations.get(scope, id, query, request.axoraPermissions ?? new Set());
  }

  @Get()
  @RequirePermission(PROJECT_PERMISSIONS.PROJECT_READ)
  list(@Scope() scope: CompanyScope) {
    return this.projects.list(scope);
  }

  @Get(":id")
  @RequirePermission(PROJECT_PERMISSIONS.PROJECT_READ)
  detail(@Scope() scope: CompanyScope, @Param("id") id: string, @Req() request: Request) {
    return this.projects.detail(scope, id, request.axoraPermissions ?? new Set());
  }

  @Post()
  @RequirePermission(PROJECT_PERMISSIONS.PROJECT_MANAGE)
  create(@Scope() scope: CompanyScope, @Req() request: Request, @CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.projects.create(scope, body, user.id, request.axoraPermissions ?? new Set());
  }

  @Post(":id/status")
  @RequirePermission(PROJECT_PERMISSIONS.PROJECT_MANAGE)
  status(@Scope() scope: CompanyScope, @Req() request: Request, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.projects.changeStatus(scope, id, body, user.id, request.axoraPermissions ?? new Set());
  }

  @Post(":id/wbs")
  @RequirePermission(PROJECT_PERMISSIONS.PROJECT_MANAGE)
  addWbs(@Scope() scope: CompanyScope, @Req() request: Request, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.projects.addWbsItem(scope, id, body, user.id, request.axoraPermissions ?? new Set());
  }

  @Post(":id/budget-lines")
  @RequirePermission(PROJECT_PERMISSIONS.BUDGET_MANAGE)
  addBudgetLine(@Scope() scope: CompanyScope, @Req() request: Request, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.projects.addBudgetLine(scope, id, body, user.id, request.axoraPermissions ?? new Set());
  }

  @Delete(":id/budget-lines/:lineId")
  @RequirePermission(PROJECT_PERMISSIONS.BUDGET_MANAGE)
  removeBudgetLine(
    @Scope() scope: CompanyScope,
    @Req() request: Request, @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Param("lineId") lineId: string,
  ) {
    return this.projects.removeBudgetLine(scope, id, lineId, user.id, request.axoraPermissions ?? new Set());
  }

  @Post(":id/baseline")
  @RequirePermission(PROJECT_PERMISSIONS.BUDGET_MANAGE)
  baseline(@Scope() scope: CompanyScope, @Req() request: Request, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.projects.baseline(scope, id, user.id, request.axoraPermissions ?? new Set());
  }

  @Post(":id/change-orders")
  @RequirePermission(PROJECT_PERMISSIONS.BUDGET_MANAGE)
  requestChangeOrder(
    @Scope() scope: CompanyScope,
    @Req() request: Request, @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.projects.requestChangeOrder(scope, id, body, user.id, request.axoraPermissions ?? new Set());
  }

  @Post(":id/change-orders/:orderId/approve")
  @RequirePermission(PROJECT_PERMISSIONS.CHANGE_ORDER_APPROVE)
  approve(
    @Scope() scope: CompanyScope,
    @Req() request: Request, @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Param("orderId") orderId: string,
    @Body() body: unknown,
  ) {
    return this.projects.decideChangeOrder(scope, id, orderId, "APPROVED", body, user.id, request.axoraPermissions ?? new Set());
  }

  @Post(":id/change-orders/:orderId/reject")
  @RequirePermission(PROJECT_PERMISSIONS.CHANGE_ORDER_APPROVE)
  reject(
    @Scope() scope: CompanyScope,
    @Req() request: Request, @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Param("orderId") orderId: string,
    @Body() body: unknown,
  ) {
    return this.projects.decideChangeOrder(scope, id, orderId, "REJECTED", body, user.id, request.axoraPermissions ?? new Set());
  }

  @Post(":id/tasks")
  @RequirePermission(PROJECT_PERMISSIONS.TASK_MANAGE)
  addTask(@Scope() scope: CompanyScope, @Req() request: Request, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.projects.addTask(scope, id, body, user.id, request.axoraPermissions ?? new Set());
  }

  @Patch(":id/tasks/:taskId/status")
  @RequirePermission(PROJECT_PERMISSIONS.TASK_MANAGE)
  taskStatus(
    @Scope() scope: CompanyScope,
    @Req() request: Request, @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Param("taskId") taskId: string,
    @Body() body: unknown,
  ) {
    return this.projects.setTaskStatus(scope, id, taskId, body, user.id, request.axoraPermissions ?? new Set());
  }

  @Post(":id/milestones")
  @RequirePermission(PROJECT_PERMISSIONS.PROJECT_MANAGE)
  addMilestone(@Scope() scope: CompanyScope, @Req() request: Request, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.projects.addMilestone(scope, id, body, user.id, request.axoraPermissions ?? new Set());
  }

  @Post(":id/milestones/:milestoneId/achieve")
  @RequirePermission(PROJECT_PERMISSIONS.PROJECT_MANAGE)
  achieveMilestone(
    @Scope() scope: CompanyScope,
    @Req() request: Request, @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Param("milestoneId") milestoneId: string,
  ) {
    return this.projects.achieveMilestone(scope, id, milestoneId, user.id, request.axoraPermissions ?? new Set());
  }

  @Post(":id/risks")
  @RequirePermission(PROJECT_PERMISSIONS.PROJECT_MANAGE)
  addRisk(@Scope() scope: CompanyScope, @Req() request: Request, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.projects.addRisk(scope, id, body, user.id, request.axoraPermissions ?? new Set());
  }

  @Patch(":id/risks/:riskId")
  @RequirePermission(PROJECT_PERMISSIONS.PROJECT_MANAGE)
  updateRisk(
    @Scope() scope: CompanyScope,
    @Req() request: Request, @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Param("riskId") riskId: string,
    @Body() body: unknown,
  ) {
    return this.projects.updateRisk(scope, id, riskId, body, user.id, request.axoraPermissions ?? new Set());
  }
}
