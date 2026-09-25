import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { InventoryController } from "./inventory.controller.js";
import { InventoryService } from "./inventory.service.js";
import { StockLedgerService } from "./stock-ledger.service.js";

/** INC-07 — Stock & Logistique. StockLedgerService est partage avec les Achats (receptions). */
@Module({
  imports: [AuthModule],
  controllers: [InventoryController],
  providers: [InventoryService, StockLedgerService],
  exports: [StockLedgerService],
})
export class InventoryModule {}
