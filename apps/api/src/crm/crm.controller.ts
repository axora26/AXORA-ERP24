import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { CRM_PERMISSIONS } from "@axora24/contracts";
import { SessionGuard } from "../auth/session.guard.js";
import { PermissionGuard } from "../auth/permission.guard.js";
import { RequirePermission } from "../auth/require-permission.decorator.js";
import { CompanyScopeService } from "../common/company-scope.service.js";
import { CompanyScopeGuard } from "../common/scope.guard.js";
import { CrmService } from "./crm.service.js";
import type {
  ConvertLeadDto,
  CreateAccountDto,
  CreateActivityDto,
  CreateContactDto,
  CreateLeadDto,
  CreateOpportunityDto,
  CreatePipelineStageDto,
  MoveOpportunityStageDto,
  UpdateLeadStatusDto,
  UpdateAccountDto,
  UpdateContactDto,
  VersionDto,
  DirectoryQueryDto,
  ActivityQueryDto,
} from "./crm.dto.js";

/**
 * API CRM (INC-02) — docs/foundation/06-product-backlog.md.
 *
 * SECURITE (docs/foundation/03-security.md) :
 * - SessionGuard + PermissionGuard sur le controleur entier ; PermissionGuard
 *   refuse toute route sans @RequirePermission explicite (deny-by-default).
 * - Le companyId eventuellement transmis (query ou body) n'est jamais utilise
 *   tel quel : CompanyScopeService le revalide contre les CompanyMembership
 *   de la session avant toute lecture ou ecriture.
 */
