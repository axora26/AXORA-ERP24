import { randomBytes } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import {
  AUTOMATION_EVENTS,
  WORKFLOW_GATED_RESOURCES,
  type AutomationEventType,
  type AutomationExecutionView,
  type NotificationView,
  type WebhookDeliveryView,
  type WorkflowActionView,
  type WorkflowApprovalView,
  type WorkflowCondition,
  type WorkflowDefinitionCreated,
  type WorkflowDefinitionView,
  type WorkflowOperator,
  type WorkflowSummaryView,
} from "@axora24/contracts";
import { Prisma } from "@axora24/database";
import { encryptSecret } from "@axora24/security";
import { PrismaService } from "../core/prisma.service.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import type { AuthenticatedUser } from "../auth/session.guard.js";
import { writeAudit } from "../common/audit.js";
import { assertBody, optionalId, optionalText, requiredEnum, requiredId, requiredInt, requiredText } from "../common/validation.js";
import { AutomationService, allowPrivateWebhookTargets, integrationKey, type ExecutionLogEntry, type RunReport, type StoredAction } from "./automation.service.js";
import { webhookTargetRefusal } from "./engine.js";

type Tx = Prisma.TransactionClient;
type Client = Tx | PrismaService;

const EVENT_TYPES = Object.keys(AUTOMATION_EVENTS) as AutomationEventType[];
const TEXT_OPERATORS: WorkflowOperator[] = ["eq", "neq", "contains"];
const DECIMAL_OPERATORS: WorkflowOperator[] = ["eq", "neq", "gt", "gte", "lt", "lte"];
const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{1,39}$/;
const DECIMAL_PATTERN = /^-?\d{1,15}(\.\d{1,4})?$/;

/** Valeur sensible a la casse (types d'evenement, champs, operateurs), contrairement a requiredEnum. */
function exactEnum<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  const match = allowed.find((candidate) => candidate === value);
  if (!match) throw new BadRequestException(`${field} doit valoir l'une des valeurs : ${allowed.join(", ")}`);
  return match;
}

function eventLabel(type: string): string {
  return AUTOMATION_EVENTS[type as AutomationEventType]?.label ?? type;
}

async function userRoleIds(client: Client, scope: CompanyScope, userId: string): Promise<Set<string>> {
  const rows = await client.roleAssignment.findMany({
    where: { userId, role: { organizationId: scope.organizationId }, OR: [{ companyId: null }, { companyId: scope.companyId }] },
    select: { roleId: true },
  });
  return new Set(rows.map((row) => row.roleId));
}

