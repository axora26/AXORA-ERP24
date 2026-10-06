import { BadRequestException, Controller, Get, Param, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { ESTIMATION_PERMISSIONS } from "@axora24/contracts";
import { SessionGuard } from "../auth/session.guard.js";
import { PermissionGuard } from "../auth/permission.guard.js";
import { RequirePermission } from "../auth/require-permission.decorator.js";
import { CompanyScopeGuard } from "../common/scope.guard.js";
import { CompanyScopeService } from "../common/company-scope.service.js";
import { PrismaService } from "../core/prisma.service.js";
import { EstimationService } from "./estimation.service.js";
import { dqePdf, dqeWorkbook } from "./dqe-export.js";

@Controller("estimation")
@UseGuards(SessionGuard, CompanyScopeGuard, PermissionGuard)
export class EstimationExportController {
  constructor(private readonly estimation: EstimationService, private readonly companyScope: CompanyScopeService, private readonly prisma: PrismaService) {}

  @Get("dqes/:id/export.xlsx")
  @RequirePermission(ESTIMATION_PERMISSIONS.DQE_READ)
  async workbook(@Req() request: Request, @Res() response: Response, @Param("id") id: string, @Query("companyId") companyId?: string) {
    return this.export(request, response, id, companyId, "xlsx");
  }

  @Get("dqes/:id/export.pdf")
  @RequirePermission(ESTIMATION_PERMISSIONS.DQE_READ)
  async pdf(@Req() request: Request, @Res() response: Response, @Param("id") id: string, @Query("companyId") companyId?: string) {
    return this.export(request, response, id, companyId, "pdf");
  }

  private async export(request: Request, response: Response, id: string, companyId: string | undefined, format: "xlsx" | "pdf") {
    const scope = await this.companyScope.resolve(request.axoraUser!, companyId);
    const dqe = await this.estimation.getDqe(scope, id);
    if (dqe.lines.length > 10_000) throw new BadRequestException("Export limité à 10 000 lignes ; divisez le document");
    const company = await this.prisma.company.findFirstOrThrow({ where: { id: scope.companyId, organizationId: scope.organizationId }, select: { name: true, legalName: true, organization: { select: { isDemo: true } } } });
    const buffer = format === "xlsx" ? await dqeWorkbook(dqe, company.legalName ?? company.name, company.organization.isDemo) : await dqePdf(dqe, company.legalName ?? company.name, company.organization.isDemo);
    const filename = dqe.code.replace(/[^a-zA-Z0-9._-]/g, "_");
    response.setHeader("Content-Type", format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/pdf");
    response.setHeader("Content-Disposition", `attachment; filename="${filename}.${format}"`);
    response.setHeader("Cache-Control", "private, no-store");
    response.send(buffer);
  }
}
