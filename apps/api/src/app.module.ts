import { Module } from "@nestjs/common";
import { HealthModule } from "./health/health.module.js";
import { CommonModule } from "./common/common.module.js";
import { CoreModule } from "./core/core.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { CrmModule } from "./crm/crm.module.js";
import { EstimationModule } from "./estimation/estimation.module.js";
import { SalesModule } from "./sales/sales.module.js";
import { DashboardModule } from "./dashboard/dashboard.module.js";
import { AdminModule } from "./admin/admin.module.js";
import { ProjectsModule } from "./projects/projects.module.js";
import { ProcurementModule } from "./procurement/procurement.module.js";
import { InventoryModule } from "./inventory/inventory.module.js";
import { FinanceModule } from "./finance/finance.module.js";
import { HrModule } from "./hr/hr.module.js";
import { FilesModule } from "./files/files.module.js";
import { DocumentsModule } from "./documents/documents.module.js";
import { FieldModule } from "./field/field.module.js";
import { QhseModule } from "./qhse/qhse.module.js";
import { MepModule } from "./mep/mep.module.js";
import { CommissioningModule } from "./commissioning/commissioning.module.js";
import { BimModule } from "./bim/bim.module.js";
import { AssetsModule } from "./assets/assets.module.js";
import { SmartModule } from "./smart/smart.module.js";
import { EnergyModule } from "./energy/energy.module.js";

@Module({
  imports: [CommonModule, HealthModule, AuthModule, CoreModule, CrmModule, EstimationModule, SalesModule, DashboardModule, AdminModule, ProjectsModule, ProcurementModule, InventoryModule, FinanceModule, HrModule, FilesModule, DocumentsModule, FieldModule, QhseModule, MepModule, CommissioningModule, BimModule, AssetsModule, SmartModule, EnergyModule],
})
export class AppModule {}
