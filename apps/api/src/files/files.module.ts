import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { FilesController } from "./files.controller.js";
import { FilesService } from "./files.service.js";
import { FILE_STORAGE, LocalFileStorage } from "./file-storage.js";

/** INC-10 — Fichiers immuables adresses par empreinte (stockage objet). */
@Module({
  imports: [AuthModule],
  controllers: [FilesController],
  providers: [FilesService, { provide: FILE_STORAGE, useFactory: () => new LocalFileStorage() }],
  exports: [FilesService],
})
export class FilesModule {}
