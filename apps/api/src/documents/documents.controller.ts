import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { DOCUMENTS_PERMISSIONS as D } from "@axora24/contracts";
import { RequirePermission } from "../auth/require-permission.decorator.js";
import { CurrentUser, Scope, ScopedController } from "../common/scope.guard.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import type { AuthenticatedUser } from "../auth/session.guard.js";
import { DocumentsService } from "./documents.service.js";

/** INC-10 — GED. Aucune route ne modifie ni ne supprime le contenu d'une version. */
@Controller("documents")
@ScopedController()
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get("folders")
  @RequirePermission(D.DOCUMENT_READ)
  folders(@Scope() scope: CompanyScope, @Query() query: Record<string, unknown>) {
    return this.documents.listFolders(scope, query);
  }

  @Post("folders")
  @RequirePermission(D.DOCUMENT_MANAGE)
  createFolder(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.documents.createFolder(scope, body, user.id);
  }

  @Get()
  @RequirePermission(D.DOCUMENT_READ)
  list(@Scope() scope: CompanyScope, @Query() query: Record<string, unknown>) {
    return this.documents.list(scope, query);
  }

  @Get(":id")
  @RequirePermission(D.DOCUMENT_READ)
  get(@Scope() scope: CompanyScope, @Param("id") id: string) {
    return this.documents.get(scope, id);
  }

  @Post()
  @RequirePermission(D.DOCUMENT_MANAGE)
  create(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.documents.create(scope, body, user.id);
  }

  @Post(":id/versions")
  @RequirePermission(D.DOCUMENT_MANAGE)
  addVersion(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.documents.addVersion(scope, id, body, user.id);
  }

  @Post(":id/submit")
  @RequirePermission(D.DOCUMENT_MANAGE)
  submit(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.documents.submit(scope, id, user.id);
  }

  @Post(":id/approve")
  @RequirePermission(D.DOCUMENT_APPROVE)
  approve(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.documents.decide(scope, id, "APPROVED", body, user.id);
  }

  @Post(":id/reject")
  @RequirePermission(D.DOCUMENT_APPROVE)
  reject(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.documents.decide(scope, id, "REJECTED", body, user.id);
  }

  @Post(":id/archive")
  @RequirePermission(D.DOCUMENT_APPROVE)
  archive(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.documents.archive(scope, id, body, user.id);
  }
}
