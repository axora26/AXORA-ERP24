import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { FIELD_PERMISSIONS as F } from "@axora24/contracts";
import { RequirePermission } from "../auth/require-permission.decorator.js";
import { CurrentUser, Scope, ScopedController } from "../common/scope.guard.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import type { AuthenticatedUser } from "../auth/session.guard.js";
import { FieldService } from "./field.service.js";

/**
 * INC-10 — Chantier. Toutes les saisies terrain (reserves, preuves,
 * corrections, journal) passent par /field/sync — en ligne comme hors
 * ligne — pour garantir idempotence et detection explicite des conflits.
 */
@Controller("field")
@ScopedController()
export class FieldController {
  constructor(private readonly field: FieldService) {}

  @Get("zones")
  @RequirePermission(F.SITE_READ)
  zones(@Scope() scope: CompanyScope, @Query() query: Record<string, unknown>) {
    return this.field.listZones(scope, query);
  }

  @Post("zones")
  @RequirePermission(F.LOG_MANAGE)
  createZone(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.field.createZone(scope, body, user.id);
  }

  @Get("logs")
  @RequirePermission(F.SITE_READ)
  logs(@Scope() scope: CompanyScope, @Query() query: Record<string, unknown>) {
    return this.field.listLogs(scope, query);
  }

  @Get("logs/:id")
  @RequirePermission(F.SITE_READ)
  log(@Scope() scope: CompanyScope, @Param("id") id: string) {
    return this.field.getLog(scope, id);
  }

  @Post("logs/:id/sign")
  @RequirePermission(F.LOG_SIGN)
  signLog(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.field.signLog(scope, id, body, user.id);
  }

  @Get("issues")
  @RequirePermission(F.SITE_READ)
  issues(@Scope() scope: CompanyScope, @Query() query: Record<string, unknown>) {
    return this.field.listIssues(scope, query);
  }

  @Get("issues/:id")
  @RequirePermission(F.SITE_READ)
  issue(@Scope() scope: CompanyScope, @Param("id") id: string) {
    return this.field.getIssue(scope, id);
  }

  @Post("issues/:id/close")
  @RequirePermission(F.ISSUE_CLOSE)
  closeIssue(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.field.closeIssue(scope, id, body, user.id);
  }

  @Post("issues/:id/reopen")
  @RequirePermission(F.ISSUE_CLOSE)
  reopenIssue(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.field.reopenIssue(scope, id, body, user.id);
  }

  @Get("evidence")
  @RequirePermission(F.SITE_READ)
  evidence(@Scope() scope: CompanyScope, @Query() query: Record<string, unknown>) {
    return this.field.listEvidence(scope, query);
  }

  @Post("sync")
  @RequirePermission(F.SITE_READ)
  sync(@Req() request: Request, @Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.field.sync(scope, body, user.id, request.axoraPermissions ?? new Set<string>());
  }
}
