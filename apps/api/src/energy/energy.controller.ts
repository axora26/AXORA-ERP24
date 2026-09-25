import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ENERGY_PERMISSIONS as E } from "@axora24/contracts";
import { RequirePermission } from "../auth/require-permission.decorator.js";
import { CurrentUser, Scope, ScopedController } from "../common/scope.guard.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import type { AuthenticatedUser } from "../auth/session.guard.js";
import { Gateway, GatewayTokenGuard, type GatewayContext } from "../smart/gateway-token.guard.js";
import { EnergyService } from "./energy.service.js";

/** INC-17 — Energie (utilisateurs). */
@Controller("energy")
@ScopedController()
export class EnergyController {
  constructor(private readonly energy: EnergyService) {}

  @Get("summary")
  @RequirePermission(E.READ)
  summary(@Scope() scope: CompanyScope) {
    return this.energy.summary(scope);
  }

  @Get("buildings")
  @RequirePermission(E.READ)
  buildings(@Scope() scope: CompanyScope) {
    return this.energy.buildings(scope);
  }

  @Get("balance")
  @RequirePermission(E.READ)
  balance(@Scope() scope: CompanyScope, @Query() query: Record<string, unknown>) {
    return this.energy.balance(scope, query);
  }

  @Get("autonomy")
  @RequirePermission(E.READ)
  autonomy(@Scope() scope: CompanyScope, @Query() query: Record<string, unknown>) {
    return this.energy.autonomy(scope, query);
  }

  @Post("storages")
  @RequirePermission(E.MANAGE)
  createStorage(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.energy.createStorage(scope, body, user.id);
  }

  @Get("meters")
  @RequirePermission(E.READ)
  meters(@Scope() scope: CompanyScope, @Query() query: Record<string, unknown>) {
    return this.energy.listMeters(scope, query);
  }

  @Get("meters/:id")
  @RequirePermission(E.READ)
  meter(@Scope() scope: CompanyScope, @Param("id") id: string) {
    return this.energy.getMeter(scope, id);
  }

  @Post("meters")
  @RequirePermission(E.MANAGE)
  createMeter(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.energy.createMeter(scope, body, user.id);
  }

  @Patch("meters/:id")
  @RequirePermission(E.MANAGE)
  updateMeter(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.energy.updateMeter(scope, id, body, user.id);
  }

  @Post("meters/:id/tariffs")
  @RequirePermission(E.MANAGE)
  addTariff(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.energy.addTariff(scope, id, body, user.id);
  }

  @Post("meters/:id/rules")
  @RequirePermission(E.MANAGE)
  addRule(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.energy.addRule(scope, id, body, user.id);
  }

  @Patch("rules/:id")
  @RequirePermission(E.MANAGE)
  updateRule(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.energy.setRuleActive(scope, id, body, user.id);
  }

  @Post("meters/:id/intervals")
  @RequirePermission(E.IMPORT)
  @HttpCode(200)
  importIntervals(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.energy.importIntervals(scope, id, body, user.id);
  }

  @Get("alerts")
  @RequirePermission(E.READ)
  alerts(@Scope() scope: CompanyScope, @Query() query: Record<string, unknown>) {
    return this.energy.listAlerts(scope, query);
  }

  @Post("alerts/:id/acknowledge")
  @RequirePermission(E.ALERT_ACK)
  acknowledge(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.energy.acknowledgeAlert(scope, id, body, user.id);
  }
}

/** API machine : intervalles energetiques envoyes par une passerelle GTB pour SES compteurs. */
@Controller("smart/gateway")
@UseGuards(GatewayTokenGuard)
export class EnergyGatewayController {
  constructor(private readonly energy: EnergyService) {}

  @Post("energy-intervals")
  @HttpCode(200)
  intervals(@Gateway() gateway: GatewayContext, @Body() body: unknown) {
    return this.energy.ingestFromGateway(gateway, body);
  }
}
