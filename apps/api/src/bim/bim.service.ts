import { createHash } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type {
  BimClashView,
  BimElementView,
  BimModelView,
  BimVersionDiffView,
  BimVersionSummary,
  BimVersionView,
  RevitConnectorStatusView,
} from "@axora24/contracts";
import { Prisma } from "@axora24/database";
import { PrismaService } from "../core/prisma.service.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import { NumberingService } from "../common/numbering.service.js";
import { writeAudit } from "../common/audit.js";
import { FilesService } from "../files/files.service.js";
import { assertBody, optionalId, optionalText, requiredEnum, requiredId, requiredText } from "../common/validation.js";
import { IfcParseError, parseIfc } from "./ifc-parser.js";

type Tx = Prisma.TransactionClient;

const DISCIPLINES = ["ARCHITECTURE", "STRUCTURE", "HVAC", "ELECTRICAL", "PLUMBING", "FIRE_PROTECTION", "COORDINATION", "OTHER"] as const;
const SHA256 = /^[0-9a-f]{64}$/;
type VersionRow = Prisma.BimModelVersionGetPayload<object>;

/**
 * INC-14 — BIM / IFC (docs/foundation/02-domain-model.md BC-14) : maquettes
 * et versions IFC importees depuis des fichiers verifies par empreinte,
 * elements, structure spatiale, systemes, comparaison de versions, liaison
 * aux equipements MEP, conflits de synthese avec resolution approuvee.
 */
