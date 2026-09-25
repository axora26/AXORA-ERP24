import { createHash } from "node:crypto";
import { Injectable, NotFoundException } from "@nestjs/common";
import type {
  CopilotAnswerBlock,
  CopilotAskResult,
  CopilotCapabilityView,
  CopilotEvidenceView,
  CopilotPermissionCheck,
  CopilotSessionDetail,
  CopilotSessionView,
  CopilotSourceRef,
  DashboardKpi,
} from "@axora24/contracts";
import type { Prisma } from "@axora24/database";
import { PrismaService } from "../core/prisma.service.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import type { AuthenticatedUser } from "../auth/session.guard.js";
import { assertBody, optionalId, requiredText } from "../common/validation.js";
import { DASHBOARD_SECTIONS } from "../dashboard/sections/index.js";
import { formatAmount, planQuestion, renderAnswer, type PlanMode } from "./planner.js";
import { COPILOT_TOOLS, REFERENCE_HANDLERS, granted, type ToolContext, type ToolOutput, type ToolSource } from "./tools.js";

/** Moteur de reponse : deterministe, ancre sur les donnees, sans modele generatif. */
export const COPILOT_ENGINE = "axora-grounded-v1";

const SECTION_LABEL: Record<string, string> = {
  crm: "CRM",
  sales: "Devis & contrats",
  projects: "Projets",
  procurement: "Achats",
  inventory: "Stock",
  finance: "Finance",
  hr: "Ressources humaines",
  field: "Chantier",
  qhse: "QHSE",
  assets: "GMAO",
  smart: "Smart Building",
  energy: "Énergie",
  fleet: "Parc",
  subcontracting: "Sous-traitance",
  workflow: "Workflows",
  documents: "GED",
};

function kpiValue(kpi: DashboardKpi): string {
  if (kpi.kind === "money") return kpi.amounts.map((amount) => formatAmount(amount.amount, amount.currency)).join(" + ") || "0,00";
  return kpi.kind === "percent" ? `${kpi.value} %` : kpi.value;
}

/**
 * INC-22 — Copilote (BC-22). Il herite strictement des droits de
 * l'utilisateur : les permissions consultees sont celles que la garde RBAC a
 * resolues pour la requete, et chaque outil de lecture exige la sienne.
 * Chaque question produit une preuve d'inference append-only, y compris
 * quand l'acces est refuse ou que la question est hors perimetre.
 */
@Injectable()
export class CopilotService {
  constructor(private readonly prisma: PrismaService) {}

  capabilities(permissions: Set<string>): CopilotCapabilityView[] {
    return COPILOT_TOOLS.map((tool) => ({ tool: tool.id, label: tool.label, permission: tool.permissions.join(" | "), granted: granted(tool, permissions), example: tool.example }));
  }

