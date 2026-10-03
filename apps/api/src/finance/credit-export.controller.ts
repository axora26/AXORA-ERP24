import { Controller, ForbiddenException, Get, Param, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { FINANCE_PERMISSIONS as F } from "@axora24/contracts";
import { RequirePermission } from "../auth/require-permission.decorator.js";
import { Scope, ScopedController } from "../common/scope.guard.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import { PrismaService } from "../core/prisma.service.js";
import { CreditNotesService } from "./credit-notes.service.js";
import { creditNotePdf } from "./credit-export.js";

@Controller("finance")
@ScopedController()
export class CreditExportController {
  constructor(private readonly credits: CreditNotesService, private readonly prisma: PrismaService) {}
  @Get("customer-credit-notes/:id/export.pdf") @RequirePermission(F.CREDIT_READ)
  customer(@Scope() scope: CompanyScope, @Param("id") id: string, @Res() response: Response) { return this.export(scope, "CUSTOMER", id, response); }
  @Get("supplier-credit-notes/:id/export.pdf") @RequirePermission(F.CREDIT_READ)
  supplier(@Req() request: Request, @Scope() scope: CompanyScope, @Param("id") id: string, @Res() response: Response) {
    if (!request.axoraPermissions?.has(F.PAYABLE_READ)) throw new ForbiddenException("Missing required permission");
    return this.export(scope, "SUPPLIER", id, response);
  }
  private async export(scope: CompanyScope, kind: "CUSTOMER" | "SUPPLIER", id: string, response: Response) {
    const credit = await this.credits.get(scope, kind, id);
    const company = await this.prisma.company.findFirstOrThrow({ where: { id: scope.companyId, organizationId: scope.organizationId }, select: { name: true, legalName: true, organization: { select: { isDemo: true } } } });
    const buffer = await creditNotePdf(credit, company.legalName ?? company.name, company.organization.isDemo);
    response.setHeader("Content-Type", "application/pdf");
    response.setHeader("Content-Disposition", `attachment; filename="${(credit.code ?? credit.id).replace(/[^a-zA-Z0-9._-]/g, "_")}.pdf"`);
    response.setHeader("Cache-Control", "private, no-store");
    response.send(buffer);
  }
}
