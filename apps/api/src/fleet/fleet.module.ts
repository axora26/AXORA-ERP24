import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { FleetController } from "./fleet.controller.js";
import { FleetService } from "./fleet.service.js";

/** INC-18 — Gestion de parc : vehicules et engins adosses a la GMAO. */
@Module({
  imports: [AuthModule],
  controllers: [FleetController],
  providers: [FleetService],
})
export class FleetModule {}
