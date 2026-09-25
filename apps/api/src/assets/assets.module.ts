import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { InventoryModule } from "../inventory/inventory.module.js";
import { AssetsController } from "./assets.controller.js";
import { AssetsService } from "./assets.service.js";

/** INC-15 — Actifs / GMAO : passeports, preventif, tickets, OT, fiabilite reelle. */
@Module({
  imports: [AuthModule, InventoryModule],
  controllers: [AssetsController],
  providers: [AssetsService],
})
export class AssetsModule {}
