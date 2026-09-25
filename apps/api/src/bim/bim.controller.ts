import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { BIM_PERMISSIONS as B, MEP_PERMISSIONS as M } from "@axora24/contracts";
import { RequireAnyPermission, RequirePermission } from "../auth/require-permission.decorator.js";
import { CurrentUser, Scope, ScopedController } from "../common/scope.guard.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import type { AuthenticatedUser } from "../auth/session.guard.js";
import { BimService } from "./bim.service.js";

/** INC-14 — BIM / IFC. Aucune route ne modifie le contenu d'une version importee. */
@Controller("bim")
@ScopedController()
export class BimController {
  constructor(private readonly bim: BimService) {}

  @Get("connectors/revit")
  @RequirePermission(B.MODEL_READ)
  revit() {
    return this.bim.revitConnector();
  }

  @Get("models")
  @RequirePermission(B.MODEL_READ)
  models(@Scope() scope: CompanyScope, @Query() query: Record<string, unknown>) {
    return this.bim.listModels(scope, query);
  }

  @Get("models/:id")
  @RequirePermission(B.MODEL_READ)
  model(@Scope() scope: CompanyScope, @Param("id") id: string) {
    return this.bim.getModel(scope, id);
  }

  @Post("models")
  @RequirePermission(B.MODEL_MANAGE)
  createModel(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.bim.createModel(scope, body, user.id);
  }

  @Post("models/:id/versions")
  @RequirePermission(B.MODEL_MANAGE)
  importVersion(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.bim.importVersion(scope, id, body, user.id);
  }

  @Get("versions/:id/verify")
  @RequirePermission(B.MODEL_READ)
  verify(@Scope() scope: CompanyScope, @Param("id") id: string) {
    return this.bim.verifyVersion(scope, id);
  }

  @Post("versions/:id/approve")
  @RequirePermission(B.MODEL_APPROVE)
  approve(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.bim.decideVersion(scope, id, "APPROVED", body, user.id);
  }

  @Post("versions/:id/reject")
  @RequirePermission(B.MODEL_APPROVE)
  reject(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.bim.decideVersion(scope, id, "REJECTED", body, user.id);
  }

  @Get("versions/:id/elements")
  @RequirePermission(B.MODEL_READ)
  elements(@Scope() scope: CompanyScope, @Param("id") id: string, @Query() query: Record<string, unknown>) {
    return this.bim.listElements(scope, id, query);
  }

  @Get("versions/:id/diff")
  @RequirePermission(B.MODEL_READ)
  diff(@Scope() scope: CompanyScope, @Param("id") id: string, @Query() query: Record<string, unknown>) {
    return this.bim.diff(scope, id, query);
  }

  @Post("models/:id/bindings")
  @RequirePermission(B.MODEL_MANAGE)
  bind(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.bim.bindEquipment(scope, id, body, user.id);
  }

  @Get("equipment/:id/bindings")
  @RequireAnyPermission(B.MODEL_READ, M.READ)
  equipmentBindings(@Scope() scope: CompanyScope, @Param("id") id: string) {
    return this.bim.equipmentBindings(scope, id);
  }

  @Get("models/:id/clashes")
  @RequirePermission(B.MODEL_READ)
  clashes(@Scope() scope: CompanyScope, @Param("id") id: string) {
    return this.bim.listClashes(scope, id);
  }

  @Post("models/:id/clashes")
  @RequirePermission(B.CLASH_MANAGE)
  createClash(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.bim.createClash(scope, id, body, user.id);
  }

  @Post("clashes/:id/comments")
  @RequirePermission(B.CLASH_MANAGE)
  comment(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.bim.commentClash(scope, id, body, user.id);
  }

  @Post("clashes/:id/propose")
  @RequirePermission(B.CLASH_MANAGE)
  propose(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.bim.proposeResolution(scope, id, body, user.id);
  }

  @Post("clashes/:id/resolve")
  @RequirePermission(B.MODEL_APPROVE)
  resolve(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.bim.decideClash(scope, id, true, body, user.id);
  }

  @Post("clashes/:id/refuse")
  @RequirePermission(B.MODEL_APPROVE)
  refuse(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.bim.decideClash(scope, id, false, body, user.id);
  }
}
