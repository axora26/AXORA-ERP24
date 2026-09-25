import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { CrmModule } from "../crm/crm.module.js";
import { AnalyticsModule } from "../analytics/analytics.module.js";
import { ApiKeyGuard } from "./api-key.guard.js";
import { InboundController } from "./inbound.controller.js";
import { IntegrationsController } from "./integrations.controller.js";
import { IntegrationsService } from "./integrations.service.js";
import { PublicApiController, PublicMetaController } from "./public-api.controller.js";
import { ApiRequestLogMiddleware } from "./request-log.middleware.js";

@Module({
  imports: [AuthModule, CrmModule, AnalyticsModule],
  controllers: [IntegrationsController, PublicMetaController, PublicApiController, InboundController],
  providers: [IntegrationsService, ApiKeyGuard],
})
export class IntegrationsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(ApiRequestLogMiddleware).forRoutes(PublicApiController);
  }
}
