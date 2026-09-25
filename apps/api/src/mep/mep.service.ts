import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type {
  CalculationCatalogView,
  CalculationRevisionView,
  CalculationValue,
  EngineeringCalculationView,
  MepEquipmentView,
  MepSystemView,
} from "@axora24/contracts";
import { Prisma } from "@axora24/database";
import { PrismaService } from "../core/prisma.service.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import { NumberingService } from "../common/numbering.service.js";
import { writeAudit } from "../common/audit.js";
import { assertBody, optionalEnum, optionalId, optionalInt, optionalText, requiredEnum, requiredId, requiredText } from "../common/validation.js";
import { CALCULATIONS, KERNEL_VERSION, NOT_COVERED, findCalculation, runCalculation } from "./calculation-kernel.js";

type Tx = Prisma.TransactionClient;

const DISCIPLINES = ["HVAC", "ELECTRICAL", "LOW_CURRENT", "PLUMBING", "FIRE_PROTECTION"] as const;
/** Transitions manuelles ; COMMISSIONED n'est pose que par le commissioning (INC-12). */
const MANUAL_STATUSES = ["SPECIFIED", "SELECTED", "INSTALLED"] as const;

const equipmentInclude = { system: { select: { code: true } } } satisfies Prisma.MepEquipmentInclude;
type EquipmentRow = Prisma.MepEquipmentGetPayload<{ include: typeof equipmentInclude }>;
type RevisionRow = Prisma.EngineeringCalculationRevisionGetPayload<object>;
type CalculationRow = Prisma.EngineeringCalculationGetPayload<{ include: { revisions: true } }>;

/**
 * INC-13 — MEP (docs/foundation/02-domain-model.md BC-13) : systemes par
 * discipline, equipements (identite de reference), notes de calcul
 * revisionnees et validees par un autre ingenieur, quantitatifs.
 */
