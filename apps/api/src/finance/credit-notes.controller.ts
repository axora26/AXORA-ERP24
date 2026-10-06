import { Body, Controller, ForbiddenException, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { FINANCE_PERMISSIONS as F } from "@axora24/contracts";
import { RequirePermission } from "../auth/require-permission.decorator.js";
import { CurrentUser, Scope, ScopedController } from "../common/scope.guard.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import type { AuthenticatedUser } from "../auth/session.guard.js";
import { CreditNotesService } from "./credit-notes.service.js";

@Controller("finance")
@ScopedController()
export class CreditNotesController {
  constructor(private readonly credits: CreditNotesService) {}
  @Get("customer-credit-notes") @RequirePermission(F.CREDIT_READ)
  customerList(@Scope() scope: CompanyScope, @Query() query: Record<string, unknown>) { return this.credits.list(scope, "CUSTOMER", query); }
  @Get("customer-credit-notes/:id") @RequirePermission(F.CREDIT_READ)
  customerGet(@Scope() scope: CompanyScope, @Param("id") id: string) { return this.credits.get(scope, "CUSTOMER", id); }
  @Post("customer-credit-notes") @RequirePermission(F.CREDIT_MANAGE)
  customerCreate(@Req() request: Request, @Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    requireExtra(request, F.INVOICE_READ); return this.credits.create(scope, "CUSTOMER", body, user.id);
  }
  @Patch("customer-credit-notes/:id") @RequirePermission(F.CREDIT_MANAGE)
  customerUpdate(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) { return this.credits.update(scope, "CUSTOMER", id, body, user.id); }
  @Post("customer-credit-notes/:id/issue") @RequirePermission(F.CREDIT_ISSUE)
  customerIssue(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) { return this.credits.issue(scope, "CUSTOMER", id, body, user.id); }
  @Post("customer-credit-notes/:id/cancel") @RequirePermission(F.CREDIT_MANAGE)
  customerCancel(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) { return this.credits.cancel(scope, "CUSTOMER", id, body, user.id); }
  @Post("customer-credit-notes/:id/refunds") @RequirePermission(F.REFUND_MANAGE)
  customerRefund(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) { return this.credits.refund(scope, "CUSTOMER", id, body, user.id); }

  @Get("supplier-credit-notes") @RequirePermission(F.CREDIT_READ)
  supplierList(@Req() request: Request, @Scope() scope: CompanyScope, @Query() query: Record<string, unknown>) { requireExtra(request, F.PAYABLE_READ); return this.credits.list(scope, "SUPPLIER", query); }
  @Get("supplier-credit-notes/:id") @RequirePermission(F.CREDIT_READ)
  supplierGet(@Req() request: Request, @Scope() scope: CompanyScope, @Param("id") id: string) { requireExtra(request, F.PAYABLE_READ); return this.credits.get(scope, "SUPPLIER", id); }
  @Post("supplier-credit-notes") @RequirePermission(F.CREDIT_MANAGE)
  supplierCreate(@Req() request: Request, @Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Body() body: unknown) { requireExtra(request, F.PAYABLE_READ); return this.credits.create(scope, "SUPPLIER", body, user.id); }
  @Patch("supplier-credit-notes/:id") @RequirePermission(F.CREDIT_MANAGE)
  supplierUpdate(@Req() request: Request, @Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) { requireExtra(request, F.PAYABLE_READ); return this.credits.update(scope, "SUPPLIER", id, body, user.id); }
  @Post("supplier-credit-notes/:id/issue") @RequirePermission(F.CREDIT_ISSUE)
  supplierIssue(@Req() request: Request, @Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) { requireExtra(request, F.PAYABLE_READ); return this.credits.issue(scope, "SUPPLIER", id, body, user.id); }
  @Post("supplier-credit-notes/:id/cancel") @RequirePermission(F.CREDIT_MANAGE)
  supplierCancel(@Req() request: Request, @Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) { requireExtra(request, F.PAYABLE_READ); return this.credits.cancel(scope, "SUPPLIER", id, body, user.id); }
  @Post("supplier-credit-notes/:id/refunds") @RequirePermission(F.REFUND_MANAGE)
  supplierRefund(@Req() request: Request, @Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) { requireExtra(request, F.PAYABLE_READ); return this.credits.refund(scope, "SUPPLIER", id, body, user.id); }
}

/**
 * Avoir fournisseur prepare depuis un retour d'achat. Expose sous la commande
 * (parcours Achats) mais regi par les droits Finance : gestion des avoirs et
 * lecture des factures fournisseur.
 */
@Controller("procurement")
@ScopedController()
export class SupplierReturnCreditController {
  constructor(private readonly credits: CreditNotesService) {}
  @Post("orders/:orderId/returns/:returnId/credit-note") @RequirePermission(F.CREDIT_MANAGE)
  draft(@Req() request: Request, @Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("orderId") orderId: string, @Param("returnId") returnId: string) {
    requireExtra(request, F.PAYABLE_READ);
    return this.credits.draftFromSupplierReturn(scope, orderId, returnId, user.id);
  }
}
function requireExtra(request: Request, permission: string) {
  if (!request.axoraPermissions?.has(permission)) throw new ForbiddenException(`Missing permission: ${permission}`);
}
