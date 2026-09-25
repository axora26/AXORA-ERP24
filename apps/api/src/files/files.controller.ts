import { Controller, Get, Param, Post, Res, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { BIM_PERMISSIONS as BIM, COMMISSIONING_PERMISSIONS as CX, DOCUMENTS_PERMISSIONS as D, FIELD_PERMISSIONS as F, QHSE_PERMISSIONS as Q, FLEET_PERMISSIONS as FLEET } from "@axora24/contracts";
import { RequireAnyPermission } from "../auth/require-permission.decorator.js";
import { CurrentUser, Scope, ScopedController } from "../common/scope.guard.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import type { AuthenticatedUser } from "../auth/session.guard.js";
import { FilesService, MAX_FILE_BYTES, type UploadedBinary } from "./files.service.js";
import { isImage } from "./file-type.js";

/** Fichiers immuables (GED, preuves chantier). Aucune route de modification ni de suppression. */
@Controller("files")
@ScopedController()
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post()
  @RequireAnyPermission(D.FILE_UPLOAD, F.EVIDENCE_CREATE, D.DOCUMENT_MANAGE, Q.INSPECTION_MANAGE, Q.ACTION_MANAGE, CX.MANAGE, BIM.MODEL_MANAGE, FLEET.MANAGE, FLEET.FUEL)
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_FILE_BYTES, files: 1 } }))
  upload(@Scope() scope: CompanyScope, @CurrentUser() user: AuthenticatedUser, @UploadedFile() file: UploadedBinary | undefined) {
    return this.files.store(scope, file, user.id);
  }

  @Get(":id")
  @RequireAnyPermission(D.DOCUMENT_READ, F.SITE_READ, Q.READ, CX.READ, BIM.MODEL_READ, FLEET.READ)
  metadata(@Scope() scope: CompanyScope, @Param("id") id: string) {
    return this.files.metadata(scope, id);
  }

  @Get(":id/content")
  @RequireAnyPermission(D.DOCUMENT_READ, F.SITE_READ, Q.READ, CX.READ, BIM.MODEL_READ, FLEET.READ)
  async content(@Scope() scope: CompanyScope, @Param("id") id: string, @Res() response: Response): Promise<void> {
    const { file, content } = await this.files.content(scope, id);
    const inline = isImage(file.mimeType) || file.mimeType === "application/pdf";
    const asciiName = file.originalName.replace(/[^\x20-\x7e]/g, "_");
    response.setHeader("Content-Type", file.mimeType);
    response.setHeader("Content-Length", String(content.length));
    response.setHeader(
      "Content-Disposition",
      `${inline ? "inline" : "attachment"}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
    );
    response.setHeader("ETag", `"${file.sha256}"`);
    response.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.end(content);
  }
}
