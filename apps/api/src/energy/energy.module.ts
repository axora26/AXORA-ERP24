import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { GatewayTokenGuard } from "../smart/gateway-token.guard.js";
import { EnergyController, EnergyGatewayController } from "./energy.controller.js";
import { EnergyService } from "./energy.service.js";

/** INC-17 — Energie : compteurs, intervalles idempotents, bilans, autonomie, alertes. */
@Module({
  imports: [AuthModule],
  controllers: [EnergyController, EnergyGatewayController],
  providers: [EnergyService, GatewayTokenGuard],
})
export class EnergyModule {}
