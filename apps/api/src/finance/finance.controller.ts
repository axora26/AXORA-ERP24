import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { FINANCE_PERMISSIONS as F } from "@axora24/contracts";
import { RequirePermission } from "../auth/require-permission.decorator.js";
import { CurrentUser, Scope, ScopedController } from "../common/scope.guard.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import type { AuthenticatedUser } from "../auth/session.guard.js";
import { FinanceService } from "./finance.service.js";

/** INC-08 — Finance. Les paiements sont append-only (aucune route de modification). */
@Controller("finance")
@ScopedController()
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  @Get("summary")
  @RequirePermission(F.INVOICE_READ)
  summary(@Req() request: Request, @Scope() scope: CompanyScope) {
    return this.finance.summary(scope, request.axoraPermissions?.has(F.PAYABLE_READ) ?? false);
  }

  @Get("tax-rates")
  @RequirePermission(F.INVOICE_READ)
  taxRates(@Scope() scope: CompanyScope) {
    return this.finance.listTaxRates(scope);
  }

  @Post("tax-rates")
  @RequirePermission(F.SETTINGS_MANAGE)
  createTaxRate(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.finance.createTaxRate(scope, body, user.id);
  }

  @Get("bank-accounts")
  @RequirePermission(F.INVOICE_READ)
  bankAccounts(@Scope() scope: CompanyScope) {
    return this.finance.listBankAccounts(scope);
  }

  @Post("bank-accounts")
  @RequirePermission(F.BANK_MANAGE)
  createBankAccount(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.finance.createBankAccount(scope, body, user.id);
  }

  @Get("invoices")
  @RequirePermission(F.INVOICE_READ)
  invoices(@Scope() scope: CompanyScope) {
    return this.finance.listCustomerInvoices(scope);
  }

  @Get("invoices/:id")
  @RequirePermission(F.INVOICE_READ)
  invoice(@Scope() scope: CompanyScope, @Param("id") id: string) {
    return this.finance.getCustomerInvoice(scope, id);
  }

  @Post("invoices")
  @RequirePermission(F.INVOICE_MANAGE)
  createInvoice(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.finance.createCustomerInvoice(scope, body, user.id);
  }

  @Post("invoices/:id/issue")
  @RequirePermission(F.INVOICE_MANAGE)
  issueInvoice(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.finance.issueCustomerInvoice(scope, id, body, user.id);
  }

  @Post("invoices/:id/cancel")
  @RequirePermission(F.INVOICE_MANAGE)
  cancelInvoice(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.finance.cancelCustomerInvoice(scope, id, body, user.id);
  }

  @Get("payables")
  @RequirePermission(F.PAYABLE_READ)
  payables(@Scope() scope: CompanyScope) {
    return this.finance.listSupplierInvoices(scope);
  }

  @Get("payables/:id")
  @RequirePermission(F.PAYABLE_READ)
  payable(@Scope() scope: CompanyScope, @Param("id") id: string) {
    return this.finance.getSupplierInvoice(scope, id);
  }

  @Post("payables")
  @RequirePermission(F.PAYABLE_MANAGE)
  recordPayable(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.finance.recordSupplierInvoice(scope, body, user.id);
  }

  @Post("payables/:id/approve")
  @RequirePermission(F.PAYABLE_APPROVE)
  approvePayable(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.finance.decideSupplierInvoice(scope, id, "APPROVED", body, user.id);
  }

  @Post("payables/:id/reject")
  @RequirePermission(F.PAYABLE_APPROVE)
  rejectPayable(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.finance.decideSupplierInvoice(scope, id, "REJECTED", body, user.id);
  }

  @Get("payments")
  @RequirePermission(F.INVOICE_READ)
  payments(@Scope() scope: CompanyScope, @Query() query: Record<string, unknown>) {
    return this.finance.listPayments(scope, query);
  }

  @Post("payments")
  @RequirePermission(F.PAYMENT_CREATE)
  pay(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.finance.pay(scope, body, user.id);
  }
}
