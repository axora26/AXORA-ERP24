import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@axora24/database";
import type {
  ProjectCostCategory,
  ProjectForecastLineInput,
  ProjectForecastRevisionView,
} from "@axora24/contracts";
import { PROJECT_PERMISSIONS } from "@axora24/contracts";
import type { CompanyScope } from "../common/company-scope.service.js";
import { PrismaService } from "../core/prisma.service.js";
import { projectCostFigures } from "./project-costs.js";

const CATEGORIES: ProjectCostCategory[] = [
  "MATERIAL",
  "LABOR",
  "EQUIPMENT",
  "SUBCONTRACT",
  "OVERHEAD",
  "OTHER",
];

type ForecastBody = {
  justification?: unknown;
  revisedBudget?: unknown;
  lines?: unknown;
};

const asMoney = (value: unknown, field: string): Prisma.Decimal => {
  try {
    const decimal = new Prisma.Decimal(String(value ?? ""));
    if (!decimal.isFinite() || decimal.isNegative()) throw new Error("invalid");
    return decimal.toDecimalPlaces(2);
  } catch {
    throw new BadRequestException(`${field} doit être un montant positif ou nul`);
  }
};

const asLine = (value: unknown): ProjectForecastLineInput => {
  if (!value || typeof value !== "object") throw new BadRequestException("Chaque ligne de prévision est invalide");
  const input = value as Record<string, unknown>;
  if (!CATEGORIES.includes(input.category as ProjectCostCategory)) {
    throw new BadRequestException("La catégorie de prévision est invalide");
  }
  const description = String(input.description ?? "").trim();
  if (!description) throw new BadRequestException("La description de chaque catégorie est obligatoire");
  return {
    category: input.category as ProjectCostCategory,
    description,
    remainingAmount: asMoney(input.remainingAmount, "remainingAmount").toFixed(2),
    ...(input.wbsItemId ? { wbsItemId: String(input.wbsItemId) } : {}),
  };
};

@Injectable()
export class ProjectForecastService {
  constructor(private readonly prisma: PrismaService) {}

  async list(scope: CompanyScope, projectId: string, permissions: Set<string>): Promise<ProjectForecastRevisionView[]> {
    await this.requireProject(scope, projectId);
    if (!permissions.has(PROJECT_PERMISSIONS.FORECAST_READ) && !permissions.has(PROJECT_PERMISSIONS.FORECAST_MANAGE)) {
      throw new ForbiddenException("Permission de lecture des prévisions requise");
    }
    const rows = await this.prisma.projectForecastRevision.findMany({
      where: { ...scope, projectId },
      include: { lines: { orderBy: { category: "asc" } } },
      orderBy: { revisionNumber: "desc" },
    });
    return rows.map((row) => this.view(row));
  }

