import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type {
  QhseChecklistTemplateView,
  QhseCorrectiveActionView,
  QhseFindingView,
  QhseInspectionView,
  QhseSummaryView,
  SafetyIncidentView,
  ToolboxMeetingView,
  WorkPermitView,
} from "@axora24/contracts";
import { Prisma } from "@axora24/database";
import { PrismaService } from "../core/prisma.service.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import { NumberingService } from "../common/numbering.service.js";
import { writeAudit } from "../common/audit.js";
import { AutomationService } from "../workflow/automation.service.js";
import { dec } from "../common/decimal.js";
import { fileView } from "../files/files.service.js";
import {
  assertBody,
  optionalDate,
  optionalEnum,
  optionalId,
  optionalInt,
  optionalText,
  requiredDate,
  requiredEnum,
  requiredId,
  requiredText,
} from "../common/validation.js";

type Tx = Prisma.TransactionClient;

const DOMAINS = ["QUALITY", "SAFETY", "ENVIRONMENT"] as const;
const SEVERITIES = ["MINOR", "MAJOR", "CRITICAL"] as const;
const RESULTS = ["CONFORM", "NON_CONFORM", "NOT_APPLICABLE"] as const;
const INCIDENT_TYPES = ["NEAR_MISS", "FIRST_AID", "MEDICAL_TREATMENT", "LOST_TIME", "PROPERTY_DAMAGE", "ENVIRONMENTAL"] as const;
const PERMIT_TYPES = ["HOT_WORK", "WORK_AT_HEIGHT", "CONFINED_SPACE", "ELECTRICAL", "EXCAVATION", "LIFTING", "OTHER"] as const;
const DAY_MS = 86_400_000;

function startOfToday(): Date {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return today;
}

/**
 * INC-11 — QHSE (docs/foundation/02-domain-model.md BC-11) : Inspection ->
 * NCR -> Action corrective -> Verification -> Cloture (backlog §5.8), avec
 * incidents, permis de travail, quarts d'heure securite et KPI calcules sur
 * donnees reelles.
 */
