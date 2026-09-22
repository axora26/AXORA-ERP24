import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { CrmModule } from "../crm/crm.module.js";
import { PrismaService } from "../core/prisma.service.js";
import { EstimationController } from "./estimation.controller.js";
import { EstimationService } from "./estimation.service.js";

/** INC-03 — Study, DQE/BPU et estimation décimale exacte. */
@Module({
  imports: [AuthModule, CrmModule],
  controllers: [EstimationController],
  providers: [EstimationService, PrismaService],
})
export class EstimationModule {}
