import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ASSETS_PERMISSIONS as A } from "@axora24/contracts";
import { RequirePermission } from "../auth/require-permission.decorator.js";
import { CurrentUser, Scope, ScopedController } from "../common/scope.guard.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import type { AuthenticatedUser } from "../auth/session.guard.js";
import { AssetsService } from "./assets.service.js";

/** INC-15 — Actifs / GMAO. Temps et pieces d'un OT sont append-only. */
@Controller("assets")
@ScopedController()
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Get("summary")
  @RequirePermission(A.ASSET_READ)
  summary(@Scope() scope: CompanyScope) {
    return this.assets.summary(scope);
  }

  @Get()
  @RequirePermission(A.ASSET_READ)
  list(@Scope() scope: CompanyScope, @Query() query: Record<string, unknown>) {
    return this.assets.listAssets(scope, query);
  }

  @Get("items/:id")
  @RequirePermission(A.ASSET_READ)
  get(@Scope() scope: CompanyScope, @Param("id") id: string) {
    return this.assets.getAsset(scope, id);
  }

  @Post("from-commissioning")
  @RequirePermission(A.ASSET_MANAGE)
  fromCommissioning(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.assets.createFromCommissioning(scope, body, user.id);
  }

  @Post("manual")
  @RequirePermission(A.ASSET_MANAGE)
  manual(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.assets.createManual(scope, body, user.id);
  }

  @Patch("items/:id")
  @RequirePermission(A.ASSET_MANAGE)
  update(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.assets.updateAsset(scope, id, body, user.id);
  }

  @Get("plans")
  @RequirePermission(A.ASSET_READ)
  plans(@Scope() scope: CompanyScope, @Query() query: Record<string, unknown>) {
    return this.assets.listPlans(scope, query);
  }

  @Post("plans")
  @RequirePermission(A.ASSET_MANAGE)
  createPlan(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.assets.createPlan(scope, body, user.id);
  }

  @Post("plans/generate")
  @RequirePermission(A.WORKORDER_MANAGE)
  generate(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.assets.generateDue(scope, body, user.id);
  }

  @Get("tickets")
  @RequirePermission(A.ASSET_READ)
  tickets(@Scope() scope: CompanyScope, @Query() query: Record<string, unknown>) {
    return this.assets.listTickets(scope, query);
  }

  @Post("tickets")
  @RequirePermission(A.TICKET_CREATE)
  createTicket(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.assets.createTicket(scope, body, user.id);
  }

  @Post("tickets/:id/convert")
  @RequirePermission(A.WORKORDER_MANAGE)
  convert(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.assets.convertTicket(scope, id, body, user.id);
  }

  @Post("tickets/:id/reject")
  @RequirePermission(A.WORKORDER_MANAGE)
  rejectTicket(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.assets.rejectTicket(scope, id, body, user.id);
  }

  @Get("work-orders")
  @RequirePermission(A.ASSET_READ)
  workOrders(@Scope() scope: CompanyScope, @Query() query: Record<string, unknown>) {
    return this.assets.listWorkOrders(scope, query);
  }

  @Get("work-orders/:id")
  @RequirePermission(A.ASSET_READ)
  workOrder(@Scope() scope: CompanyScope, @Param("id") id: string) {
    return this.assets.getWorkOrder(scope, id);
  }

  @Post("work-orders/:id/start")
  @RequirePermission(A.WORKORDER_MANAGE)
  start(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.assets.startWorkOrder(scope, id, body, user.id);
  }

  @Post("work-orders/:id/labor")
  @RequirePermission(A.WORKORDER_MANAGE)
  labor(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.assets.addLabor(scope, id, body, user.id);
  }

  @Post("work-orders/:id/parts")
  @RequirePermission(A.WORKORDER_MANAGE)
  parts(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.assets.addPart(scope, id, body, user.id);
  }

  @Post("work-orders/:id/complete")
  @RequirePermission(A.WORKORDER_MANAGE)
  complete(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.assets.completeWorkOrder(scope, id, body, user.id);
  }

  @Post("work-orders/:id/cancel")
  @RequirePermission(A.WORKORDER_MANAGE)
  cancel(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.assets.cancelWorkOrder(scope, id, body, user.id);
  }
}
