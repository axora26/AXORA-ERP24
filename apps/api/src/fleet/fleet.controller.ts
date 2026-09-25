import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { FLEET_PERMISSIONS as FL } from "@axora24/contracts";
import { RequirePermission } from "../auth/require-permission.decorator.js";
import { CurrentUser, Scope, ScopedController } from "../common/scope.guard.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import type { AuthenticatedUser } from "../auth/session.guard.js";
import { FleetService } from "./fleet.service.js";

/** INC-18 — Gestion de parc. */
@Controller("fleet")
@ScopedController()
export class FleetController {
  constructor(private readonly fleet: FleetService) {}

  @Get("summary")
  @RequirePermission(FL.READ)
  summary(@Scope() scope: CompanyScope) {
    return this.fleet.summary(scope);
  }

  @Get("vehicles")
  @RequirePermission(FL.READ)
  vehicles(@Scope() scope: CompanyScope, @Query() query: Record<string, unknown>) {
    return this.fleet.listVehicles(scope, query);
  }

  @Get("vehicles/:id")
  @RequirePermission(FL.READ)
  vehicle(@Scope() scope: CompanyScope, @Param("id") id: string) {
    return this.fleet.getVehicle(scope, id);
  }

  @Post("vehicles")
  @RequirePermission(FL.MANAGE)
  create(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.fleet.createVehicle(scope, body, user.id);
  }

  @Post("vehicles/:id/status")
  @RequirePermission(FL.MANAGE)
  status(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.fleet.setStatus(scope, id, body, user.id);
  }

  @Post("vehicles/:id/readings")
  @RequirePermission(FL.MANAGE)
  reading(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.fleet.addReading(scope, id, body, user.id);
  }

  @Post("vehicles/:id/documents")
  @RequirePermission(FL.MANAGE)
  document(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.fleet.addDocument(scope, id, body, user.id);
  }

  @Get("assignments")
  @RequirePermission(FL.READ)
  assignments(@Scope() scope: CompanyScope, @Query() query: Record<string, unknown>) {
    return this.fleet.listAssignments(scope, query);
  }

  @Post("assignments")
  @RequirePermission(FL.ASSIGN)
  assign(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.fleet.assign(scope, body, user.id);
  }

  @Post("assignments/:id/close")
  @RequirePermission(FL.ASSIGN)
  close(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.fleet.closeAssignment(scope, id, body, user.id);
  }

  @Get("fuel")
  @RequirePermission(FL.READ)
  fuel(@Scope() scope: CompanyScope, @Query() query: Record<string, unknown>) {
    return this.fleet.listFuel(scope, query);
  }

  @Post("fuel")
  @RequirePermission(FL.FUEL)
  recordFuel(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.fleet.recordFuel(scope, body, user.id);
  }

  @Get("project-costs")
  @RequirePermission(FL.READ)
  projectCosts(@Scope() scope: CompanyScope) {
    return this.fleet.projectCosts(scope);
  }

  @Get("incidents")
  @RequirePermission(FL.READ)
  incidents(@Scope() scope: CompanyScope, @Query() query: Record<string, unknown>) {
    return this.fleet.listIncidents(scope, query);
  }

  @Post("incidents")
  @RequirePermission(FL.INCIDENT)
  report(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.fleet.reportIncident(scope, body, user.id);
  }

  @Post("incidents/:id/close")
  @RequirePermission(FL.INCIDENT)
  closeIncident(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.fleet.closeIncident(scope, id, body, user.id);
  }
}
