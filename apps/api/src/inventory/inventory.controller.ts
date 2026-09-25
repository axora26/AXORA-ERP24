import { Body, Controller, Get, Param, Patch, Post, Put, Query } from "@nestjs/common";
import { INVENTORY_PERMISSIONS as P } from "@axora24/contracts";
import { RequirePermission } from "../auth/require-permission.decorator.js";
import { CurrentUser, Scope, ScopedController } from "../common/scope.guard.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import type { AuthenticatedUser } from "../auth/session.guard.js";
import { InventoryService } from "./inventory.service.js";

/** INC-07 — Stock & Logistique. Aucune route de modification/suppression du grand livre. */
@Controller("inventory")
@ScopedController()
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get("items")
  @RequirePermission(P.ITEM_READ)
  items(@Scope() scope: CompanyScope) {
    return this.inventory.listItems(scope);
  }

  @Post("items")
  @RequirePermission(P.ITEM_MANAGE)
  createItem(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.inventory.createItem(scope, body, user.id);
  }

  @Patch("items/:id")
  @RequirePermission(P.ITEM_MANAGE)
  updateItem(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.inventory.updateItem(scope, id, body, user.id);
  }

  @Get("warehouses")
  @RequirePermission(P.ITEM_READ)
  warehouses(@Scope() scope: CompanyScope) {
    return this.inventory.listWarehouses(scope);
  }

  @Post("warehouses")
  @RequirePermission(P.ITEM_MANAGE)
  createWarehouse(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.inventory.createWarehouse(scope, body, user.id);
  }

  @Get("balances")
  @RequirePermission(P.ITEM_READ)
  balances(@Scope() scope: CompanyScope, @Query() query: Record<string, unknown>) {
    return this.inventory.balances(scope, query);
  }

  @Get("movements")
  @RequirePermission(P.ITEM_READ)
  movements(@Scope() scope: CompanyScope, @Query() query: Record<string, unknown>) {
    return this.inventory.movements(scope, query);
  }

  @Post("issues")
  @RequirePermission(P.MOVEMENT_CREATE)
  issue(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.inventory.issue(scope, body, user.id, "ISSUE");
  }

  @Post("returns")
  @RequirePermission(P.MOVEMENT_CREATE)
  returnToStock(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.inventory.issue(scope, body, user.id, "RETURN");
  }

  @Post("transfers")
  @RequirePermission(P.MOVEMENT_CREATE)
  transfer(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.inventory.transfer(scope, body, user.id);
  }

  @Post("adjustments")
  @RequirePermission(P.ADJUSTMENT_CREATE)
  adjust(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.inventory.adjust(scope, body, user.id);
  }

  @Get("counts")
  @RequirePermission(P.ITEM_READ)
  counts(@Scope() scope: CompanyScope) {
    return this.inventory.listCounts(scope);
  }

  @Get("counts/:id")
  @RequirePermission(P.ITEM_READ)
  count(@Scope() scope: CompanyScope, @Param("id") id: string) {
    return this.inventory.getCount(scope, id);
  }

  @Post("counts")
  @RequirePermission(P.COUNT_MANAGE)
  openCount(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.inventory.openCount(scope, body, user.id);
  }

  @Put("counts/:id/lines")
  @RequirePermission(P.COUNT_MANAGE)
  recordCount(@Scope() scope: CompanyScope, @Param("id") id: string, @Body() body: unknown) {
    return this.inventory.recordCount(scope, id, body);
  }

  @Post("counts/:id/close")
  @RequirePermission(P.COUNT_MANAGE)
  closeCount(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.inventory.closeCount(scope, id, user.id);
  }
}
