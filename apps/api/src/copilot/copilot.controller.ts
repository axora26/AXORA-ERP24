import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { AI_PERMISSIONS as AI } from "@axora24/contracts";
import { RequirePermission } from "../auth/require-permission.decorator.js";
import type { AuthenticatedUser } from "../auth/session.guard.js";
import { CurrentUser, Scope, ScopedController } from "../common/scope.guard.js";
import { EffectivePermissions } from "../common/effective-permissions.decorator.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import { CopilotService } from "./copilot.service.js";

/** INC-22 — Copilote : lecture augmentee, strictement bornee par le RBAC de l'appelant. */
@Controller("copilot")
@ScopedController()
export class CopilotController {
  constructor(private readonly service: CopilotService) {}

  @Get("capabilities")
  @RequirePermission(AI.USE)
  capabilities(@EffectivePermissions() permissions: Set<string>) {
    return this.service.capabilities(permissions);
  }

  @Post("ask")
  @RequirePermission(AI.USE)
  ask(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @EffectivePermissions() permissions: Set<string>, @Body() body: unknown) {
    return this.service.ask(scope, user, permissions, body);
  }

  @Get("sessions")
  @RequirePermission(AI.USE)
  sessions(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser) {
    return this.service.sessions(scope, user);
  }

  @Get("sessions/:id")
  @RequirePermission(AI.USE)
  session(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.service.session(scope, user, id);
  }

  @Get("evidence")
  @RequirePermission(AI.AUDIT)
  evidence(@Scope() scope: CompanyScope, @Query() query: Record<string, unknown>) {
    return this.service.evidence(scope, query);
  }
}
