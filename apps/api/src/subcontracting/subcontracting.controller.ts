import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { FINANCE_PERMISSIONS as FIN, SUBCONTRACTING_PERMISSIONS as S } from "@axora24/contracts";
import { RequirePermission } from "../auth/require-permission.decorator.js";
import { CurrentUser, Scope, ScopedController } from "../common/scope.guard.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import type { AuthenticatedUser } from "../auth/session.guard.js";
import { SubcontractingService } from "./subcontracting.service.js";

/** INC-19 — Sous-traitants. Les factures de situation sont enregistrees avec le droit Finance. */
@Controller("subcontracting")
@ScopedController()
export class SubcontractingController {
  constructor(private readonly service: SubcontractingService) {}

  @Get("summary")
  @RequirePermission(S.READ)
  summary(@Scope() scope: CompanyScope) {
    return this.service.summary(scope);
  }

  @Get("subcontractors")
  @RequirePermission(S.READ)
  subcontractors(@Scope() scope: CompanyScope) {
    return this.service.listSubcontractors(scope);
  }

  @Get("subcontractors/:id")
  @RequirePermission(S.READ)
  subcontractor(@Scope() scope: CompanyScope, @Param("id") id: string) {
    return this.service.getSubcontractor(scope, id);
  }

  @Post("subcontractors")
  @RequirePermission(S.MANAGE)
  create(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.service.createSubcontractor(scope, body, user.id);
  }

  @Post("subcontractors/:id/documents")
  @RequirePermission(S.MANAGE)
  document(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.service.addDocument(scope, id, body, user.id);
  }

  @Post("subcontractors/:id/decision")
  @RequirePermission(S.QUALIFY)
  decide(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.service.decide(scope, id, body, user.id);
  }

  @Get("packages")
  @RequirePermission(S.READ)
  packages(@Scope() scope: CompanyScope, @Query() query: Record<string, unknown>) {
    return this.service.listPackages(scope, query);
  }

  @Get("packages/:id")
  @RequirePermission(S.READ)
  package(@Scope() scope: CompanyScope, @Param("id") id: string) {
    return this.service.getPackage(scope, id);
  }

  @Post("packages")
  @RequirePermission(S.MANAGE)
  createPackage(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.service.createPackage(scope, body, user.id);
  }

  @Post("packages/:id/close")
  @RequirePermission(S.MANAGE)
  closePackage(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.service.closePackage(scope, id, body, user.id);
  }

  @Post("packages/:id/statements")
  @RequirePermission(S.STATEMENT_PREPARE)
  prepare(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.service.prepareStatement(scope, id, body, user.id);
  }

  @Get("statements")
  @RequirePermission(S.READ)
  statements(@Scope() scope: CompanyScope, @Query() query: Record<string, unknown>) {
    return this.service.listStatements(scope, query);
  }

  @Post("statements/:id/decision")
  @RequirePermission(S.STATEMENT_APPROVE)
  decideStatement(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.service.decideStatement(scope, id, body, user.id);
  }

  @Post("statements/:id/invoice")
  @RequirePermission(FIN.PAYABLE_MANAGE)
  invoice(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.service.invoiceStatement(scope, id, body, user.id);
  }

  @Get("retentions")
  @RequirePermission(S.READ)
  retentions(@Scope() scope: CompanyScope, @Query() query: Record<string, unknown>) {
    return this.service.listRetentions(scope, query);
  }

  @Post("retentions/:id/release")
  @RequirePermission(S.RETENTION_RELEASE)
  release(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.service.releaseRetention(scope, id, body, user.id);
  }
}
