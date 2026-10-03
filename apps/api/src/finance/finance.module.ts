import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { FinanceController } from "./finance.controller.js";
import { FinanceService } from "./finance.service.js";
import { CreditNotesController } from "./credit-notes.controller.js";
import { CreditNotesService } from "./credit-notes.service.js";
import { CreditExportController } from "./credit-export.controller.js";

/** INC-08 — Finance (clients, fournisseurs, paiements, tresorerie). */
@Module({
  imports: [AuthModule],
  controllers: [FinanceController, CreditNotesController, CreditExportController],
  providers: [FinanceService, CreditNotesService],
})
export class FinanceModule {}
