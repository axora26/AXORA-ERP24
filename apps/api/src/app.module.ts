import { Module } from "@nestjs/common";
import { HealthModule } from "./health/health.module.js";
import { CoreModule } from "./core/core.module.js";
import { AuthModule } from "./auth/auth.module.js";

@Module({
  imports: [HealthModule, AuthModule, CoreModule],
})
export class AppModule {}