@Injectable()
export class QhseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly automation: AutomationService,
  ) {}

  // -------------------------------------------------------------------
  // Modeles de checklist et inspections
  // -------------------------------------------------------------------

  async listTemplates(scope: CompanyScope): Promise<QhseChecklistTemplateView[]> {
    const templates = await this.prisma.qhseChecklistTemplate.findMany({ where: scope, orderBy: { code: "asc" } });
    return templates.map((template) => ({
      id: template.id,
      code: template.code,
      name: template.name,
      domain: template.domain,
      items: template.items as Array<{ label: string; critical: boolean }>,
    }));
  }

  async createTemplate(scope: CompanyScope, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const code = requiredText(input.code, "code", 30).toUpperCase();
    const name = requiredText(input.name, "name", 160);
    const domain = requiredEnum(input.domain, "domain", DOMAINS);
    const items = this.parseItems(input.items);
    const duplicate = await this.prisma.qhseChecklistTemplate.findFirst({ where: { companyId: scope.companyId, code }, select: { id: true } });
    if (duplicate) throw new ConflictException(`Checklist "${code}" already exists`);
    await this.prisma.$transaction(async (tx) => {
      const template = await tx.qhseChecklistTemplate.create({ data: { ...scope, code, name, domain, items } });
      await writeAudit(tx, scope, actorUserId, "qhse.template.created", "QhseChecklistTemplate", template.id, { code, itemCount: items.length });
    });
    return this.listTemplates(scope);
  }

  async listInspections(scope: CompanyScope, query: Record<string, unknown>): Promise<QhseInspectionView[]> {
    const projectId = optionalId(query.projectId, "projectId");
    const inspections = await this.prisma.qhseInspection.findMany({
      where: { ...scope, ...(projectId ? { projectId } : {}) },
      include: { items: { select: { result: true } } },
      orderBy: [{ status: "asc" }, { scheduledAt: "desc" }],
      take: 200,
    });
    const context = await this.context(scope, {
      projectIds: inspections.map((inspection) => inspection.projectId),
      zoneIds: inspections.map((inspection) => inspection.zoneId),
      userIds: inspections.map((inspection) => inspection.inspectorUserId),
    });
    return inspections.map((inspection) => this.inspectionView(inspection, context));
  }

  async getInspection(scope: CompanyScope, inspectionId: string): Promise<QhseInspectionView> {
    const inspection = await this.prisma.qhseInspection.findFirst({
      where: { id: inspectionId, ...scope },
      include: { items: { orderBy: { position: "asc" } } },
    });
    if (!inspection) throw new NotFoundException("Inspection not found");
    const [files, findings, context] = await Promise.all([
      this.prisma.storedFile.findMany({ where: { id: { in: inspection.items.map((item) => item.fileId).filter((id): id is string => Boolean(id)) }, ...scope } }),
      this.prisma.qhseFinding.findMany({ where: { ...scope, inspectionId }, select: { id: true, code: true, inspectionItemId: true } }),
      this.context(scope, {
        projectIds: [inspection.projectId],
        zoneIds: [inspection.zoneId],
        userIds: [inspection.inspectorUserId, ...inspection.items.map((item) => item.answeredByUserId)],
      }),
    ]);
    const fileById = new Map(files.map((file) => [file.id, file]));
    const findingByItem = new Map(findings.map((finding) => [finding.inspectionItemId, finding]));
    return {
      ...this.inspectionView(inspection, context),
      items: inspection.items.map((item) => {
        const file = item.fileId ? fileById.get(item.fileId) : undefined;
        const finding = findingByItem.get(item.id);
        return {
          id: item.id,
          position: item.position,
          label: item.label,
          critical: item.critical,
          result: item.result,
          comment: item.comment,
          file: file ? fileView(file) : null,
          answeredByName: item.answeredByUserId ? (context.names.get(item.answeredByUserId) ?? "—") : null,
          answeredAt: item.answeredAt?.toISOString() ?? null,
          findingId: finding?.id ?? null,
          findingCode: finding?.code ?? null,
        };
      }),
    };
  }

  async createInspection(scope: CompanyScope, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const projectId = requiredId(input.projectId, "projectId");
    const title = requiredText(input.title, "title", 200);
    const scheduledAt = requiredDate(input.scheduledAt, "scheduledAt");
    const templateId = optionalId(input.templateId, "templateId");
    const zoneId = optionalId(input.zoneId, "zoneId");
    const inspectorUserId = optionalId(input.inspectorUserId, "inspectorUserId") ?? actorUserId;
    const id = await this.prisma.$transaction(async (tx) => {
      await this.requireProject(tx, scope, projectId);
      if (zoneId) {
        const zone = await tx.siteZone.findFirst({ where: { id: zoneId, projectId, ...scope }, select: { id: true } });
        if (!zone) throw new NotFoundException("Zone not found on this project");
      }
      const member = await tx.companyMembership.findFirst({ where: { userId: inspectorUserId, companyId: scope.companyId }, select: { id: true } });
      if (!member) throw new BadRequestException("The inspector must be a member of this company");
      let domain: (typeof DOMAINS)[number];
      let items: Array<{ label: string; critical: boolean }>;
      if (templateId) {
        const template = await tx.qhseChecklistTemplate.findFirst({ where: { id: templateId, ...scope } });
        if (!template) throw new NotFoundException("Checklist template not found");
        domain = template.domain;
        items = template.items as Array<{ label: string; critical: boolean }>;
      } else {
        domain = requiredEnum(input.domain, "domain", DOMAINS);
        items = this.parseItems(input.items);
      }
      const code = await this.numbering.next(tx, scope, "INSP");
      const inspection = await tx.qhseInspection.create({
        data: {
          ...scope,
          code,
          projectId,
          zoneId,
          templateId,
          title,
          domain,
          scheduledAt,
          inspectorUserId,
          notes: optionalText(input.notes, "notes", 2000),
          createdByUserId: actorUserId,
          items: { create: items.map((item, index) => ({ position: index + 1, label: item.label, critical: item.critical })) },
        },
      });
      await writeAudit(tx, scope, actorUserId, "qhse.inspection.planned", "QhseInspection", inspection.id, { code, projectId, itemCount: items.length });
      return inspection.id;
    });
    return this.getInspection(scope, id);
  }

  async answerItem(scope: CompanyScope, inspectionId: string, itemId: string, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const result = requiredEnum(input.result, "result", RESULTS);
    const comment = optionalText(input.comment, "comment", 2000);
    const fileId = optionalId(input.fileId, "fileId");
    if (result === "NON_CONFORM" && !comment) throw new BadRequestException("A non-conformity must be described (comment)");
    await this.prisma.$transaction(async (tx) => {
      const inspection = await this.lockInspection(tx, scope, inspectionId);
      if (inspection.status === "COMPLETED") throw new BadRequestException("The inspection is completed and frozen");
      if (inspection.inspectorUserId !== actorUserId) throw new ForbiddenException("Only the assigned inspector records the results");
      const item = await tx.qhseInspectionItem.findFirst({ where: { id: itemId, inspectionId } });
      if (!item) throw new NotFoundException("Checklist item not found");
      if (fileId) {
        const file = await tx.storedFile.findFirst({ where: { id: fileId, ...scope }, select: { id: true } });
        if (!file) throw new NotFoundException("File not found");
      }
      await tx.qhseInspectionItem.update({ where: { id: item.id }, data: { result, comment, fileId, answeredByUserId: actorUserId, answeredAt: new Date() } });
      if (inspection.status === "PLANNED") {
        await tx.qhseInspection.update({ where: { id: inspectionId }, data: { status: "IN_PROGRESS", startedAt: new Date() } });
      }
      await writeAudit(tx, scope, actorUserId, "qhse.inspection.item_answered", "QhseInspection", inspectionId, { position: item.position, result });
    });
    return this.getInspection(scope, inspectionId);
  }

  /** Cloture : tous les points renseignes, taux calcule, une NCR ouverte par point non conforme. */
  async completeInspection(scope: CompanyScope, inspectionId: string, actorUserId: string) {
    await this.prisma.$transaction(async (tx) => {
      const inspection = await this.lockInspection(tx, scope, inspectionId);
      if (inspection.status === "COMPLETED") throw new BadRequestException("Already completed");
      if (inspection.inspectorUserId !== actorUserId) throw new ForbiddenException("Only the assigned inspector completes the inspection");
      const items = await tx.qhseInspectionItem.findMany({ where: { inspectionId }, orderBy: { position: "asc" } });
      const unanswered = items.filter((item) => item.result === null);
      if (unanswered.length > 0) throw new BadRequestException(`${unanswered.length} checklist item(s) are not answered`);
      const applicable = items.filter((item) => item.result !== "NOT_APPLICABLE");
      const conform = applicable.filter((item) => item.result === "CONFORM").length;
      const conformityRate = applicable.length === 0 ? null : new Prisma.Decimal(conform).mul(100).div(applicable.length).toDecimalPlaces(2);
      const now = new Date();
      for (const item of items.filter((candidate) => candidate.result === "NON_CONFORM")) {
        const code = await this.numbering.next(tx, scope, "NC");
        const finding = await tx.qhseFinding.create({
          data: {
            ...scope,
            code,
            projectId: inspection.projectId,
            category: inspection.domain,
            severity: item.critical ? "CRITICAL" : "MAJOR",
            title: item.label,
            description: item.comment ?? item.label,
            detectedAt: item.answeredAt ?? now,
            inspectionId,
            inspectionItemId: item.id,
            createdByUserId: actorUserId,
          },
        });
        await writeAudit(tx, scope, actorUserId, "qhse.finding.created", "QhseFinding", finding.id, { code, inspectionId, severity: finding.severity });
      }
      await tx.qhseInspection.update({ where: { id: inspectionId }, data: { status: "COMPLETED", completedAt: now, conformityRate } });
      await writeAudit(tx, scope, actorUserId, "qhse.inspection.completed", "QhseInspection", inspectionId, {
        conformityRate: conformityRate?.toFixed(2) ?? null,
        nonConform: items.filter((item) => item.result === "NON_CONFORM").length,
      });
    });
    return this.getInspection(scope, inspectionId);
  }

  // -------------------------------------------------------------------
  // Non-conformites et actions correctives
  // -------------------------------------------------------------------

  async listFindings(scope: CompanyScope, query: Record<string, unknown>): Promise<QhseFindingView[]> {
    const projectId = optionalId(query.projectId, "projectId");
    const status = optionalEnum(query.status, "status", ["OPEN", "IN_PROGRESS", "CLOSED"] as const);
    const findings = await this.prisma.qhseFinding.findMany({
      where: { ...scope, ...(projectId ? { projectId } : {}), ...(status ? { status } : {}) },
      include: { actions: { select: { status: true, dueDate: true } } },
      orderBy: [{ status: "asc" }, { detectedAt: "desc" }],
      take: 300,
    });
    const context = await this.findingContext(scope, findings);
    return findings.map((finding) => this.findingView(finding, context));
  }

  async getFinding(scope: CompanyScope, findingId: string): Promise<QhseFindingView> {
    const finding = await this.prisma.qhseFinding.findFirst({
      where: { id: findingId, ...scope },
      include: { actions: { orderBy: { createdAt: "asc" } } },
    });
    if (!finding) throw new NotFoundException("Non-conformity not found");
    const context = await this.findingContext(scope, [finding], finding.actions.flatMap((action) => [action.completedByUserId, action.verifiedByUserId]));
    const files = await this.prisma.storedFile.findMany({ where: { id: { in: finding.actions.map((action) => action.fileId).filter((id): id is string => Boolean(id)) }, ...scope } });
    const fileById = new Map(files.map((file) => [file.id, file]));
    const today = startOfToday();
    return {
      ...this.findingView(finding, context),
      actions: finding.actions.map(
        (action): QhseCorrectiveActionView => ({
          id: action.id,
          findingId: finding.id,
          findingCode: finding.code,
          description: action.description,
          assigneeName: action.assigneeName,
          assigneeUserId: action.assigneeUserId,
          dueDate: action.dueDate.toISOString(),
          overdue: action.status === "OPEN" && action.dueDate < today,
          status: action.status,
          completedByUserId: action.completedByUserId,
          completedByName: action.completedByUserId ? (context.names.get(action.completedByUserId) ?? "—") : null,
          completedAt: action.completedAt?.toISOString() ?? null,
          completionNote: action.completionNote,
          file: action.fileId && fileById.get(action.fileId) ? fileView(fileById.get(action.fileId)!) : null,
          verifiedByName: action.verifiedByUserId ? (context.names.get(action.verifiedByUserId) ?? "—") : null,
          verifiedAt: action.verifiedAt?.toISOString() ?? null,
          verificationNote: action.verificationNote,
          createdAt: action.createdAt.toISOString(),
        }),
      ),
    };
  }

  async createFinding(scope: CompanyScope, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const title = requiredText(input.title, "title", 200);
    const description = requiredText(input.description, "description", 4000);
    const category = requiredEnum(input.category, "category", DOMAINS);
    const severity = requiredEnum(input.severity, "severity", SEVERITIES);
    const detectedAt = optionalDate(input.detectedAt, "detectedAt") ?? new Date();
    if (detectedAt.getTime() > Date.now() + 5 * 60_000) throw new BadRequestException("detectedAt cannot be in the future");
    const projectId = optionalId(input.projectId, "projectId");
    const incidentId = optionalId(input.incidentId, "incidentId");
    const id = await this.prisma.$transaction(async (tx) => {
      if (projectId) await this.requireProject(tx, scope, projectId);
      if (incidentId) {
        const incident = await tx.safetyIncident.findFirst({ where: { id: incidentId, ...scope }, select: { id: true } });
        if (!incident) throw new NotFoundException("Incident not found");
      }
      const code = await this.numbering.next(tx, scope, "NC");
      const finding = await tx.qhseFinding.create({
        data: { ...scope, code, projectId, category, severity, title, description, detectedAt, incidentId, createdByUserId: actorUserId },
      });
      await writeAudit(tx, scope, actorUserId, "qhse.finding.created", "QhseFinding", finding.id, { code, severity, incidentId, description });
      await this.automation.emit(tx, scope, { type: "qhse.finding.created", resourceId: finding.id, actorUserId, link: `/qhse/findings/${finding.id}`, payload: { code, title, severity, domain: category } });
      return finding.id;
    });
    return this.getFinding(scope, id);
  }

  async addAction(scope: CompanyScope, findingId: string, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const description = requiredText(input.description, "description", 2000);
    const assigneeName = requiredText(input.assigneeName, "assigneeName", 160);
    const dueDate = requiredDate(input.dueDate, "dueDate");
    const assigneeUserId = optionalId(input.assigneeUserId, "assigneeUserId");
    await this.prisma.$transaction(async (tx) => {
      const finding = await this.lockFinding(tx, scope, findingId);
      if (finding.status === "CLOSED") throw new BadRequestException("The non-conformity is closed");
      if (assigneeUserId) {
        const member = await tx.companyMembership.findFirst({ where: { userId: assigneeUserId, companyId: scope.companyId }, select: { id: true } });
        if (!member) throw new BadRequestException("assigneeUserId must be a member of this company");
      }
      const action = await tx.qhseCorrectiveAction.create({
        data: { ...scope, findingId, description, assigneeName, assigneeUserId, dueDate, createdByUserId: actorUserId },
      });
      if (finding.status === "OPEN") await tx.qhseFinding.update({ where: { id: findingId }, data: { status: "IN_PROGRESS" } });
      await writeAudit(tx, scope, actorUserId, "qhse.action.created", "QhseCorrectiveAction", action.id, { findingId, dueDate: dueDate.toISOString().slice(0, 10) });
    });
    return this.getFinding(scope, findingId);
  }

  async completeAction(scope: CompanyScope, actionId: string, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const note = requiredText(input.note, "note", 2000);
    const fileId = optionalId(input.fileId, "fileId");
    const findingId = await this.prisma.$transaction(async (tx) => {
      const action = await this.lockAction(tx, scope, actionId);
      if (action.status !== "OPEN") throw new BadRequestException("Only an open action can be completed");
      if (fileId) {
        const file = await tx.storedFile.findFirst({ where: { id: fileId, ...scope }, select: { id: true } });
        if (!file) throw new NotFoundException("File not found");
      }
      await tx.qhseCorrectiveAction.update({
        where: { id: actionId },
        data: { status: "DONE", completedByUserId: actorUserId, completedAt: new Date(), completionNote: note, fileId },
      });
      await writeAudit(tx, scope, actorUserId, "qhse.action.completed", "QhseCorrectiveAction", actionId, { findingId: action.findingId });
      return action.findingId;
    });
    return this.getFinding(scope, findingId);
  }

  /** Verification (efficacite) par une personne distincte de celle qui a realise l'action. */
  async verifyAction(scope: CompanyScope, actionId: string, decision: "VERIFIED" | "REJECTED", body: unknown, actorUserId: string) {
    const note = optionalText(assertBody(body ?? {}).note, "note", 2000);
    if (decision === "REJECTED" && !note) throw new BadRequestException("A note is required to reject an action");
    const findingId = await this.prisma.$transaction(async (tx) => {
      const action = await this.lockAction(tx, scope, actionId);
      if (action.status !== "DONE") throw new BadRequestException("Only a completed action can be verified");
      if (action.completedByUserId === actorUserId) throw new ForbiddenException("An action is verified by someone other than the person who carried it out");
      await tx.qhseCorrectiveAction.update({
        where: { id: actionId },
        data:
          decision === "VERIFIED"
            ? { status: "VERIFIED", verifiedByUserId: actorUserId, verifiedAt: new Date(), verificationNote: note }
            : { status: "OPEN", completedByUserId: null, completedAt: null, completionNote: null, fileId: null, verificationNote: note },
      });
      await writeAudit(tx, scope, actorUserId, decision === "VERIFIED" ? "qhse.action.verified" : "qhse.action.rejected", "QhseCorrectiveAction", actionId, {
        findingId: action.findingId,
        note,
      });
      return action.findingId;
    });
    return this.getFinding(scope, findingId);
  }

  /** Cloture de la NCR : actions toutes verifiees, par une personne distincte du createur. */
  async closeFinding(scope: CompanyScope, findingId: string, body: unknown, actorUserId: string) {
    const note = requiredText(assertBody(body ?? {}).note, "note", 2000);
    await this.prisma.$transaction(async (tx) => {
      const finding = await this.lockFinding(tx, scope, findingId);
      if (finding.status === "CLOSED") throw new BadRequestException("Already closed");
      if (finding.createdByUserId === actorUserId) throw new ForbiddenException("A non-conformity is closed by someone other than its creator");
      const actions = await tx.qhseCorrectiveAction.findMany({ where: { findingId }, select: { status: true } });
      if (actions.length === 0) throw new BadRequestException("At least one corrective action is required before closing");
      const pending = actions.filter((action) => action.status !== "VERIFIED").length;
      if (pending > 0) throw new BadRequestException(`${pending} corrective action(s) are not verified`);
      await tx.qhseFinding.update({ where: { id: findingId }, data: { status: "CLOSED", closedByUserId: actorUserId, closedAt: new Date(), closureNote: note } });
      await writeAudit(tx, scope, actorUserId, "qhse.finding.closed", "QhseFinding", findingId, { code: finding.code, note });
    });
    return this.getFinding(scope, findingId);
  }

  // -------------------------------------------------------------------
  // Incidents de securite
  // -------------------------------------------------------------------

  async listIncidents(scope: CompanyScope, query: Record<string, unknown>): Promise<SafetyIncidentView[]> {
    const projectId = optionalId(query.projectId, "projectId");
    const incidents = await this.prisma.safetyIncident.findMany({
      where: { ...scope, ...(projectId ? { projectId } : {}) },
      orderBy: { occurredAt: "desc" },
      take: 200,
    });
    const [context, findings] = await Promise.all([
      this.context(scope, { projectIds: incidents.map((incident) => incident.projectId), userIds: incidents.map((incident) => incident.reportedByUserId) }),
      this.prisma.qhseFinding.findMany({ where: { ...scope, incidentId: { in: incidents.map((incident) => incident.id) } }, select: { id: true, incidentId: true } }),
    ]);
    return incidents.map((incident) => ({
      id: incident.id,
      code: incident.code,
      projectId: incident.projectId,
      projectCode: incident.projectId ? (context.projects.get(incident.projectId) ?? null) : null,
      type: incident.type,
      severity: incident.severity,
      occurredAt: incident.occurredAt.toISOString(),
      location: incident.location,
      description: incident.description,
      injuredPerson: incident.injuredPerson,
      immediateActions: incident.immediateActions,
      reportedByName: context.names.get(incident.reportedByUserId) ?? "—",
      lostDays: incident.lostDays,
      status: incident.status,
      investigationSummary: incident.investigationSummary,
      investigatedAt: incident.investigatedAt?.toISOString() ?? null,
      closedAt: incident.closedAt?.toISOString() ?? null,
      findingIds: findings.filter((finding) => finding.incidentId === incident.id).map((finding) => finding.id),
    }));
  }

  async reportIncident(scope: CompanyScope, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const type = requiredEnum(input.type, "type", INCIDENT_TYPES);
    const severity = requiredEnum(input.severity, "severity", SEVERITIES);
    const occurredAt = requiredDate(input.occurredAt, "occurredAt");
    if (occurredAt.getTime() > Date.now() + 5 * 60_000) throw new BadRequestException("occurredAt cannot be in the future");
    const location = requiredText(input.location, "location", 200);
    const description = requiredText(input.description, "description", 4000);
    const projectId = optionalId(input.projectId, "projectId");
    const lostDays = optionalInt(input.lostDays, "lostDays", { min: 0, max: 3650 }) ?? 0;
    if (type === "LOST_TIME" && lostDays === 0) throw new BadRequestException("A lost-time incident declares at least one lost day");
    await this.prisma.$transaction(async (tx) => {
      if (projectId) await this.requireProject(tx, scope, projectId);
      const code = await this.numbering.next(tx, scope, "HSE");
      const incident = await tx.safetyIncident.create({
        data: {
          ...scope,
          code,
          projectId,
          type,
          severity,
          occurredAt,
          location,
          description,
          injuredPerson: optionalText(input.injuredPerson, "injuredPerson", 160),
          immediateActions: optionalText(input.immediateActions, "immediateActions", 2000),
          reportedByUserId: actorUserId,
          lostDays,
        },
      });
      // Audit renforce : les faits declares sont integralement conserves dans la trace.
      await writeAudit(tx, scope, actorUserId, "qhse.incident.reported", "SafetyIncident", incident.id, {
        code,
        type,
        severity,
        occurredAt: occurredAt.toISOString(),
        location,
        description,
        lostDays,
      });
    });
    return this.listIncidents(scope, {});
  }

  async investigateIncident(scope: CompanyScope, incidentId: string, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const summary = requiredText(input.summary, "summary", 4000);
    const lostDays = optionalInt(input.lostDays, "lostDays", { min: 0, max: 3650 });
    await this.prisma.$transaction(async (tx) => {
      const incident = await tx.safetyIncident.findFirst({ where: { id: incidentId, ...scope } });
      if (!incident) throw new NotFoundException("Incident not found");
      if (incident.status === "CLOSED") throw new BadRequestException("The incident is closed");
      if (lostDays !== null && lostDays < incident.lostDays) throw new BadRequestException("Lost days can only be extended, never reduced");
      await tx.safetyIncident.update({
        where: { id: incidentId },
        data: { status: "INVESTIGATED", investigationSummary: summary, investigatedByUserId: actorUserId, investigatedAt: new Date(), ...(lostDays !== null ? { lostDays } : {}) },
      });
      await writeAudit(tx, scope, actorUserId, "qhse.incident.investigated", "SafetyIncident", incidentId, { summary, lostDays });
    });
    return this.listIncidents(scope, {});
  }

  async closeIncident(scope: CompanyScope, incidentId: string, actorUserId: string) {
    await this.prisma.$transaction(async (tx) => {
      const incident = await tx.safetyIncident.findFirst({ where: { id: incidentId, ...scope } });
      if (!incident) throw new NotFoundException("Incident not found");
      if (incident.status !== "INVESTIGATED") throw new BadRequestException("An incident is closed only after its investigation");
      const openFindings = await tx.qhseFinding.count({ where: { incidentId, status: { not: "CLOSED" } } });
      if (openFindings > 0) throw new BadRequestException(`${openFindings} related non-conformity(ies) are still open`);
      await tx.safetyIncident.update({ where: { id: incidentId }, data: { status: "CLOSED", closedByUserId: actorUserId, closedAt: new Date() } });
      await writeAudit(tx, scope, actorUserId, "qhse.incident.closed", "SafetyIncident", incidentId, {});
    });
    return this.listIncidents(scope, {});
  }

  // -------------------------------------------------------------------
  // Permis de travail
  // -------------------------------------------------------------------

  async listPermits(scope: CompanyScope, query: Record<string, unknown>): Promise<WorkPermitView[]> {
    const projectId = optionalId(query.projectId, "projectId");
    const permits = await this.prisma.workPermit.findMany({ where: { ...scope, ...(projectId ? { projectId } : {}) }, orderBy: { validFrom: "desc" }, take: 200 });
    const context = await this.context(scope, {
      projectIds: permits.map((permit) => permit.projectId),
      zoneIds: permits.map((permit) => permit.zoneId),
      userIds: permits.flatMap((permit) => [permit.requestedByUserId, permit.decidedByUserId]),
    });
    const now = new Date();
    return permits.map((permit) => ({
      id: permit.id,
      code: permit.code,
      projectId: permit.projectId,
      projectCode: context.projects.get(permit.projectId) ?? null,
      zoneId: permit.zoneId,
      zoneName: permit.zoneId ? (context.zones.get(permit.zoneId) ?? null) : null,
      type: permit.type,
      description: permit.description,
      precautions: permit.precautions,
      validFrom: permit.validFrom.toISOString(),
      validTo: permit.validTo.toISOString(),
      status: permit.status,
      active: permit.status === "APPROVED" && permit.validFrom <= now && now < permit.validTo,
      expired: permit.status === "APPROVED" && permit.validTo <= now,
      requestedByUserId: permit.requestedByUserId,
      requestedByName: context.names.get(permit.requestedByUserId) ?? "—",
      decidedByName: permit.decidedByUserId ? (context.names.get(permit.decidedByUserId) ?? "—") : null,
      decidedAt: permit.decidedAt?.toISOString() ?? null,
      decisionNote: permit.decisionNote,
      closedAt: permit.closedAt?.toISOString() ?? null,
    }));
  }

  async requestPermit(scope: CompanyScope, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const projectId = requiredId(input.projectId, "projectId");
    const type = requiredEnum(input.type, "type", PERMIT_TYPES);
    const description = requiredText(input.description, "description", 2000);
    const precautions = requiredText(input.precautions, "precautions", 4000);
    const validFrom = requiredDate(input.validFrom, "validFrom");
    const validTo = requiredDate(input.validTo, "validTo");
    if (validTo <= validFrom) throw new BadRequestException("validTo must be after validFrom");
    if (validTo.getTime() - validFrom.getTime() > 14 * DAY_MS) throw new BadRequestException("A work permit covers at most 14 days");
    const zoneId = optionalId(input.zoneId, "zoneId");
    await this.prisma.$transaction(async (tx) => {
      await this.requireProject(tx, scope, projectId);
      if (zoneId) {
        const zone = await tx.siteZone.findFirst({ where: { id: zoneId, projectId, ...scope }, select: { id: true } });
        if (!zone) throw new NotFoundException("Zone not found on this project");
      }
      const code = await this.numbering.next(tx, scope, "PT");
      const permit = await tx.workPermit.create({
        data: { ...scope, code, projectId, zoneId, type, description, precautions, validFrom, validTo, requestedByUserId: actorUserId },
      });
      await writeAudit(tx, scope, actorUserId, "qhse.permit.requested", "WorkPermit", permit.id, { code, type });
    });
    return this.listPermits(scope, {});
  }

  async decidePermit(scope: CompanyScope, permitId: string, decision: "APPROVED" | "REJECTED", body: unknown, actorUserId: string) {
    const note = optionalText(assertBody(body ?? {}).note, "note", 1000);
    if (decision === "REJECTED" && !note) throw new BadRequestException("A note is required to reject a permit");
    await this.prisma.$transaction(async (tx) => {
      const permit = await tx.workPermit.findFirst({ where: { id: permitId, ...scope } });
      if (!permit) throw new NotFoundException("Work permit not found");
      if (permit.status !== "REQUESTED") throw new BadRequestException("Only a requested permit can be decided");
      if (permit.requestedByUserId === actorUserId) throw new ForbiddenException("A work permit is issued by someone other than the requester");
      if (decision === "APPROVED" && permit.validTo <= new Date()) throw new BadRequestException("The validity window is already over");
      await tx.workPermit.update({ where: { id: permitId }, data: { status: decision, decidedByUserId: actorUserId, decidedAt: new Date(), decisionNote: note } });
      await writeAudit(tx, scope, actorUserId, decision === "APPROVED" ? "qhse.permit.approved" : "qhse.permit.rejected", "WorkPermit", permitId, { note });
    });
    return this.listPermits(scope, {});
  }

  async closePermit(scope: CompanyScope, permitId: string, actorUserId: string) {
    await this.prisma.$transaction(async (tx) => {
      const permit = await tx.workPermit.findFirst({ where: { id: permitId, ...scope } });
      if (!permit) throw new NotFoundException("Work permit not found");
      if (permit.status !== "APPROVED") throw new BadRequestException("Only an approved permit can be closed");
      await tx.workPermit.update({ where: { id: permitId }, data: { status: "CLOSED", closedByUserId: actorUserId, closedAt: new Date() } });
      await writeAudit(tx, scope, actorUserId, "qhse.permit.closed", "WorkPermit", permitId, {});
    });
    return this.listPermits(scope, {});
  }

  // -------------------------------------------------------------------
  // Quarts d'heure securite
  // -------------------------------------------------------------------

  async listToolbox(scope: CompanyScope, query: Record<string, unknown>): Promise<ToolboxMeetingView[]> {
    const projectId = optionalId(query.projectId, "projectId");
    const meetings = await this.prisma.toolboxMeeting.findMany({
      where: { ...scope, ...(projectId ? { projectId } : {}) },
      include: { attendees: true },
      orderBy: { heldAt: "desc" },
      take: 100,
    });
    const employeeIds = [...new Set(meetings.flatMap((meeting) => meeting.attendees.map((attendee) => attendee.employeeId)))];
    const [employees, context] = await Promise.all([
      this.prisma.employee.findMany({ where: { id: { in: employeeIds }, ...scope }, select: { id: true, firstName: true, lastName: true } }),
      this.context(scope, { projectIds: meetings.map((meeting) => meeting.projectId), userIds: meetings.map((meeting) => meeting.facilitatorUserId) }),
    ]);
    const names = new Map(employees.map((employee) => [employee.id, `${employee.firstName} ${employee.lastName}`]));
    return meetings.map((meeting) => ({
      id: meeting.id,
      projectId: meeting.projectId,
      projectCode: context.projects.get(meeting.projectId) ?? null,
      heldAt: meeting.heldAt.toISOString(),
      topic: meeting.topic,
      content: meeting.content,
      facilitatorName: context.names.get(meeting.facilitatorUserId) ?? "—",
      attendees: meeting.attendees.map((attendee) => ({ employeeId: attendee.employeeId, name: names.get(attendee.employeeId) ?? "—" })),
    }));
  }

  async recordToolbox(scope: CompanyScope, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const projectId = requiredId(input.projectId, "projectId");
    const heldAt = requiredDate(input.heldAt, "heldAt");
    if (heldAt.getTime() > Date.now() + 5 * 60_000) throw new BadRequestException("A toolbox meeting is recorded after it is held");
    const topic = requiredText(input.topic, "topic", 200);
    const content = requiredText(input.content, "content", 4000);
    if (!Array.isArray(input.attendeeEmployeeIds) || input.attendeeEmployeeIds.length === 0) {
      throw new BadRequestException("attendeeEmployeeIds must list at least one attendee");
    }
    const attendeeIds = [...new Set((input.attendeeEmployeeIds as unknown[]).map((value, index) => requiredId(value, `attendeeEmployeeIds[${index}]`)))];
    await this.prisma.$transaction(async (tx) => {
      await this.requireProject(tx, scope, projectId);
      const employees = await tx.employee.count({ where: { id: { in: attendeeIds }, ...scope } });
      if (employees !== attendeeIds.length) throw new NotFoundException("Unknown attendee");
      const meeting = await tx.toolboxMeeting.create({
        data: {
          ...scope,
          projectId,
          heldAt,
          topic,
          content,
          facilitatorUserId: actorUserId,
          attendees: { create: attendeeIds.map((employeeId) => ({ employeeId })) },
        },
      });
      await writeAudit(tx, scope, actorUserId, "qhse.toolbox.recorded", "ToolboxMeeting", meeting.id, { topic, attendees: attendeeIds.length });
    });
    return this.listToolbox(scope, { projectId });
  }

  // -------------------------------------------------------------------
  // Indicateurs (donnees reelles uniquement)
  // -------------------------------------------------------------------

  async summary(scope: CompanyScope, query: Record<string, unknown>): Promise<QhseSummaryView> {
    const projectId = optionalId(query.projectId, "projectId");
    const byProject = projectId ? { projectId } : {};
    const now = new Date();
    const today = startOfToday();
    const since30 = new Date(now.getTime() - 30 * DAY_MS);
    const since12m = new Date(now.getTime() - 365 * DAY_MS);
    const [openFindings, criticalOpenFindings, overdueActions, actionsToVerify, incidents30d, lostTime, lastLostTime, hours, inspections, activePermits] = await Promise.all([
      this.prisma.qhseFinding.count({ where: { ...scope, ...byProject, status: { not: "CLOSED" } } }),
      this.prisma.qhseFinding.count({ where: { ...scope, ...byProject, status: { not: "CLOSED" }, severity: "CRITICAL" } }),
      this.prisma.qhseCorrectiveAction.count({ where: { ...scope, status: "OPEN", dueDate: { lt: today }, finding: { ...byProject } } }),
      this.prisma.qhseCorrectiveAction.count({ where: { ...scope, status: "DONE", finding: { ...byProject } } }),
      this.prisma.safetyIncident.count({ where: { ...scope, ...byProject, occurredAt: { gte: since30 } } }),
      this.prisma.safetyIncident.count({ where: { ...scope, ...byProject, type: "LOST_TIME", occurredAt: { gte: since12m } } }),
      this.prisma.safetyIncident.findFirst({ where: { ...scope, ...byProject, type: "LOST_TIME" }, orderBy: { occurredAt: "desc" }, select: { occurredAt: true } }),
      this.prisma.timesheetEntry.aggregate({
        where: { ...scope, ...byProject, workDate: { gte: since12m }, timesheet: { status: "VALIDATED" } },
        _sum: { hours: true },
      }),
      this.prisma.qhseInspection.findMany({ where: { ...scope, ...byProject, status: "COMPLETED", completedAt: { gte: since30 } }, select: { conformityRate: true } }),
      this.prisma.workPermit.count({ where: { ...scope, ...byProject, status: "APPROVED", validFrom: { lte: now }, validTo: { gt: now } } }),
    ]);
    const hoursWorked = dec(hours._sum.hours);
    const rates = inspections.map((inspection) => inspection.conformityRate).filter((rate): rate is Prisma.Decimal => rate !== null);
    return {
      openFindings,
      criticalOpenFindings,
      overdueActions,
      actionsToVerify,
      incidents30d,
      lostTimeIncidents12m: lostTime,
      daysSinceLastLostTime: lastLostTime ? Math.floor((today.getTime() - new Date(lastLostTime.occurredAt).setUTCHours(0, 0, 0, 0)) / DAY_MS) : null,
      hoursWorked12m: hoursWorked.toFixed(2),
      frequencyRate: hoursWorked.isZero() ? null : new Prisma.Decimal(lostTime).mul(1_000_000).div(hoursWorked).toDecimalPlaces(2).toFixed(2),
      inspectionsCompleted30d: inspections.length,
      averageConformity30d: rates.length === 0 ? null : rates.reduce((sum, rate) => sum.plus(rate), new Prisma.Decimal(0)).div(rates.length).toDecimalPlaces(2).toFixed(2),
      activePermits,
    };
  }

  // -------------------------------------------------------------------
  // Internes
  // -------------------------------------------------------------------

  private parseItems(value: unknown): Array<{ label: string; critical: boolean }> {
    if (!Array.isArray(value) || value.length === 0) throw new BadRequestException("items must list at least one checklist item");
    if (value.length > 200) throw new BadRequestException("At most 200 checklist items");
    return value.map((raw, index) => {
      const item = assertBody(raw);
      return { label: requiredText(item.label, `items[${index}].label`, 300), critical: item.critical === true };
    });
  }

  private inspectionView(
    inspection: Prisma.QhseInspectionGetPayload<object> & { items: Array<{ result: string | null }> },
    context: Awaited<ReturnType<QhseService["context"]>>,
  ): QhseInspectionView {
    return {
      id: inspection.id,
      code: inspection.code,
      projectId: inspection.projectId,
      projectCode: context.projects.get(inspection.projectId) ?? null,
      zoneId: inspection.zoneId,
      zoneName: inspection.zoneId ? (context.zones.get(inspection.zoneId) ?? null) : null,
      title: inspection.title,
      domain: inspection.domain,
      scheduledAt: inspection.scheduledAt.toISOString(),
      inspectorUserId: inspection.inspectorUserId,
      inspectorName: context.names.get(inspection.inspectorUserId) ?? "—",
      status: inspection.status,
      startedAt: inspection.startedAt?.toISOString() ?? null,
      completedAt: inspection.completedAt?.toISOString() ?? null,
      conformityRate: inspection.conformityRate === null ? null : dec(inspection.conformityRate).toFixed(2),
      answered: inspection.items.filter((item) => item.result !== null).length,
      total: inspection.items.length,
      nonConform: inspection.items.filter((item) => item.result === "NON_CONFORM").length,
      notes: inspection.notes,
    };
  }

  private async findingContext(
    scope: CompanyScope,
    findings: Array<{ projectId: string | null; inspectionId: string | null; incidentId: string | null; createdByUserId: string; closedByUserId: string | null }>,
    extraUsers: Array<string | null> = [],
  ) {
    const [base, inspections, incidents] = await Promise.all([
      this.context(scope, {
        projectIds: findings.map((finding) => finding.projectId),
        userIds: [...findings.flatMap((finding) => [finding.createdByUserId, finding.closedByUserId]), ...extraUsers],
      }),
      this.prisma.qhseInspection.findMany({ where: { id: { in: findings.map((finding) => finding.inspectionId).filter((id): id is string => Boolean(id)) }, ...scope }, select: { id: true, code: true } }),
      this.prisma.safetyIncident.findMany({ where: { id: { in: findings.map((finding) => finding.incidentId).filter((id): id is string => Boolean(id)) }, ...scope }, select: { id: true, code: true } }),
    ]);
    return { ...base, inspections: new Map(inspections.map((row) => [row.id, row.code])), incidents: new Map(incidents.map((row) => [row.id, row.code])) };
  }

  private findingView(
    finding: Prisma.QhseFindingGetPayload<object> & { actions: Array<{ status: string; dueDate: Date }> },
    context: Awaited<ReturnType<QhseService["findingContext"]>>,
  ): QhseFindingView {
    const today = startOfToday();
    return {
      id: finding.id,
      code: finding.code,
      projectId: finding.projectId,
      projectCode: finding.projectId ? (context.projects.get(finding.projectId) ?? null) : null,
      category: finding.category,
      severity: finding.severity,
      title: finding.title,
      description: finding.description,
      detectedAt: finding.detectedAt.toISOString(),
      inspectionId: finding.inspectionId,
      inspectionCode: finding.inspectionId ? (context.inspections.get(finding.inspectionId) ?? null) : null,
      incidentId: finding.incidentId,
      incidentCode: finding.incidentId ? (context.incidents.get(finding.incidentId) ?? null) : null,
      status: finding.status,
      createdByUserId: finding.createdByUserId,
      createdByName: context.names.get(finding.createdByUserId) ?? "—",
      closedByName: finding.closedByUserId ? (context.names.get(finding.closedByUserId) ?? "—") : null,
      closedAt: finding.closedAt?.toISOString() ?? null,
      closureNote: finding.closureNote,
      createdAt: finding.createdAt.toISOString(),
      actionCount: finding.actions.length,
      verifiedActions: finding.actions.filter((action) => action.status === "VERIFIED").length,
      overdueActions: finding.actions.filter((action) => action.status === "OPEN" && action.dueDate < today).length,
    };
  }

  private async context(scope: CompanyScope, ids: { projectIds?: Array<string | null>; zoneIds?: Array<string | null>; userIds?: Array<string | null> }) {
    const unique = (values: Array<string | null> = []) => [...new Set(values.filter((value): value is string => Boolean(value)))];
    const [projects, zones, users] = await Promise.all([
      unique(ids.projectIds).length ? this.prisma.project.findMany({ where: { id: { in: unique(ids.projectIds) }, ...scope }, select: { id: true, code: true } }) : [],
      unique(ids.zoneIds).length ? this.prisma.siteZone.findMany({ where: { id: { in: unique(ids.zoneIds) }, ...scope }, select: { id: true, name: true } }) : [],
      unique(ids.userIds).length
        ? this.prisma.user.findMany({ where: { id: { in: unique(ids.userIds) }, organizationId: scope.organizationId }, select: { id: true, fullName: true } })
        : [],
    ]);
    return {
      projects: new Map(projects.map((project) => [project.id, project.code])),
      zones: new Map(zones.map((zone) => [zone.id, zone.name])),
      names: new Map(users.map((user) => [user.id, user.fullName])),
    };
  }

  private async requireProject(tx: Tx, scope: CompanyScope, projectId: string) {
    const project = await tx.project.findFirst({ where: { id: projectId, ...scope }, select: { id: true } });
    if (!project) throw new NotFoundException("Project not found");
  }

  private async lockInspection(tx: Tx, scope: CompanyScope, inspectionId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "qhse_inspections"
      WHERE "id" = ${inspectionId} AND "organizationId" = ${scope.organizationId} AND "companyId" = ${scope.companyId}
      FOR UPDATE
    `;
    if (rows.length === 0) throw new NotFoundException("Inspection not found");
    return tx.qhseInspection.findUniqueOrThrow({ where: { id: inspectionId } });
  }

  private async lockFinding(tx: Tx, scope: CompanyScope, findingId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "qhse_findings"
      WHERE "id" = ${findingId} AND "organizationId" = ${scope.organizationId} AND "companyId" = ${scope.companyId}
      FOR UPDATE
    `;
    if (rows.length === 0) throw new NotFoundException("Non-conformity not found");
    return tx.qhseFinding.findUniqueOrThrow({ where: { id: findingId } });
  }

  private async lockAction(tx: Tx, scope: CompanyScope, actionId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "qhse_corrective_actions"
      WHERE "id" = ${actionId} AND "organizationId" = ${scope.organizationId} AND "companyId" = ${scope.companyId}
      FOR UPDATE
    `;
    if (rows.length === 0) throw new NotFoundException("Corrective action not found");
    const action = await tx.qhseCorrectiveAction.findUniqueOrThrow({ where: { id: actionId } });
    const finding = await tx.qhseFinding.findUniqueOrThrow({ where: { id: action.findingId }, select: { status: true } });
    if (finding.status === "CLOSED") throw new BadRequestException("The non-conformity is closed");
    return action;
  }
}
