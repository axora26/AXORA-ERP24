import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { CrmModule } from "../crm/crm.module.js";
import { EstimationController } from "./estimation.controller.js";
import { EstimationService } from "./estimation.service.js";
import { EstimationExportController } from "./estimation-export.controller.js";

/** INC-03 — Study, DQE/BPU et estimation décimale exacte. */
@Module({
  imports: [AuthModule, CrmModule],
  controllers: [EstimationController, EstimationExportController],
  providers: [EstimationService],
})
export class EstimationModule {}
