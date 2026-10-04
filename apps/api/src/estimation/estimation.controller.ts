import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { ESTIMATION_PERMISSIONS } from "@axora24/contracts";
import { SessionGuard } from "../auth/session.guard.js";
import { PermissionGuard } from "../auth/permission.guard.js";
import { RequirePermission } from "../auth/require-permission.decorator.js";
import { CompanyScopeService } from "../common/company-scope.service.js";
import { CompanyScopeGuard } from "../common/scope.guard.js";
import { EstimationService } from "./estimation.service.js";
import type {
  CreateDqeDto,
  CreateDqeLineDto,
  CreateStudyDto,
  CreateStudyRequirementDto,
  DraftVersionDto,
  UpdateStudyRequirementDto,
  UpdateDqeLineDto,
  UpdateDqePricingDto,
  CreateDqeVariantDto,
} from "./estimation.dto.js";

@Controller("estimation")
@UseGuards(SessionGuard, CompanyScopeGuard, PermissionGuard)
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
    const scope = await this.companyScope.resolve(request.axoraUser!, body?.companyId);
    return this.estimation.addRequirement(scope, id, body, request.axoraUser!.id);
  }

  @Patch("studies/:id/requirements/:requirementId")
  @RequirePermission(ESTIMATION_PERMISSIONS.STUDY_MANAGE)
  async updateRequirement(@Req() request: Request, @Param("id") id: string,
    @Param("requirementId") requirementId: string, @Body() body: UpdateStudyRequirementDto) {
    const scope = await this.companyScope.resolve(request.axoraUser!, body?.companyId);
    return this.estimation.updateRequirement(scope, id, requirementId, body, request.axoraUser!.id);
  }

  @Delete("studies/:id/requirements/:requirementId")
  @RequirePermission(ESTIMATION_PERMISSIONS.STUDY_MANAGE)
  async deleteRequirement(@Req() request: Request, @Param("id") id: string,
    @Param("requirementId") requirementId: string, @Body() body: DraftVersionDto) {
    const scope = await this.companyScope.resolve(request.axoraUser!, body?.companyId);
    return this.estimation.deleteRequirement(scope, id, requirementId, body, request.axoraUser!.id);
  }

  @Post("studies/:id/ready")
  @RequirePermission(ESTIMATION_PERMISSIONS.STUDY_MANAGE)
  async markStudyReady(
    @Req() request: Request,
    @Param("id") id: string,
    @Query("companyId") companyId?: string,
    @Body() body: DraftVersionDto = {},
  ) {
    const user = request.axoraUser!;
    const scope = await this.companyScope.resolve(user, body?.companyId ?? companyId);
    return this.estimation.markStudyReady(scope, id, user.id, body);
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
    const scope = await this.companyScope.resolve(request.axoraUser!, body?.companyId);
    return this.estimation.addDqeLine(scope, id, body, request.axoraUser!.id);
  }

  @Patch("dqes/:id/lines/:lineId")
  @RequirePermission(ESTIMATION_PERMISSIONS.DQE_MANAGE)
  async updateDqeLine(@Req() request: Request, @Param("id") id: string, @Param("lineId") lineId: string,
    @Body() body: UpdateDqeLineDto) {
    const scope = await this.companyScope.resolve(request.axoraUser!, body?.companyId);
    return this.estimation.updateDqeLine(scope, id, lineId, body, request.axoraUser!.id);
  }

  @Patch("dqes/:id/pricing")
  @RequirePermission(ESTIMATION_PERMISSIONS.PRICING_MANAGE)
  async updateDqePricing(@Req() request: Request, @Param("id") id: string, @Body() body: UpdateDqePricingDto) {
    const scope = await this.companyScope.resolve(request.axoraUser!, body?.companyId);
    return this.estimation.updateDqePricing(scope, id, body, request.axoraUser!.id);
  }

  @Get("dqes/:id/variants")
  @RequirePermission(ESTIMATION_PERMISSIONS.DQE_READ)
  async listDqeVariants(@Req() request: Request, @Param("id") id: string, @Query("companyId") companyId?: string) {
    const scope = await this.companyScope.resolve(request.axoraUser!, companyId);
    return this.estimation.listDqeVariants(scope, id);
  }

  @Post("dqes/:id/variants")
  @RequirePermission(ESTIMATION_PERMISSIONS.DQE_MANAGE)
  async createDqeVariant(@Req() request: Request, @Param("id") id: string, @Body() body: CreateDqeVariantDto) {
    const scope = await this.companyScope.resolve(request.axoraUser!, body?.companyId);
    return this.estimation.createDqeVariant(scope, id, body, request.axoraUser!.id);
  }

  @Delete("dqes/:id/lines/:lineId")
  @RequirePermission(ESTIMATION_PERMISSIONS.DQE_MANAGE)
  async deleteDqeLine(@Req() request: Request, @Param("id") id: string, @Param("lineId") lineId: string,
    @Body() body: DraftVersionDto) {
    const scope = await this.companyScope.resolve(request.axoraUser!, body?.companyId);
    return this.estimation.deleteDqeLine(scope, id, lineId, body, request.axoraUser!.id);
  }

  @Post("dqes/:id/finalize")
  @RequirePermission(ESTIMATION_PERMISSIONS.DQE_MANAGE)
  async finalizeDqe(
    @Req() request: Request,
    @Param("id") id: string,
    @Query("companyId") companyId?: string,
    @Body() body: DraftVersionDto = {},
  ) {
    const user = request.axoraUser!;
    const scope = await this.companyScope.resolve(user, body?.companyId ?? companyId);
    return this.estimation.finalizeDqe(scope, id, user.id, body);
  }
}
