import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { WORKFLOW_PERMISSIONS as W } from "@axora24/contracts";
import { RequireAnyPermission, RequirePermission } from "../auth/require-permission.decorator.js";
import { SessionGuard, type AuthenticatedUser } from "../auth/session.guard.js";
import { CurrentUser, Scope, ScopedController } from "../common/scope.guard.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import { WorkflowService } from "./workflow.service.js";

/** INC-21 — Workflows : definitions, journal, approbations, webhooks. */
@Controller("workflow")
@ScopedController()
export class WorkflowController {
  constructor(private readonly service: WorkflowService) {}

  @Get("summary")
  @RequireAnyPermission(W.READ, W.APPROVE)
  summary(@Scope() scope: CompanyScope) {
    return this.service.summary(scope);
  }

  @Get("roles")
  @RequirePermission(W.MANAGE)
  roles(@Scope() scope: CompanyScope) {
    return this.service.roles(scope);
  }

  @Get("definitions")
  @RequirePermission(W.READ)
  definitions(@Scope() scope: CompanyScope) {
    return this.service.listDefinitions(scope);
  }

  @Post("definitions")
  @RequirePermission(W.MANAGE)
  create(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.service.createDefinition(scope, body, user.id);
  }

  @Post("definitions/:id/active")
  @RequirePermission(W.MANAGE)
  setActive(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.service.setActive(scope, id, body, user.id);
  }

  @Get("executions")
  @RequirePermission(W.READ)
  executions(@Scope() scope: CompanyScope, @Query() query: Record<string, unknown>) {
    return this.service.listExecutions(scope, query);
  }

  @Post("run")
  @RequirePermission(W.MANAGE)
  run(@Scope() scope: CompanyScope) {
    return this.service.run(scope);
  }

  @Get("approvals")
  @RequireAnyPermission(W.READ, W.APPROVE)
  approvals(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Query() query: Record<string, unknown>) {
    return this.service.listApprovals(scope, user, query);
  }

  @Post("approvals/:id/decision")
  @RequirePermission(W.APPROVE)
  decide(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.service.decideApproval(scope, id, body, user);
  }

  @Get("deliveries")
  @RequirePermission(W.READ)
  deliveries(@Scope() scope: CompanyScope) {
    return this.service.listDeliveries(scope);
  }

  @Post("deliveries/:id/retry")
  @RequirePermission(W.MANAGE)
  retry(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.service.retryDelivery(scope, id, user.id);
  }
}

/**
 * Notifications de l'utilisateur de la session. Aucune permission metier :
 * chacun ne lit que ses propres notifications, dans les entreprises dont il
 * est encore membre.
 */
@Controller("notifications")
@UseGuards(SessionGuard)
export class NotificationsController {
  constructor(private readonly service: WorkflowService) {}

  @Get()
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.service.myNotifications(user);
  }

  @Post("read-all")
  readAll(@CurrentUser() user: AuthenticatedUser) {
    return this.service.markRead(user, null);
  }

  @Post(":id/read")
  read(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.service.markRead(user, id);
  }
}
