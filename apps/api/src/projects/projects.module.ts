import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { ProjectsController } from "./projects.controller.js";
import { ProjectsService } from "./projects.service.js";
import { ProjectOperationsService } from "./project-operations.service.js";
import { ProjectExportController } from "./project-export.controller.js";

/** INC-05 — Projets & Construction. */
@Module({
  imports: [AuthModule],
  controllers: [ProjectsController, ProjectExportController],
  providers: [ProjectsService, ProjectOperationsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
