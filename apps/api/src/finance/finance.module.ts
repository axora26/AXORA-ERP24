import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { FinanceController } from "./finance.controller.js";
import { FinanceService } from "./finance.service.js";

/** INC-08 — Finance (clients, fournisseurs, paiements, tresorerie). */
@Module({
  imports: [AuthModule],
  controllers: [FinanceController],
  providers: [FinanceService],
})
export class FinanceModule {}