/** INC-21 — Configuration des workflows, approbations, journal et notifications. */
@Injectable()
export class WorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly automation: AutomationService,
  ) {}

  async summary(scope: CompanyScope): Promise<WorkflowSummaryView> {
    const now = new Date();
    const [activeDefinitions, pendingApprovals, overdueApprovals, failedExecutions, failedDeliveries, pendingEvents] = await Promise.all([
      this.prisma.workflowDefinition.count({ where: { ...scope, active: true } }),
      this.prisma.workflowApproval.count({ where: { ...scope, status: "PENDING" } }),
      this.prisma.workflowApproval.count({ where: { ...scope, status: "PENDING", dueAt: { lt: now } } }),
      this.prisma.automationExecution.count({ where: { ...scope, status: "FAILED" } }),
      this.prisma.webhookDelivery.count({ where: { ...scope, status: "FAILED" } }),
      this.prisma.automationEvent.count({ where: { ...scope, processedAt: null } }),
    ]);
    return { activeDefinitions, pendingApprovals, overdueApprovals, failedExecutions, failedDeliveries, pendingEvents };
  }

  async roles(scope: CompanyScope): Promise<Array<{ id: string; name: string }>> {
    return this.prisma.role.findMany({ where: { organizationId: scope.organizationId }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  }

  // -------------------------------------------------------------------------
  // Definitions (versionnees : une modification cree une nouvelle version)
  // -------------------------------------------------------------------------

  async listDefinitions(scope: CompanyScope): Promise<WorkflowDefinitionView[]> {
    const definitions = await this.prisma.workflowDefinition.findMany({ where: scope, orderBy: [{ code: "asc" }, { version: "desc" }] });
    return this.definitionViews(scope, definitions);
  }

  private async definitionViews(scope: CompanyScope, definitions: Array<Prisma.WorkflowDefinitionGetPayload<object>>): Promise<WorkflowDefinitionView[]> {
    const ids = definitions.map((definition) => definition.id);
    const [counts, roles, users] = await Promise.all([
      this.prisma.automationExecution.groupBy({ by: ["definitionId", "status"], where: { ...scope, definitionId: { in: ids } }, _count: { _all: true } }),
      this.prisma.role.findMany({ where: { organizationId: scope.organizationId }, select: { id: true, name: true } }),
      this.prisma.user.findMany({ where: { id: { in: [...new Set(definitions.map((definition) => definition.createdByUserId))] } }, select: { id: true, fullName: true } }),
    ]);
    const roleName = new Map(roles.map((role) => [role.id, role.name]));
    const userName = new Map(users.map((user) => [user.id, user.fullName]));
    return definitions.map((definition) => {
      const mine = counts.filter((count) => count.definitionId === definition.id);
      const actions: WorkflowActionView[] = (definition.actions as unknown as StoredAction[]).map((action) =>
        action.type === "NOTIFY"
          ? { type: "NOTIFY", roleId: action.roleId, roleName: roleName.get(action.roleId) ?? "Rôle supprimé", title: action.title, body: action.body }
          : action.type === "REQUIRE_APPROVAL"
            ? {
                type: "REQUIRE_APPROVAL",
                approverRoleId: action.approverRoleId,
                approverRoleName: roleName.get(action.approverRoleId) ?? "Rôle supprimé",
                escalationRoleId: action.escalationRoleId,
                escalationRoleName: action.escalationRoleId ? (roleName.get(action.escalationRoleId) ?? "Rôle supprimé") : null,
                slaHours: action.slaHours,
                title: action.title,
              }
            : { type: "WEBHOOK", url: action.url },
      );
      return {
        id: definition.id,
        code: definition.code,
        version: definition.version,
        name: definition.name,
        description: definition.description,
        eventType: definition.eventType,
        eventLabel: eventLabel(definition.eventType),
        conditions: definition.conditions as unknown as WorkflowCondition[],
        actions,
        active: definition.active,
        createdByName: userName.get(definition.createdByUserId) ?? "—",
        createdAt: definition.createdAt.toISOString(),
        executions: mine.reduce((sum, count) => sum + count._count._all, 0),
        failures: mine.filter((count) => count.status === "FAILED").reduce((sum, count) => sum + count._count._all, 0),
      };
    });
  }

  async createDefinition(scope: CompanyScope, body: unknown, userId: string): Promise<WorkflowDefinitionCreated> {
    const input = assertBody(body);
    const code = requiredText(input.code, "code", 40).toUpperCase();
    if (!CODE_PATTERN.test(code)) throw new BadRequestException("code : lettres majuscules, chiffres, « - » ou « _ » (2 à 40 caractères)");
    const name = requiredText(input.name, "name", 120);
    const description = optionalText(input.description, "description", 1000);
    const eventType = exactEnum(input.eventType, "eventType", EVENT_TYPES);
    const catalog = AUTOMATION_EVENTS[eventType];
    const conditions = this.parseConditions(input.conditions, catalog.fields);
    const roleIds = new Set((await this.roles(scope)).map((role) => role.id));
    const { actions, secrets } = this.parseActions(input.actions, roleIds, catalog.resourceType);

    try {
      const definition = await this.prisma.$transaction(async (tx) => {
        const latest = await tx.workflowDefinition.findFirst({ where: { ...scope, code }, orderBy: { version: "desc" }, select: { version: true } });
        await tx.workflowDefinition.updateMany({ where: { ...scope, code, active: true }, data: { active: false } });
        const created = await tx.workflowDefinition.create({
          data: {
            ...scope,
            code,
            version: (latest?.version ?? 0) + 1,
            name,
            description,
            eventType,
            conditions: conditions as unknown as Prisma.InputJsonValue,
            actions: actions as unknown as Prisma.InputJsonValue,
            createdByUserId: userId,
          },
        });
        await writeAudit(tx, scope, userId, "workflow.definition.created", "WorkflowDefinition", created.id, { code, version: created.version, eventType, actions: actions.map((action) => action.type) });
        return created;
      });
      const [view] = await this.definitionViews(scope, [definition]);
      return { definition: view!, webhookSecrets: secrets };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ConflictException("Une autre version de ce workflow vient d'être créée : réessayez");
      throw error;
    }
  }

  private parseConditions(raw: unknown, fields: Record<string, string>): WorkflowCondition[] {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw) || raw.length > 10) throw new BadRequestException("conditions : liste de 10 conditions au plus");
    return raw.map((item, index) => {
      const condition = assertBody(item);
      const field = exactEnum(condition.field, `conditions[${index}].field`, Object.keys(fields));
      const decimal = fields[field] === "decimal";
      const operator = exactEnum(condition.operator, `conditions[${index}].operator`, decimal ? DECIMAL_OPERATORS : TEXT_OPERATORS);
      const value = requiredText(condition.value, `conditions[${index}].value`, 200);
      if (decimal && !DECIMAL_PATTERN.test(value)) throw new BadRequestException(`conditions[${index}].value : montant décimal attendu`);
      return { field, operator, value };
    });
  }

  private parseActions(raw: unknown, roleIds: Set<string>, resourceType: string): { actions: StoredAction[]; secrets: Array<{ url: string; secret: string }> } {
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > 6) throw new BadRequestException("actions : 1 à 6 actions");
    const secrets: Array<{ url: string; secret: string }> = [];
    const role = (value: unknown, field: string): string => {
      const id = requiredId(value, field);
      if (!roleIds.has(id)) throw new BadRequestException(`${field} : rôle inconnu dans cette organisation`);
      return id;
    };
    const actions = raw.map((item, index): StoredAction => {
      const action = assertBody(item);
      const type = requiredEnum(action.type, `actions[${index}].type`, ["NOTIFY", "REQUIRE_APPROVAL", "WEBHOOK"] as const);
      if (type === "NOTIFY") {
        return { type, roleId: role(action.roleId, `actions[${index}].roleId`), title: requiredText(action.title, `actions[${index}].title`, 160), body: requiredText(action.body, `actions[${index}].body`, 1000) };
      }
      if (type === "REQUIRE_APPROVAL") {
        if (!(WORKFLOW_GATED_RESOURCES as readonly string[]).includes(resourceType)) {
          throw new BadRequestException("Une approbation de workflow ne peut être exigée que sur une demande d'achat, une facture fournisseur ou une situation de sous-traitance");
        }
        const approverRoleId = role(action.approverRoleId, `actions[${index}].approverRoleId`);
        const escalation = optionalId(action.escalationRoleId, `actions[${index}].escalationRoleId`);
        const escalationRoleId = escalation ? role(escalation, `actions[${index}].escalationRoleId`) : null;
        if (escalationRoleId === approverRoleId) throw new BadRequestException("Le rôle d'escalade doit différer du rôle approbateur");
        return { type, approverRoleId, escalationRoleId, slaHours: requiredInt(action.slaHours, `actions[${index}].slaHours`, { min: 1, max: 720 }), title: requiredText(action.title, `actions[${index}].title`, 160) };
      }
      const url = requiredText(action.url, `actions[${index}].url`, 500);
      const refusal = webhookTargetRefusal(url, allowPrivateWebhookTargets());
      if (refusal) throw new BadRequestException(`actions[${index}].url : ${refusal}`);
      const key = integrationKey();
      if (!key) throw new BadRequestException("Webhooks indisponibles : clé de chiffrement des intégrations non configurée sur le serveur");
      const secret = `whsec_${randomBytes(24).toString("base64url")}`;
      secrets.push({ url, secret });
      return { type, url, secretEnc: encryptSecret(secret, key) };
    });
    if (actions.filter((action) => action.type === "REQUIRE_APPROVAL").length > 1) throw new BadRequestException("Une seule approbation par workflow");
    const urls = actions.flatMap((action) => (action.type === "WEBHOOK" ? [action.url] : []));
    if (urls.length > 3 || new Set(urls).size !== urls.length) throw new BadRequestException("Webhooks : 3 cibles distinctes au plus");
    return { actions, secrets };
  }

  async setActive(scope: CompanyScope, id: string, body: unknown, userId: string): Promise<WorkflowDefinitionView> {
    const input = assertBody(body);
    if (typeof input.active !== "boolean") throw new BadRequestException("active doit être un booléen");
    const active = input.active;
    const definition = await this.prisma.$transaction(async (tx) => {
      const current = await tx.workflowDefinition.findFirst({ where: { ...scope, id } });
      if (!current) throw new NotFoundException("Workflow introuvable");
      if (active) await tx.workflowDefinition.updateMany({ where: { ...scope, code: current.code, active: true, NOT: { id } }, data: { active: false } });
      const updated = await tx.workflowDefinition.update({ where: { id }, data: { active } });
      await writeAudit(tx, scope, userId, active ? "workflow.definition.activated" : "workflow.definition.deactivated", "WorkflowDefinition", id, { code: current.code, version: current.version });
      return updated;
    });
    const [view] = await this.definitionViews(scope, [definition]);
    return view!;
  }

  // -------------------------------------------------------------------------
  // Journal d'execution
  // -------------------------------------------------------------------------

  async listExecutions(scope: CompanyScope, query: Record<string, unknown>): Promise<AutomationExecutionView[]> {
    const status = query.status === "FAILED" || query.status === "SUCCEEDED" ? query.status : undefined;
    const definitionId = typeof query.definitionId === "string" && query.definitionId ? query.definitionId : undefined;
    const rows = await this.prisma.automationExecution.findMany({
      where: { ...scope, ...(status ? { status } : {}), ...(definitionId ? { definitionId } : {}) },
      include: { definition: { select: { code: true, name: true } }, event: { select: { type: true, resourceType: true, resourceId: true } } },
      orderBy: { finishedAt: "desc" },
      take: 200,
    });
    return rows.map((row) => ({
      id: row.id,
      definitionId: row.definitionId,
      definitionCode: row.definition.code,
      definitionName: row.definition.name,
      eventType: row.event.type,
      eventLabel: eventLabel(row.event.type),
      resourceType: row.event.resourceType,
      resourceId: row.event.resourceId,
      status: row.status,
      log: row.log as unknown as ExecutionLogEntry[],
      error: row.error,
      finishedAt: row.finishedAt.toISOString(),
    }));
  }

  /** Traitement immediat (declenche par un administrateur ; le planificateur tourne aussi en tache de fond). */
  run(scope: CompanyScope): Promise<RunReport> {
    return this.automation.runOnce(scope);
  }

  // -------------------------------------------------------------------------
  // Approbations (quatre yeux, role approbateur, escalade)
  // -------------------------------------------------------------------------

  async listApprovals(scope: CompanyScope, user: AuthenticatedUser, query: Record<string, unknown>): Promise<WorkflowApprovalView[]> {
    const status = query.status === "PENDING" || query.status === "APPROVED" || query.status === "REJECTED" ? query.status : undefined;
    const rows = await this.prisma.workflowApproval.findMany({ where: { ...scope, ...(status ? { status } : {}) }, orderBy: [{ status: "asc" }, { dueAt: "asc" }], take: 200 });
    return this.approvalViews(scope, user, rows);
  }

  private async approvalViews(scope: CompanyScope, user: AuthenticatedUser, rows: Array<Prisma.WorkflowApprovalGetPayload<object>>): Promise<WorkflowApprovalView[]> {
    const [roles, users, events, mine] = await Promise.all([
      this.prisma.role.findMany({ where: { organizationId: scope.organizationId }, select: { id: true, name: true } }),
      this.prisma.user.findMany({ where: { id: { in: rows.flatMap((row) => [row.requesterUserId, row.decidedByUserId]).filter((id): id is string => Boolean(id)) } }, select: { id: true, fullName: true } }),
      this.prisma.automationEvent.findMany({ where: { id: { in: rows.map((row) => row.eventId) } }, select: { id: true, payload: true } }),
      userRoleIds(this.prisma, scope, user.id),
    ]);
    const roleName = new Map(roles.map((role) => [role.id, role.name]));
    const userName = new Map(users.map((entry) => [entry.id, entry.fullName]));
    const link = new Map(events.map((event) => [event.id, ((event.payload ?? {}) as { link?: string | null }).link ?? null]));
    const now = Date.now();
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      title: row.title,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      link: link.get(row.eventId) ?? null,
      requesterName: row.requesterUserId ? (userName.get(row.requesterUserId) ?? "—") : null,
      approverRoleName: roleName.get(row.approverRoleId) ?? "Rôle supprimé",
      dueAt: row.dueAt.toISOString(),
      overdue: row.status === "PENDING" && row.dueAt.getTime() < now,
      escalatedAt: row.escalatedAt?.toISOString() ?? null,
      status: row.status,
      decidedByName: row.decidedByUserId ? (userName.get(row.decidedByUserId) ?? "—") : null,
      decidedAt: row.decidedAt?.toISOString() ?? null,
      decisionNote: row.decisionNote,
      canDecide: row.status === "PENDING" && row.requesterUserId !== user.id && (mine.has(row.approverRoleId) || Boolean(row.escalatedAt && row.escalationRoleId && mine.has(row.escalationRoleId))),
    }));
  }

  async decideApproval(scope: CompanyScope, id: string, body: unknown, user: AuthenticatedUser): Promise<WorkflowApprovalView> {
    const input = assertBody(body);
    const decision = requiredEnum(input.decision, "decision", ["APPROVED", "REJECTED"] as const);
    const note = optionalText(input.note, "note", 1000);
    if (decision === "REJECTED" && !note) throw new BadRequestException("Un motif est obligatoire pour refuser");
    const updated = await this.prisma.$transaction(async (tx) => {
      const approval = await tx.workflowApproval.findFirst({ where: { ...scope, id } });
      if (!approval) throw new NotFoundException("Approbation introuvable");
      if (approval.status !== "PENDING") throw new ConflictException(`Approbation ${approval.code} déjà décidée`);
      if (approval.requesterUserId === user.id) throw new ForbiddenException("Principe des quatre yeux : le demandeur ne peut pas décider sa propre approbation");
      const roles = await userRoleIds(tx, scope, user.id);
      const holder = roles.has(approval.approverRoleId) || Boolean(approval.escalatedAt && approval.escalationRoleId && roles.has(approval.escalationRoleId));
      if (!holder) throw new ForbiddenException("Vous n'êtes pas titulaire du rôle approbateur de cette demande");
      const claimed = await tx.workflowApproval.updateMany({ where: { id, status: "PENDING" }, data: { status: decision, decidedByUserId: user.id, decidedAt: new Date(), decisionNote: note } });
      if (claimed.count !== 1) throw new ConflictException(`Approbation ${approval.code} déjà décidée`);
      await writeAudit(tx, scope, user.id, decision === "APPROVED" ? "workflow.approval.approved" : "workflow.approval.rejected", "WorkflowApproval", id, { code: approval.code, resourceType: approval.resourceType, resourceId: approval.resourceId, note });
      if (approval.requesterUserId) {
        await tx.notification.create({
          data: {
            ...scope,
            userId: approval.requesterUserId,
            executionId: approval.executionId,
            title: `${approval.code} ${decision === "APPROVED" ? "approuvée" : "refusée"} — ${approval.title}`.slice(0, 200),
            body: note ? `Motif : ${note}` : `Décision de ${user.fullName}.`,
            link: "/workflow?tab=approvals",
          },
        });
      }
      return tx.workflowApproval.findUniqueOrThrow({ where: { id } });
    });
    const [view] = await this.approvalViews(scope, user, [updated]);
    return view!;
  }

  // -------------------------------------------------------------------------
  // Webhooks sortants
  // -------------------------------------------------------------------------

  async listDeliveries(scope: CompanyScope): Promise<WebhookDeliveryView[]> {
    const rows = await this.prisma.webhookDelivery.findMany({ where: scope, orderBy: { createdAt: "desc" }, take: 200 });
    const definitions = await this.prisma.workflowDefinition.findMany({ where: { id: { in: [...new Set(rows.map((row) => row.definitionId))] } }, select: { id: true, code: true } });
    const code = new Map(definitions.map((definition) => [definition.id, definition.code]));
    return rows.map((row) => this.deliveryView(row, code.get(row.definitionId) ?? "—"));
  }

  private deliveryView(row: Prisma.WebhookDeliveryGetPayload<object>, definitionCode: string): WebhookDeliveryView {
    return {
      id: row.id,
      definitionId: row.definitionId,
      definitionCode,
      url: row.url,
      status: row.status,
      attempts: row.attempts,
      lastStatusCode: row.lastStatusCode,
      lastError: row.lastError,
      nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null,
      deliveredAt: row.deliveredAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async retryDelivery(scope: CompanyScope, id: string, userId: string): Promise<WebhookDeliveryView> {
    await this.prisma.$transaction(async (tx) => {
      const delivery = await tx.webhookDelivery.findFirst({ where: { ...scope, id } });
      if (!delivery) throw new NotFoundException("Livraison introuvable");
      if (delivery.status !== "FAILED") throw new ConflictException("Seule une livraison en échec peut être relancée");
      await tx.webhookDelivery.update({ where: { id }, data: { status: "PENDING", nextAttemptAt: new Date() } });
      await writeAudit(tx, scope, userId, "workflow.webhook.retried", "WebhookDelivery", id, { attempts: delivery.attempts });
    });
    await this.automation.deliverDue(scope, new Date(), id);
    const row = await this.prisma.webhookDelivery.findUniqueOrThrow({ where: { id } });
    const definition = await this.prisma.workflowDefinition.findUnique({ where: { id: row.definitionId }, select: { code: true } });
    return this.deliveryView(row, definition?.code ?? "—");
  }

  // -------------------------------------------------------------------------
  // Notifications de l'utilisateur de la session
  // -------------------------------------------------------------------------

  private async notificationScope(user: AuthenticatedUser): Promise<Prisma.NotificationWhereInput> {
    const memberships = await this.prisma.companyMembership.findMany({ where: { userId: user.id, company: { organizationId: user.organizationId } }, select: { companyId: true } });
    return { userId: user.id, organizationId: user.organizationId, companyId: { in: memberships.map((membership) => membership.companyId) } };
  }

  async myNotifications(user: AuthenticatedUser): Promise<{ unread: number; items: NotificationView[] }> {
    const where = await this.notificationScope(user);
    const [unread, rows] = await Promise.all([
      this.prisma.notification.count({ where: { ...where, readAt: null } }),
      this.prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, take: 30 }),
    ]);
    return {
      unread,
      items: rows.map((row) => ({ id: row.id, title: row.title, body: row.body, link: row.link, readAt: row.readAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString() })),
    };
  }

  async markRead(user: AuthenticatedUser, id: string | null): Promise<{ unread: number; items: NotificationView[] }> {
    const where = await this.notificationScope(user);
    const updated = await this.prisma.notification.updateMany({ where: { ...where, readAt: null, ...(id ? { id } : {}) }, data: { readAt: new Date() } });
    if (id && updated.count === 0 && !(await this.prisma.notification.count({ where: { ...where, id } }))) throw new NotFoundException("Notification introuvable");
    return this.myNotifications(user);
  }
}
