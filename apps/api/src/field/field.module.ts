import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { FilesModule } from "../files/files.module.js";
import { FieldController } from "./field.controller.js";
import { FieldService } from "./field.service.js";

/** INC-10 — Chantier : journal, preuves, reserves, synchronisation hors ligne. */
@Module({
  imports: [AuthModule, FilesModule],
  controllers: [FieldController],
  providers: [FieldService],
})
export class FieldModule {}
