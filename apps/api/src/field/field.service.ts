import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import {
  FIELD_PERMISSIONS as F,
  type FieldSyncResult,
  type SiteDailyLogView,
  type SiteEvidenceView,
  type SiteIssueView,
  type SiteZoneView,
} from "@axora24/contracts";
import { Prisma } from "@axora24/database";
import { PrismaService } from "../core/prisma.service.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import { NumberingService } from "../common/numbering.service.js";
import { writeAudit } from "../common/audit.js";
import { dec, qty } from "../common/decimal.js";
import { fileView } from "../files/files.service.js";
import { isImage } from "../files/file-type.js";
import {
  assertBody,
  optionalDecimal,
  optionalEnum,
  optionalId,
  optionalText,
  requiredDate,
  requiredEnum,
  requiredId,
  requiredInt,
  requiredText,
} from "../common/validation.js";

type Tx = Prisma.TransactionClient;

const CATEGORIES = ["QUALITY", "SAFETY", "ENVIRONMENT", "PROGRESS", "OTHER"] as const;
const SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
const EVIDENCE_KINDS = ["PHOTO", "OBSERVATION", "CORRECTION"] as const;
const OPERATION_TYPES = ["issue.create", "evidence.create", "issue.submitCorrection", "log.save"] as const;
const CLIENT_ID = /^[A-Za-z0-9_-]{8,100}$/;
const DAY_MS = 86_400_000;
const MAX_BATCH = 100;

type OperationType = (typeof OPERATION_TYPES)[number];

/** Resultat d'une operation : APPLIED/DUPLICATE portent l'entite, CONFLICT l'etat serveur. */
class SyncConflict extends Error {
  constructor(
    message: string,
    readonly server: SiteIssueView | SiteDailyLogView,
  ) {
    super(message);
  }
}

const evidenceInclude = { file: true, issue: { select: { code: true } } } satisfies Prisma.SiteEvidenceInclude;
type EvidenceRow = Prisma.SiteEvidenceGetPayload<{ include: typeof evidenceInclude }>;

/**
 * INC-10 — Chantier (docs/foundation/02-domain-model.md BC-09) : zones,
 * journal quotidien signe, preuves horodatees append-only, reserves
 * (responsable + echeance, fermeture sur preuve verifiee par un tiers),
 * synchronisation hors ligne idempotente avec conflits explicites.
 */
