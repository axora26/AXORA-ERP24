import { Body, Controller, Get, Param, Post, Put, Query } from "@nestjs/common";
import { QHSE_PERMISSIONS as Q } from "@axora24/contracts";
import { RequirePermission } from "../auth/require-permission.decorator.js";
import { CurrentUser, Scope, ScopedController } from "../common/scope.guard.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import type { AuthenticatedUser } from "../auth/session.guard.js";
import { QhseService } from "./qhse.service.js";

/** INC-11 — QHSE. Aucune route ne modifie les faits d'une NCR ou d'un incident, ni ne supprime. */
@Controller("qhse")
@ScopedController()
export class QhseController {
  constructor(private readonly qhse: QhseService) {}

  @Get("summary")
  @RequirePermission(Q.READ)
  summary(@Scope() scope: CompanyScope, @Query() query: Record<string, unknown>) {
    return this.qhse.summary(scope, query);
  }

  @Get("templates")
  @RequirePermission(Q.READ)
  templates(@Scope() scope: CompanyScope) {
    return this.qhse.listTemplates(scope);
  }

  @Post("templates")
  @RequirePermission(Q.INSPECTION_MANAGE)
  createTemplate(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.qhse.createTemplate(scope, body, user.id);
  }

  @Get("inspections")
  @RequirePermission(Q.READ)
  inspections(@Scope() scope: CompanyScope, @Query() query: Record<string, unknown>) {
    return this.qhse.listInspections(scope, query);
  }

  @Get("inspections/:id")
  @RequirePermission(Q.READ)
  inspection(@Scope() scope: CompanyScope, @Param("id") id: string) {
    return this.qhse.getInspection(scope, id);
  }

  @Post("inspections")
  @RequirePermission(Q.INSPECTION_MANAGE)
  createInspection(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.qhse.createInspection(scope, body, user.id);
  }

  @Put("inspections/:id/items/:itemId")
  @RequirePermission(Q.INSPECTION_MANAGE)
  answer(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Param("itemId") itemId: string, @Body() body: unknown) {
    return this.qhse.answerItem(scope, id, itemId, body, user.id);
  }

  @Post("inspections/:id/complete")
  @RequirePermission(Q.INSPECTION_MANAGE)
  complete(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.qhse.completeInspection(scope, id, user.id);
  }

  @Get("findings")
  @RequirePermission(Q.READ)
  findings(@Scope() scope: CompanyScope, @Query() query: Record<string, unknown>) {
    return this.qhse.listFindings(scope, query);
  }

  @Get("findings/:id")
  @RequirePermission(Q.READ)
  finding(@Scope() scope: CompanyScope, @Param("id") id: string) {
    return this.qhse.getFinding(scope, id);
  }

  @Post("findings")
  @RequirePermission(Q.FINDING_CREATE)
  createFinding(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.qhse.createFinding(scope, body, user.id);
  }

  @Post("findings/:id/actions")
  @RequirePermission(Q.ACTION_MANAGE)
  addAction(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.qhse.addAction(scope, id, body, user.id);
  }

  @Post("findings/:id/close")
  @RequirePermission(Q.FINDING_CLOSE)
  closeFinding(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.qhse.closeFinding(scope, id, body, user.id);
  }

  @Post("actions/:id/complete")
  @RequirePermission(Q.ACTION_MANAGE)
  completeAction(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.qhse.completeAction(scope, id, body, user.id);
  }

  @Post("actions/:id/verify")
  @RequirePermission(Q.FINDING_CLOSE)
  verifyAction(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.qhse.verifyAction(scope, id, "VERIFIED", body, user.id);
  }

  @Post("actions/:id/reject")
  @RequirePermission(Q.FINDING_CLOSE)
  rejectAction(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.qhse.verifyAction(scope, id, "REJECTED", body, user.id);
  }

  @Get("incidents")
  @RequirePermission(Q.READ)
  incidents(@Scope() scope: CompanyScope, @Query() query: Record<string, unknown>) {
    return this.qhse.listIncidents(scope, query);
  }

  @Post("incidents")
  @RequirePermission(Q.INCIDENT_REPORT)
  reportIncident(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.qhse.reportIncident(scope, body, user.id);
  }

  @Post("incidents/:id/investigate")
  @RequirePermission(Q.INCIDENT_MANAGE)
  investigate(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.qhse.investigateIncident(scope, id, body, user.id);
  }

  @Post("incidents/:id/close")
  @RequirePermission(Q.INCIDENT_MANAGE)
  closeIncident(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.qhse.closeIncident(scope, id, user.id);
  }

  @Get("permits")
  @RequirePermission(Q.READ)
  permits(@Scope() scope: CompanyScope, @Query() query: Record<string, unknown>) {
    return this.qhse.listPermits(scope, query);
  }

  @Post("permits")
  @RequirePermission(Q.PERMIT_REQUEST)
  requestPermit(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.qhse.requestPermit(scope, body, user.id);
  }

  @Post("permits/:id/approve")
  @RequirePermission(Q.PERMIT_APPROVE)
  approvePermit(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.qhse.decidePermit(scope, id, "APPROVED", body, user.id);
  }

  @Post("permits/:id/reject")
  @RequirePermission(Q.PERMIT_APPROVE)
  rejectPermit(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.qhse.decidePermit(scope, id, "REJECTED", body, user.id);
  }

  @Post("permits/:id/close")
  @RequirePermission(Q.PERMIT_REQUEST)
  closePermit(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.qhse.closePermit(scope, id, user.id);
  }

  @Get("toolbox")
  @RequirePermission(Q.READ)
  toolbox(@Scope() scope: CompanyScope, @Query() query: Record<string, unknown>) {
    return this.qhse.listToolbox(scope, query);
  }

  @Post("toolbox")
  @RequirePermission(Q.TOOLBOX_MANAGE)
  recordToolbox(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.qhse.recordToolbox(scope, body, user.id);
  }
}
