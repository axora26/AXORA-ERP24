import { Controller, Get, Req } from "@nestjs/common";
import type { Request } from "express";
import { DASHBOARD_PERMISSIONS } from "@axora24/contracts";
import { RequirePermission } from "../auth/require-permission.decorator.js";
import { Scope, ScopedController } from "../common/scope.guard.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import { DashboardService } from "./dashboard.service.js";

@Controller("dashboard")
@ScopedController()
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get("overview")
  @RequirePermission(DASHBOARD_PERMISSIONS.OVERVIEW_READ)
  overview(@Req() request: Request, @Scope() scope: CompanyScope) {
    return this.dashboard.overview(scope, request.axoraPermissions ?? new Set());
  }
}
