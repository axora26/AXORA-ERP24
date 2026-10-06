import { Controller, Get, Param, Res } from "@nestjs/common";
import type { Response } from "express";
import { FINANCE_PERMISSIONS as F } from "@axora24/contracts";
import { RequirePermission } from "../auth/require-permission.decorator.js";
import { Scope, ScopedController } from "../common/scope.guard.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import { PrismaService } from "../core/prisma.service.js";
import { FinanceService } from "./finance.service.js";
import { InvoiceSignatureService } from "./invoice-signature.service.js";
import { customerInvoicePdf } from "./invoice-export.js";

@Controller("finance")
@ScopedController()
export class InvoiceExportController {
  constructor(
    private readonly finance: FinanceService,
    private readonly signatures: InvoiceSignatureService,
    private readonly prisma: PrismaService,
  ) {}

  @Get("invoices/:id/export.pdf")
  @RequirePermission(F.INVOICE_READ)
  async customerInvoice(@Scope() scope: CompanyScope, @Param("id") id: string, @Res() response: Response): Promise<void> {
    const invoice = await this.finance.getCustomerInvoice(scope, id);
    const company = await this.prisma.company.findFirstOrThrow({
      where: { id: scope.companyId, organizationId: scope.organizationId },
      select: { name: true, legalName: true, organization: { select: { isDemo: true } } },
    });
    const signature = (await this.signatures.list(scope, id)).find((row) => row.status === "VALID");
    const buffer = await customerInvoicePdf(invoice, company.legalName ?? company.name, company.organization.isDemo, signature);
    const filename = `${invoice.code ?? `facture-${invoice.id}`}`.replace(/[^a-zA-Z0-9._-]/g, "_");
    response.setHeader("Content-Type", "application/pdf");
    response.setHeader("Content-Disposition", `attachment; filename="${filename}.pdf"`);
    response.setHeader("Cache-Control", "private, no-store");
    response.send(buffer);
  }
}