@Controller("crm")
@UseGuards(SessionGuard, CompanyScopeGuard, PermissionGuard)
export class CrmController {
  constructor(
    private readonly crm: CrmService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  // --- Pipeline -------------------------------------------------------------

  @Get("pipeline/stages")
  @RequirePermission(CRM_PERMISSIONS.OPPORTUNITY_READ)
  async listStages(@Req() request: Request, @Query("companyId") companyId?: string) {
    const scope = await this.companyScope.resolve(request.axoraUser!, companyId);
    return this.crm.listStages(scope);
  }

  @Post("pipeline/stages")
  @RequirePermission(CRM_PERMISSIONS.PIPELINE_MANAGE)
  async createStage(@Req() request: Request, @Body() body: CreatePipelineStageDto) {
    const scope = await this.companyScope.resolve(request.axoraUser!, body.companyId);
    return this.crm.createStage(scope, body);
  }

  // --- Comptes --------------------------------------------------------------

  @Get("accounts/page")
  @RequirePermission(CRM_PERMISSIONS.ACCOUNT_READ)
  async pageAccounts(@Req() request: Request, @Query() query: DirectoryQueryDto) {
    const scope = await this.companyScope.resolve(request.axoraUser!, query.companyId);
    return this.crm.pageAccounts(scope, query);
  }

  @Get("accounts/:id")
  @RequirePermission(CRM_PERMISSIONS.ACCOUNT_READ)
  async getAccount(@Req() request: Request, @Param("id") id: string, @Query("companyId") companyId?: string) {
    const scope = await this.companyScope.resolve(request.axoraUser!, companyId);
    return this.crm.getAccount(scope, id);
  }

  @Patch("accounts/:id")
  @RequirePermission(CRM_PERMISSIONS.ACCOUNT_MANAGE)
  async updateAccount(@Req() request: Request, @Param("id") id: string, @Body() body: UpdateAccountDto) {
    const scope = await this.companyScope.resolve(request.axoraUser!, body.companyId);
    return this.crm.updateAccount(scope, id, body, request.axoraUser!.id);
  }

  @Post("accounts/:id/archive")
  @RequirePermission(CRM_PERMISSIONS.ACCOUNT_MANAGE)
  async archiveAccount(@Req() request: Request, @Param("id") id: string, @Body() body: VersionDto) {
    const scope = await this.companyScope.resolve(request.axoraUser!, body.companyId);
    return this.crm.archiveAccount(scope, id, body, request.axoraUser!.id);
  }

  @Post("accounts/:id/restore")
  @RequirePermission(CRM_PERMISSIONS.ACCOUNT_MANAGE)
  async restoreAccount(@Req() request: Request, @Param("id") id: string, @Body() body: VersionDto) {
    const scope = await this.companyScope.resolve(request.axoraUser!, body.companyId);
    return this.crm.archiveAccount(scope, id, body, request.axoraUser!.id, true);
  }

  @Get("accounts")
  @RequirePermission(CRM_PERMISSIONS.ACCOUNT_READ)
  async listAccounts(@Req() request: Request, @Query("companyId") companyId?: string) {
    const scope = await this.companyScope.resolve(request.axoraUser!, companyId);
    return this.crm.listAccounts(scope);
  }

  @Post("accounts")
  @RequirePermission(CRM_PERMISSIONS.ACCOUNT_MANAGE)
  async createAccount(@Req() request: Request, @Body() body: CreateAccountDto) {
    const scope = await this.companyScope.resolve(request.axoraUser!, body.companyId);
    return this.crm.createAccount(scope, body, request.axoraUser!.id);
  }

  // --- Contacts -------------------------------------------------------------

  @Get("contacts/page")
  @RequirePermission(CRM_PERMISSIONS.CONTACT_READ)
  async pageContacts(@Req() request: Request, @Query() query: DirectoryQueryDto) {
    const scope = await this.companyScope.resolve(request.axoraUser!, query.companyId);
    return this.crm.pageContacts(scope, query);
  }

  @Get("contacts/:id")
  @RequirePermission(CRM_PERMISSIONS.CONTACT_READ)
  async getContact(@Req() request: Request, @Param("id") id: string, @Query("companyId") companyId?: string) {
    const scope = await this.companyScope.resolve(request.axoraUser!, companyId);
    return this.crm.getContact(scope, id);
  }

  @Patch("contacts/:id")
  @RequirePermission(CRM_PERMISSIONS.CONTACT_MANAGE)
  async updateContact(@Req() request: Request, @Param("id") id: string, @Body() body: UpdateContactDto) {
    const scope = await this.companyScope.resolve(request.axoraUser!, body.companyId);
    return this.crm.updateContact(scope, id, body, request.axoraUser!.id);
  }

  @Post("contacts/:id/archive")
  @RequirePermission(CRM_PERMISSIONS.CONTACT_MANAGE)
  async archiveContact(@Req() request: Request, @Param("id") id: string, @Body() body: VersionDto) {
    const scope = await this.companyScope.resolve(request.axoraUser!, body.companyId);
    return this.crm.archiveContact(scope, id, body, request.axoraUser!.id);
  }

  @Post("contacts/:id/restore")
  @RequirePermission(CRM_PERMISSIONS.CONTACT_MANAGE)
  async restoreContact(@Req() request: Request, @Param("id") id: string, @Body() body: VersionDto) {
    const scope = await this.companyScope.resolve(request.axoraUser!, body.companyId);
    return this.crm.archiveContact(scope, id, body, request.axoraUser!.id, true);
  }

  @Get("contacts")
  @RequirePermission(CRM_PERMISSIONS.CONTACT_READ)
  async listContacts(@Req() request: Request, @Query("companyId") companyId?: string) {
    const scope = await this.companyScope.resolve(request.axoraUser!, companyId);
    return this.crm.listContacts(scope);
  }

  @Post("contacts")
  @RequirePermission(CRM_PERMISSIONS.CONTACT_MANAGE)
  async createContact(@Req() request: Request, @Body() body: CreateContactDto) {
    const scope = await this.companyScope.resolve(request.axoraUser!, body.companyId);
    return this.crm.createContact(scope, body, request.axoraUser!.id);
  }

  // --- Prospects ------------------------------------------------------------

  @Get("leads")
  @RequirePermission(CRM_PERMISSIONS.LEAD_READ)
  async listLeads(@Req() request: Request, @Query("companyId") companyId?: string) {
    const scope = await this.companyScope.resolve(request.axoraUser!, companyId);
    return this.crm.listLeads(scope);
  }

  @Post("leads")
  @RequirePermission(CRM_PERMISSIONS.LEAD_MANAGE)
  async createLead(@Req() request: Request, @Body() body: CreateLeadDto) {
    const user = request.axoraUser!;
    const scope = await this.companyScope.resolve(user, body.companyId);
    return this.crm.createLead(scope, body, user.id);
  }

  @Patch("leads/:id/status")
  @RequirePermission(CRM_PERMISSIONS.LEAD_MANAGE)
  async updateLeadStatus(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: UpdateLeadStatusDto,
  ) {
    const user = request.axoraUser!;
    const scope = await this.companyScope.resolve(user, body.companyId);
    return this.crm.updateLeadStatus(scope, id, body, user.id);
  }

  @Post("leads/:id/convert")
  @RequirePermission(CRM_PERMISSIONS.OPPORTUNITY_MANAGE)
  async convertLead(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: ConvertLeadDto,
  ) {
    const user = request.axoraUser!;
    const scope = await this.companyScope.resolve(user, body.companyId);
    return this.crm.convertLead(scope, id, body, user.id);
  }

  // --- Opportunites ---------------------------------------------------------

  @Get("opportunities")
  @RequirePermission(CRM_PERMISSIONS.OPPORTUNITY_READ)
  async listOpportunities(@Req() request: Request, @Query("companyId") companyId?: string) {
    const scope = await this.companyScope.resolve(request.axoraUser!, companyId);
    return this.crm.listOpportunities(scope);
  }

  @Post("opportunities")
  @RequirePermission(CRM_PERMISSIONS.OPPORTUNITY_MANAGE)
  async createOpportunity(@Req() request: Request, @Body() body: CreateOpportunityDto) {
    const user = request.axoraUser!;
    const scope = await this.companyScope.resolve(user, body.companyId);
    return this.crm.createOpportunity(scope, body, user.id);
  }

  @Patch("opportunities/:id/stage")
  @RequirePermission(CRM_PERMISSIONS.OPPORTUNITY_MANAGE)
  async moveOpportunityStage(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: MoveOpportunityStageDto,
  ) {
    const user = request.axoraUser!;
    const scope = await this.companyScope.resolve(user, body.companyId);
    return this.crm.moveOpportunityStage(scope, id, body, user.id);
  }

  // --- Activites (append-only : aucune route PUT/PATCH/DELETE) --------------

  @Get("activities/page")
  @RequirePermission(CRM_PERMISSIONS.ACTIVITY_READ)
  async pageActivities(@Req() request: Request, @Query() query: ActivityQueryDto) {
    const scope = await this.companyScope.resolve(request.axoraUser!, query.companyId);
    return this.crm.pageActivities(scope, query);
  }

  @Get("activities")
  @RequirePermission(CRM_PERMISSIONS.ACTIVITY_READ)
  async listActivities(
    @Req() request: Request,
    @Query("companyId") companyId?: string,
    @Query("relatedType") relatedType?: string,
    @Query("relatedId") relatedId?: string,
  ) {
    const scope = await this.companyScope.resolve(request.axoraUser!, companyId);
    return this.crm.listActivities(scope, relatedType, relatedId);
  }

  @Post("activities")
  @RequirePermission(CRM_PERMISSIONS.ACTIVITY_CREATE)
  async createActivity(@Req() request: Request, @Body() body: CreateActivityDto) {
    const user = request.axoraUser!;
    const scope = await this.companyScope.resolve(user, body.companyId);
    return this.crm.createActivity(scope, body, user.id);
  }

  // --- Tableau de bord commercial ------------------------------------------

  @Get("dashboard")
  @RequirePermission(CRM_PERMISSIONS.OPPORTUNITY_READ)
  async dashboard(@Req() request: Request, @Query("companyId") companyId?: string) {
    const scope = await this.companyScope.resolve(request.axoraUser!, companyId);
    return this.crm.dashboard(scope, request.axoraPermissions ?? new Set());
  }
}