@Injectable()
export class MepService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
  ) {}

  catalog(): CalculationCatalogView {
    return {
      kernelVersion: KERNEL_VERSION,
      types: CALCULATIONS.map(({ compute: _compute, ...definition }) => definition),
      notCovered: NOT_COVERED,
    };
  }

  // -------------------------------------------------------------------
  // Systemes et equipements
  // -------------------------------------------------------------------

  async listSystems(scope: CompanyScope, query: Record<string, unknown>): Promise<MepSystemView[]> {
    const projectId = requiredId(query.projectId, "projectId");
    const systems = await this.prisma.mepSystem.findMany({
      where: { ...scope, projectId },
      include: { _count: { select: { equipment: true } } },
      orderBy: [{ discipline: "asc" }, { code: "asc" }],
    });
    return systems.map((system) => ({
      id: system.id,
      projectId: system.projectId,
      code: system.code,
      name: system.name,
      discipline: system.discipline,
      description: system.description,
      equipmentCount: system._count.equipment,
    }));
  }

  async createSystem(scope: CompanyScope, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const projectId = requiredId(input.projectId, "projectId");
    const code = requiredText(input.code, "code", 30).toUpperCase();
    const name = requiredText(input.name, "name", 160);
    const discipline = requiredEnum(input.discipline, "discipline", DISCIPLINES);
    await this.prisma.$transaction(async (tx) => {
      await this.requireProject(tx, scope, projectId);
      const duplicate = await tx.mepSystem.findFirst({ where: { projectId, code }, select: { id: true } });
      if (duplicate) throw new ConflictException(`System "${code}" already exists on this project`);
      const system = await tx.mepSystem.create({ data: { ...scope, projectId, code, name, discipline, description: optionalText(input.description, "description", 1000) } });
      await writeAudit(tx, scope, actorUserId, "mep.system.created", "MepSystem", system.id, { code, discipline });
    });
    return this.listSystems(scope, { projectId });
  }

  async listEquipment(scope: CompanyScope, query: Record<string, unknown>): Promise<MepEquipmentView[]> {
    const projectId = optionalId(query.projectId, "projectId");
    const systemId = optionalId(query.systemId, "systemId");
    const status = optionalEnum(query.status, "status", ["SPECIFIED", "SELECTED", "INSTALLED", "COMMISSIONED"] as const);
    const rows = await this.prisma.mepEquipment.findMany({
      where: { ...scope, ...(projectId ? { projectId } : {}), ...(systemId ? { systemId } : {}), ...(status ? { status } : {}) },
      include: equipmentInclude,
      orderBy: [{ discipline: "asc" }, { tag: "asc" }],
      take: 500,
    });
    const context = await this.equipmentContext(scope, rows);
    return rows.map((row) => this.equipmentView(row, context));
  }

  async getEquipment(scope: CompanyScope, equipmentId: string): Promise<MepEquipmentView> {
    const row = await this.prisma.mepEquipment.findFirst({ where: { id: equipmentId, ...scope }, include: equipmentInclude });
    if (!row) throw new NotFoundException("Equipment not found");
    const context = await this.equipmentContext(scope, [row]);
    const calculations = await this.prisma.engineeringCalculation.findMany({ where: { ...scope, equipmentId }, select: { id: true }, orderBy: { createdAt: "asc" } });
    return { ...this.equipmentView(row, context), calculations: await Promise.all(calculations.map((calculation) => this.getCalculation(scope, calculation.id, false))) };
  }

  async createEquipment(scope: CompanyScope, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const systemId = requiredId(input.systemId, "systemId");
    const tag = requiredText(input.tag, "tag", 40).toUpperCase();
    const name = requiredText(input.name, "name", 200);
    const specs = this.parseSpecs(input.specs);
    const quantity = optionalInt(input.quantity, "quantity", { min: 1, max: 100000 }) ?? 1;
    const technicalDocumentId = optionalId(input.technicalDocumentId, "technicalDocumentId");
    const id = await this.prisma.$transaction(async (tx) => {
      const system = await tx.mepSystem.findFirst({ where: { id: systemId, ...scope } });
      if (!system) throw new NotFoundException("System not found");
      const duplicate = await tx.mepEquipment.findFirst({ where: { projectId: system.projectId, tag }, select: { id: true } });
      if (duplicate) throw new ConflictException(`Tag "${tag}" is already used on this project`);
      if (technicalDocumentId) await this.requireDocument(tx, scope, technicalDocumentId);
      const equipment = await tx.mepEquipment.create({
        data: {
          ...scope,
          projectId: system.projectId,
          systemId,
          tag,
          name,
          discipline: system.discipline,
          manufacturer: optionalText(input.manufacturer, "manufacturer", 120),
          model: optionalText(input.model, "model", 120),
          location: optionalText(input.location, "location", 160),
          quantity,
          specs,
          technicalDocumentId,
          createdByUserId: actorUserId,
        },
      });
      await writeAudit(tx, scope, actorUserId, "mep.equipment.created", "MepEquipment", equipment.id, { tag, systemId });
      return equipment.id;
    });
    return this.getEquipment(scope, id);
  }

  async updateEquipment(scope: CompanyScope, equipmentId: string, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const status = optionalEnum(input.status, "status", MANUAL_STATUSES);
    await this.prisma.$transaction(async (tx) => {
      const equipment = await tx.mepEquipment.findFirst({ where: { id: equipmentId, ...scope } });
      if (!equipment) throw new NotFoundException("Equipment not found");
      if (equipment.status === "COMMISSIONED") throw new BadRequestException("A commissioned equipment is managed as an asset (GMAO)");
      const technicalDocumentId = input.technicalDocumentId === undefined ? undefined : optionalId(input.technicalDocumentId, "technicalDocumentId");
      if (technicalDocumentId) await this.requireDocument(tx, scope, technicalDocumentId);
      await tx.mepEquipment.update({
        where: { id: equipmentId },
        data: {
          ...(status ? { status } : {}),
          ...(input.specs !== undefined ? { specs: this.parseSpecs(input.specs) } : {}),
          ...(input.manufacturer !== undefined ? { manufacturer: optionalText(input.manufacturer, "manufacturer", 120) } : {}),
          ...(input.model !== undefined ? { model: optionalText(input.model, "model", 120) } : {}),
          ...(input.location !== undefined ? { location: optionalText(input.location, "location", 160) } : {}),
          ...(technicalDocumentId !== undefined ? { technicalDocumentId } : {}),
        },
      });
      await writeAudit(tx, scope, actorUserId, "mep.equipment.updated", "MepEquipment", equipmentId, { status, from: equipment.status });
    });
    return this.getEquipment(scope, equipmentId);
  }

  /** Quantitatif : equipements par systeme et par discipline (quantites declarees). */
  async quantities(scope: CompanyScope, query: Record<string, unknown>) {
    const projectId = requiredId(query.projectId, "projectId");
    const rows = await this.prisma.mepEquipment.groupBy({
      by: ["systemId", "discipline", "status"],
      where: { ...scope, projectId },
      _sum: { quantity: true },
      _count: { _all: true },
    });
    const systems = await this.prisma.mepSystem.findMany({ where: { ...scope, projectId }, select: { id: true, code: true, name: true } });
    const byId = new Map(systems.map((system) => [system.id, system]));
    return rows.map((row) => ({
      systemId: row.systemId,
      systemCode: byId.get(row.systemId)?.code ?? "—",
      systemName: byId.get(row.systemId)?.name ?? "—",
      discipline: row.discipline,
      status: row.status,
      references: row._count._all,
      quantity: row._sum.quantity ?? 0,
    }));
  }

  // -------------------------------------------------------------------
  // Notes de calcul
  // -------------------------------------------------------------------

  async listCalculations(scope: CompanyScope, query: Record<string, unknown>): Promise<EngineeringCalculationView[]> {
    const projectId = optionalId(query.projectId, "projectId");
    const calculations = await this.prisma.engineeringCalculation.findMany({
      where: { ...scope, ...(projectId ? { projectId } : {}) },
      select: { id: true },
      orderBy: { createdAt: "desc" },
      take: 300,
    });
    return Promise.all(calculations.map((calculation) => this.getCalculation(scope, calculation.id, false)));
  }

  async getCalculation(scope: CompanyScope, calculationId: string, withHistory = true): Promise<EngineeringCalculationView> {
    const calculation = await this.prisma.engineeringCalculation.findFirst({
      where: { id: calculationId, ...scope },
      include: { revisions: { orderBy: { revision: "desc" } } },
    });
    if (!calculation) throw new NotFoundException("Calculation not found");
    return this.calculationView(scope, calculation, withHistory);
  }

  /** Le serveur execute le calcul : le client ne fournit jamais un resultat. */
  async createCalculation(scope: CompanyScope, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const projectId = requiredId(input.projectId, "projectId");
    const calcType = requiredText(input.calcType, "calcType", 80);
    findCalculation(calcType);
    const title = requiredText(input.title, "title", 200);
    const systemId = optionalId(input.systemId, "systemId");
    const equipmentId = optionalId(input.equipmentId, "equipmentId");
    const result = runCalculation(calcType, input.inputs);
    const id = await this.prisma.$transaction(async (tx) => {
      await this.requireProject(tx, scope, projectId);
      if (systemId) {
        const system = await tx.mepSystem.findFirst({ where: { id: systemId, projectId, ...scope }, select: { id: true } });
        if (!system) throw new NotFoundException("System not found on this project");
      }
      if (equipmentId) {
        const equipment = await tx.mepEquipment.findFirst({ where: { id: equipmentId, projectId, ...scope }, select: { id: true } });
        if (!equipment) throw new NotFoundException("Equipment not found on this project");
      }
      const code = await this.numbering.next(tx, scope, "CALC");
      const calculation = await tx.engineeringCalculation.create({
        data: {
          ...scope,
          code,
          projectId,
          systemId,
          equipmentId,
          calcType,
          title,
          createdByUserId: actorUserId,
          revisions: {
            create: {
              revision: 1,
              inputs: result.inputs,
              outputs: result.outputs,
              formula: result.formula,
              substitution: result.substitution,
              assumptions: result.assumptions,
              sources: optionalText(input.sources, "sources", 2000),
              notes: optionalText(input.notes, "notes", 4000),
              kernelVersion: result.kernelVersion,
              authorUserId: actorUserId,
            },
          },
        },
      });
      await writeAudit(tx, scope, actorUserId, "mep.calculation.created", "EngineeringCalculation", calculation.id, { code, calcType, outputs: result.outputs });
      return calculation.id;
    });
    return this.getCalculation(scope, id);
  }

  /** Changement d'hypothese = nouvelle revision (la precedente reste consultable, intacte). */
  async reviseCalculation(scope: CompanyScope, calculationId: string, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    await this.prisma.$transaction(async (tx) => {
      const calculation = await this.lockCalculation(tx, scope, calculationId);
      const result = runCalculation(calculation.calcType, input.inputs);
      const latest = await tx.engineeringCalculationRevision.findFirstOrThrow({ where: { calculationId }, orderBy: { revision: "desc" } });
      if (latest.status === "DRAFT") await tx.engineeringCalculationRevision.update({ where: { id: latest.id }, data: { status: "SUPERSEDED" } });
      const revision = latest.revision + 1;
      await tx.engineeringCalculationRevision.create({
        data: {
          ...scope,
          calculationId,
          revision,
          inputs: result.inputs,
          outputs: result.outputs,
          formula: result.formula,
          substitution: result.substitution,
          assumptions: result.assumptions,
          sources: optionalText(input.sources, "sources", 2000),
          notes: requiredText(input.notes, "notes", 4000),
          kernelVersion: result.kernelVersion,
          authorUserId: actorUserId,
        },
      });
      await tx.engineeringCalculation.update({ where: { id: calculationId }, data: { currentRevision: revision } });
      await writeAudit(tx, scope, actorUserId, "mep.calculation.revised", "EngineeringCalculation", calculationId, { revision, outputs: result.outputs });
    });
    return this.getCalculation(scope, calculationId);
  }

  /** Validation par un ingenieur distinct de l'auteur de la revision. */
  async validateCalculation(scope: CompanyScope, calculationId: string, body: unknown, actorUserId: string) {
    const note = optionalText(assertBody(body ?? {}).note, "note", 2000);
    await this.prisma.$transaction(async (tx) => {
      await this.lockCalculation(tx, scope, calculationId);
      const latest = await tx.engineeringCalculationRevision.findFirstOrThrow({ where: { calculationId }, orderBy: { revision: "desc" } });
      if (latest.status !== "DRAFT") throw new BadRequestException("Only the current draft revision can be validated");
      if (latest.authorUserId === actorUserId) throw new ForbiddenException("A calculation is validated by an engineer other than its author");
      if (!latest.sources) throw new BadRequestException("Cite the sources of the input values before validation");
      await tx.engineeringCalculationRevision.updateMany({ where: { calculationId, status: "VALIDATED" }, data: { status: "SUPERSEDED" } });
      await tx.engineeringCalculationRevision.update({
        where: { id: latest.id },
        data: { status: "VALIDATED", validatedByUserId: actorUserId, validatedAt: new Date(), validationNote: note },
      });
      await writeAudit(tx, scope, actorUserId, "mep.calculation.validated", "EngineeringCalculation", calculationId, { revision: latest.revision, note });
    });
    return this.getCalculation(scope, calculationId);
  }

  // -------------------------------------------------------------------
  // Internes
  // -------------------------------------------------------------------

  private parseSpecs(value: unknown): Array<{ name: string; value: string; unit: string }> {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || value.length > 60) throw new BadRequestException("specs must be an array (60 entries max)");
    return value.map((raw, index) => {
      const spec = assertBody(raw);
      return {
        name: requiredText(spec.name, `specs[${index}].name`, 80),
        value: requiredText(spec.value, `specs[${index}].value`, 80),
        unit: optionalText(spec.unit, `specs[${index}].unit`, 20) ?? "",
      };
    });
  }

  private async equipmentContext(scope: CompanyScope, rows: EquipmentRow[]) {
    const projectIds = [...new Set(rows.map((row) => row.projectId))];
    const documentIds = [...new Set(rows.map((row) => row.technicalDocumentId).filter((id): id is string => Boolean(id)))];
    const [projects, documents] = await Promise.all([
      projectIds.length ? this.prisma.project.findMany({ where: { id: { in: projectIds }, ...scope }, select: { id: true, code: true } }) : [],
      documentIds.length ? this.prisma.managedDocument.findMany({ where: { id: { in: documentIds }, ...scope }, select: { id: true, code: true } }) : [],
    ]);
    return { projects: new Map(projects.map((row) => [row.id, row.code])), documents: new Map(documents.map((row) => [row.id, row.code])) };
  }

  private equipmentView(row: EquipmentRow, context: Awaited<ReturnType<MepService["equipmentContext"]>>): MepEquipmentView {
    return {
      id: row.id,
      projectId: row.projectId,
      projectCode: context.projects.get(row.projectId) ?? null,
      systemId: row.systemId,
      systemCode: row.system.code,
      tag: row.tag,
      name: row.name,
      discipline: row.discipline,
      manufacturer: row.manufacturer,
      model: row.model,
      location: row.location,
      quantity: row.quantity,
      specs: row.specs as Array<{ name: string; value: string; unit: string }>,
      status: row.status,
      technicalDocumentId: row.technicalDocumentId,
      technicalDocumentCode: row.technicalDocumentId ? (context.documents.get(row.technicalDocumentId) ?? null) : null,
    };
  }

  private async calculationView(scope: CompanyScope, calculation: CalculationRow, withHistory: boolean): Promise<EngineeringCalculationView> {
    const userIds = [...new Set(calculation.revisions.flatMap((revision) => [revision.authorUserId, revision.validatedByUserId]).filter((id): id is string => Boolean(id)))];
    const [users, project, system, equipment] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: userIds }, organizationId: scope.organizationId }, select: { id: true, fullName: true } }),
      this.prisma.project.findFirst({ where: { id: calculation.projectId, ...scope }, select: { code: true } }),
      calculation.systemId ? this.prisma.mepSystem.findFirst({ where: { id: calculation.systemId, ...scope }, select: { code: true } }) : null,
      calculation.equipmentId ? this.prisma.mepEquipment.findFirst({ where: { id: calculation.equipmentId, ...scope }, select: { tag: true } }) : null,
    ]);
    const names = new Map(users.map((user) => [user.id, user.fullName]));
    const revisionView = (revision: RevisionRow): CalculationRevisionView => ({
      id: revision.id,
      revision: revision.revision,
      inputs: revision.inputs as unknown as CalculationValue[],
      outputs: revision.outputs as unknown as CalculationValue[],
      formula: revision.formula,
      substitution: revision.substitution,
      assumptions: revision.assumptions as string[],
      sources: revision.sources,
      notes: revision.notes,
      kernelVersion: revision.kernelVersion,
      status: revision.status,
      authorUserId: revision.authorUserId,
      authorName: names.get(revision.authorUserId) ?? "—",
      validatedByName: revision.validatedByUserId ? (names.get(revision.validatedByUserId) ?? "—") : null,
      validatedAt: revision.validatedAt?.toISOString() ?? null,
      validationNote: revision.validationNote,
      createdAt: revision.createdAt.toISOString(),
    });
    const current = calculation.revisions[0]!;
    const validated = calculation.revisions.find((revision) => revision.status === "VALIDATED");
    return {
      id: calculation.id,
      code: calculation.code,
      projectId: calculation.projectId,
      projectCode: project?.code ?? null,
      systemId: calculation.systemId,
      systemCode: system?.code ?? null,
      equipmentId: calculation.equipmentId,
      equipmentTag: equipment?.tag ?? null,
      calcType: calculation.calcType,
      calcTitle: CALCULATIONS.find((definition) => definition.type === calculation.calcType)?.title ?? calculation.calcType,
      title: calculation.title,
      currentRevision: calculation.currentRevision,
      validatedRevision: validated?.revision ?? null,
      current: revisionView(current),
      ...(withHistory ? { revisions: calculation.revisions.map(revisionView) } : {}),
    };
  }

  private async lockCalculation(tx: Tx, scope: CompanyScope, calculationId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "engineering_calculations"
      WHERE "id" = ${calculationId} AND "organizationId" = ${scope.organizationId} AND "companyId" = ${scope.companyId}
      FOR UPDATE
    `;
    if (rows.length === 0) throw new NotFoundException("Calculation not found");
    return tx.engineeringCalculation.findUniqueOrThrow({ where: { id: calculationId } });
  }

  private async requireProject(tx: Tx, scope: CompanyScope, projectId: string) {
    const project = await tx.project.findFirst({ where: { id: projectId, ...scope }, select: { id: true } });
    if (!project) throw new NotFoundException("Project not found");
  }

  private async requireDocument(tx: Tx, scope: CompanyScope, documentId: string) {
    const document = await tx.managedDocument.findFirst({ where: { id: documentId, ...scope }, select: { id: true } });
    if (!document) throw new NotFoundException("Technical document not found");
  }
}
