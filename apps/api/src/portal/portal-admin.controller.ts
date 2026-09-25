import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { PORTAL_PERMISSIONS as P } from "@axora24/contracts";
import { RequirePermission } from "../auth/require-permission.decorator.js";
import { CurrentUser, Scope, ScopedController } from "../common/scope.guard.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import type { AuthenticatedUser } from "../auth/session.guard.js";
import { PortalAdminService } from "./portal-admin.service.js";

/** INC-20 — administration interne des acces portail (utilisateurs internes uniquement). */
@Controller("portal-admin")
@ScopedController()
export class PortalAdminController {
  constructor(private readonly admin: PortalAdminService) {}

  @Get("principals")
  @RequirePermission(P.READ)
  list(@Scope() scope: CompanyScope) {
    return this.admin.list(scope);
  }

  @Get("principals/:id")
  @RequirePermission(P.READ)
  get(@Scope() scope: CompanyScope, @Param("id") id: string) {
    return this.admin.get(scope, id);
  }

  @Post("principals")
  @RequirePermission(P.MANAGE)
  create(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.admin.create(scope, body, user.id);
  }

  @Post("principals/:id/invitations")
  @RequirePermission(P.MANAGE)
  reinvite(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.admin.reinvite(scope, id, user.id);
  }

  @Post("principals/:id/status")
  @RequirePermission(P.MANAGE)
  status(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.admin.setStatus(scope, id, body, user.id);
  }

  @Get("principals/:id/candidates")
  @RequirePermission(P.GRANT)
  candidates(@Scope() scope: CompanyScope, @Param("id") id: string) {
    return this.admin.candidates(scope, id);
  }

  @Post("principals/:id/grants")
  @RequirePermission(P.GRANT)
  grant(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.admin.grant(scope, id, body, user.id);
  }

  @Post("grants/:id/revoke")
  @RequirePermission(P.GRANT)
  revoke(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.admin.revokeGrant(scope, id, user.id);
  }
}
