import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { FINANCE_PERMISSIONS as F } from "@axora24/contracts";
import { RequireAnyPermission, RequirePermission } from "../auth/require-permission.decorator.js";
import { CurrentUser, Scope, ScopedController } from "../common/scope.guard.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import type { AuthenticatedUser } from "../auth/session.guard.js";
import { FinanceService } from "./finance.service.js";
import { InvoiceSignatureService } from "./invoice-signature.service.js";
import { TreasuryForecastService } from "./treasury-forecast.service.js";
import { BankReconciliationService } from "./bank-reconciliation.service.js";

/** INC-08 — Finance. Les paiements sont append-only (aucune route de modification). */
@Controller("finance")
@ScopedController()
export class FinanceController {
  constructor(private readonly finance: FinanceService, private readonly signatures: InvoiceSignatureService, private readonly treasury: TreasuryForecastService, private readonly reconciliation: BankReconciliationService) {}

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
  @RequireAnyPermission(F.INVOICE_READ, F.REFUND_MANAGE)
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

  @Get("invoices/:id/signatures")
  @RequirePermission(F.INVOICE_READ)
  signaturesForInvoice(@Scope() scope: CompanyScope, @Param("id") id: string) {
    return this.signatures.list(scope, id);
  }

  @Post("invoices/:id/sign")
  @RequireAnyPermission(F.INVOICE_SIGN, F.INVOICE_MANAGE)
  signInvoice(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.signatures.sign(scope, id, body, user.id);
  }

  @Post("invoices/:id/signatures/:signatureId/revoke")
  @RequireAnyPermission(F.INVOICE_SIGN, F.INVOICE_MANAGE)
  revokeInvoiceSignature(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Param("signatureId") signatureId: string, @Body() body: unknown) {
    return this.signatures.revoke(scope, id, signatureId, body, user.id);
  }

  @Get("invoices/:id/signatures/:signatureId/verify")
  @RequirePermission(F.INVOICE_READ)
  verifyInvoiceSignature(@Scope() scope: CompanyScope, @Param("id") id: string, @Param("signatureId") signatureId: string) {
    return this.signatures.verify(scope, id, signatureId);
  }

  @Get("treasury-forecast")
  @RequirePermission(F.INVOICE_READ)
  treasuryForecast(@Scope() scope: CompanyScope, @Query("days") days?: string) {
    return this.treasury.forecast(scope, days);
  }

  @Get("bank-statements")
  @RequirePermission(F.INVOICE_READ)
  bankStatements(@Scope() scope: CompanyScope, @Query("bankAccountId") bankAccountId?: string) {
    return this.reconciliation.list(scope, bankAccountId);
  }

  @Post("bank-statements/import")
  @RequirePermission(F.BANK_MANAGE)
  importBankStatement(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.reconciliation.importEntries(scope, body, user.id);
  }

  @Post("bank-statements/:id/match")
  @RequirePermission(F.BANK_MANAGE)
  matchBankStatement(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    const paymentId = body && typeof body === "object" && !Array.isArray(body) && "paymentId" in body && typeof body.paymentId === "string" ? body.paymentId : "";
    return this.reconciliation.match(scope, id, paymentId, user.id);
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