@Injectable()
export class FieldService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
  ) {}

  // -------------------------------------------------------------------
  // Zones
  // -------------------------------------------------------------------

  async listZones(scope: CompanyScope, query: Record<string, unknown>): Promise<SiteZoneView[]> {
    const projectId = requiredId(query.projectId, "projectId");
    const zones = await this.prisma.siteZone.findMany({ where: { ...scope, projectId }, orderBy: { code: "asc" } });
    const open = await this.prisma.siteIssue.groupBy({
      by: ["zoneId"],
      where: { ...scope, projectId, status: { not: "CLOSED" }, zoneId: { not: null } },
      _count: { _all: true },
    });
    const counts = new Map(open.map((row) => [row.zoneId, row._count._all]));
    return zones.map((zone) => ({ id: zone.id, projectId: zone.projectId, code: zone.code, name: zone.name, openIssues: counts.get(zone.id) ?? 0 }));
  }

  async createZone(scope: CompanyScope, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const projectId = requiredId(input.projectId, "projectId");
    const code = requiredText(input.code, "code", 30).toUpperCase();
    const name = requiredText(input.name, "name", 120);
    await this.prisma.$transaction(async (tx) => {
      await this.requireProject(tx, scope, projectId);
      const duplicate = await tx.siteZone.findFirst({ where: { projectId, code }, select: { id: true } });
      if (duplicate) throw new ConflictException(`Zone "${code}" already exists on this project`);
      const zone = await tx.siteZone.create({ data: { ...scope, projectId, code, name } });
      await writeAudit(tx, scope, actorUserId, "field.zone.created", "SiteZone", zone.id, { projectId, code });
    });
    return this.listZones(scope, { projectId });
  }

  // -------------------------------------------------------------------
  // Journal de chantier
  // -------------------------------------------------------------------

  async listLogs(scope: CompanyScope, query: Record<string, unknown>): Promise<SiteDailyLogView[]> {
    const projectId = requiredId(query.projectId, "projectId");
    const logs = await this.prisma.siteDailyLog.findMany({ where: { ...scope, projectId }, select: { id: true }, orderBy: { logDate: "desc" }, take: 60 });
    return Promise.all(logs.map((log) => this.getLog(scope, log.id)));
  }

  async getLog(scope: CompanyScope, logId: string): Promise<SiteDailyLogView> {
    const log = await this.prisma.siteDailyLog.findFirst({ where: { id: logId, ...scope } });
    if (!log) throw new NotFoundException("Site log not found");
    const dayStart = log.logDate;
    const dayEnd = new Date(dayStart.getTime() + DAY_MS);
    const [project, clockedIn, movements, evidence, names] = await Promise.all([
      this.prisma.project.findFirst({ where: { id: log.projectId, ...scope }, select: { code: true } }),
      this.prisma.attendanceEvent.findMany({
        where: { ...scope, projectId: log.projectId, type: "IN", occurredAt: { gte: dayStart, lt: dayEnd } },
        distinct: ["employeeId"],
        select: { employeeId: true },
      }),
      this.prisma.stockMovement.findMany({
        where: { ...scope, projectId: log.projectId, type: { in: ["ISSUE", "RETURN"] }, createdAt: { gte: dayStart, lt: dayEnd } },
        include: { item: { select: { code: true, name: true, unitCode: true } } },
      }),
      this.prisma.siteEvidence.findMany({ where: { ...scope, dailyLogId: log.id }, include: evidenceInclude, orderBy: { takenAt: "asc" } }),
      this.userNames(scope, [log.createdByUserId, log.signedByUserId]),
    ]);
    const perItem = new Map<string, { itemCode: string; itemName: string; quantity: Prisma.Decimal; unitCode: string }>();
    for (const movement of movements) {
      const current = perItem.get(movement.itemId) ?? { itemCode: movement.item.code, itemName: movement.item.name, quantity: new Prisma.Decimal(0), unitCode: movement.item.unitCode };
      current.quantity = current.quantity.minus(movement.quantityDelta);
      perItem.set(movement.itemId, current);
    }
    return {
      id: log.id,
      projectId: log.projectId,
      projectCode: project?.code ?? null,
      logDate: log.logDate.toISOString().slice(0, 10),
      weather: log.weather,
      temperature: log.temperature,
      workforceCount: log.workforceCount,
      clockedInCount: clockedIn.length,
      summary: log.summary,
      safetyNotes: log.safetyNotes,
      status: log.status,
      version: log.version,
      createdByName: names.get(log.createdByUserId) ?? "—",
      signedByName: log.signedByUserId ? (names.get(log.signedByUserId) ?? "—") : null,
      signedAt: log.signedAt?.toISOString() ?? null,
      evidence: await this.evidenceViews(scope, evidence),
      stockIssues: [...perItem.values()]
        .filter((line) => !line.quantity.isZero())
        .map((line) => ({ itemCode: line.itemCode, itemName: line.itemName, quantity: qty(line.quantity), unitCode: line.unitCode })),
    };
  }

  /** Signature du journal par un responsable habilite : le journal est ensuite fige (trigger). */
  async signLog(scope: CompanyScope, logId: string, body: unknown, actorUserId: string) {
    const input = assertBody(body ?? {});
    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; status: string; version: number }>>`
        SELECT "id", "status"::text AS "status", "version" FROM "site_daily_logs"
        WHERE "id" = ${logId} AND "organizationId" = ${scope.organizationId} AND "companyId" = ${scope.companyId}
        FOR UPDATE
      `;
      const log = rows[0];
      if (!log) throw new NotFoundException("Site log not found");
      if (log.status === "SIGNED") throw new BadRequestException("This site log is already signed");
      if (input.version !== undefined && input.version !== log.version) {
        throw new ConflictException("The site log changed since you read it: review it before signing");
      }
      await tx.siteDailyLog.update({ where: { id: logId }, data: { status: "SIGNED", signedByUserId: actorUserId, signedAt: new Date() } });
      await writeAudit(tx, scope, actorUserId, "field.log.signed", "SiteDailyLog", logId, { version: log.version });
    });
    return this.getLog(scope, logId);
  }

  // -------------------------------------------------------------------
  // Reserves
  // -------------------------------------------------------------------

  async listIssues(scope: CompanyScope, query: Record<string, unknown>): Promise<SiteIssueView[]> {
    const projectId = optionalId(query.projectId, "projectId");
    const status = optionalEnum(query.status, "status", ["OPEN", "CORRECTION_SUBMITTED", "CLOSED"] as const);
    const issues = await this.prisma.siteIssue.findMany({
      where: { ...scope, ...(projectId ? { projectId } : {}), ...(status ? { status } : {}) },
      include: { _count: { select: { evidence: true } } },
      orderBy: [{ status: "asc" }, { dueDate: "asc" }],
      take: 300,
    });
    const context = await this.issueContext(scope, issues);
    return issues.map((issue) => this.issueView(issue, issue._count.evidence, context));
  }

  async getIssue(scope: CompanyScope, issueId: string): Promise<SiteIssueView> {
    const issue = await this.prisma.siteIssue.findFirst({ where: { id: issueId, ...scope } });
    if (!issue) throw new NotFoundException("Site issue not found");
    const evidence = await this.prisma.siteEvidence.findMany({ where: { ...scope, issueId }, include: evidenceInclude, orderBy: { takenAt: "asc" } });
    const context = await this.issueContext(scope, [issue]);
    return { ...this.issueView(issue, evidence.length, context), evidence: await this.evidenceViews(scope, evidence) };
  }

  /**
   * Fermeture : uniquement sur correction declaree, prouvee par photo, et
   * verifiee par une personne distincte de celle qui a declare la correction.
   */
  async closeIssue(scope: CompanyScope, issueId: string, body: unknown, actorUserId: string) {
    const input = assertBody(body ?? {});
    const note = optionalText(input.note, "note", 1000);
    await this.prisma.$transaction(async (tx) => {
      const issue = await this.lockIssue(tx, scope, issueId);
      if (input.version !== undefined && input.version !== issue.version) {
        throw new ConflictException("The issue changed since you read it: review it before closing");
      }
      if (issue.status !== "CORRECTION_SUBMITTED") throw new BadRequestException("An issue is closed only after a correction has been submitted");
      if (issue.correctionSubmittedByUserId === actorUserId) {
        throw new ForbiddenException("The correction is verified by someone other than the person who declared it");
      }
      await this.requireCorrectionProof(tx, issue);
      await tx.siteIssue.update({
        where: { id: issueId },
        data: { status: "CLOSED", closedByUserId: actorUserId, closedAt: new Date(), closureNote: note, version: { increment: 1 } },
      });
      await writeAudit(tx, scope, actorUserId, "field.issue.closed", "SiteIssue", issueId, { code: issue.code, note });
    });
    return this.getIssue(scope, issueId);
  }

  /** Correction refusee a la verification : la reserve est rouverte, une nouvelle preuve sera exigee. */
  async reopenIssue(scope: CompanyScope, issueId: string, body: unknown, actorUserId: string) {
    const note = requiredText(assertBody(body ?? {}).note, "note", 1000);
    await this.prisma.$transaction(async (tx) => {
      const issue = await this.lockIssue(tx, scope, issueId);
      if (issue.status !== "CORRECTION_SUBMITTED") throw new BadRequestException("Only a submitted correction can be refused");
      if (issue.correctionSubmittedByUserId === actorUserId) {
        throw new ForbiddenException("The correction is verified by someone other than the person who declared it");
      }
      await tx.siteIssue.update({
        where: { id: issueId },
        data: {
          status: "OPEN",
          reopenedAt: new Date(),
          correctionSubmittedAt: null,
          correctionSubmittedByUserId: null,
          correctionNote: null,
          version: { increment: 1 },
        },
      });
      await writeAudit(tx, scope, actorUserId, "field.issue.reopened", "SiteIssue", issueId, { code: issue.code, note });
    });
    return this.getIssue(scope, issueId);
  }

  async listEvidence(scope: CompanyScope, query: Record<string, unknown>): Promise<SiteEvidenceView[]> {
    const projectId = requiredId(query.projectId, "projectId");
    const evidence = await this.prisma.siteEvidence.findMany({
      where: { ...scope, projectId },
      include: evidenceInclude,
      orderBy: { takenAt: "desc" },
      take: 120,
    });
    return this.evidenceViews(scope, evidence);
  }

  // -------------------------------------------------------------------
  // Synchronisation (en ligne comme hors ligne : un seul chemin)
  // -------------------------------------------------------------------

  async sync(scope: CompanyScope, body: unknown, actorUserId: string, permissions: Set<string>): Promise<{ results: FieldSyncResult[] }> {
    const input = assertBody(body);
    if (!Array.isArray(input.operations)) throw new BadRequestException("operations must be an array");
    if (input.operations.length > MAX_BATCH) throw new BadRequestException(`At most ${MAX_BATCH} operations per batch`);
    const results: FieldSyncResult[] = [];
    for (const raw of input.operations as unknown[]) {
      results.push(await this.applyOperation(scope, raw, actorUserId, permissions));
    }
    return { results };
  }

  private async applyOperation(scope: CompanyScope, raw: unknown, actorUserId: string, permissions: Set<string>): Promise<FieldSyncResult> {
    const operation = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const clientId = typeof operation.clientId === "string" ? operation.clientId : "";
    if (!CLIENT_ID.test(clientId)) return { clientId, status: "REJECTED", message: "clientId must be 8-100 characters [A-Za-z0-9_-]" };
    const type = OPERATION_TYPES.find((candidate) => candidate === operation.type);
    if (!type) return { clientId, status: "REJECTED", message: "Unknown operation type" };
    const required = { "issue.create": F.ISSUE_MANAGE, "issue.submitCorrection": F.ISSUE_MANAGE, "evidence.create": F.EVIDENCE_CREATE, "log.save": F.LOG_MANAGE }[type];
    if (!permissions.has(required)) return { clientId, status: "REJECTED", message: `Missing permission: ${required}` };

    const already = await this.prisma.fieldSyncOperation.findFirst({ where: { companyId: scope.companyId, clientId } });
    if (already) return { clientId, status: "DUPLICATE", entityId: already.entityId };

    const payload = operation.payload && typeof operation.payload === "object" ? (operation.payload as Record<string, unknown>) : {};
    const baseVersion = typeof operation.baseVersion === "number" ? operation.baseVersion : undefined;
    try {
      const entityId = await this.prisma.$transaction(async (tx) => {
        const id = await this.execute(tx, scope, type, clientId, payload, baseVersion, actorUserId);
        await tx.fieldSyncOperation.create({ data: { ...scope, clientId, type, entityId: id, userId: actorUserId } });
        return id;
      });
      return { clientId, status: "APPLIED", entityId };
    } catch (error) {
      if (error instanceof SyncConflict) return { clientId, status: "CONFLICT", message: error.message, server: error.server };
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const winner = await this.prisma.fieldSyncOperation.findFirst({ where: { companyId: scope.companyId, clientId } });
        if (winner) return { clientId, status: "DUPLICATE", entityId: winner.entityId };
        return { clientId, status: "REJECTED", message: "Duplicate business key" };
      }
      if (error instanceof BadRequestException || error instanceof NotFoundException || error instanceof ForbiddenException || error instanceof ConflictException) {
        const response = error.getResponse();
        const message = typeof response === "object" && response && "message" in response ? String((response as { message: unknown }).message) : error.message;
        return { clientId, status: "REJECTED", message };
      }
      throw error;
    }
  }

  private async execute(
    tx: Tx,
    scope: CompanyScope,
    type: OperationType,
    clientId: string,
    payload: Record<string, unknown>,
    baseVersion: number | undefined,
    actorUserId: string,
  ): Promise<string> {
    switch (type) {
      case "issue.create":
        return this.createIssue(tx, scope, clientId, payload, actorUserId);
      case "evidence.create":
        return this.createEvidence(tx, scope, clientId, payload, actorUserId);
      case "issue.submitCorrection":
        return this.submitCorrection(tx, scope, payload, baseVersion, actorUserId);
      case "log.save":
        return this.saveLog(tx, scope, clientId, payload, baseVersion, actorUserId);
    }
  }

  private async createIssue(tx: Tx, scope: CompanyScope, clientId: string, payload: Record<string, unknown>, actorUserId: string): Promise<string> {
    const projectId = requiredId(payload.projectId, "projectId");
    const title = requiredText(payload.title, "title", 200);
    const description = requiredText(payload.description, "description", 4000);
    const category = requiredEnum(payload.category, "category", CATEGORIES);
    const severity = requiredEnum(payload.severity, "severity", SEVERITIES);
    const assigneeName = requiredText(payload.assigneeName, "assigneeName", 160);
    const dueDate = requiredDate(payload.dueDate, "dueDate");
    const zoneId = optionalId(payload.zoneId, "zoneId");
    const taskId = optionalId(payload.taskId, "taskId");
    const assigneeUserId = optionalId(payload.assigneeUserId, "assigneeUserId");
    await this.requireProject(tx, scope, projectId);
    if (zoneId) await this.requireZone(tx, scope, projectId, zoneId);
    if (taskId) await this.requireTask(tx, scope, projectId, taskId);
    if (assigneeUserId) {
      const member = await tx.companyMembership.findFirst({ where: { userId: assigneeUserId, companyId: scope.companyId }, select: { id: true } });
      if (!member) throw new BadRequestException("assigneeUserId must be a member of this company");
    }
    const code = await this.numbering.next(tx, scope, "RES");
    const issue = await tx.siteIssue.create({
      data: { ...scope, projectId, code, title, description, category, severity, zoneId, taskId, assigneeName, assigneeUserId, dueDate, clientId, createdByUserId: actorUserId },
    });
    await writeAudit(tx, scope, actorUserId, "field.issue.created", "SiteIssue", issue.id, { code, projectId, severity, clientId });
    return issue.id;
  }

  private async createEvidence(tx: Tx, scope: CompanyScope, clientId: string, payload: Record<string, unknown>, actorUserId: string): Promise<string> {
    const projectId = requiredId(payload.projectId, "projectId");
    const kind = requiredEnum(payload.kind, "kind", EVIDENCE_KINDS);
    const note = optionalText(payload.note, "note", 2000);
    const fileId = optionalId(payload.fileId, "fileId");
    const takenAt = requiredDate(payload.takenAt, "takenAt");
    if (takenAt.getTime() > Date.now() + 5 * 60_000) throw new BadRequestException("takenAt cannot be in the future");
    const latitude = optionalDecimal(payload.latitude, "latitude", { allowNegative: true });
    const longitude = optionalDecimal(payload.longitude, "longitude", { allowNegative: true });
    if (latitude && latitude.abs().greaterThan(90)) throw new BadRequestException("latitude out of range");
    if (longitude && longitude.abs().greaterThan(180)) throw new BadRequestException("longitude out of range");
    await this.requireProject(tx, scope, projectId);

    const issueId = await this.resolveByClientId(tx, scope, "issue", payload.issueId, payload.issueClientId);
    const dailyLogId = await this.resolveByClientId(tx, scope, "log", payload.dailyLogId, payload.logClientId);
    const taskId = optionalId(payload.taskId, "taskId");
    const zoneId = optionalId(payload.zoneId, "zoneId");
    if (!issueId && !dailyLogId && !taskId && !zoneId) {
      throw new BadRequestException("Evidence must be linked to an issue, a task, a zone or a site log");
    }
    if (issueId) {
      const issue = await tx.siteIssue.findFirst({ where: { id: issueId, ...scope } });
      if (!issue || issue.projectId !== projectId) throw new NotFoundException("Issue not found on this project");
      if (issue.status === "CLOSED") throw new BadRequestException("The issue is closed");
    }
    if (kind === "CORRECTION" && !issueId) throw new BadRequestException("A correction proof is linked to an issue");
    if (dailyLogId) {
      const log = await tx.siteDailyLog.findFirst({ where: { id: dailyLogId, ...scope } });
      if (!log || log.projectId !== projectId) throw new NotFoundException("Site log not found on this project");
      if (log.status === "SIGNED") throw new BadRequestException("The site log is signed and frozen");
    }
    if (taskId) await this.requireTask(tx, scope, projectId, taskId);
    if (zoneId) await this.requireZone(tx, scope, projectId, zoneId);
    if (kind !== "OBSERVATION") {
      if (!fileId) throw new BadRequestException("A photo is required for this evidence");
    }
    if (fileId) {
      const file = await tx.storedFile.findFirst({ where: { id: fileId, ...scope } });
      if (!file) throw new NotFoundException("File not found");
      if (kind !== "OBSERVATION" && !isImage(file.mimeType)) throw new BadRequestException("The proof must be a photo (JPEG, PNG or WebP)");
    } else if (!note) {
      throw new BadRequestException("An observation needs a note");
    }
    const evidence = await tx.siteEvidence.create({
      data: { ...scope, projectId, kind, note, fileId, takenAt, latitude, longitude, issueId, dailyLogId, taskId, zoneId, clientId, createdByUserId: actorUserId },
    });
    await writeAudit(tx, scope, actorUserId, "field.evidence.recorded", "SiteEvidence", evidence.id, { kind, issueId, dailyLogId, taskId, zoneId, clientId });
    return evidence.id;
  }

  private async submitCorrection(tx: Tx, scope: CompanyScope, payload: Record<string, unknown>, baseVersion: number | undefined, actorUserId: string): Promise<string> {
    const issueId = await this.resolveByClientId(tx, scope, "issue", payload.issueId, payload.issueClientId);
    if (!issueId) throw new BadRequestException("issueId or issueClientId is required");
    const note = requiredText(payload.note, "note", 2000);
    if (baseVersion === undefined) throw new BadRequestException("baseVersion is required to modify an issue");
    const issue = await this.lockIssue(tx, scope, issueId);
    if (issue.version !== baseVersion || issue.status !== "OPEN") {
      throw new SyncConflict(
        issue.status !== "OPEN"
          ? `Issue ${issue.code} is now ${issue.status}: your correction was not applied`
          : `Issue ${issue.code} changed (version ${issue.version}, you read ${baseVersion}): confirm again on the current version`,
        await this.issueSnapshot(tx, scope, issue.id),
      );
    }
    await this.requireCorrectionProof(tx, issue);
    await tx.siteIssue.update({
      where: { id: issue.id },
      data: {
        status: "CORRECTION_SUBMITTED",
        correctionSubmittedAt: new Date(),
        correctionSubmittedByUserId: actorUserId,
        correctionNote: note,
        version: { increment: 1 },
      },
    });
    await writeAudit(tx, scope, actorUserId, "field.issue.correction_submitted", "SiteIssue", issue.id, { code: issue.code });
    return issue.id;
  }

  private async saveLog(
    tx: Tx,
    scope: CompanyScope,
    clientId: string,
    payload: Record<string, unknown>,
    baseVersion: number | undefined,
    actorUserId: string,
  ): Promise<string> {
    const projectId = requiredId(payload.projectId, "projectId");
    const logDate = requiredDate(payload.logDate, "logDate");
    const day = new Date(Date.UTC(logDate.getUTCFullYear(), logDate.getUTCMonth(), logDate.getUTCDate()));
    if (day.getTime() > Date.now() + DAY_MS) throw new BadRequestException("A site log cannot be dated in the future");
    const data = {
      weather: optionalText(payload.weather, "weather", 120),
      temperature: optionalText(payload.temperature, "temperature", 40),
      workforceCount: requiredInt(payload.workforceCount, "workforceCount", { min: 0, max: 5000 }),
      summary: requiredText(payload.summary, "summary", 8000),
      safetyNotes: optionalText(payload.safetyNotes, "safetyNotes", 4000),
    };
    await this.requireProject(tx, scope, projectId);
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "site_daily_logs"
      WHERE "projectId" = ${projectId} AND "logDate" = ${day} AND "organizationId" = ${scope.organizationId} AND "companyId" = ${scope.companyId}
      FOR UPDATE
    `;
    if (rows.length === 0) {
      if (baseVersion !== undefined) {
        throw new BadRequestException("No site log exists for this day: send it without baseVersion to create it");
      }
      const log = await tx.siteDailyLog.create({ data: { ...scope, projectId, logDate: day, ...data, clientId, createdByUserId: actorUserId } });
      await writeAudit(tx, scope, actorUserId, "field.log.created", "SiteDailyLog", log.id, { projectId, logDate: day.toISOString().slice(0, 10), clientId });
      return log.id;
    }
    const existing = await tx.siteDailyLog.findUniqueOrThrow({ where: { id: rows[0]!.id } });
    if (existing.status === "SIGNED" || baseVersion !== existing.version) {
      throw new SyncConflict(
        existing.status === "SIGNED"
          ? "The site log of this day is already signed: your changes were not applied"
          : baseVersion === undefined
            ? "A site log already exists for this day: merge your entry with it explicitly"
            : `The site log changed (version ${existing.version}, you read ${baseVersion}): merge your entry explicitly`,
        await this.logSnapshot(scope, existing.id),
      );
    }
    await tx.siteDailyLog.update({ where: { id: existing.id }, data: { ...data, version: { increment: 1 } } });
    await writeAudit(tx, scope, actorUserId, "field.log.updated", "SiteDailyLog", existing.id, { version: existing.version + 1 });
    return existing.id;
  }

  // -------------------------------------------------------------------
  // Internes
  // -------------------------------------------------------------------

  /** Preuve de correction : une photo de correction posterieure a la derniere reouverture. */
  private async requireCorrectionProof(tx: Tx, issue: { id: string; reopenedAt: Date | null }) {
    const proof = await tx.siteEvidence.count({
      where: { issueId: issue.id, kind: "CORRECTION", fileId: { not: null }, ...(issue.reopenedAt ? { recordedAt: { gt: issue.reopenedAt } } : {}) },
    });
    if (proof === 0) throw new BadRequestException("A correction photo is required before declaring or closing the correction");
  }

  private async resolveByClientId(tx: Tx, scope: CompanyScope, kind: "issue" | "log", id: unknown, clientRef: unknown): Promise<string | null> {
    const direct = optionalId(id, `${kind}Id`);
    if (direct) return direct;
    if (typeof clientRef !== "string" || clientRef === "") return null;
    const found =
      kind === "issue"
        ? await tx.siteIssue.findFirst({ where: { companyId: scope.companyId, clientId: clientRef }, select: { id: true } })
        : await tx.siteDailyLog.findFirst({ where: { companyId: scope.companyId, clientId: clientRef }, select: { id: true } });
    if (!found) throw new NotFoundException(`No ${kind} created with clientId ${clientRef} (synchronize it first)`);
    return found.id;
  }

  private async lockIssue(tx: Tx, scope: CompanyScope, issueId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "site_issues"
      WHERE "id" = ${issueId} AND "organizationId" = ${scope.organizationId} AND "companyId" = ${scope.companyId}
      FOR UPDATE
    `;
    if (rows.length === 0) throw new NotFoundException("Site issue not found");
    return tx.siteIssue.findUniqueOrThrow({ where: { id: issueId } });
  }

  private async issueSnapshot(tx: Tx, scope: CompanyScope, issueId: string): Promise<SiteIssueView> {
    const issue = await tx.siteIssue.findUniqueOrThrow({ where: { id: issueId }, include: { _count: { select: { evidence: true } } } });
    const context = await this.issueContext(scope, [issue]);
    return this.issueView(issue, issue._count.evidence, context);
  }

  private logSnapshot(scope: CompanyScope, logId: string): Promise<SiteDailyLogView> {
    return this.getLog(scope, logId);
  }

  private async requireProject(tx: Tx, scope: CompanyScope, projectId: string) {
    const project = await tx.project.findFirst({ where: { id: projectId, ...scope }, select: { id: true } });
    if (!project) throw new NotFoundException("Project not found");
  }

  private async requireZone(tx: Tx, scope: CompanyScope, projectId: string, zoneId: string) {
    const zone = await tx.siteZone.findFirst({ where: { id: zoneId, projectId, ...scope }, select: { id: true } });
    if (!zone) throw new NotFoundException("Zone not found on this project");
  }

  private async requireTask(tx: Tx, scope: CompanyScope, projectId: string, taskId: string) {
    const task = await tx.projectTask.findFirst({ where: { id: taskId, projectId, ...scope }, select: { id: true } });
    if (!task) throw new NotFoundException("Task not found on this project");
  }

  private async userNames(scope: CompanyScope, ids: Array<string | null>): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (unique.length === 0) return new Map();
    const users = await this.prisma.user.findMany({ where: { id: { in: unique }, organizationId: scope.organizationId }, select: { id: true, fullName: true } });
    return new Map(users.map((user) => [user.id, user.fullName]));
  }

  private async issueContext(
    scope: CompanyScope,
    issues: Array<{ projectId: string; zoneId: string | null; taskId: string | null; createdByUserId: string; closedByUserId: string | null }>,
  ) {
    const ids = (pick: (issue: (typeof issues)[number]) => string | null) => [...new Set(issues.map(pick).filter((id): id is string => Boolean(id)))];
    const [projects, zones, tasks, names] = await Promise.all([
      this.prisma.project.findMany({ where: { id: { in: ids((issue) => issue.projectId) }, ...scope }, select: { id: true, code: true } }),
      this.prisma.siteZone.findMany({ where: { id: { in: ids((issue) => issue.zoneId) }, ...scope }, select: { id: true, name: true } }),
      this.prisma.projectTask.findMany({ where: { id: { in: ids((issue) => issue.taskId) }, ...scope }, select: { id: true, name: true } }),
      this.userNames(scope, issues.flatMap((issue) => [issue.createdByUserId, issue.closedByUserId])),
    ]);
    return {
      projects: new Map(projects.map((project) => [project.id, project.code])),
      zones: new Map(zones.map((zone) => [zone.id, zone.name])),
      tasks: new Map(tasks.map((task) => [task.id, task.name])),
      names,
    };
  }

  private issueView(
    issue: Prisma.SiteIssueGetPayload<object>,
    evidenceCount: number,
    context: Awaited<ReturnType<FieldService["issueContext"]>>,
  ): SiteIssueView {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    return {
      id: issue.id,
      code: issue.code,
      projectId: issue.projectId,
      projectCode: context.projects.get(issue.projectId) ?? null,
      title: issue.title,
      description: issue.description,
      category: issue.category,
      severity: issue.severity,
      zoneId: issue.zoneId,
      zoneName: issue.zoneId ? (context.zones.get(issue.zoneId) ?? null) : null,
      taskId: issue.taskId,
      taskName: issue.taskId ? (context.tasks.get(issue.taskId) ?? null) : null,
      assigneeName: issue.assigneeName,
      assigneeUserId: issue.assigneeUserId,
      dueDate: issue.dueDate.toISOString(),
      overdue: issue.status !== "CLOSED" && issue.dueDate < today,
      status: issue.status,
      version: issue.version,
      createdByUserId: issue.createdByUserId,
      createdByName: context.names.get(issue.createdByUserId) ?? "—",
      createdAt: issue.createdAt.toISOString(),
      correctionSubmittedAt: issue.correctionSubmittedAt?.toISOString() ?? null,
      correctionSubmittedByUserId: issue.correctionSubmittedByUserId,
      correctionNote: issue.correctionNote,
      closedAt: issue.closedAt?.toISOString() ?? null,
      closedByName: issue.closedByUserId ? (context.names.get(issue.closedByUserId) ?? "—") : null,
      closureNote: issue.closureNote,
      evidenceCount,
    };
  }

  private async evidenceViews(scope: CompanyScope, rows: EvidenceRow[]): Promise<SiteEvidenceView[]> {
    const taskIds = [...new Set(rows.map((row) => row.taskId).filter((id): id is string => Boolean(id)))];
    const zoneIds = [...new Set(rows.map((row) => row.zoneId).filter((id): id is string => Boolean(id)))];
    const [tasks, zones, names] = await Promise.all([
      taskIds.length ? this.prisma.projectTask.findMany({ where: { id: { in: taskIds }, ...scope }, select: { id: true, name: true } }) : [],
      zoneIds.length ? this.prisma.siteZone.findMany({ where: { id: { in: zoneIds }, ...scope }, select: { id: true, name: true } }) : [],
      this.userNames(scope, rows.map((row) => row.createdByUserId)),
    ]);
    const taskNames = new Map(tasks.map((task) => [task.id, task.name]));
    const zoneNames = new Map(zones.map((zone) => [zone.id, zone.name]));
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      note: row.note,
      file: row.file ? fileView(row.file) : null,
      takenAt: row.takenAt.toISOString(),
      recordedAt: row.recordedAt.toISOString(),
      latitude: row.latitude === null ? null : dec(row.latitude).toFixed(6),
      longitude: row.longitude === null ? null : dec(row.longitude).toFixed(6),
      issueId: row.issueId,
      issueCode: row.issue?.code ?? null,
      taskId: row.taskId,
      taskName: row.taskId ? (taskNames.get(row.taskId) ?? null) : null,
      zoneId: row.zoneId,
      zoneName: row.zoneId ? (zoneNames.get(row.zoneId) ?? null) : null,
      dailyLogId: row.dailyLogId,
      createdByName: names.get(row.createdByUserId) ?? "—",
    }));
  }
}
