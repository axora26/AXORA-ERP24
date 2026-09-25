import { randomUUID } from "node:crypto";
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { AUTOMATION_EVENTS, type AutomationEventType, type WorkflowCondition } from "@axora24/contracts";
import { Prisma } from "@axora24/database";
import { decryptSecret, parseEncryptionKey } from "@axora24/security";
import { PrismaService } from "../core/prisma.service.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import { NumberingService } from "../common/numbering.service.js";
import { writeAudit } from "../common/audit.js";
import { allConditionsHold, nextRetryDelayMs, render, signWebhook, webhookTargetRefusal } from "./engine.js";

type Tx = Prisma.TransactionClient;
type Client = Tx | PrismaService;

/** Forme stockee des actions (le secret de webhook est chiffre et jamais expose). */
export type StoredAction =
  | { type: "NOTIFY"; roleId: string; title: string; body: string }
  | { type: "REQUIRE_APPROVAL"; approverRoleId: string; escalationRoleId: string | null; slaHours: number; title: string }
  | { type: "WEBHOOK"; url: string; secretEnc: string };

export interface ExecutionLogEntry {
  action: string;
  ok: boolean;
  detail: string;
}

export interface EmitInput {
  type: AutomationEventType;
  resourceId: string;
  actorUserId: string | null;
  /** Lien interne vers la ressource (notifications). */
  link: string | null;
  payload: Record<string, string | null>;
}

export interface RunReport {
  events: number;
  executions: number;
  deliveries: number;
  escalations: number;
}

const DELIVERY_TIMEOUT_MS = 5_000;
const DELIVERY_LEASE_MS = 2 * 60_000;
const TICK_MS = 15_000;

export function integrationKey(): Buffer | null {
  return parseEncryptionKey(process.env.INTEGRATION_ENCRYPTION_KEY);
}

export function allowPrivateWebhookTargets(): boolean {
  return process.env.WEBHOOK_ALLOW_PRIVATE_TARGETS === "true";
}

