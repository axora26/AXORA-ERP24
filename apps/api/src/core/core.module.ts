import { Module } from "@nestjs/common";
import { OrganizationController } from "./organization.controller.js";
import { OrganizationService } from "./organization.service.js";
import { PrismaService } from "./prisma.service.js";
import { PermissionSyncService } from "./permission-sync.service.js";
import { AuthModule } from "../auth/auth.module.js";

/**
 * Module Core — INC-01 (docs/foundation/06-product-backlog.md).
 * Perimetre minimal actuel : Organization en lecture/creation, protege par
 * SessionGuard + PermissionGuard (voir docs/foundation/03-security.md).
 */
@Module({
  imports: [AuthModule],
  controllers: [OrganizationController],
  providers: [OrganizationService, PermissionSyncService, PrismaService],
})
export class CoreModule {}
