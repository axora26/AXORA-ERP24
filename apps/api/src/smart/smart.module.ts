import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { SmartController } from "./smart.controller.js";
import { SmartGatewayController } from "./smart-gateway.controller.js";
import { GatewayTokenGuard } from "./gateway-token.guard.js";
import { SmartIngestionService } from "./ingestion.service.js";
import { SmartService } from "./smart.service.js";

/** INC-16 — Smart Building : configuration, telemetrie, alarmes, consignes, essais reels. */
@Module({
  imports: [AuthModule],
  controllers: [SmartController, SmartGatewayController],
  providers: [SmartService, SmartIngestionService, GatewayTokenGuard],
  exports: [SmartIngestionService],
})
export class SmartModule {}
