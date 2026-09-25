import { Module } from "@nestjs/common";
import { HealthModule } from "./health/health.module.js";
import { CommonModule } from "./common/common.module.js";
import { CoreModule } from "./core/core.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { CrmModule } from "./crm/crm.module.js";
import { EstimationModule } from "./estimation/estimation.module.js";
import { SalesModule } from "./sales/sales.module.js";
import { DashboardModule } from "./dashboard/dashboard.module.js";

@Module({
  imports: [CommonModule, HealthModule, AuthModule, CoreModule, CrmModule, EstimationModule, SalesModule, DashboardModule],
})
export class AppModule {}
