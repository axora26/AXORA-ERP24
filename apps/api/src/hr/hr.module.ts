import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { HrController } from "./hr.controller.js";
import { HrService } from "./hr.service.js";
import { HrOperationsController } from "./hr-operations.controller.js";
import { PayrollPolicyService } from "./payroll-policy.service.js";
import { ServiceCardService } from "./service-card.service.js";
import { HrExportController } from "./hr-export.controller.js";

/** INC-09 — Ressources humaines (employes, presence, temps, conges, paie). */
@Module({
  imports: [AuthModule],
  controllers: [HrController, HrOperationsController, HrExportController],
  providers: [HrService, PayrollPolicyService, ServiceCardService],
  exports: [HrService, ServiceCardService],
})
export class HrModule {}
