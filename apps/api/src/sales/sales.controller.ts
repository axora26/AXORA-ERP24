import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { SALES_PERMISSIONS } from "@axora24/contracts";
import { SessionGuard } from "../auth/session.guard.js";
import { PermissionGuard } from "../auth/permission.guard.js";
import { RequirePermission } from "../auth/require-permission.decorator.js";
import { CompanyScopeService } from "../crm/company-scope.service.js";
import { SalesService } from "./sales.service.js";
import type {
  AcceptQuoteDto,
  CreateContractDto,
  CreateQuoteDto,
  RejectQuoteDto,
  SubmitQuoteDto,
} from "./sales.dto.js";

/** INC-04 — Devis (issus d'un DQE finalise) -> Contrat (issu d'un devis accepte). */
@Controller("sales")
@UseGuards(SessionGuard, PermissionGuard)
export class SalesController {
  constructor(
    private readonly sales: SalesService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  @Get("quotes")
  @RequirePermission(SALES_PERMISSIONS.QUOTE_READ)
  async listQuotes(@Req() request: Request, @Query("companyId") companyId?: string) {
    const scope = await this.companyScope.resolve(request.axoraUser!, companyId);
    return this.sales.listQuotes(scope);
  }

  @Get("quotes/:id")
  @RequirePermission(SALES_PERMISSIONS.QUOTE_READ)
  async getQuote(
    @Req() request: Request,
    @Param("id") id: string,
    @Query("companyId") companyId?: string,
  ) {
    const scope = await this.companyScope.resolve(request.axoraUser!, companyId);
    return this.sales.getQuote(scope, id);
  }

  @Post("quotes")
  @RequirePermission(SALES_PERMISSIONS.QUOTE_MANAGE)
  async createQuote(@Req() request: Request, @Body() body: CreateQuoteDto) {
    const user = request.axoraUser!;
    const scope = await this.companyScope.resolve(user, body.companyId);
    return this.sales.createQuote(scope, body, user.id);
  }

  @Post("quotes/:id/submit")
  @RequirePermission(SALES_PERMISSIONS.QUOTE_MANAGE)
  async submitQuote(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: SubmitQuoteDto,
  ) {
    const user = request.axoraUser!;
    const scope = await this.companyScope.resolve(user, body?.companyId);
    return this.sales.submitQuote(scope, id, user.id);
  }

  @Post("quotes/:id/accept")
  @RequirePermission(SALES_PERMISSIONS.QUOTE_MANAGE)
  async acceptQuote(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: AcceptQuoteDto,
  ) {
    const user = request.axoraUser!;
    const scope = await this.companyScope.resolve(user, body?.companyId);
    return this.sales.acceptQuote(scope, id, body ?? {}, user.id);
  }

  @Post("quotes/:id/reject")
  @RequirePermission(SALES_PERMISSIONS.QUOTE_MANAGE)
  async rejectQuote(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: RejectQuoteDto,
  ) {
    const user = request.axoraUser!;
    const scope = await this.companyScope.resolve(user, body?.companyId);
    return this.sales.rejectQuote(scope, id, body, user.id);
  }

  @Get("contracts")
  @RequirePermission(SALES_PERMISSIONS.CONTRACT_READ)
  async listContracts(@Req() request: Request, @Query("companyId") companyId?: string) {
    const scope = await this.companyScope.resolve(request.axoraUser!, companyId);
    return this.sales.listContracts(scope);
  }

  @Get("contracts/:id")
  @RequirePermission(SALES_PERMISSIONS.CONTRACT_READ)
  async getContract(
    @Req() request: Request,
    @Param("id") id: string,
    @Query("companyId") companyId?: string,
  ) {
    const scope = await this.companyScope.resolve(request.axoraUser!, companyId);
    return this.sales.getContract(scope, id);
  }

  @Post("contracts")
  @RequirePermission(SALES_PERMISSIONS.CONTRACT_MANAGE)
  async createContract(@Req() request: Request, @Body() body: CreateContractDto) {
    const user = request.axoraUser!;
    const scope = await this.companyScope.resolve(user, body.companyId);
    return this.sales.createContract(scope, body, user.id);
  }
}
