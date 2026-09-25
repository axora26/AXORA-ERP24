import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { CrmModule } from "../crm/crm.module.js";
import { SalesController } from "./sales.controller.js";
import { SalesService } from "./sales.service.js";

/** INC-04 — Devis (Quote) -> Contrat, tranche verticale commerciale. */
@Module({
  imports: [AuthModule, CrmModule],
  controllers: [SalesController],
  providers: [SalesService],
})
export class SalesModule {}
