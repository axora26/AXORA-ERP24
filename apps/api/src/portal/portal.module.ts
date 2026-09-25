import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { FilesModule } from "../files/files.module.js";
import { PortalAdminController } from "./portal-admin.controller.js";
import { PortalAdminService } from "./portal-admin.service.js";
import { PortalController } from "./portal.controller.js";
import { PortalService } from "./portal.service.js";
import { PortalSessionGuard } from "./portal-session.guard.js";

/** INC-20 — Portails Client & Fournisseur : plan d'identite externe separe. */
@Module({
  imports: [AuthModule, FilesModule],
  controllers: [PortalAdminController, PortalController],
  providers: [PortalAdminService, PortalService, PortalSessionGuard],
})
export class PortalModule {}