@Injectable()
export class BimService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly files: FilesService,
  ) {}

  /**
   * Etat du connecteur Revit natif. Aucun add-in Revit n'est livre et aucun
   * Revit reel n'a ete exerce : chaque etat le dit, avec sa preuve.
   */
  revitConnector(): RevitConnectorStatusView {
    const noRevit = "Aucun poste Windows avec Revit sous licence n'a été exercé : état non vérifiable, jamais simulé.";
    return {
      connectorAvailable: { state: "NOT_AVAILABLE", evidence: "Aucun add-in Revit n'est livré avec AXORA-ERP24 à ce jour." },
      revitDetected: { state: "NOT_TESTED", evidence: noRevit },
      connectionEstablished: { state: "NOT_TESTED", evidence: noRevit },
      documentOpen: { state: "NOT_TESTED", evidence: noRevit },
      readTested: { state: "NOT_TESTED", evidence: noRevit },
      writeTested: { state: "NOT_TESTED", evidence: noRevit },
      interoperability: {
        format: "IFC (ISO 10303-21)",
        schemas: ["IFC2X3", "IFC4", "IFC4X3_ADD2"],
        state: "TESTED",
        evidence: "Lecture vérifiée par la suite de tests sur des fichiers réels buildingSMART (IFC2X3, IFC4, IFC4X3_ADD2) ; import par empreinte testé de bout en bout.",
      },
    };
  }

  // -------------------------------------------------------------------
  // Maquettes et versions
  // -------------------------------------------------------------------

  async listModels(scope: CompanyScope, query: Record<string, unknown>): Promise<BimModelView[]> {
    const projectId = optionalId(query.projectId, "projectId");
    const models = await this.prisma.bimModel.findMany({
      where: { ...scope, ...(projectId ? { projectId } : {}) },
      include: { versions: { orderBy: { versionNumber: "desc" } } },
      orderBy: { createdAt: "desc" },
    });
    return Promise.all(models.map((model) => this.modelView(scope, model, false)));
  }

  async getModel(scope: CompanyScope, modelId: string): Promise<BimModelView> {
    const model = await this.prisma.bimModel.findFirst({ where: { id: modelId, ...scope }, include: { versions: { orderBy: { versionNumber: "desc" } } } });
    if (!model) throw new NotFoundException("BIM model not found");
    return this.modelView(scope, model, true);
  }

  async createModel(scope: CompanyScope, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const projectId = requiredId(input.projectId, "projectId");
    const name = requiredText(input.name, "name", 160);
    const discipline = requiredEnum(input.discipline, "discipline", DISCIPLINES);
    const id = await this.prisma.$transaction(async (tx) => {
      const project = await tx.project.findFirst({ where: { id: projectId, ...scope }, select: { id: true } });
      if (!project) throw new NotFoundException("Project not found");
      const code = await this.numbering.next(tx, scope, "BIM");
      const model = await tx.bimModel.create({ data: { ...scope, code, projectId, name, discipline, createdByUserId: actorUserId } });
      await writeAudit(tx, scope, actorUserId, "bim.model.created", "BimModel", model.id, { code, discipline });
      return model.id;
    });
    return this.getModel(scope, id);
  }

  /**
   * Import : le contenu du fichier est relu et son empreinte recalculee ; si
   * le client annonce l'empreinte calculee de son cote, elle doit concorder.
   */
  async importVersion(scope: CompanyScope, modelId: string, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const fileId = requiredId(input.fileId, "fileId");
    const expected = optionalText(input.expectedSha256, "expectedSha256", 64)?.toLowerCase() ?? null;
    if (expected && !SHA256.test(expected)) throw new BadRequestException("expectedSha256 must be a hexadecimal SHA-256");
    const model = await this.prisma.bimModel.findFirst({ where: { id: modelId, ...scope } });
    if (!model) throw new NotFoundException("BIM model not found");
    const { file, content } = await this.files.content(scope, fileId);
    if (file.mimeType !== "application/x-step") throw new BadRequestException("The file is not an IFC (STEP) file");
    const recomputed = createHash("sha256").update(content).digest("hex");
    if (recomputed !== file.sha256) throw new ConflictException("Stored file integrity check failed: content does not match its fingerprint");
    if (expected && expected !== recomputed) throw new ConflictException(`Fingerprint mismatch: expected ${expected}, received ${recomputed}`);
    let parsed;
    try {
      parsed = parseIfc(content.toString("utf8"));
    } catch (error) {
      if (error instanceof IfcParseError) throw new BadRequestException(`Invalid IFC file: ${error.message}`);
      throw error;
    }
    const summary: BimVersionSummary = {
      spatial: parsed.spatial,
      systems: parsed.systems,
      elementTypes: parsed.elements.reduce<Record<string, number>>((counts, element) => ({ ...counts, [element.ifcType]: (counts[element.ifcType] ?? 0) + 1 }), {}),
      warnings: parsed.warnings,
      projectName: parsed.projectName,
    };
    const versionId = await this.prisma.$transaction(async (tx) => {
      await this.lockModel(tx, scope, modelId);
      const latest = await tx.bimModelVersion.findFirst({ where: { modelId }, orderBy: { versionNumber: "desc" } });
      if (latest?.sha256 === recomputed) throw new ConflictException("This file is identical to the latest version");
      const version = await tx.bimModelVersion.create({
        data: {
          ...scope,
          modelId,
          versionNumber: (latest?.versionNumber ?? 0) + 1,
          fileId,
          sha256: recomputed,
          fileName: optionalText(input.fileName, "fileName", 200) ?? file.originalName,
          schema: parsed.schema,
          application: parsed.application,
          entityCount: parsed.entityCount,
          elementCount: parsed.elements.length,
          summary: summary as unknown as Prisma.InputJsonValue,
          importedByUserId: actorUserId,
        },
      });
      if (parsed.elements.length > 0) {
        await tx.bimElement.createMany({
          data: parsed.elements.map((element) => ({
            ...scope,
            versionId: version.id,
            globalId: element.globalId,
            ifcType: element.ifcType,
            name: element.name,
            description: element.description,
            objectType: element.objectType,
            tag: element.tag,
            storeyName: element.storeyName,
            typeName: element.typeName,
            systems: element.systems,
            classifications: element.classifications,
            properties: element.properties,
            quantities: element.quantities,
          })),
          skipDuplicates: true,
        });
      }
      await writeAudit(tx, scope, actorUserId, "bim.version.imported", "BimModel", modelId, {
        versionNumber: version.versionNumber,
        sha256: recomputed,
        schema: parsed.schema,
        elements: parsed.elements.length,
      });
      return version.id;
    });
    return { model: await this.getModel(scope, modelId), versionId };
  }

  /** Reverification a la demande : relit le fichier et compare a l'empreinte enregistree. */
  async verifyVersion(scope: CompanyScope, versionId: string) {
    const version = await this.prisma.bimModelVersion.findFirst({ where: { id: versionId, ...scope } });
    if (!version) throw new NotFoundException("Version not found");
    const { content } = await this.files.content(scope, version.fileId);
    const recomputed = createHash("sha256").update(content).digest("hex");
    return { versionId, versionNumber: version.versionNumber, sha256: version.sha256, recomputed, verified: recomputed === version.sha256, checkedAt: new Date().toISOString() };
  }

  async decideVersion(scope: CompanyScope, versionId: string, decision: "APPROVED" | "REJECTED", body: unknown, actorUserId: string) {
    const note = optionalText(assertBody(body ?? {}).note, "note", 2000);
    if (decision === "REJECTED" && !note) throw new BadRequestException("A note is required to reject a version");
    const modelId = await this.prisma.$transaction(async (tx) => {
      const version = await tx.bimModelVersion.findFirst({ where: { id: versionId, ...scope } });
      if (!version) throw new NotFoundException("Version not found");
      await this.lockModel(tx, scope, version.modelId);
      if (version.status !== "IMPORTED") throw new BadRequestException("Only an imported version can be decided");
      if (version.importedByUserId === actorUserId) throw new ForbiddenException("A version is approved by someone other than its importer");
      if (decision === "APPROVED") await tx.bimModelVersion.updateMany({ where: { modelId: version.modelId, status: "APPROVED" }, data: { status: "SUPERSEDED" } });
      await tx.bimModelVersion.update({ where: { id: versionId }, data: { status: decision, decidedByUserId: actorUserId, decidedAt: new Date(), decisionNote: note } });
      await writeAudit(tx, scope, actorUserId, decision === "APPROVED" ? "bim.version.approved" : "bim.version.rejected", "BimModel", version.modelId, { versionNumber: version.versionNumber, note });
      return version.modelId;
    });
    return this.getModel(scope, modelId);
  }

  async listElements(scope: CompanyScope, versionId: string, query: Record<string, unknown>): Promise<BimElementView[]> {
    const version = await this.prisma.bimModelVersion.findFirst({ where: { id: versionId, ...scope } });
    if (!version) throw new NotFoundException("Version not found");
    const ifcType = optionalText(query.ifcType, "ifcType", 80)?.toUpperCase();
    const q = optionalText(query.q, "q", 80);
    const elements = await this.prisma.bimElement.findMany({
      where: {
        versionId,
        ...(ifcType ? { ifcType } : {}),
        ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { globalId: { contains: q } }, { tag: { contains: q, mode: "insensitive" } }] } : {}),
      },
      orderBy: [{ ifcType: "asc" }, { name: "asc" }],
      take: 1000,
    });
    const bindings = await this.prisma.equipmentBimBinding.findMany({ where: { ...scope, modelId: version.modelId, globalId: { in: elements.map((element) => element.globalId) } } });
    const equipment = await this.prisma.mepEquipment.findMany({ where: { id: { in: bindings.map((binding) => binding.equipmentId) }, ...scope }, select: { id: true, tag: true, name: true } });
    const equipmentById = new Map(equipment.map((item) => [item.id, item]));
    const byGlobalId = new Map(bindings.map((binding) => [binding.globalId, equipmentById.get(binding.equipmentId) ?? null]));
    return elements.map((element) => ({
      id: element.id,
      globalId: element.globalId,
      ifcType: element.ifcType,
      name: element.name,
      description: element.description,
      objectType: element.objectType,
      tag: element.tag,
      storeyName: element.storeyName,
      typeName: element.typeName,
      systems: element.systems as string[],
      classifications: element.classifications as string[],
      properties: element.properties as Record<string, string>,
      quantities: element.quantities as Record<string, string>,
      equipment: byGlobalId.get(element.globalId) ?? null,
    }));
  }

  /** Comparaison de deux versions par GlobalId (ajouts, suppressions, modifications). */
  async diff(scope: CompanyScope, versionId: string, query: Record<string, unknown>): Promise<BimVersionDiffView> {
    const againstId = requiredId(query.against, "against");
    const [to, from] = await Promise.all([
      this.prisma.bimModelVersion.findFirst({ where: { id: versionId, ...scope } }),
      this.prisma.bimModelVersion.findFirst({ where: { id: againstId, ...scope } }),
    ]);
    if (!to || !from || to.modelId !== from.modelId) throw new NotFoundException("Versions not found in the same model");
    const [toElements, fromElements] = await Promise.all([this.prisma.bimElement.findMany({ where: { versionId: to.id } }), this.prisma.bimElement.findMany({ where: { versionId: from.id } })]);
    const before = new Map(fromElements.map((element) => [element.globalId, element]));
    const after = new Map(toElements.map((element) => [element.globalId, element]));
    const fields = ["ifcType", "name", "storeyName", "typeName", "tag"] as const;
    const changed: BimVersionDiffView["changed"] = [];
    let unchanged = 0;
    for (const [globalId, element] of after) {
      const previous = before.get(globalId);
      if (!previous) continue;
      const diff = fields.filter((field) => element[field] !== previous[field]);
      const propertiesChanged = JSON.stringify(element.properties) !== JSON.stringify(previous.properties);
      if (diff.length || propertiesChanged) changed.push({ globalId, name: element.name, fields: [...diff, ...(propertiesChanged ? ["properties"] : [])] });
      else unchanged += 1;
    }
    const brief = (element: { globalId: string; ifcType: string; name: string | null }) => ({ globalId: element.globalId, ifcType: element.ifcType, name: element.name });
    return {
      fromVersion: from.versionNumber,
      toVersion: to.versionNumber,
      added: [...after.values()].filter((element) => !before.has(element.globalId)).map(brief),
      removed: [...before.values()].filter((element) => !after.has(element.globalId)).map(brief),
      changed,
      unchanged,
    };
  }

  // -------------------------------------------------------------------
  // Liaison equipement MEP <-> element BIM
  // -------------------------------------------------------------------

  async bindEquipment(scope: CompanyScope, modelId: string, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const equipmentId = requiredId(input.equipmentId, "equipmentId");
    const globalId = requiredText(input.globalId, "globalId", 22);
    await this.prisma.$transaction(async (tx) => {
      const model = await tx.bimModel.findFirst({ where: { id: modelId, ...scope } });
      if (!model) throw new NotFoundException("BIM model not found");
      const equipment = await tx.mepEquipment.findFirst({ where: { id: equipmentId, ...scope } });
      if (!equipment || equipment.projectId !== model.projectId) throw new NotFoundException("Equipment not found on the model's project");
      const latest = await tx.bimModelVersion.findFirst({ where: { modelId }, orderBy: { versionNumber: "desc" } });
      const element = latest ? await tx.bimElement.findFirst({ where: { versionId: latest.id, globalId } }) : null;
      if (!element) throw new NotFoundException("Element not found in the latest version of the model");
      const taken = await tx.equipmentBimBinding.findFirst({ where: { modelId, globalId, NOT: { equipmentId } } });
      if (taken) throw new ConflictException("This element is already bound to another equipment");
      await tx.equipmentBimBinding.upsert({
        where: { equipmentId_modelId: { equipmentId, modelId } },
        create: { ...scope, equipmentId, modelId, globalId, boundByUserId: actorUserId },
        update: { globalId, boundByUserId: actorUserId },
      });
      await writeAudit(tx, scope, actorUserId, "bim.equipment.bound", "BimModel", modelId, { equipmentId, tag: equipment.tag, globalId, ifcType: element.ifcType });
    });
    return this.listElements(scope, (await this.latestVersion(scope, modelId)).id, {});
  }

  /** Passeport BIM d'un equipement : ses liaisons et l'element dans la derniere version de chaque maquette. */
  async equipmentBindings(scope: CompanyScope, equipmentId: string) {
    const bindings = await this.prisma.equipmentBimBinding.findMany({ where: { ...scope, equipmentId } });
    return Promise.all(
      bindings.map(async (binding) => {
        const model = await this.prisma.bimModel.findFirst({ where: { id: binding.modelId, ...scope }, select: { id: true, code: true, name: true } });
        const latest = await this.prisma.bimModelVersion.findFirst({ where: { modelId: binding.modelId }, orderBy: { versionNumber: "desc" } });
        const element = latest ? await this.prisma.bimElement.findFirst({ where: { versionId: latest.id, globalId: binding.globalId } }) : null;
        return {
          modelId: binding.modelId,
          modelCode: model?.code ?? null,
          modelName: model?.name ?? null,
          globalId: binding.globalId,
          versionNumber: latest?.versionNumber ?? null,
          presentInLatestVersion: element !== null,
          ifcType: element?.ifcType ?? null,
          name: element?.name ?? null,
          storeyName: element?.storeyName ?? null,
        };
      }),
    );
  }

  // -------------------------------------------------------------------
  // Conflits de synthese
  // -------------------------------------------------------------------

  async listClashes(scope: CompanyScope, modelId: string): Promise<BimClashView[]> {
    const clashes = await this.prisma.bimClash.findMany({ where: { ...scope, modelId }, include: { comments: { orderBy: { createdAt: "asc" } } }, orderBy: [{ status: "asc" }, { createdAt: "desc" }] });
    return this.clashViews(scope, clashes);
  }

  async createClash(scope: CompanyScope, modelId: string, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const elementA = requiredText(input.elementAGlobalId, "elementAGlobalId", 22);
    const elementB = requiredText(input.elementBGlobalId, "elementBGlobalId", 22);
    const description = requiredText(input.description, "description", 2000);
    if (elementA === elementB) throw new BadRequestException("A clash involves two distinct elements");
    await this.prisma.$transaction(async (tx) => {
      const version = await this.latestVersionTx(tx, scope, modelId);
      const found = await tx.bimElement.count({ where: { versionId: version.id, globalId: { in: [elementA, elementB] } } });
      if (found !== 2) throw new NotFoundException("Both elements must exist in the latest version");
      const code = await this.numbering.next(tx, scope, "CLASH");
      const clash = await tx.bimClash.create({
        data: { ...scope, code, modelId, versionId: version.id, elementAGlobalId: elementA, elementBGlobalId: elementB, description, createdByUserId: actorUserId },
      });
      await writeAudit(tx, scope, actorUserId, "bim.clash.created", "BimClash", clash.id, { code, elementA, elementB });
    });
    return this.listClashes(scope, modelId);
  }

  async commentClash(scope: CompanyScope, clashId: string, body: unknown, actorUserId: string) {
    const text = requiredText(assertBody(body).body, "body", 2000);
    const clash = await this.prisma.bimClash.findFirst({ where: { id: clashId, ...scope } });
    if (!clash) throw new NotFoundException("Clash not found");
    await this.prisma.bimClashComment.create({ data: { ...scope, clashId, authorUserId: actorUserId, body: text } });
    return this.listClashes(scope, clash.modelId);
  }

  async proposeResolution(scope: CompanyScope, clashId: string, body: unknown, actorUserId: string) {
    const proposal = requiredText(assertBody(body).proposal, "proposal", 2000);
    const modelId = await this.prisma.$transaction(async (tx) => {
      const clash = await tx.bimClash.findFirst({ where: { id: clashId, ...scope } });
      if (!clash) throw new NotFoundException("Clash not found");
      if (clash.status !== "OPEN") throw new BadRequestException("A resolution is proposed on an open clash");
      await tx.bimClash.update({ where: { id: clashId }, data: { status: "RESOLUTION_PROPOSED", proposal, proposedByUserId: actorUserId, proposedAt: new Date() } });
      await writeAudit(tx, scope, actorUserId, "bim.clash.proposed", "BimClash", clashId, { proposal });
      return clash.modelId;
    });
    return this.listClashes(scope, modelId);
  }

  /** Approbation (resolu) ou refus (retour a ouvert) par une personne distincte du proposant. */
  async decideClash(scope: CompanyScope, clashId: string, approve: boolean, body: unknown, actorUserId: string) {
    const note = optionalText(assertBody(body ?? {}).note, "note", 2000);
    if (!approve && !note) throw new BadRequestException("A note is required to refuse a resolution");
    const modelId = await this.prisma.$transaction(async (tx) => {
      const clash = await tx.bimClash.findFirst({ where: { id: clashId, ...scope } });
      if (!clash) throw new NotFoundException("Clash not found");
      if (clash.status !== "RESOLUTION_PROPOSED") throw new BadRequestException("No resolution to decide");
      if (clash.proposedByUserId === actorUserId) throw new ForbiddenException("A resolution is approved by someone other than its proposer");
      await tx.bimClash.update({
        where: { id: clashId },
        data: approve
          ? { status: "RESOLVED", resolvedByUserId: actorUserId, resolvedAt: new Date(), resolutionNote: note }
          : { status: "OPEN", proposal: null, proposedByUserId: null, proposedAt: null },
      });
      if (!approve) await tx.bimClashComment.create({ data: { ...scope, clashId, authorUserId: actorUserId, body: `Résolution refusée : ${note}` } });
      await writeAudit(tx, scope, actorUserId, approve ? "bim.clash.resolved" : "bim.clash.reopened", "BimClash", clashId, { note });
      return clash.modelId;
    });
    return this.listClashes(scope, modelId);
  }

  // -------------------------------------------------------------------
  // Internes
  // -------------------------------------------------------------------

  private async latestVersion(scope: CompanyScope, modelId: string) {
    const version = await this.prisma.bimModelVersion.findFirst({ where: { modelId, ...scope }, orderBy: { versionNumber: "desc" } });
    if (!version) throw new BadRequestException("The model has no imported version");
    return version;
  }

  private async latestVersionTx(tx: Tx, scope: CompanyScope, modelId: string) {
    const model = await tx.bimModel.findFirst({ where: { id: modelId, ...scope }, select: { id: true } });
    if (!model) throw new NotFoundException("BIM model not found");
    const version = await tx.bimModelVersion.findFirst({ where: { modelId }, orderBy: { versionNumber: "desc" } });
    if (!version) throw new BadRequestException("The model has no imported version");
    return version;
  }

  private async lockModel(tx: Tx, scope: CompanyScope, modelId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "bim_models"
      WHERE "id" = ${modelId} AND "organizationId" = ${scope.organizationId} AND "companyId" = ${scope.companyId}
      FOR UPDATE
    `;
    if (rows.length === 0) throw new NotFoundException("BIM model not found");
  }

  private async modelView(scope: CompanyScope, model: Prisma.BimModelGetPayload<{ include: { versions: true } }>, detailed: boolean): Promise<BimModelView> {
    const userIds = [...new Set(model.versions.flatMap((version) => [version.importedByUserId, version.decidedByUserId]).filter((id): id is string => Boolean(id)))];
    const [users, project, openClashes] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: userIds }, organizationId: scope.organizationId }, select: { id: true, fullName: true } }),
      this.prisma.project.findFirst({ where: { id: model.projectId, ...scope }, select: { code: true } }),
      this.prisma.bimClash.count({ where: { ...scope, modelId: model.id, status: { not: "RESOLVED" } } }),
    ]);
    const names = new Map(users.map((user) => [user.id, user.fullName]));
    const versionView = (version: VersionRow): BimVersionView => ({
      id: version.id,
      versionNumber: version.versionNumber,
      fileId: version.fileId,
      fileUrl: `/api/v1/files/${version.fileId}/content`,
      fileName: version.fileName,
      sha256: version.sha256,
      schema: version.schema,
      application: version.application,
      entityCount: version.entityCount,
      elementCount: version.elementCount,
      status: version.status,
      importedByName: names.get(version.importedByUserId) ?? "—",
      importedByUserId: version.importedByUserId,
      importedAt: version.importedAt.toISOString(),
      decidedByName: version.decidedByUserId ? (names.get(version.decidedByUserId) ?? "—") : null,
      decidedAt: version.decidedAt?.toISOString() ?? null,
      decisionNote: version.decisionNote,
      summary: version.summary as unknown as BimVersionSummary,
    });
    const latest = model.versions[0];
    return {
      id: model.id,
      code: model.code,
      projectId: model.projectId,
      projectCode: project?.code ?? null,
      name: model.name,
      discipline: model.discipline,
      createdAt: model.createdAt.toISOString(),
      latestVersion: latest ? versionView(latest) : null,
      approvedVersionNumber: model.versions.find((version) => version.status === "APPROVED")?.versionNumber ?? null,
      versionCount: model.versions.length,
      openClashes,
      ...(detailed ? { versions: model.versions.map(versionView) } : {}),
    };
  }

  private async clashViews(scope: CompanyScope, clashes: Prisma.BimClashGetPayload<{ include: { comments: true } }>[]): Promise<BimClashView[]> {
    const versionIds = [...new Set(clashes.map((clash) => clash.versionId))];
    const [versions, elements, users] = await Promise.all([
      this.prisma.bimModelVersion.findMany({ where: { id: { in: versionIds } }, select: { id: true, versionNumber: true } }),
      this.prisma.bimElement.findMany({
        where: { versionId: { in: versionIds }, globalId: { in: clashes.flatMap((clash) => [clash.elementAGlobalId, clash.elementBGlobalId]) } },
        select: { versionId: true, globalId: true, ifcType: true, name: true },
      }),
      this.prisma.user.findMany({
        where: {
          organizationId: scope.organizationId,
          id: { in: [...new Set(clashes.flatMap((clash) => [clash.createdByUserId, clash.proposedByUserId, clash.resolvedByUserId, ...clash.comments.map((comment) => comment.authorUserId)]).filter((id): id is string => Boolean(id)))] },
        },
        select: { id: true, fullName: true },
      }),
    ]);
    const versionNumber = new Map(versions.map((version) => [version.id, version.versionNumber]));
    const element = (versionId: string, globalId: string) => {
      const found = elements.find((candidate) => candidate.versionId === versionId && candidate.globalId === globalId);
      return { globalId, ifcType: found?.ifcType ?? null, name: found?.name ?? null };
    };
    const names = new Map(users.map((user) => [user.id, user.fullName]));
    return clashes.map((clash) => ({
      id: clash.id,
      code: clash.code,
      modelId: clash.modelId,
      versionNumber: versionNumber.get(clash.versionId) ?? 0,
      elementA: element(clash.versionId, clash.elementAGlobalId),
      elementB: element(clash.versionId, clash.elementBGlobalId),
      description: clash.description,
      status: clash.status,
      proposal: clash.proposal,
      proposedByUserId: clash.proposedByUserId,
      proposedByName: clash.proposedByUserId ? (names.get(clash.proposedByUserId) ?? "—") : null,
      proposedAt: clash.proposedAt?.toISOString() ?? null,
      resolvedByName: clash.resolvedByUserId ? (names.get(clash.resolvedByUserId) ?? "—") : null,
      resolvedAt: clash.resolvedAt?.toISOString() ?? null,
      resolutionNote: clash.resolutionNote,
      createdByName: names.get(clash.createdByUserId) ?? "—",
      createdAt: clash.createdAt.toISOString(),
      comments: clash.comments.map((comment) => ({ id: comment.id, authorName: names.get(comment.authorUserId) ?? "—", body: comment.body, createdAt: comment.createdAt.toISOString() })),
    }));
  }
}
