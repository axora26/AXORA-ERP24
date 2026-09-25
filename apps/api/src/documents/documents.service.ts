import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { DocumentFolderView, DocumentVersionView, ManagedDocumentView } from "@axora24/contracts";
import { Prisma } from "@axora24/database";
import { PrismaService } from "../core/prisma.service.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import { NumberingService } from "../common/numbering.service.js";
import { writeAudit } from "../common/audit.js";
import { fileView } from "../files/files.service.js";
import { assertBody, optionalEnum, optionalId, optionalText, requiredEnum, requiredId, requiredText } from "../common/validation.js";

type Tx = Prisma.TransactionClient;

const CATEGORIES = ["PLAN", "SPECIFICATION", "TECHNICAL_SHEET", "REPORT", "MINUTES", "CONTRACT", "PHOTO", "DOE", "CERTIFICATE", "OTHER"] as const;
const STATUSES = ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "ARCHIVED"] as const;

/** Indice de revision lisible : 1 -> A, 26 -> Z, 27 -> AA. */
export function revisionLabel(versionNumber: number): string {
  let value = versionNumber;
  let label = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
}

const documentInclude = {
  folder: { select: { name: true } },
  versions: { include: { file: true }, orderBy: { versionNumber: "desc" as const } },
} satisfies Prisma.ManagedDocumentInclude;

type DocumentRow = Prisma.ManagedDocumentGetPayload<{ include: typeof documentInclude }>;

/**
 * INC-10 — GED (fondation, docs/foundation/02-domain-model.md BC-10) :
 * arborescence par projet, documents versionnes a contenu immuable,
 * cycle brouillon -> soumis -> approuve/rejete -> archive, recherche.
 */
