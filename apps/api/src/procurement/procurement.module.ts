import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { InventoryModule } from "../inventory/inventory.module.js";
import { ProcurementController } from "./procurement.controller.js";
import { ProcurementService } from "./procurement.service.js";

/** INC-06 — Achats. */
@Module({
  imports: [AuthModule, InventoryModule],
  controllers: [ProcurementController],
  providers: [ProcurementService],
  exports: [ProcurementService],
})
export class ProcurementModule {}
