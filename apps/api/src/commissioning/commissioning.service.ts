import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { CommissioningActivityView, CommissioningMeasurement, CommissioningStage } from "@axora24/contracts";
import { Prisma } from "@axora24/database";
import { PrismaService } from "../core/prisma.service.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import { NumberingService } from "../common/numbering.service.js";
import { writeAudit } from "../common/audit.js";
import { assertBody, optionalDecimal, optionalId, optionalText, requiredEnum, requiredId, requiredText } from "../common/validation.js";

type Tx = Prisma.TransactionClient;

const TEST_KINDS = ["PRECOMMISSIONING", "FUNCTIONAL", "RETEST"] as const;
const SEVERITIES = ["MINOR", "MAJOR", "CRITICAL"] as const;

const activityInclude = {
  equipment: { select: { tag: true, name: true, system: { select: { code: true } } } },
  tests: { orderBy: { sequence: "asc" as const } },
  punchItems: { orderBy: { createdAt: "asc" as const } },
  documents: true,
} satisfies Prisma.CommissioningActivityInclude;
type ActivityRow = Prisma.CommissioningActivityGetPayload<{ include: typeof activityInclude }>;

/**
 * Etat de la sequence deduit des faits (essais, anomalies) — la meme logique
 * que le trigger `commissioning_activities_sequence`, exposee pour l'interface.
 */
export function sequenceState(activity: {
  status: string;
  tests: Array<{ kind: string; outcome: string; performedAt: Date }>;
  punchItems: Array<{ status: string; correctedAt: Date | null }>;
}): { stage: CommissioningStage; blockers: string[] } {
  if (activity.status === "HANDED_OVER") return { stage: "HANDED_OVER", blockers: [] };
  if (activity.status === "ACCEPTED") return { stage: "ACCEPTED", blockers: [] };
  const blockers: string[] = [];
  const precommissioned = activity.tests.some((test) => test.kind === "PRECOMMISSIONING" && test.outcome === "PASS");
  const functional = activity.tests.some((test) => (test.kind === "FUNCTIONAL" || test.kind === "RETEST") && test.outcome === "PASS");
  const open = activity.punchItems.filter((item) => item.status === "OPEN").length;
  const corrected = activity.punchItems.filter((item) => item.status === "CORRECTED").length;
  const lastCorrection = activity.punchItems.reduce<Date | null>((latest, item) => (item.correctedAt && (!latest || item.correctedAt > latest) ? item.correctedAt : latest), null);
  const retested = lastCorrection === null || activity.tests.some((test) => test.kind === "RETEST" && test.outcome === "PASS" && test.performedAt > lastCorrection);
  if (!precommissioned) blockers.push("Précommissioning non réussi");
  if (!functional) blockers.push("Aucun essai fonctionnel réussi");
  if (open > 0) blockers.push(`${open} anomalie(s) à corriger`);
  if (corrected > 0) blockers.push(`${corrected} correction(s) à confirmer par un retest`);
  if (open === 0 && corrected === 0 && !retested) blockers.push("Retest réussi exigé après la dernière correction");
  let stage: CommissioningStage;
  if (!precommissioned) stage = "PRECOMMISSIONING";
  else if (open > 0) stage = "CORRECTIONS";
  else if (corrected > 0 || !retested) stage = "RETEST";
  else if (!functional) stage = "FUNCTIONAL_TEST";
  else stage = "READY_FOR_ACCEPTANCE";
  return { stage, blockers };
}

/**
 * INC-12 — Commissioning (docs/foundation/02-domain-model.md BC-12) :
 * Equipement -> Essai -> Anomalie -> Correction -> Retest -> Acceptation
 * (backlog §5.9), puis remise au client avec DOE.
 */
