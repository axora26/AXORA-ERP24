import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { MEP_PERMISSIONS as M } from "@axora24/contracts";
import { RequirePermission } from "../auth/require-permission.decorator.js";
import { CurrentUser, Scope, ScopedController } from "../common/scope.guard.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import type { AuthenticatedUser } from "../auth/session.guard.js";
import { MepService } from "./mep.service.js";

/** INC-13 — MEP. Les resultats de calcul sont toujours produits par le serveur. */
@Controller("mep")
@ScopedController()
export class MepController {
  constructor(private readonly mep: MepService) {}

  @Get("calculation-types")
  @RequirePermission(M.READ)
  catalog() {
    return this.mep.catalog();
  }

  @Get("systems")
  @RequirePermission(M.READ)
  systems(@Scope() scope: CompanyScope, @Query() query: Record<string, unknown>) {
    return this.mep.listSystems(scope, query);
  }

  @Post("systems")
  @RequirePermission(M.MANAGE)
  createSystem(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.mep.createSystem(scope, body, user.id);
  }

  @Get("equipment")
  @RequirePermission(M.READ)
  equipment(@Scope() scope: CompanyScope, @Query() query: Record<string, unknown>) {
    return this.mep.listEquipment(scope, query);
  }

  @Get("equipment/:id")
  @RequirePermission(M.READ)
  oneEquipment(@Scope() scope: CompanyScope, @Param("id") id: string) {
    return this.mep.getEquipment(scope, id);
  }

  @Post("equipment")
  @RequirePermission(M.MANAGE)
  createEquipment(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.mep.createEquipment(scope, body, user.id);
  }

  @Patch("equipment/:id")
  @RequirePermission(M.MANAGE)
  updateEquipment(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.mep.updateEquipment(scope, id, body, user.id);
  }

  @Get("quantities")
  @RequirePermission(M.READ)
  quantities(@Scope() scope: CompanyScope, @Query() query: Record<string, unknown>) {
    return this.mep.quantities(scope, query);
  }

  @Get("calculations")
  @RequirePermission(M.READ)
  calculations(@Scope() scope: CompanyScope, @Query() query: Record<string, unknown>) {
    return this.mep.listCalculations(scope, query);
  }

  @Get("calculations/:id")
  @RequirePermission(M.READ)
  calculation(@Scope() scope: CompanyScope, @Param("id") id: string) {
    return this.mep.getCalculation(scope, id);
  }

  @Post("calculations")
  @RequirePermission(M.CALCULATION_MANAGE)
  createCalculation(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.mep.createCalculation(scope, body, user.id);
  }

  @Post("calculations/:id/revise")
  @RequirePermission(M.CALCULATION_MANAGE)
  revise(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.mep.reviseCalculation(scope, id, body, user.id);
  }

  @Post("calculations/:id/validate")
  @RequirePermission(M.CALCULATION_VALIDATE)
  validate(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.mep.validateCalculation(scope, id, body, user.id);
  }
}
