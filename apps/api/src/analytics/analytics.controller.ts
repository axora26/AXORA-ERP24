import { Body, Controller, Delete, Get, Param, Post, Put, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { ANALYTICS_PERMISSIONS as A } from "@axora24/contracts";
import { RequirePermission } from "../auth/require-permission.decorator.js";
import type { AuthenticatedUser } from "../auth/session.guard.js";
import { CurrentUser, Scope, ScopedController } from "../common/scope.guard.js";
import { EffectivePermissions } from "../common/effective-permissions.decorator.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import { AnalyticsService } from "./analytics.service.js";

/** INC-23 — Analytique : chaque indicateur reste soumis a la permission de lecture de son module. */
@Controller("analytics")
@ScopedController()
export class AnalyticsController {
  constructor(private readonly service: AnalyticsService) {}

  @Get("catalog")
  @RequirePermission(A.READ)
  catalog(@EffectivePermissions() permissions: Set<string>) {
    return this.service.catalog(permissions);
  }

  @Get("series/:key")
  @RequirePermission(A.READ)
  series(@Scope() scope: CompanyScope, @EffectivePermissions() permissions: Set<string>, @Param("key") key: string, @Query() query: Record<string, unknown>) {
    return this.service.series(scope, permissions, key, query);
  }

  @Get("export/:key")
  @RequirePermission(A.READ)
  async export(@Scope() scope: CompanyScope, @EffectivePermissions() permissions: Set<string>, @Param("key") key: string, @Query() query: Record<string, unknown>, @Res() response: Response) {
    const { filename, content } = await this.service.csv(scope, permissions, key, query);
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader("Content-Disposition", `attachment; filename="${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}"`);
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.send(`\ufeff${content}`);
  }

  @Get("snapshots")
  @RequirePermission(A.READ)
  snapshots(@Scope() scope: CompanyScope, @EffectivePermissions() permissions: Set<string>) {
    return this.service.snapshots(scope, permissions);
  }

  @Post("snapshots")
  @RequirePermission(A.SNAPSHOT)
  capture(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @EffectivePermissions() permissions: Set<string>, @Body() body: unknown) {
    return this.service.capture(scope, user, permissions, body);
  }

  @Get("dashboards")
  @RequirePermission(A.READ)
  dashboards(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser) {
    return this.service.dashboards(scope, user);
  }

  @Post("dashboards")
  @RequirePermission(A.DASHBOARD)
  createDashboard(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @EffectivePermissions() permissions: Set<string>, @Body() body: unknown) {
    return this.service.createDashboard(scope, user, permissions, body);
  }

  @Put("dashboards/:id")
  @RequirePermission(A.DASHBOARD)
  updateDashboard(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @EffectivePermissions() permissions: Set<string>, @Param("id") id: string, @Body() body: unknown) {
    return this.service.updateDashboard(scope, user, permissions, id, body);
  }

  @Delete("dashboards/:id")
  @RequirePermission(A.DASHBOARD)
  deleteDashboard(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.service.deleteDashboard(scope, user, id);
  }
}