@Injectable()
export class CommissioningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
  ) {}

  async list(scope: CompanyScope, query: Record<string, unknown>): Promise<CommissioningActivityView[]> {
    const projectId = optionalId(query.projectId, "projectId");
    const activities = await this.prisma.commissioningActivity.findMany({
      where: { ...scope, ...(projectId ? { projectId } : {}) },
      include: activityInclude,
      orderBy: { createdAt: "desc" },
      take: 300,
    });
    const context = await this.context(scope, activities);
    return activities.map((activity) => this.view(activity, context, false));
  }

  async get(scope: CompanyScope, activityId: string): Promise<CommissioningActivityView> {
    const activity = await this.prisma.commissioningActivity.findFirst({ where: { id: activityId, ...scope }, include: activityInclude });
    if (!activity) throw new NotFoundException("Commissioning activity not found");
    const context = await this.context(scope, [activity]);
    return this.view(activity, context, true);
  }

  async create(scope: CompanyScope, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const equipmentId = requiredId(input.equipmentId, "equipmentId");
    const procedure = requiredText(input.procedure, "procedure", 8000);
    const id = await this.prisma.$transaction(async (tx) => {
      const equipment = await tx.mepEquipment.findFirst({ where: { id: equipmentId, ...scope } });
      if (!equipment) throw new NotFoundException("Equipment not found");
      if (equipment.status !== "INSTALLED") throw new BadRequestException("Only an installed equipment can be commissioned");
      const existing = await tx.commissioningActivity.findFirst({ where: { equipmentId }, select: { id: true } });
      if (existing) throw new ConflictException("This equipment already has a commissioning activity");
      const code = await this.numbering.next(tx, scope, "CX");
      const activity = await tx.commissioningActivity.create({
        data: { ...scope, code, projectId: equipment.projectId, equipmentId, procedure, createdByUserId: actorUserId },
      });
      await writeAudit(tx, scope, actorUserId, "commissioning.activity.created", "CommissioningActivity", activity.id, { code, equipmentId });
      return activity.id;
    });
    return this.get(scope, id);
  }

  /**
   * Fiche d'essai : resultat calcule par le serveur (toutes les mesures dans
   * leurs bornes et tous les controles OK). Un echec documente ses anomalies.
   */
  async recordTest(scope: CompanyScope, activityId: string, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const kind = requiredEnum(input.kind, "kind", TEST_KINDS);
    const measurements = this.parseMeasurements(input.measurements);
    const checks = this.parseChecks(input.checks);
    if (measurements.length + checks.length === 0) throw new BadRequestException("A test sheet records at least one measurement or check");
    const outcome = measurements.every((measurement) => measurement.pass) && checks.every((check) => check.ok) ? "PASS" : "FAIL";
    const anomalies = outcome === "FAIL" ? this.parseAnomalies(input.anomalies) : [];
    const fileIds = Array.isArray(input.fileIds) ? (input.fileIds as unknown[]).map((value, index) => requiredId(value, `fileIds[${index}]`)) : [];
    await this.prisma.$transaction(async (tx) => {
      const activity = await this.lock(tx, scope, activityId);
      if (activity.status === "ACCEPTED" || activity.status === "HANDED_OVER") throw new BadRequestException("The equipment is already accepted");
      const tests = await tx.commissioningTest.findMany({ where: { activityId }, orderBy: { sequence: "asc" } });
      const punchItems = await tx.commissioningPunchItem.findMany({ where: { activityId } });
      const precommissioned = tests.some((test) => test.kind === "PRECOMMISSIONING" && test.outcome === "PASS");
      if (kind !== "PRECOMMISSIONING" && !precommissioned) throw new BadRequestException("Precommissioning must pass before any functional test");
      if (kind === "PRECOMMISSIONING" && precommissioned) throw new BadRequestException("Precommissioning has already passed");
      if (kind === "FUNCTIONAL" && punchItems.length > 0) throw new BadRequestException("Anomalies exist: confirm corrections with a retest");
      if (kind === "RETEST") {
        if (punchItems.some((item) => item.status === "OPEN")) throw new BadRequestException("Correct every open anomaly before the retest");
        if (!punchItems.some((item) => item.status === "CORRECTED")) throw new BadRequestException("A retest follows corrected anomalies");
      }
      for (const fileId of fileIds) {
        const file = await tx.storedFile.findFirst({ where: { id: fileId, ...scope }, select: { id: true } });
        if (!file) throw new NotFoundException("Evidence file not found");
      }
      const sequence = (tests.at(-1)?.sequence ?? 0) + 1;
      const test = await tx.commissioningTest.create({
        data: { ...scope, activityId, sequence, kind, measurements: measurements as unknown as Prisma.InputJsonValue, checks, outcome, notes: optionalText(input.notes, "notes", 4000), fileIds, performedByUserId: actorUserId },
      });
      for (const anomaly of anomalies) {
        await tx.commissioningPunchItem.create({ data: { ...scope, activityId, testId: test.id, description: anomaly.description, severity: anomaly.severity, createdByUserId: actorUserId } });
      }
      if (kind === "RETEST" && outcome === "PASS") {
        await tx.commissioningPunchItem.updateMany({ where: { activityId, status: "CORRECTED" }, data: { status: "CLOSED", closedByTestId: test.id, closedAt: new Date() } });
      }
      if (activity.status === "PLANNED") await tx.commissioningActivity.update({ where: { id: activityId }, data: { status: "IN_PROGRESS" } });
      await writeAudit(tx, scope, actorUserId, "commissioning.test.recorded", "CommissioningActivity", activityId, { sequence, kind, outcome, anomalies: anomalies.length });
    });
    return this.get(scope, activityId);
  }

  async correctPunchItem(scope: CompanyScope, punchItemId: string, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const note = requiredText(input.note, "note", 2000);
    const fileId = optionalId(input.fileId, "fileId");
    const activityId = await this.prisma.$transaction(async (tx) => {
      const item = await tx.commissioningPunchItem.findFirst({ where: { id: punchItemId, ...scope } });
      if (!item) throw new NotFoundException("Punch item not found");
      await this.lock(tx, scope, item.activityId);
      if (item.status !== "OPEN") throw new BadRequestException("Only an open anomaly can be corrected");
      if (fileId) {
        const file = await tx.storedFile.findFirst({ where: { id: fileId, ...scope }, select: { id: true } });
        if (!file) throw new NotFoundException("File not found");
      }
      await tx.commissioningPunchItem.update({
        where: { id: punchItemId },
        data: { status: "CORRECTED", correctionNote: note, correctionFileId: fileId, correctedByUserId: actorUserId, correctedAt: new Date() },
      });
      await writeAudit(tx, scope, actorUserId, "commissioning.punch.corrected", "CommissioningActivity", item.activityId, { punchItemId, note });
      return item.activityId;
    });
    return this.get(scope, activityId);
  }

  /** Reception : sequence complete, par une personne distincte du dernier essayeur ; l'equipement passe COMMISSIONED. */
  async accept(scope: CompanyScope, activityId: string, body: unknown, actorUserId: string) {
    const note = requiredText(assertBody(body ?? {}).note, "note", 2000);
    await this.prisma.$transaction(async (tx) => {
      const activity = await this.lock(tx, scope, activityId);
      if (activity.status === "ACCEPTED" || activity.status === "HANDED_OVER") throw new BadRequestException("Already accepted");
      const full = await tx.commissioningActivity.findUniqueOrThrow({ where: { id: activityId }, include: { tests: { orderBy: { sequence: "asc" } }, punchItems: true } });
      const { blockers } = sequenceState(full);
      if (blockers.length > 0) throw new BadRequestException(`Acceptance blocked: ${blockers.join(" ; ")}`);
      if (full.tests.at(-1)?.performedByUserId === actorUserId) throw new ForbiddenException("Acceptance is pronounced by someone other than the last tester");
      await tx.commissioningActivity.update({ where: { id: activityId }, data: { status: "ACCEPTED", acceptedByUserId: actorUserId, acceptedAt: new Date(), acceptanceNote: note } });
      await tx.mepEquipment.update({ where: { id: activity.equipmentId }, data: { status: "COMMISSIONED" } });
      await writeAudit(tx, scope, actorUserId, "commissioning.activity.accepted", "CommissioningActivity", activityId, { note, tests: full.tests.length });
    });
    return this.get(scope, activityId);
  }

  /** Remise au client : documents GED approuves (DOE) obligatoires. */
  async handOver(scope: CompanyScope, activityId: string, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const recipient = requiredText(input.recipient, "recipient", 200);
    if (!Array.isArray(input.documentIds) || input.documentIds.length === 0) throw new BadRequestException("documentIds must list the as-built documents (DOE)");
    const documentIds = [...new Set((input.documentIds as unknown[]).map((value, index) => requiredId(value, `documentIds[${index}]`)))];
    await this.prisma.$transaction(async (tx) => {
      const activity = await this.lock(tx, scope, activityId);
      if (activity.status !== "ACCEPTED") throw new BadRequestException("Handover requires an accepted commissioning");
      const documents = await tx.managedDocument.findMany({ where: { id: { in: documentIds }, ...scope } });
      if (documents.length !== documentIds.length) throw new NotFoundException("Document not found");
      const notApproved = documents.filter((document) => document.status !== "APPROVED");
      if (notApproved.length > 0) throw new BadRequestException(`Only approved documents are handed over (${notApproved.map((document) => document.code).join(", ")})`);
      for (const document of documents) {
        await tx.commissioningDocument.create({ data: { ...scope, activityId, documentId: document.id, linkedByUserId: actorUserId } });
      }
      await tx.commissioningActivity.update({ where: { id: activityId }, data: { status: "HANDED_OVER", handedOverByUserId: actorUserId, handedOverAt: new Date(), handoverRecipient: recipient } });
      await writeAudit(tx, scope, actorUserId, "commissioning.activity.handed_over", "CommissioningActivity", activityId, { recipient, documents: documents.map((document) => document.code) });
    });
    return this.get(scope, activityId);
  }

  // -------------------------------------------------------------------
  // Internes
  // -------------------------------------------------------------------

  private parseMeasurements(value: unknown): CommissioningMeasurement[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || value.length > 100) throw new BadRequestException("measurements must be an array (100 max)");
    return value.map((raw, index) => {
      const item = assertBody(raw);
      const min = optionalDecimal(item.min, `measurements[${index}].min`, { allowNegative: true });
      const max = optionalDecimal(item.max, `measurements[${index}].max`, { allowNegative: true });
      const measured = optionalDecimal(item.measured, `measurements[${index}].measured`, { allowNegative: true });
      if (!measured) throw new BadRequestException(`measurements[${index}].measured is required`);
      if (!min && !max) throw new BadRequestException(`measurements[${index}] needs an acceptance range (min and/or max)`);
      if (min && max && min.greaterThan(max)) throw new BadRequestException(`measurements[${index}]: min > max`);
      const pass = (!min || measured.greaterThanOrEqualTo(min)) && (!max || measured.lessThanOrEqualTo(max));
      return {
        name: requiredText(item.name, `measurements[${index}].name`, 120),
        unit: optionalText(item.unit, `measurements[${index}].unit`, 20) ?? "",
        min: min?.toString() ?? null,
        max: max?.toString() ?? null,
        measured: measured.toString(),
        pass,
      };
    });
  }

  private parseChecks(value: unknown): Array<{ label: string; ok: boolean }> {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || value.length > 100) throw new BadRequestException("checks must be an array (100 max)");
    return value.map((raw, index) => {
      const item = assertBody(raw);
      if (typeof item.ok !== "boolean") throw new BadRequestException(`checks[${index}].ok must be a boolean`);
      return { label: requiredText(item.label, `checks[${index}].label`, 200), ok: item.ok };
    });
  }

  private parseAnomalies(value: unknown): Array<{ description: string; severity: string }> {
    if (!Array.isArray(value) || value.length === 0) throw new BadRequestException("A failed test must document at least one anomaly");
    return value.map((raw, index) => {
      const item = assertBody(raw);
      return { description: requiredText(item.description, `anomalies[${index}].description`, 2000), severity: requiredEnum(item.severity, `anomalies[${index}].severity`, SEVERITIES) };
    });
  }

  private async lock(tx: Tx, scope: CompanyScope, activityId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "commissioning_activities"
      WHERE "id" = ${activityId} AND "organizationId" = ${scope.organizationId} AND "companyId" = ${scope.companyId}
      FOR UPDATE
    `;
    if (rows.length === 0) throw new NotFoundException("Commissioning activity not found");
    return tx.commissioningActivity.findUniqueOrThrow({ where: { id: activityId } });
  }

  private async context(scope: CompanyScope, activities: ActivityRow[]) {
    const userIds = [
      ...new Set(
        activities.flatMap((activity) => [
          activity.acceptedByUserId,
          ...activity.tests.map((test) => test.performedByUserId),
          ...activity.punchItems.map((item) => item.correctedByUserId),
        ]),
      ),
    ].filter((id): id is string => Boolean(id));
    const fileIds = [...new Set(activities.flatMap((activity) => activity.tests.flatMap((test) => test.fileIds as string[])))];
    const documentIds = [...new Set(activities.flatMap((activity) => activity.documents.map((document) => document.documentId)))];
    const [users, projects, files, documents] = await Promise.all([
      userIds.length ? this.prisma.user.findMany({ where: { id: { in: userIds }, organizationId: scope.organizationId }, select: { id: true, fullName: true } }) : [],
      this.prisma.project.findMany({ where: { id: { in: [...new Set(activities.map((activity) => activity.projectId))] }, ...scope }, select: { id: true, code: true } }),
      fileIds.length ? this.prisma.storedFile.findMany({ where: { id: { in: fileIds }, ...scope }, select: { id: true, originalName: true, mimeType: true } }) : [],
      documentIds.length ? this.prisma.managedDocument.findMany({ where: { id: { in: documentIds }, ...scope }, select: { id: true, code: true, title: true, status: true } }) : [],
    ]);
    return {
      names: new Map(users.map((user) => [user.id, user.fullName])),
      projects: new Map(projects.map((project) => [project.id, project.code])),
      files: new Map(files.map((file) => [file.id, file])),
      documents: new Map(documents.map((document) => [document.id, document])),
    };
  }

  private view(activity: ActivityRow, context: Awaited<ReturnType<CommissioningService["context"]>>, detailed: boolean): CommissioningActivityView {
    const { stage, blockers } = sequenceState(activity);
    const sequenceById = new Map(activity.tests.map((test) => [test.id, test.sequence]));
    return {
      id: activity.id,
      code: activity.code,
      projectId: activity.projectId,
      projectCode: context.projects.get(activity.projectId) ?? null,
      equipmentId: activity.equipmentId,
      equipmentTag: activity.equipment.tag,
      equipmentName: activity.equipment.name,
      systemCode: activity.equipment.system.code,
      procedure: activity.procedure,
      status: activity.status,
      stage,
      blockers,
      acceptedByName: activity.acceptedByUserId ? (context.names.get(activity.acceptedByUserId) ?? "—") : null,
      acceptedAt: activity.acceptedAt?.toISOString() ?? null,
      acceptanceNote: activity.acceptanceNote,
      handedOverAt: activity.handedOverAt?.toISOString() ?? null,
      handoverRecipient: activity.handoverRecipient,
      lastTesterUserId: activity.tests.at(-1)?.performedByUserId ?? null,
      openPunchItems: activity.punchItems.filter((item) => item.status !== "CLOSED").length,
      ...(detailed
        ? {
            tests: activity.tests.map((test) => ({
              id: test.id,
              sequence: test.sequence,
              kind: test.kind,
              outcome: test.outcome,
              measurements: test.measurements as unknown as CommissioningMeasurement[],
              checks: test.checks as Array<{ label: string; ok: boolean }>,
              notes: test.notes,
              files: (test.fileIds as string[])
                .map((fileId) => context.files.get(fileId))
                .filter((file): file is { id: string; originalName: string; mimeType: string } => Boolean(file))
                .map((file) => ({ ...file, url: `/api/v1/files/${file.id}/content` })),
              performedByUserId: test.performedByUserId,
              performedByName: context.names.get(test.performedByUserId) ?? "—",
              performedAt: test.performedAt.toISOString(),
            })),
            punchItems: activity.punchItems.map((item) => ({
              id: item.id,
              testSequence: sequenceById.get(item.testId) ?? 0,
              description: item.description,
              severity: item.severity,
              status: item.status,
              correctionNote: item.correctionNote,
              correctedByName: item.correctedByUserId ? (context.names.get(item.correctedByUserId) ?? "—") : null,
              correctedAt: item.correctedAt?.toISOString() ?? null,
              closedAt: item.closedAt?.toISOString() ?? null,
              closedByTestSequence: item.closedByTestId ? (sequenceById.get(item.closedByTestId) ?? null) : null,
            })),
            documents: activity.documents
              .map((link) => context.documents.get(link.documentId))
              .filter((document): document is { id: string; code: string; title: string; status: "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED" | "ARCHIVED" } => Boolean(document)),
          }
        : {}),
    };
  }
}
