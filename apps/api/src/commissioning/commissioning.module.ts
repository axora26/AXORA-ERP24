import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { CommissioningController } from "./commissioning.controller.js";
import { CommissioningService } from "./commissioning.service.js";

/** INC-12 — Commissioning : essais, anomalies, retests, reception, remise DOE. */
@Module({
  imports: [AuthModule],
  controllers: [CommissioningController],
  providers: [CommissioningService],
})
export class CommissioningModule {}
