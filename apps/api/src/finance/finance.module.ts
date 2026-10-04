import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { FinanceController } from "./finance.controller.js";
import { FinanceService } from "./finance.service.js";
import { CreditNotesController } from "./credit-notes.controller.js";
import { CreditNotesService } from "./credit-notes.service.js";
import { CreditExportController } from "./credit-export.controller.js";
import { InvoiceExportController } from "./invoice-export.controller.js";
import { InvoiceSignatureService } from "./invoice-signature.service.js";
import { TreasuryForecastService } from "./treasury-forecast.service.js";
import { BankReconciliationService } from "./bank-reconciliation.service.js";
import { AccountingService } from "./accounting.service.js";

/** INC-08 — Finance (clients, fournisseurs, paiements, tresorerie). */
@Module({
  imports: [AuthModule],
  controllers: [FinanceController, CreditNotesController, CreditExportController, InvoiceExportController],
  providers: [FinanceService, CreditNotesService, InvoiceSignatureService, TreasuryForecastService, BankReconciliationService, AccountingService],
})
export class FinanceModule {}
