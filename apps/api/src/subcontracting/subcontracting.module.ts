import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { SubcontractingController } from "./subcontracting.controller.js";
import { SubcontractingService } from "./subcontracting.service.js";

/** INC-19 — Sous-traitants : qualification, lots, situations, retenues de garantie. */
@Module({
  imports: [AuthModule],
  controllers: [SubcontractingController],
  providers: [SubcontractingService],
})
export class SubcontractingModule {}
