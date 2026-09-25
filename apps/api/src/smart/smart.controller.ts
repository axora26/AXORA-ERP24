import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { SMART_PERMISSIONS as S } from "@axora24/contracts";
import { RequirePermission } from "../auth/require-permission.decorator.js";
import { CurrentUser, Scope, ScopedController } from "../common/scope.guard.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import type { AuthenticatedUser } from "../auth/session.guard.js";
import { SmartService } from "./smart.service.js";

/** INC-16 — Smart Building (utilisateurs). La telemetrie n'entre que par l'API passerelle. */
@Controller("smart")
@ScopedController()
export class SmartController {
  constructor(private readonly smart: SmartService) {}

  @Get("summary")
  @RequirePermission(S.READ)
  summary(@Scope() scope: CompanyScope) {
    return this.smart.summary(scope);
  }

  @Get("buildings")
  @RequirePermission(S.READ)
  buildings(@Scope() scope: CompanyScope) {
    return this.smart.listBuildings(scope);
  }

  @Post("buildings")
  @RequirePermission(S.MANAGE)
  createBuilding(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.smart.createBuilding(scope, body, user.id);
  }

  @Get("gateways")
  @RequirePermission(S.READ)
  gateways(@Scope() scope: CompanyScope) {
    return this.smart.listGateways(scope);
  }

  @Get("gateways/:id")
  @RequirePermission(S.READ)
  gateway(@Scope() scope: CompanyScope, @Param("id") id: string) {
    return this.smart.getGateway(scope, id);
  }

  @Post("gateways")
  @RequirePermission(S.MANAGE)
  createGateway(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.smart.createGateway(scope, body, user.id);
  }

  @Patch("gateways/:id")
  @RequirePermission(S.MANAGE)
  updateGateway(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.smart.updateGateway(scope, id, body, user.id);
  }

  @Post("gateways/:id/rotate-token")
  @RequirePermission(S.MANAGE)
  rotate(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.smart.rotateToken(scope, id, user.id);
  }

  @Post("gateways/:id/tests")
  @RequirePermission(S.GATEWAY_TEST)
  attest(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.smart.attestTest(scope, id, body, user.id);
  }

  @Get("points")
  @RequirePermission(S.READ)
  points(@Scope() scope: CompanyScope, @Query() query: Record<string, unknown>) {
    return this.smart.listPoints(scope, query);
  }

  @Get("points/:id")
  @RequirePermission(S.READ)
  point(@Scope() scope: CompanyScope, @Param("id") id: string) {
    return this.smart.getPoint(scope, id);
  }

  @Get("points/:id/trend")
  @RequirePermission(S.READ)
  trend(@Scope() scope: CompanyScope, @Param("id") id: string, @Query() query: Record<string, unknown>) {
    return this.smart.trend(scope, id, query);
  }

  @Post("points")
  @RequirePermission(S.MANAGE)
  createPoint(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.smart.createPoint(scope, body, user.id);
  }

  @Patch("points/:id")
  @RequirePermission(S.MANAGE)
  updatePoint(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.smart.updatePoint(scope, id, body, user.id);
  }

  @Post("rules")
  @RequirePermission(S.MANAGE)
  createRule(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.smart.createRule(scope, body, user.id);
  }

  @Patch("rules/:id")
  @RequirePermission(S.MANAGE)
  updateRule(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.smart.setRuleActive(scope, id, body, user.id);
  }

  @Get("alarms")
  @RequirePermission(S.READ)
  alarms(@Scope() scope: CompanyScope, @Query() query: Record<string, unknown>) {
    return this.smart.listAlarms(scope, query);
  }

  @Post("alarms/:id/acknowledge")
  @RequirePermission(S.ALARM_ACK)
  acknowledge(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.smart.acknowledgeAlarm(scope, id, body, user.id);
  }

  @Get("setpoints")
  @RequirePermission(S.READ)
  setpoints(@Scope() scope: CompanyScope, @Query() query: Record<string, unknown>) {
    return this.smart.listSetpoints(scope, query);
  }

  @Post("setpoints")
  @RequirePermission(S.SETPOINT_REQUEST)
  requestSetpoint(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.smart.requestSetpoint(scope, body, user.id);
  }

  @Post("setpoints/:id/cancel")
  @RequirePermission(S.SETPOINT_REQUEST)
  cancelSetpoint(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.smart.cancelSetpoint(scope, id, user.id);
  }
}
