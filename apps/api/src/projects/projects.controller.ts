import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { PROJECT_PERMISSIONS } from "@axora24/contracts";
import { RequirePermission } from "../auth/require-permission.decorator.js";
import { CurrentUser, Scope, ScopedController } from "../common/scope.guard.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import type { AuthenticatedUser } from "../auth/session.guard.js";
import { ProjectsService } from "./projects.service.js";

/** INC-05 — Projets & Construction. */
@Controller("projects")
@ScopedController()
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  @RequirePermission(PROJECT_PERMISSIONS.PROJECT_READ)
  list(@Scope() scope: CompanyScope) {
    return this.projects.list(scope);
  }

  @Get(":id")
  @RequirePermission(PROJECT_PERMISSIONS.PROJECT_READ)
  detail(@Scope() scope: CompanyScope, @Param("id") id: string) {
    return this.projects.detail(scope, id);
  }

  @Post()
  @RequirePermission(PROJECT_PERMISSIONS.PROJECT_MANAGE)
  create(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.projects.create(scope, body, user.id);
  }

  @Post(":id/status")
  @RequirePermission(PROJECT_PERMISSIONS.PROJECT_MANAGE)
  status(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.projects.changeStatus(scope, id, body, user.id);
  }

  @Post(":id/wbs")
  @RequirePermission(PROJECT_PERMISSIONS.PROJECT_MANAGE)
  addWbs(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.projects.addWbsItem(scope, id, body, user.id);
  }

  @Post(":id/budget-lines")
  @RequirePermission(PROJECT_PERMISSIONS.BUDGET_MANAGE)
  addBudgetLine(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.projects.addBudgetLine(scope, id, body, user.id);
  }

  @Delete(":id/budget-lines/:lineId")
  @RequirePermission(PROJECT_PERMISSIONS.BUDGET_MANAGE)
  removeBudgetLine(
    @Scope() scope: CompanyScope,
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Param("lineId") lineId: string,
  ) {
    return this.projects.removeBudgetLine(scope, id, lineId, user.id);
  }

  @Post(":id/baseline")
  @RequirePermission(PROJECT_PERMISSIONS.BUDGET_MANAGE)
  baseline(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.projects.baseline(scope, id, user.id);
  }

  @Post(":id/change-orders")
  @RequirePermission(PROJECT_PERMISSIONS.BUDGET_MANAGE)
  requestChangeOrder(
    @Scope() scope: CompanyScope,
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.projects.requestChangeOrder(scope, id, body, user.id);
  }

  @Post(":id/change-orders/:orderId/approve")
  @RequirePermission(PROJECT_PERMISSIONS.CHANGE_ORDER_APPROVE)
  approve(
    @Scope() scope: CompanyScope,
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Param("orderId") orderId: string,
    @Body() body: unknown,
  ) {
    return this.projects.decideChangeOrder(scope, id, orderId, "APPROVED", body, user.id);
  }

  @Post(":id/change-orders/:orderId/reject")
  @RequirePermission(PROJECT_PERMISSIONS.CHANGE_ORDER_APPROVE)
  reject(
    @Scope() scope: CompanyScope,
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Param("orderId") orderId: string,
    @Body() body: unknown,
  ) {
    return this.projects.decideChangeOrder(scope, id, orderId, "REJECTED", body, user.id);
  }

  @Post(":id/tasks")
  @RequirePermission(PROJECT_PERMISSIONS.TASK_MANAGE)
  addTask(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.projects.addTask(scope, id, body, user.id);
  }

  @Patch(":id/tasks/:taskId/status")
  @RequirePermission(PROJECT_PERMISSIONS.TASK_MANAGE)
  taskStatus(
    @Scope() scope: CompanyScope,
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Param("taskId") taskId: string,
    @Body() body: unknown,
  ) {
    return this.projects.setTaskStatus(scope, id, taskId, body, user.id);
  }

  @Post(":id/milestones")
  @RequirePermission(PROJECT_PERMISSIONS.PROJECT_MANAGE)
  addMilestone(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.projects.addMilestone(scope, id, body, user.id);
  }

  @Post(":id/milestones/:milestoneId/achieve")
  @RequirePermission(PROJECT_PERMISSIONS.PROJECT_MANAGE)
  achieveMilestone(
    @Scope() scope: CompanyScope,
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Param("milestoneId") milestoneId: string,
  ) {
    return this.projects.achieveMilestone(scope, id, milestoneId, user.id);
  }

  @Post(":id/risks")
  @RequirePermission(PROJECT_PERMISSIONS.PROJECT_MANAGE)
  addRisk(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.projects.addRisk(scope, id, body, user.id);
  }

  @Patch(":id/risks/:riskId")
  @RequirePermission(PROJECT_PERMISSIONS.PROJECT_MANAGE)
  updateRisk(
    @Scope() scope: CompanyScope,
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Param("riskId") riskId: string,
    @Body() body: unknown,
  ) {
    return this.projects.updateRisk(scope, id, riskId, body, user.id);
  }
}