  async ask(scope: CompanyScope, user: AuthenticatedUser, permissions: Set<string>, body: unknown): Promise<CopilotAskResult> {
    const startedAt = Date.now();
    const input = assertBody(body);
    const question = requiredText(input.question, "question", 500);
    const sessionId = optionalId(input.sessionId, "sessionId");
    if (sessionId && !(await this.prisma.aiCopilotSession.findFirst({ where: { ...scope, id: sessionId, userId: user.id }, select: { id: true } }))) {
      throw new NotFoundException("Conversation introuvable");
    }

    const plan = planQuestion(question, COPILOT_TOOLS);
    const context: ToolContext = { prisma: this.prisma, scope, userId: user.id, permissions, now: new Date() };
    const checks: CopilotPermissionCheck[] = [];
    const blocks: CopilotAnswerBlock[] = [];
    const sources: CopilotSourceRef[] = [];

    const cite = (tool: string, source: ToolSource): number => {
      const existing = sources.find((entry) => entry.resourceType === source.resourceType && entry.resourceId === source.resourceId);
      if (existing) return existing.index;
      sources.push({ index: sources.length + 1, tool, ...source });
      return sources.length;
    };
    const addBlock = (tool: string, output: ToolOutput) => blocks.push({ title: output.title, tool, lines: output.facts.map((fact) => ({ text: fact.text, cites: fact.sources.map((source) => cite(tool, source)) })) });

    const runTools = async (ids: string[]) => {
      for (const id of ids) {
        const tool = COPILOT_TOOLS.find((candidate) => candidate.id === id)!;
        const ok = granted(tool, permissions);
        checks.push({ tool: tool.id, label: tool.label, permission: tool.permissions.join(" | "), granted: ok });
        if (ok) addBlock(tool.id, await tool.run(context));
      }
    };

    if (plan.mode === "BRIEFING") {
      const lines: CopilotAnswerBlock["lines"] = [];
      for (const section of DASHBOARD_SECTIONS) {
        const ok = permissions.has(section.permission);
        checks.push({ tool: `dashboard.${section.key}`, label: SECTION_LABEL[section.key] ?? section.key, permission: section.permission, granted: ok });
        if (!ok) continue;
        for (const kpi of await section.build(this.prisma, scope)) {
          lines.push({ text: `${kpi.label} : ${kpiValue(kpi)} — ${kpi.detail}`, cites: [cite(`dashboard.${section.key}`, { resourceType: "DashboardKpi", resourceId: kpi.key, label: kpi.label, link: kpi.href })] });
        }
      }
      blocks.push({ title: "Synthèse", tool: "dashboard", lines: lines.length ? lines : [{ text: "Aucun indicateur disponible dans votre périmètre de lecture.", cites: [] }] });
    } else if (plan.mode === "TOOLS") {
      await runTools(plan.tools);
    } else if (plan.mode === "LOOKUP") {
      const lines: CopilotAnswerBlock["lines"] = [];
      for (const reference of plan.references) {
        const prefix = reference.split("-")[0]!;
        const handler = REFERENCE_HANDLERS[prefix];
        if (!handler) {
          lines.push({ text: `${reference} : ce type de pièce n'est pas encore consultable par le copilote.`, cites: [] });
          continue;
        }
        const ok = granted(handler, permissions);
        checks.push({ tool: `lookup.${prefix}`, label: handler.label, permission: handler.permissions.join(" | "), granted: ok });
        if (!ok) continue;
        const fact = await handler.find(context, reference);
        // Meme message qu'une piece inexistante : ne jamais reveler une piece hors perimetre.
        lines.push(fact ? { text: fact.text, cites: fact.sources.map((source) => cite(`lookup.${prefix}`, source)) } : { text: `Aucune pièce ${reference} trouvée dans votre périmètre.`, cites: [] });
      }
      if (lines.length) blocks.push({ title: "Pièces demandées", tool: "lookup", lines });
      await runTools(plan.tools);
    } else {
      const available = COPILOT_TOOLS.filter((tool) => granted(tool, permissions));
      for (const tool of COPILOT_TOOLS) checks.push({ tool: tool.id, label: tool.label, permission: tool.permissions.join(" | "), granted: granted(tool, permissions) });
      blocks.push({
        title: "Question hors de mon périmètre",
        tool: "help",
        lines: [
          { text: "Je réponds uniquement à partir des données de l'ERP auxquelles vos droits donnent accès ; je ne formule aucune réponse que je ne peux pas sourcer.", cites: [] },
          ...(available.length
            ? available.map((tool) => ({ text: `${tool.label} — par exemple : « ${tool.example} »`, cites: [] }))
            : [{ text: "Vos droits actuels ne donnent accès à aucune source de données interrogeable. Demandez à votre administrateur les permissions de lecture nécessaires.", cites: [] }]),
          { text: "Vous pouvez aussi citer une pièce (ex. DA-2026-0007, FF-2026-0012, PRJ-2026-0001) ou demander une synthèse.", cites: [] },
        ],
      });
    }

    const denied = checks.filter((check) => !check.granted);
    if (plan.mode !== "HELP" && denied.length > 0) {
      blocks.push({
        title: "Non consulté (droits insuffisants)",
        tool: "rbac",
        lines: denied.map((check) => ({ text: `${check.label} : permission ${check.permission} absente — aucune donnée de ce domaine n'a été lue.`, cites: [] })),
      });
    }

    const answer = renderAnswer(blocks);
    const answerSha256 = createHash("sha256").update(answer, "utf8").digest("hex");
    const evidence = await this.prisma.$transaction(async (tx) => {
      const session = sessionId
        ? await tx.aiCopilotSession.update({ where: { id: sessionId }, data: { lastActivityAt: new Date() } })
        : await tx.aiCopilotSession.create({ data: { ...scope, userId: user.id, title: question.slice(0, 120) } });
      return tx.aiInferenceEvidence.create({
        data: {
          ...scope,
          userId: user.id,
          sessionId: session.id,
          question,
          mode: plan.mode,
          permissionChecks: checks as unknown as Prisma.InputJsonValue,
          sources: sources as unknown as Prisma.InputJsonValue,
          blocks: blocks as unknown as Prisma.InputJsonValue,
          answer,
          answerSha256,
          engine: COPILOT_ENGINE,
          modelProvider: null,
          latencyMs: Date.now() - startedAt,
        },
      });
    });
    return { sessionId: evidence.sessionId, evidence: this.evidenceView(evidence, user.fullName) };
  }