  async create(
    scope: CompanyScope,
    projectId: string,
    body: unknown,
    actorUserId: string,
    permissions: Set<string>,
  ): Promise<ProjectForecastRevisionView> {
    if (!permissions.has(PROJECT_PERMISSIONS.FORECAST_MANAGE)) throw new ForbiddenException("Permission de préparation des prévisions requise");
    const input = (body ?? {}) as ForecastBody;
    const justification = String(input.justification ?? "").trim();
    if (justification.length < 10) throw new BadRequestException("Une justification d'au moins 10 caractères est requise");
    if (!Array.isArray(input.lines) || input.lines.length !== CATEGORIES.length) {
      throw new BadRequestException("Une prévision doit contenir exactement les six catégories de coût");
    }
    const lines = input.lines.map(asLine);
    if (new Set(lines.map((line) => line.category)).size !== CATEGORIES.length) {
      throw new BadRequestException("Chaque catégorie de coût doit apparaître une seule fois");
    }
    const revisedBudget = asMoney(input.revisedBudget, "revisedBudget");
    const project = await this.requireProject(scope, projectId);
    const costs = await projectCostFigures(this.prisma, scope, projectId, project.currency, permissions);
    if (!costs.consumed.available) {
      throw new ForbiddenException("Les permissions de lecture de toutes les sources de coût sont requises pour figer le consommé");
    }
    const consumedAmount = asMoney(costs.consumed.amount, "consumedAmount");
    const remainingAmount = lines.reduce((sum, line) => sum.plus(line.remainingAmount), new Prisma.Decimal(0)).toDecimalPlaces(2);
    const eacAmount = consumedAmount.plus(remainingAmount).toDecimalPlaces(2);
    const marginAmount = new Prisma.Decimal(project.contractAmount).minus(eacAmount).toDecimalPlaces(2);
    const row = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.project.findFirst({ where: { ...scope, id: projectId }, select: { id: true, currency: true, contractAmount: true } });
      if (!locked) throw new NotFoundException("Projet introuvable");
      await tx.$queryRaw`SELECT "id" FROM "projects" WHERE "id" = ${projectId} AND "organizationId" = ${scope.organizationId} AND "companyId" = ${scope.companyId} FOR UPDATE`;
      const latest = await tx.projectForecastRevision.findFirst({ where: { ...scope, projectId }, orderBy: { revisionNumber: "desc" }, select: { revisionNumber: true } });
      const revisionNumber = (latest?.revisionNumber ?? 0) + 1;
      const created = await tx.projectForecastRevision.create({
        data: {
          ...scope,
          projectId,
          revisionNumber,
          justification,
          currency: project.currency,
          contractAmount: project.contractAmount,
          revisedBudget,
          consumedAmount,
          remainingAmount,
          eacAmount,
          marginAmount,
          requestedByUserId: actorUserId,
          lines: { create: lines.map((line) => ({ ...scope, category: line.category, description: line.description, remainingAmount: line.remainingAmount, wbsItemId: line.wbsItemId })) },
        },
        include: { lines: { orderBy: { category: "asc" } } },
      });
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return this.view(row);
  }

  async decide(
    scope: CompanyScope,
    projectId: string,
    revisionId: string,
    decision: "APPROVED" | "REJECTED",
    body: unknown,
    actorUserId: string,
  ): Promise<ProjectForecastRevisionView> {
    const row = await this.prisma.projectForecastRevision.findFirst({ where: { ...scope, projectId, id: revisionId }, include: { lines: { orderBy: { category: "asc" } } } });
    if (!row) throw new NotFoundException("Révision de prévision introuvable");
    if (row.requestedByUserId === actorUserId) throw new ConflictException("La validation doit être effectuée par un tiers");
    if (row.status !== "PENDING") throw new ConflictException("Cette révision est déjà décidée");
    const note = String((body as Record<string, unknown> | null)?.note ?? "").trim();
    if (decision === "REJECTED" && note.length < 5) throw new BadRequestException("Un motif est requis pour un rejet");
    const updated = await this.prisma.projectForecastRevision.update({
      where: { id: revisionId },
      data: { status: decision, decidedByUserId: actorUserId, decidedAt: new Date(), decisionNote: note || null },
      include: { lines: { orderBy: { category: "asc" } } },
    });
    return this.view(updated);
  }

  private async requireProject(scope: CompanyScope, projectId: string) {
    const project = await this.prisma.project.findFirst({ where: { ...scope, id: projectId }, select: { id: true, currency: true, contractAmount: true } });
    if (!project) throw new NotFoundException("Projet introuvable");
    return project;
  }

  private view(row: Prisma.ProjectForecastRevisionGetPayload<{ include: { lines: true } }>): ProjectForecastRevisionView {
    return {
      id: row.id,
      projectId: row.projectId,
      revisionNumber: row.revisionNumber,
      status: row.status,
      justification: row.justification,
      asOf: row.asOf.toISOString(),
      currency: row.currency,
      contractAmount: row.contractAmount.toFixed(2),
      revisedBudget: row.revisedBudget.toFixed(2),
      consumedAmount: row.consumedAmount.toFixed(2),
      remainingAmount: row.remainingAmount.toFixed(2),
      eacAmount: row.eacAmount.toFixed(2),
      marginAmount: row.marginAmount.toFixed(2),
      requestedByUserId: row.requestedByUserId,
      decidedByUserId: row.decidedByUserId,
      decidedAt: row.decidedAt?.toISOString() ?? null,
      decisionNote: row.decisionNote,
      lines: row.lines.map((line) => ({ id: line.id, category: line.category, description: line.description, remainingAmount: line.remainingAmount.toFixed(2), ...(line.wbsItemId ? { wbsItemId: line.wbsItemId } : {}) })),
    };
  }
}
