import { Controller, Get, NotFoundException, Param, Res } from "@nestjs/common";
import type { Response } from "express";
import { HR_PERMISSIONS as H } from "@axora24/contracts";
import { RequirePermission } from "../auth/require-permission.decorator.js";
import { CurrentUser, Scope, ScopedController } from "../common/scope.guard.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import type { AuthenticatedUser } from "../auth/session.guard.js";
import { PrismaService } from "../core/prisma.service.js";
import { HrService } from "./hr.service.js";
import { ServiceCardService } from "./service-card.service.js";
import { payrollSlipPdf, serviceCardPdf } from "./hr-export.js";

@Controller("hr")
@ScopedController()
export class HrExportController {
  constructor(private readonly hr: HrService, private readonly cards: ServiceCardService, private readonly prisma: PrismaService) {}
  @Get("employees/:id/service-card/export.pdf") @RequirePermission(H.CARD_MANAGE)
  async card(@Scope() scope: CompanyScope, @CurrentUser() actor: AuthenticatedUser, @Param("id") id: string, @Res() response: Response) {
    const card = await this.cards.document(scope, id, actor.id);
    const organization = await this.prisma.organization.findUniqueOrThrow({ where: { id: scope.organizationId }, select: { isDemo: true } });
    this.send(response, `carte-${card.employee.code}`, await serviceCardPdf(card, organization.isDemo));
  }
  @Get("payroll/:runId/employees/:employeeId/export.pdf") @RequirePermission(H.PAYROLL_READ)
  async payroll(@Scope() scope: CompanyScope, @Param("runId") runId: string, @Param("employeeId") employeeId: string, @Res() response: Response) {
    const run = await this.hr.getPayrollRun(scope, runId);
    if (!run.lines.some(line => line.employeeId === employeeId)) throw new NotFoundException("Payroll employee not found");
    const company = await this.prisma.company.findFirstOrThrow({ where: { id: scope.companyId, organizationId: scope.organizationId }, select: { name: true, legalName: true, organization: { select: { isDemo: true } } } });
    const employee = await this.prisma.employee.findFirst({ where: { id: employeeId, ...scope }, select: { code: true } });
    this.send(response, `paie-${run.period}-${employee?.code ?? employeeId}`, await payrollSlipPdf(run, employeeId, company.legalName ?? company.name, company.organization.isDemo, employee?.code));
  }
  private send(response: Response, filename: string, buffer: Buffer) {
    response.setHeader("Content-Type", "application/pdf");
    response.setHeader("Content-Disposition", `attachment; filename="${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}.pdf"`);
    response.setHeader("Cache-Control", "private, no-store");
    response.send(buffer);
  }
}
