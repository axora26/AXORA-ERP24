import { Controller, Get, Param, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { PROJECT_PERMISSIONS } from "@axora24/contracts";
import { RequirePermission } from "../auth/require-permission.decorator.js";
import { Scope, ScopedController } from "../common/scope.guard.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import { PrismaService } from "../core/prisma.service.js";
import { ProjectOperationsService } from "./project-operations.service.js";
import { ProjectsService } from "./projects.service.js";
import { projectOperationsPdf } from "./project-export.js";

@Controller("projects")
@ScopedController()
export class ProjectExportController {
  constructor(private readonly projects: ProjectsService, private readonly operations: ProjectOperationsService, private readonly prisma: PrismaService) {}
  @Get(":id/operations/export.pdf") @RequirePermission(PROJECT_PERMISSIONS.PROJECT_READ)
  async pdf(@Req() request: Request, @Scope() scope: CompanyScope, @Param("id") id: string, @Query() query: Record<string, unknown>, @Res() response: Response) {
    const permissions = request.axoraPermissions ?? new Set<string>();
    const operations = await this.operations.get(scope, id, query, permissions);
    const project = await this.projects.detail(scope, id, permissions);
    const company = await this.prisma.company.findFirstOrThrow({ where: { id: scope.companyId, organizationId: scope.organizationId }, select: { name: true, legalName: true, organization: { select: { isDemo: true } } } });
    const buffer = await projectOperationsPdf(project, operations, company.legalName ?? company.name, company.organization.isDemo);
    response.setHeader("Content-Type", "application/pdf");
    response.setHeader("Content-Disposition", `attachment; filename="${project.code.replace(/[^a-zA-Z0-9._-]/g, "_")}-${operations.from}.pdf"`);
    response.setHeader("Cache-Control", "private, no-store");
    response.send(buffer);
  }
}
