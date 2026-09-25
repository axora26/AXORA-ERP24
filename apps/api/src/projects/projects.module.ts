import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { ProjectsController } from "./projects.controller.js";
import { ProjectsService } from "./projects.service.js";

/** INC-05 — Projets & Construction. */
@Module({
  imports: [AuthModule],
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