@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
  ) {}

  // -------------------------------------------------------------------
  // Arborescence
  // -------------------------------------------------------------------

  async listFolders(scope: CompanyScope, query: Record<string, unknown>): Promise<DocumentFolderView[]> {
    const projectId = optionalId(query.projectId, "projectId");
    const folders = await this.prisma.documentFolder.findMany({
      where: { ...scope, ...(query.projectId !== undefined ? { projectId } : {}) },
      include: { _count: { select: { documents: true } } },
      orderBy: { name: "asc" },
    });
    return folders.map((folder) => ({
      id: folder.id,
      name: folder.name,
      parentId: folder.parentId,
      projectId: folder.projectId,
      documentCount: folder._count.documents,
    }));
  }

  async createFolder(scope: CompanyScope, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const name = requiredText(input.name, "name", 120);
    let projectId = optionalId(input.projectId, "projectId");
    const parentId = optionalId(input.parentId, "parentId");
    await this.prisma.$transaction(async (tx) => {
      if (parentId) {
        const parent = await tx.documentFolder.findFirst({ where: { id: parentId, ...scope } });
        if (!parent) throw new NotFoundException("Parent folder not found");
        if (projectId && parent.projectId !== projectId) throw new BadRequestException("A sub-folder belongs to its parent's project");
        projectId = parent.projectId;
      }
      if (projectId) await this.requireProject(tx, scope, projectId);
      const sibling = await tx.documentFolder.findFirst({
        where: { ...scope, projectId, parentId, name: { equals: name, mode: "insensitive" } },
        select: { id: true },
      });
      if (sibling) throw new ConflictException(`Folder "${name}" already exists here`);
      const folder = await tx.documentFolder.create({ data: { ...scope, name, projectId, parentId } });
      await writeAudit(tx, scope, actorUserId, "documents.folder.created", "DocumentFolder", folder.id, { name, projectId });
    });
    return this.listFolders(scope, projectId ? { projectId } : {});
  }

  // -------------------------------------------------------------------
  // Documents
  // -------------------------------------------------------------------

  async list(scope: CompanyScope, query: Record<string, unknown>): Promise<ManagedDocumentView[]> {
    const projectId = optionalId(query.projectId, "projectId");
    const folderId = optionalId(query.folderId, "folderId");
    const status = optionalEnum(query.status, "status", STATUSES);
    const category = optionalEnum(query.category, "category", CATEGORIES);
    const q = optionalText(query.q, "q", 120);
    const documents = await this.prisma.managedDocument.findMany({
      where: {
        ...scope,
        ...(projectId ? { projectId } : {}),
        ...(folderId ? { folderId } : {}),
        ...(status ? { status } : {}),
        ...(category ? { category } : {}),
        ...(q
          ? {
              OR: [
                { code: { contains: q, mode: "insensitive" } },
                { title: { contains: q, mode: "insensitive" } },
                { keywords: { contains: q, mode: "insensitive" } },
                { versions: { some: { fileName: { contains: q, mode: "insensitive" } } } },
              ],
            }
          : {}),
      },
      include: documentInclude,
      orderBy: { updatedAt: "desc" },
      take: 300,
    });
    const projectCodes = await this.projectCodes(scope, documents.map((document) => document.projectId));
    return documents.map((document) => this.view(document, projectCodes, null));
  }

  async get(scope: CompanyScope, documentId: string): Promise<ManagedDocumentView> {
    const document = await this.prisma.managedDocument.findFirst({ where: { id: documentId, ...scope }, include: documentInclude });
    if (!document) throw new NotFoundException("Document not found");
    const projectCodes = await this.projectCodes(scope, [document.projectId]);
    const userIds = document.versions.flatMap((version) => [version.uploadedByUserId, version.decidedByUserId]).filter((id): id is string => Boolean(id));
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(userIds)] }, organizationId: scope.organizationId }, select: { id: true, fullName: true } });
    return this.view(document, projectCodes, new Map(users.map((user) => [user.id, user.fullName])));
  }

  async create(scope: CompanyScope, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const title = requiredText(input.title, "title", 200);
    const category = requiredEnum(input.category, "category", CATEGORIES);
    const fileId = requiredId(input.fileId, "fileId");
    let projectId = optionalId(input.projectId, "projectId");
    const folderId = optionalId(input.folderId, "folderId");
    const id = await this.prisma.$transaction(async (tx) => {
      if (folderId) {
        const folder = await tx.documentFolder.findFirst({ where: { id: folderId, ...scope } });
        if (!folder) throw new NotFoundException("Folder not found");
        if (projectId && folder.projectId !== projectId) throw new BadRequestException("The folder belongs to another project");
        projectId = folder.projectId;
      }
      if (projectId) await this.requireProject(tx, scope, projectId);
      const file = await this.requireFile(tx, scope, fileId);
      const code = await this.numbering.next(tx, scope, "DOC");
      const document = await tx.managedDocument.create({
        data: {
          ...scope,
          code,
          title,
          category,
          projectId,
          folderId,
          keywords: optionalText(input.keywords, "keywords", 300),
          createdByUserId: actorUserId,
          versions: {
            create: {
              versionNumber: 1,
              revision: revisionLabel(1),
              fileId: file.id,
              fileName: optionalText(input.fileName, "fileName", 180) ?? file.originalName,
              changeNote: optionalText(input.changeNote, "changeNote", 500) ?? "Création",
              uploadedByUserId: actorUserId,
            },
          },
        },
      });
      await writeAudit(tx, scope, actorUserId, "documents.document.created", "ManagedDocument", document.id, { code, category, sha256: file.sha256 });
      return document.id;
    });
    return this.get(scope, id);
  }

  /** Nouvelle revision : jamais une reecriture de la version existante. */
  async addVersion(scope: CompanyScope, documentId: string, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const fileId = requiredId(input.fileId, "fileId");
    const changeNote = requiredText(input.changeNote, "changeNote", 500);
    await this.prisma.$transaction(async (tx) => {
      const document = await this.lockDocument(tx, scope, documentId);
      if (document.status === "ARCHIVED") throw new BadRequestException("An archived document cannot be revised");
      const latest = await tx.documentVersion.findFirstOrThrow({ where: { documentId }, orderBy: { versionNumber: "desc" } });
      if (latest.status === "SUBMITTED") throw new BadRequestException("The current version is under review: decide it before uploading a new revision");
      const file = await this.requireFile(tx, scope, fileId);
      if (file.id === latest.fileId) throw new BadRequestException("This file is identical to the current version");
      const versionNumber = latest.versionNumber + 1;
      if (latest.status === "DRAFT" || latest.status === "REJECTED") {
        await tx.documentVersion.update({ where: { id: latest.id }, data: { status: "SUPERSEDED" } });
      }
      await tx.documentVersion.create({
        data: {
          ...scope,
          documentId,
          versionNumber,
          revision: revisionLabel(versionNumber),
          fileId: file.id,
          fileName: optionalText(input.fileName, "fileName", 180) ?? file.originalName,
          changeNote,
          uploadedByUserId: actorUserId,
        },
      });
      await tx.managedDocument.update({ where: { id: documentId }, data: { status: "DRAFT", currentVersionNumber: versionNumber } });
      await writeAudit(tx, scope, actorUserId, "documents.version.added", "ManagedDocument", documentId, {
        revision: revisionLabel(versionNumber),
        sha256: file.sha256,
      });
    });
    return this.get(scope, documentId);
  }

  async submit(scope: CompanyScope, documentId: string, actorUserId: string) {
    await this.prisma.$transaction(async (tx) => {
      const document = await this.lockDocument(tx, scope, documentId);
      if (document.status === "ARCHIVED") throw new BadRequestException("The document is archived");
      const latest = await tx.documentVersion.findFirstOrThrow({ where: { documentId }, orderBy: { versionNumber: "desc" } });
      if (latest.status !== "DRAFT") throw new BadRequestException("Only a draft version can be submitted");
      await tx.documentVersion.update({ where: { id: latest.id }, data: { status: "SUBMITTED", submittedByUserId: actorUserId, submittedAt: new Date() } });
      await tx.managedDocument.update({ where: { id: documentId }, data: { status: "SUBMITTED" } });
      await writeAudit(tx, scope, actorUserId, "documents.version.submitted", "ManagedDocument", documentId, { revision: latest.revision });
    });
    return this.get(scope, documentId);
  }

  /** Approbation par un tiers : ni l'auteur de la version ni celui qui l'a soumise. */
  async decide(scope: CompanyScope, documentId: string, decision: "APPROVED" | "REJECTED", body: unknown, actorUserId: string) {
    const note = optionalText(assertBody(body ?? {}).note, "note", 1000);
    if (decision === "REJECTED" && !note) throw new BadRequestException("A note is required to reject a version");
    await this.prisma.$transaction(async (tx) => {
      await this.lockDocument(tx, scope, documentId);
      const latest = await tx.documentVersion.findFirstOrThrow({ where: { documentId }, orderBy: { versionNumber: "desc" } });
      if (latest.status !== "SUBMITTED") throw new BadRequestException("Only a submitted version can be decided");
      if (latest.uploadedByUserId === actorUserId || latest.submittedByUserId === actorUserId) {
        throw new ForbiddenException("A version is approved by someone other than its author and its submitter");
      }
      if (decision === "APPROVED") {
        await tx.documentVersion.updateMany({ where: { documentId, status: "APPROVED" }, data: { status: "SUPERSEDED" } });
      }
      await tx.documentVersion.update({
        where: { id: latest.id },
        data: { status: decision, decidedByUserId: actorUserId, decidedAt: new Date(), decisionNote: note },
      });
      await tx.managedDocument.update({ where: { id: documentId }, data: { status: decision } });
      await writeAudit(tx, scope, actorUserId, decision === "APPROVED" ? "documents.version.approved" : "documents.version.rejected", "ManagedDocument", documentId, {
        revision: latest.revision,
        note,
      });
    });
    return this.get(scope, documentId);
  }

  async archive(scope: CompanyScope, documentId: string, body: unknown, actorUserId: string) {
    const reason = requiredText(assertBody(body ?? {}).reason, "reason", 500);
    await this.prisma.$transaction(async (tx) => {
      const document = await this.lockDocument(tx, scope, documentId);
      if (document.status === "ARCHIVED") throw new BadRequestException("Already archived");
      if (document.status === "SUBMITTED") throw new BadRequestException("Decide the version under review before archiving");
      await tx.managedDocument.update({ where: { id: documentId }, data: { status: "ARCHIVED", archivedAt: new Date(), archivedByUserId: actorUserId } });
      await writeAudit(tx, scope, actorUserId, "documents.document.archived", "ManagedDocument", documentId, { reason });
    });
    return this.get(scope, documentId);
  }

  // -------------------------------------------------------------------
  // Internes
  // -------------------------------------------------------------------

  private view(document: DocumentRow, projectCodes: Map<string, string>, names: Map<string, string> | null): ManagedDocumentView {
    const current = document.versions[0];
    const approved = document.versions.find((version) => version.status === "APPROVED");
    return {
      id: document.id,
      code: document.code,
      title: document.title,
      category: document.category,
      projectId: document.projectId,
      projectCode: document.projectId ? (projectCodes.get(document.projectId) ?? null) : null,
      folderId: document.folderId,
      folderName: document.folder?.name ?? null,
      keywords: document.keywords,
      status: document.status,
      currentVersionNumber: document.currentVersionNumber,
      currentRevision: current?.revision ?? revisionLabel(document.currentVersionNumber),
      approvedRevision: approved?.revision ?? null,
      createdAt: document.createdAt.toISOString(),
      updatedAt: document.updatedAt.toISOString(),
      archivedAt: document.archivedAt?.toISOString() ?? null,
      ...(names
        ? {
            versions: document.versions.map(
              (version): DocumentVersionView => ({
                id: version.id,
                versionNumber: version.versionNumber,
                revision: version.revision,
                status: version.status,
                fileName: version.fileName,
                file: fileView(version.file),
                changeNote: version.changeNote,
                uploadedByUserId: version.uploadedByUserId,
                uploadedByName: names.get(version.uploadedByUserId) ?? "—",
                createdAt: version.createdAt.toISOString(),
                submittedByUserId: version.submittedByUserId,
                submittedAt: version.submittedAt?.toISOString() ?? null,
                decidedByName: version.decidedByUserId ? (names.get(version.decidedByUserId) ?? "—") : null,
                decidedAt: version.decidedAt?.toISOString() ?? null,
                decisionNote: version.decisionNote,
              }),
            ),
          }
        : {}),
    };
  }

  private async projectCodes(scope: CompanyScope, ids: Array<string | null>): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (unique.length === 0) return new Map();
    const projects = await this.prisma.project.findMany({ where: { id: { in: unique }, ...scope }, select: { id: true, code: true } });
    return new Map(projects.map((project) => [project.id, project.code]));
  }

  private async lockDocument(tx: Tx, scope: CompanyScope, documentId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "documents"
      WHERE "id" = ${documentId} AND "organizationId" = ${scope.organizationId} AND "companyId" = ${scope.companyId}
      FOR UPDATE
    `;
    if (rows.length === 0) throw new NotFoundException("Document not found");
    return tx.managedDocument.findUniqueOrThrow({ where: { id: documentId } });
  }

  private async requireProject(tx: Tx, scope: CompanyScope, projectId: string) {
    const project = await tx.project.findFirst({ where: { id: projectId, ...scope }, select: { id: true } });
    if (!project) throw new NotFoundException("Project not found");
  }

  private async requireFile(tx: Tx, scope: CompanyScope, fileId: string) {
    const file = await tx.storedFile.findFirst({ where: { id: fileId, ...scope } });
    if (!file) throw new NotFoundException("File not found");
    return file;
  }
}