  private evidenceView(row: Prisma.AiInferenceEvidenceGetPayload<object>, userName: string): CopilotEvidenceView {
    return {
      id: row.id,
      sessionId: row.sessionId,
      userName,
      question: row.question,
      mode: row.mode as PlanMode,
      answer: row.answer,
      blocks: row.blocks as unknown as CopilotAnswerBlock[],
      sources: row.sources as unknown as CopilotSourceRef[],
      permissionChecks: row.permissionChecks as unknown as CopilotPermissionCheck[],
      engine: row.engine,
      modelProvider: row.modelProvider,
      answerSha256: row.answerSha256,
      latencyMs: row.latencyMs,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async sessions(scope: CompanyScope, user: AuthenticatedUser): Promise<CopilotSessionView[]> {
    const rows = await this.prisma.aiCopilotSession.findMany({ where: { ...scope, userId: user.id }, include: { _count: { select: { evidences: true } } }, orderBy: { lastActivityAt: "desc" }, take: 50 });
    return rows.map((row) => ({ id: row.id, title: row.title, createdAt: row.createdAt.toISOString(), lastActivityAt: row.lastActivityAt.toISOString(), exchanges: row._count.evidences }));
  }

  /** Une conversation n'est lisible que par son auteur (meme message qu'une conversation inexistante). */
  async session(scope: CompanyScope, user: AuthenticatedUser, id: string): Promise<CopilotSessionDetail> {
    const row = await this.prisma.aiCopilotSession.findFirst({ where: { ...scope, id, userId: user.id }, include: { evidences: { orderBy: { createdAt: "asc" } } } });
    if (!row) throw new NotFoundException("Conversation introuvable");
    return {
      id: row.id,
      title: row.title,
      createdAt: row.createdAt.toISOString(),
      lastActivityAt: row.lastActivityAt.toISOString(),
      exchanges: row.evidences.length,
      exchangesDetail: row.evidences.map((evidence) => this.evidenceView(evidence, user.fullName)),
    };
  }

  /** Journal d'audit des preuves d'inference de l'entreprise. */
  async evidence(scope: CompanyScope, query: Record<string, unknown>): Promise<CopilotEvidenceView[]> {
    const userId = typeof query.userId === "string" && query.userId ? query.userId : undefined;
    const rows = await this.prisma.aiInferenceEvidence.findMany({ where: { ...scope, ...(userId ? { userId } : {}) }, orderBy: { createdAt: "desc" }, take: 200 });
    const users = new Map((await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((row) => row.userId))] } }, select: { id: true, fullName: true } })).map((entry) => [entry.id, entry.fullName]));
    return rows.map((row) => this.evidenceView(row, users.get(row.userId) ?? "—"));
  }
}
