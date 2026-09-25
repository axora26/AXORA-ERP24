import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { PROCUREMENT_PERMISSIONS as P } from "@axora24/contracts";
import { RequirePermission } from "../auth/require-permission.decorator.js";
import { CurrentUser, Scope, ScopedController } from "../common/scope.guard.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import type { AuthenticatedUser } from "../auth/session.guard.js";
import { ProcurementService } from "./procurement.service.js";

/** INC-06 — Achats. */
@Controller("procurement")
@ScopedController()
export class ProcurementController {
  constructor(private readonly procurement: ProcurementService) {}

  @Get("suppliers")
  @RequirePermission(P.SUPPLIER_READ)
  suppliers(@Scope() scope: CompanyScope) {
    return this.procurement.listSuppliers(scope);
  }

  @Post("suppliers")
  @RequirePermission(P.SUPPLIER_MANAGE)
  createSupplier(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.procurement.createSupplier(scope, body, user.id);
  }

  @Patch("suppliers/:id")
  @RequirePermission(P.SUPPLIER_MANAGE)
  updateSupplier(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.procurement.updateSupplier(scope, id, body, user.id);
  }

  @Post("suppliers/:id/evaluations")
  @RequirePermission(P.SUPPLIER_MANAGE)
  evaluate(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.procurement.evaluateSupplier(scope, id, body, user.id);
  }

  @Get("requests")
  @RequirePermission(P.REQUEST_READ)
  requests(@Scope() scope: CompanyScope) {
    return this.procurement.listRequests(scope);
  }

  @Get("requests/:id")
  @RequirePermission(P.REQUEST_READ)
  request(@Scope() scope: CompanyScope, @Param("id") id: string) {
    return this.procurement.getRequest(scope, id);
  }

  @Post("requests")
  @RequirePermission(P.REQUEST_CREATE)
  createRequest(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.procurement.createRequest(scope, body, user.id);
  }

  @Post("requests/:id/submit")
  @RequirePermission(P.REQUEST_CREATE)
  submit(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.procurement.submitRequest(scope, id, user.id);
  }

  @Post("requests/:id/approve")
  @RequirePermission(P.REQUEST_APPROVE)
  approve(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.procurement.decideRequest(scope, id, "APPROVED", body, user.id);
  }

  @Post("requests/:id/reject")
  @RequirePermission(P.REQUEST_APPROVE)
  reject(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.procurement.decideRequest(scope, id, "REJECTED", body, user.id);
  }

  @Post("requests/:id/quotes")
  @RequirePermission(P.ORDER_MANAGE)
  addQuote(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.procurement.addQuote(scope, id, body, user.id);
  }

  @Get("orders")
  @RequirePermission(P.ORDER_READ)
  orders(@Scope() scope: CompanyScope) {
    return this.procurement.listOrders(scope);
  }

  @Get("orders/:id")
  @RequirePermission(P.ORDER_READ)
  order(@Scope() scope: CompanyScope, @Param("id") id: string) {
    return this.procurement.getOrder(scope, id);
  }

  @Post("orders")
  @RequirePermission(P.ORDER_MANAGE)
  createOrder(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.procurement.createOrder(scope, body, user.id);
  }

  @Post("orders/:id/issue")
  @RequirePermission(P.ORDER_MANAGE)
  issue(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.procurement.issueOrder(scope, id, user.id);
  }

  @Post("orders/:id/cancel")
  @RequirePermission(P.ORDER_MANAGE)
  cancel(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.procurement.cancelOrder(scope, id, body, user.id);
  }

  @Post("orders/:id/receipts")
  @RequirePermission(P.RECEIPT_CREATE)
  receive(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.procurement.receive(scope, id, body, user.id);
  }
}
