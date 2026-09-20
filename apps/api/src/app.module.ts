import { Module } from "@nestjs/common";
import { HealthModule } from "./health/health.module.js";
import { CoreModule } from "./core/core.module.js";

@Module({
  imports: [HealthModule, CoreModule],
})
export class AppModule {}
