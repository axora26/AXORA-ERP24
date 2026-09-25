import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { INTEGRATIONS_PERMISSIONS as I } from "@axora24/contracts";
import { RequirePermission } from "../auth/require-permission.decorator.js";
import type { AuthenticatedUser } from "../auth/session.guard.js";
import { CurrentUser, Scope, ScopedController } from "../common/scope.guard.js";
import { EffectivePermissions } from "../common/effective-permissions.decorator.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import { IntegrationsService } from "./integrations.service.js";

/** INC-23 — Administration des integrations (session interne). */
@Controller("integrations")
@ScopedController()
export class IntegrationsController {
  constructor(private readonly service: IntegrationsService) {}

  @Get("connectors")
  @RequirePermission(I.READ)
  connectors() {
    return this.service.connectors();
  }

  @Get("delegable")
  @RequirePermission(I.MANAGE)
  delegable(@EffectivePermissions() permissions: Set<string>) {
    return this.service.delegable(permissions);
  }

  @Get("api-keys")
  @RequirePermission(I.READ)
  keys(@Scope() scope: CompanyScope) {
    return this.service.keys(scope);
  }

  @Post("api-keys")
  @RequirePermission(I.MANAGE)
  issue(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @EffectivePermissions() permissions: Set<string>, @Body() body: unknown) {
    return this.service.issueKey(scope, user, permissions, body);
  }

  @Post("api-keys/:id/revoke")
  @RequirePermission(I.MANAGE)
  revoke(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.service.revokeKey(scope, user, id, body);
  }

  @Get("api-keys/:id/requests")
  @RequirePermission(I.READ)
  requests(@Scope() scope: CompanyScope, @Param("id") id: string) {
    return this.service.requests(scope, id);
  }

  @Get("inbound")
  @RequirePermission(I.READ)
  endpoints(@Scope() scope: CompanyScope) {
    return this.service.endpoints(scope);
  }

  @Post("inbound")
  @RequirePermission(I.INBOUND)
  createEndpoint(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @EffectivePermissions() permissions: Set<string>, @Body() body: unknown) {
    return this.service.createEndpoint(scope, user, permissions, body);
  }

  @Post("inbound/:id/active")
  @RequirePermission(I.INBOUND)
  setActive(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.service.setEndpointActive(scope, user, id, body);
  }

  @Get("inbound/:id/events")
  @RequirePermission(I.READ)
  events(@Scope() scope: CompanyScope, @Param("id") id: string) {
    return this.service.events(scope, id);
  }
}
