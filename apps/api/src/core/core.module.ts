import { Module } from "@nestjs/common";
import { OrganizationController } from "./organization.controller.js";
import { OrganizationService } from "./organization.service.js";
import { PrismaService } from "./prisma.service.js";

/**
 * Module Core — INC-01 (docs/foundation/06-product-backlog.md).
 * Perimetre minimal actuel : Organization en lecture/creation.
 * RBAC applicatif complet (guards de permission) a brancher avant toute
 * exposition en environnement partage — voir docs/foundation/03-security.md.
 */
@Module({
  controllers: [OrganizationController],
  providers: [OrganizationService, PrismaService],
})
export class CoreModule {}