/** Membres actifs d'un role dans l'entreprise (affectation entreprise ou organisation). */
export async function roleMembers(client: Client, scope: CompanyScope, roleId: string): Promise<string[]> {
  const rows = await client.roleAssignment.findMany({
    where: {
      roleId,
      role: { organizationId: scope.organizationId },
      OR: [{ companyId: null }, { companyId: scope.companyId }],
      user: { isActive: true, organizationId: scope.organizationId, companyMemberships: { some: { companyId: scope.companyId } } },
    },
    select: { userId: true },
  });
  return [...new Set(rows.map((row) => row.userId))];
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function message(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

/**
 * INC-21 — Moteur d'automatisation (BC-21).
 *
 * - `emit` ecrit l'evenement dans la MEME transaction que la mutation metier
 *   (outbox) : pas d'evenement sans mutation, pas de mutation sans evenement.
 * - Le traitement est asynchrone et idempotent : une execution est unique par
 *   (definition, evenement) ; ses effets (notifications, approbation, livraison
 *   de webhook) sont ecrits dans la meme transaction que la ligne d'execution.
 * - Toute execution est journalisee, succes comme echec.
 * - Les webhooks sont livres hors transaction, re-signes a chaque tentative,
 *   avec un calendrier de nouvelles tentatives borne.
 */
@Injectable()
export class AutomationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("Automation");
  private timer: NodeJS.Timeout | null = null;
  private kickTimer: NodeJS.Timeout | null = null;
  private running: Promise<RunReport> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
  ) {}

  private get autorun(): boolean {
    return process.env.AUTOMATION_AUTORUN !== "false";
  }

  onModuleInit(): void {
    if (!this.autorun) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.kickTimer) clearTimeout(this.kickTimer);
  }

  async emit(tx: Tx, scope: CompanyScope, input: EmitInput): Promise<void> {
    const definition = AUTOMATION_EVENTS[input.type];
    await tx.automationEvent.create({
      data: {
        organizationId: scope.organizationId,
        companyId: scope.companyId,
        type: input.type,
        resourceType: definition.resourceType,
        resourceId: input.resourceId,
        actorUserId: input.actorUserId,
        payload: { ...input.payload, link: input.link },
      },
    });
    this.kick();
  }

  /** Traitement differe (apres validation de la transaction emettrice). */
  private kick(): void {
    if (!this.autorun || this.kickTimer) return;
    this.kickTimer = setTimeout(() => {
      this.kickTimer = null;
      void this.tick();
    }, 300);
    this.kickTimer.unref();
  }

  private async tick(): Promise<void> {
    try {
      await this.runOnce();
    } catch (error) {
      this.logger.error(`Automation tick failed: ${message(error)}`);
    }
  }

  /** Un seul cycle a la fois par instance ; l'unicite (definition, evenement) protege entre instances. */
  runOnce(scope?: CompanyScope, now = new Date()): Promise<RunReport> {
    if (this.running) return this.running.then(() => this.runOnce(scope, now));
    this.running = this.cycle(scope, now).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async cycle(scope: CompanyScope | undefined, now: Date): Promise<RunReport> {
    const report: RunReport = { events: 0, executions: 0, deliveries: 0, escalations: 0 };
    const events = await this.prisma.automationEvent.findMany({
      where: { processedAt: null, ...(scope ?? {}) },
      orderBy: { occurredAt: "asc" },
      take: 200,
    });
    for (const event of events) {
      report.executions += await this.processEvent(event);
      report.events += 1;
    }
    report.escalations = await this.processEscalations(scope, now);
    // Horloge fraiche : les livraisons creees pendant ce cycle sont dues immediatement.
    report.deliveries = await this.deliverDue(scope, new Date(Math.max(now.getTime(), Date.now())));
    return report;
  }

  private async processEvent(event: Prisma.AutomationEventGetPayload<object>): Promise<number> {
    const scope = { organizationId: event.organizationId, companyId: event.companyId };
    // Une definition ne s'applique qu'aux evenements posterieurs a sa creation (pas de retroactivite).
    const definitions = await this.prisma.workflowDefinition.findMany({
      where: { ...scope, eventType: event.type, active: true, createdAt: { lte: event.occurredAt } },
      orderBy: { createdAt: "asc" },
    });
    let executions = 0;
    for (const definition of definitions) {
      if (await this.runDefinition(scope, definition, event)) executions += 1;
    }
    await this.prisma.automationEvent.updateMany({ where: { id: event.id, processedAt: null }, data: { processedAt: new Date() } });
    return executions;
  }

  private async runDefinition(
    scope: CompanyScope,
    definition: Prisma.WorkflowDefinitionGetPayload<object>,
    event: Prisma.AutomationEventGetPayload<object>,
  ): Promise<boolean> {
    const catalog = AUTOMATION_EVENTS[event.type as AutomationEventType];
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    if (!catalog || !allConditionsHold(definition.conditions as unknown as WorkflowCondition[], payload, catalog.fields)) return false;
    const startedAt = new Date();
    const executionId = randomUUID();
    try {
      return await this.prisma.$transaction(async (tx) => {
        const done = await tx.automationExecution.findUnique({ where: { definitionId_eventId: { definitionId: definition.id, eventId: event.id } }, select: { id: true } });
        if (done) return false;
        const log: ExecutionLogEntry[] = [];
        for (const action of definition.actions as unknown as StoredAction[]) {
          log.push(await this.runAction(tx, scope, executionId, definition, event, payload, action));
        }
        const failure = log.find((entry) => !entry.ok);
        await tx.automationExecution.create({
          data: {
            id: executionId,
            ...scope,
            definitionId: definition.id,
            eventId: event.id,
            status: failure ? "FAILED" : "SUCCEEDED",
            log: log as unknown as Prisma.InputJsonValue,
            error: failure ? failure.detail : null,
            startedAt,
          },
        });
        return true;
      });
    } catch (error) {
      if (isUniqueViolation(error)) return false;
      this.logger.warn(`Workflow ${definition.code} v${definition.version} failed on event ${event.id}: ${message(error)}`);
      await this.prisma.automationExecution
        .create({ data: { ...scope, definitionId: definition.id, eventId: event.id, status: "FAILED", log: [], error: message(error), startedAt } })
        .catch(() => undefined);
      return true;
    }
  }

  private async runAction(
    tx: Tx,
    scope: CompanyScope,
    executionId: string,
    definition: Prisma.WorkflowDefinitionGetPayload<object>,
    event: Prisma.AutomationEventGetPayload<object>,
    payload: Record<string, unknown>,
    action: StoredAction,
  ): Promise<ExecutionLogEntry> {
    const link = typeof payload.link === "string" ? payload.link : null;
    if (action.type === "NOTIFY") {
      const recipients = await roleMembers(tx, scope, action.roleId);
      const role = await tx.role.findUnique({ where: { id: action.roleId }, select: { name: true } });
      if (recipients.length === 0) return { action: "NOTIFY", ok: false, detail: `Aucun destinataire actif pour le rôle ${role?.name ?? "supprimé"}` };
      await tx.notification.createMany({
        data: recipients.map((userId) => ({ ...scope, userId, executionId, title: render(action.title, payload).slice(0, 200), body: render(action.body, payload).slice(0, 2000), link })),
      });
      return { action: "NOTIFY", ok: true, detail: `${recipients.length} notification(s) — rôle ${role?.name}` };
    }

    if (action.type === "REQUIRE_APPROVAL") {
      const code = await this.numbering.next(tx, scope, "WFA");
      const dueAt = new Date(Date.now() + action.slaHours * 3_600_000);
      const title = render(action.title, payload).slice(0, 200);
      const approval = await tx.workflowApproval.create({
        data: {
          ...scope,
          code,
          definitionId: definition.id,
          eventId: event.id,
          executionId,
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          title,
          requesterUserId: event.actorUserId,
          approverRoleId: action.approverRoleId,
          escalationRoleId: action.escalationRoleId,
          dueAt,
        },
      });
      await writeAudit(tx, scope, null, "workflow.approval.requested", "WorkflowApproval", approval.id, { code, resourceType: event.resourceType, resourceId: event.resourceId, definition: definition.code });
      const approvers = (await roleMembers(tx, scope, action.approverRoleId)).filter((userId) => userId !== event.actorUserId);
      const role = await tx.role.findUnique({ where: { id: action.approverRoleId }, select: { name: true } });
      if (approvers.length > 0) {
        await tx.notification.createMany({
          data: approvers.map((userId) => ({ ...scope, userId, executionId, title: `Approbation requise — ${title}`.slice(0, 200), body: `${code} : décision attendue avant le ${dueAt.toISOString().slice(0, 16).replace("T", " ")} UTC.`, link: "/workflow?tab=approvals" })),
        });
      }
      // Fail-closed : l'approbation reste bloquante meme sans approbateur disponible.
      return approvers.length > 0
        ? { action: "REQUIRE_APPROVAL", ok: true, detail: `${code} créée — rôle ${role?.name}, ${approvers.length} approbateur(s) notifié(s)` }
        : { action: "REQUIRE_APPROVAL", ok: false, detail: `${code} créée mais aucun approbateur distinct du demandeur dans le rôle ${role?.name ?? "supprimé"}` };
    }

    const deliveryId = randomUUID();
    const data = Object.fromEntries(Object.entries(payload).filter(([key]) => key !== "link"));
    const body = JSON.stringify({ id: deliveryId, type: event.type, occurredAt: event.occurredAt.toISOString(), resource: { type: event.resourceType, id: event.resourceId }, workflow: { code: definition.code, version: definition.version }, data });
    await tx.webhookDelivery.create({ data: { id: deliveryId, ...scope, executionId, definitionId: definition.id, url: action.url, body, timestamp: "", signature: "", nextAttemptAt: new Date() } });
    return { action: "WEBHOOK", ok: true, detail: `Livraison planifiée vers ${new URL(action.url).host}` };
  }

  /** Approbations echues : escalade unique vers le role d'escalade (ou relance des approbateurs). */
  private async processEscalations(scope: CompanyScope | undefined, now: Date): Promise<number> {
    const overdue = await this.prisma.workflowApproval.findMany({ where: { status: "PENDING", escalatedAt: null, dueAt: { lt: now }, ...(scope ?? {}) }, take: 100 });
    let escalated = 0;
    for (const approval of overdue) {
      const approvalScope = { organizationId: approval.organizationId, companyId: approval.companyId };
      const done = await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.workflowApproval.updateMany({ where: { id: approval.id, status: "PENDING", escalatedAt: null }, data: { escalatedAt: now } });
        if (claimed.count !== 1) return false;
        const roleId = approval.escalationRoleId ?? approval.approverRoleId;
        const recipients = (await roleMembers(tx, approvalScope, roleId)).filter((userId) => userId !== approval.requesterUserId);
        if (recipients.length > 0) {
          await tx.notification.createMany({
            data: recipients.map((userId) => ({ ...approvalScope, userId, executionId: approval.executionId, title: `Escalade — ${approval.title}`.slice(0, 200), body: `${approval.code} n'a pas été décidée dans le délai (échéance ${approval.dueAt.toISOString().slice(0, 16).replace("T", " ")} UTC).`, link: "/workflow?tab=approvals" })),
          });
        }
        await writeAudit(tx, approvalScope, null, "workflow.approval.escalated", "WorkflowApproval", approval.id, { code: approval.code, roleId, recipients: recipients.length });
        return true;
      });
      if (done) escalated += 1;
    }
    return escalated;
  }

  /** Livre les webhooks dus. Chaque tentative est reservee (bail) pour eviter un double envoi entre instances. */
  async deliverDue(scope: CompanyScope | undefined, now = new Date(), onlyId?: string): Promise<number> {
    const due = await this.prisma.webhookDelivery.findMany({
      where: { status: "PENDING", OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }], ...(scope ?? {}), ...(onlyId ? { id: onlyId } : {}) },
      orderBy: { createdAt: "asc" },
      take: 25,
    });
    let attempted = 0;
    for (const delivery of due) {
      if (await this.attempt(delivery)) attempted += 1;
    }
    return attempted;
  }

  private async attempt(delivery: Prisma.WebhookDeliveryGetPayload<object>): Promise<boolean> {
    const claimed = await this.prisma.webhookDelivery.updateMany({
      where: { id: delivery.id, status: "PENDING", attempts: delivery.attempts },
      data: { attempts: { increment: 1 }, nextAttemptAt: new Date(Date.now() + DELIVERY_LEASE_MS) },
    });
    if (claimed.count !== 1) return false;
    const attempts = delivery.attempts + 1;
    const timestamp = String(Math.floor(Date.now() / 1000));
    let signature = "";
    let statusCode: number | null = null;
    let error: string | null = null;
    try {
      const secret = await this.secretFor(delivery.definitionId, delivery.url);
      signature = signWebhook(secret, timestamp, delivery.body);
      const refusal = webhookTargetRefusal(delivery.url, allowPrivateWebhookTargets());
      if (refusal) throw new Error(`Cible refusée : ${refusal}`);
      const event = (JSON.parse(delivery.body) as { type?: string }).type ?? "";
      const response = await fetch(delivery.url, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": "AXORA-ERP24-Webhooks/1", "x-axora-delivery": delivery.id, "x-axora-event": event, "x-axora-timestamp": timestamp, "x-axora-signature": signature },
        body: delivery.body,
        redirect: "manual",
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
      });
      statusCode = response.status;
      await response.body?.cancel().catch(() => undefined);
      if (statusCode < 200 || statusCode >= 300) error = `Réponse HTTP ${statusCode}`;
    } catch (caught) {
      error = caught instanceof Error && caught.name === "TimeoutError" ? `Délai dépassé (${DELIVERY_TIMEOUT_MS / 1000} s)` : message(caught).replace(/^fetch failed$/, "Connexion impossible");
      const cause = caught instanceof Error && caught.cause instanceof Error ? caught.cause.message : null;
      if (cause && error === "Connexion impossible") error = `Connexion impossible : ${cause}`.slice(0, 300);
    }
    if (!error) {
      await this.prisma.webhookDelivery.update({ where: { id: delivery.id }, data: { status: "DELIVERED", deliveredAt: new Date(), lastStatusCode: statusCode, lastError: null, nextAttemptAt: null, timestamp, signature } });
      return true;
    }
    const delay = nextRetryDelayMs(attempts);
    await this.prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: { status: delay === null ? "FAILED" : "PENDING", nextAttemptAt: delay === null ? null : new Date(Date.now() + delay), lastStatusCode: statusCode, lastError: error.slice(0, 300), timestamp, signature },
    });
    return true;
  }

  private async secretFor(definitionId: string, url: string): Promise<string> {
    const key = integrationKey();
    if (!key) throw new Error("Clé de chiffrement des intégrations absente (INTEGRATION_ENCRYPTION_KEY)");
    const definition = await this.prisma.workflowDefinition.findUnique({ where: { id: definitionId }, select: { actions: true } });
    const action = ((definition?.actions ?? []) as unknown as StoredAction[]).find((candidate) => candidate.type === "WEBHOOK" && candidate.url === url);
    if (!action || action.type !== "WEBHOOK") throw new Error("Secret de signature introuvable");
    return decryptSecret(action.secretEnc, key);
  }
}
