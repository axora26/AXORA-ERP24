import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { COMMISSIONING_PERMISSIONS as C } from "@axora24/contracts";
import { RequirePermission } from "../auth/require-permission.decorator.js";
import { CurrentUser, Scope, ScopedController } from "../common/scope.guard.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import type { AuthenticatedUser } from "../auth/session.guard.js";
import { CommissioningService } from "./commissioning.service.js";

/** INC-12 — Commissioning. Les fiches d'essai sont append-only (aucune route de modification). */
@Controller("commissioning")
@ScopedController()
export class CommissioningController {
  constructor(private readonly commissioning: CommissioningService) {}

  @Get("activities")
  @RequirePermission(C.READ)
  list(@Scope() scope: CompanyScope, @Query() query: Record<string, unknown>) {
    return this.commissioning.list(scope, query);
  }

  @Get("activities/:id")
  @RequirePermission(C.READ)
  get(@Scope() scope: CompanyScope, @Param("id") id: string) {
    return this.commissioning.get(scope, id);
  }

  @Post("activities")
  @RequirePermission(C.MANAGE)
  create(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.commissioning.create(scope, body, user.id);
  }

  @Post("activities/:id/tests")
  @RequirePermission(C.MANAGE)
  recordTest(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.commissioning.recordTest(scope, id, body, user.id);
  }

  @Post("punch-items/:id/correct")
  @RequirePermission(C.MANAGE)
  correct(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.commissioning.correctPunchItem(scope, id, body, user.id);
  }

  @Post("activities/:id/accept")
  @RequirePermission(C.ACCEPT)
  accept(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.commissioning.accept(scope, id, body, user.id);
  }

  @Post("activities/:id/handover")
  @RequirePermission(C.ACCEPT)
  handover(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.commissioning.handOver(scope, id, body, user.id);
  }
}
