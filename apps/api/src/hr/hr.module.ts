import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { HrController } from "./hr.controller.js";
import { HrService } from "./hr.service.js";

/** INC-09 — Ressources humaines (employes, presence, temps, conges, paie). */
@Module({
  imports: [AuthModule],
  controllers: [HrController],
  providers: [HrService],
})
export class HrModule {}
