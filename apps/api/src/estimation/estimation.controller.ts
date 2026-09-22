import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { ESTIMATION_PERMISSIONS } from "@axora24/contracts";
import { SessionGuard } from "../auth/session.guard.js";
import { PermissionGuard } from "../auth/permission.guard.js";
import { RequirePermission } from "../auth/require-permission.decorator.js";
import { CompanyScopeService } from "../crm/company-scope.service.js";
import { EstimationService } from "./estimation.service.js";
import type {
  CreateDqeDto,
  CreateDqeLineDto,
  CreateStudyDto,
  CreateStudyRequirementDto,
} from "./estimation.dto.js";

@Controller("estimation")
@UseGuards(SessionGuard, PermissionGuard)
export class EstimationController {
  constructor(
    private readonly estimation: EstimationService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  @Get("studies")
  @RequirePermission(ESTIMATION_PERMISSIONS.STUDY_READ)
  async listStudies(@Req() request: Request, @Query("companyId") companyId?: string) {
    const scope = await this.companyScope.resolve(request.axoraUser!, companyId);
    return this.estimation.listStudies(scope);
  }

  @Get("studies/:id")
  @RequirePermission(ESTIMATION_PERMISSIONS.STUDY_READ)
  async getStudy(
    @Req() request: Request,
    @Param("id") id: string,
    @Query("companyId") companyId?: string,
  ) {
    const scope = await this.companyScope.resolve(request.axoraUser!, companyId);
    return this.estimation.getStudy(scope, id);
  }

  @Post("studies")
  @RequirePermission(ESTIMATION_PERMISSIONS.STUDY_MANAGE)
  async createStudy(@Req() request: Request, @Body() body: CreateStudyDto) {
    const user = request.axoraUser!;
    const scope = await this.companyScope.resolve(user, body.companyId);
    return this.estimation.createStudy(scope, body, user.id);
  }

  @Post("studies/:id/requirements")
  @RequirePermission(ESTIMATION_PERMISSIONS.STUDY_MANAGE)
  async addRequirement(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: CreateStudyRequirementDto,
  ) {
    const scope = await this.companyScope.resolve(request.axoraUser!, body.companyId);
    return this.estimation.addRequirement(scope, id, body);
  }

  @Post("studies/:id/ready")
  @RequirePermission(ESTIMATION_PERMISSIONS.STUDY_MANAGE)
  async markStudyReady(
    @Req() request: Request,
    @Param("id") id: string,
    @Query("companyId") companyId?: string,
  ) {
    const user = request.axoraUser!;
    const scope = await this.companyScope.resolve(user, companyId);
    return this.estimation.markStudyReady(scope, id, user.id);
  }

  @Get("dqes")
  @RequirePermission(ESTIMATION_PERMISSIONS.DQE_READ)
  async listDqes(@Req() request: Request, @Query("companyId") companyId?: string) {
    const scope = await this.companyScope.resolve(request.axoraUser!, companyId);
    return this.estimation.listDqes(scope);
  }

  @Get("dqes/:id")
  @RequirePermission(ESTIMATION_PERMISSIONS.DQE_READ)
  async getDqe(
    @Req() request: Request,
    @Param("id") id: string,
    @Query("companyId") companyId?: string,
  ) {
    const scope = await this.companyScope.resolve(request.axoraUser!, companyId);
    return this.estimation.getDqe(scope, id);
  }

  @Post("dqes")
  @RequirePermission(ESTIMATION_PERMISSIONS.DQE_MANAGE)
  async createDqe(@Req() request: Request, @Body() body: CreateDqeDto) {
    const user = request.axoraUser!;
    const scope = await this.companyScope.resolve(user, body.companyId);
    return this.estimation.createDqe(scope, body, user.id);
  }

  @Post("dqes/:id/lines")
  @RequirePermission(ESTIMATION_PERMISSIONS.DQE_MANAGE)
  async addDqeLine(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: CreateDqeLineDto,
  ) {
    const scope = await this.companyScope.resolve(request.axoraUser!, body.companyId);
    return this.estimation.addDqeLine(scope, id, body);
  }

  @Post("dqes/:id/finalize")
  @RequirePermission(ESTIMATION_PERMISSIONS.DQE_MANAGE)
  async finalizeDqe(
    @Req() request: Request,
    @Param("id") id: string,
    @Query("companyId") companyId?: string,
  ) {
    const user = request.axoraUser!;
    const scope = await this.companyScope.resolve(user, companyId);
    return this.estimation.finalizeDqe(scope, id, user.id);
  }
}
