import { createHash } from "node:crypto";
import { Inject, Injectable, NotFoundException, UnsupportedMediaTypeException, BadRequestException } from "@nestjs/common";
import type { StoredFileView } from "@axora24/contracts";
import { Prisma } from "@axora24/database";
import { PrismaService } from "../core/prisma.service.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import { writeAudit } from "../common/audit.js";
import { detectFileType } from "./file-type.js";
import { FILE_STORAGE, type FileStorage } from "./file-storage.js";

export interface UploadedBinary {
  originalname: string;
  size: number;
  buffer: Buffer;
}

type StoredFileRow = {
  id: string;
  sha256: string;
  size: number;
  mimeType: string;
  originalName: string;
  createdAt: Date;
};

export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export function fileView(file: StoredFileRow): StoredFileView {
  return {
    id: file.id,
    sha256: file.sha256,
    size: file.size,
    mimeType: file.mimeType,
    originalName: file.originalName,
    createdAt: file.createdAt.toISOString(),
    url: `/api/v1/files/${file.id}/content`,
  };
}

function safeName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "fichier";
  const cleaned = [...base]
    .map((char) => (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 || '"<>|:*?'.includes(char) ? "_" : char))
    .join("")
    .trim();
  return (cleaned || "fichier").slice(0, 180);
}

/** Fichiers immuables adresses par empreinte (INC-10). */
@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
  ) {}

  /** Televersement idempotent : un contenu deja stocke dans l'entreprise renvoie le meme fichier. */
  async store(scope: CompanyScope, file: UploadedBinary | undefined, actorUserId: string): Promise<StoredFileView> {
    if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) throw new BadRequestException("A non-empty file is required");
    if (file.buffer.length > MAX_FILE_BYTES) throw new BadRequestException("File exceeds 25 MB");
    const originalName = safeName(file.originalname);
    const type = detectFileType(file.buffer, originalName);
    if (!type) {
      throw new UnsupportedMediaTypeException("Unsupported file type (accepted: JPEG, PNG, WebP, PDF, DOCX, XLSX, PPTX, ZIP, IFC, DWG)");
    }
    const sha256 = createHash("sha256").update(file.buffer).digest("hex");
    const existing = await this.prisma.storedFile.findFirst({ where: { companyId: scope.companyId, sha256 } });
    if (existing) return fileView(existing);

    const storageKey = `${scope.organizationId.toLowerCase().replace(/[^a-z0-9]/g, "")}/${sha256.slice(0, 2)}/${sha256}`;
    await this.storage.put(storageKey, file.buffer);
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const row = await tx.storedFile.create({
          data: { ...scope, sha256, size: file.buffer.length, mimeType: type.mimeType, originalName, storageKey, uploadedByUserId: actorUserId },
        });
        await writeAudit(tx, scope, actorUserId, "documents.file.uploaded", "StoredFile", row.id, {
          sha256,
          size: row.size,
          mimeType: row.mimeType,
        });
        return row;
      });
      return fileView(created);
    } catch (error) {
      // Course entre deux televersements du meme contenu : le premier gagne.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const winner = await this.prisma.storedFile.findFirstOrThrow({ where: { companyId: scope.companyId, sha256 } });
        return fileView(winner);
      }
      throw error;
    }
  }

  async metadata(scope: CompanyScope, fileId: string): Promise<StoredFileView> {
    const file = await this.prisma.storedFile.findFirst({ where: { id: fileId, ...scope } });
    if (!file) throw new NotFoundException("File not found");
    return fileView(file);
  }

  async content(scope: CompanyScope, fileId: string): Promise<{ file: StoredFileView; content: Buffer }> {
    const file = await this.prisma.storedFile.findFirst({ where: { id: fileId, ...scope } });
    if (!file) throw new NotFoundException("File not found");
    const content = await this.storage.read(file.storageKey);
    return { file: fileView(file), content };
  }
}
