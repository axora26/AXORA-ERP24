import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { AnalyticsCatalogEntry, AnalyticsDashboardView, AnalyticsSeriesView, AnalyticsSnapshotMetric, AnalyticsSnapshotView } from "@axora24/contracts";
import { Prisma } from "@axora24/database";
import { PrismaService } from "../core/prisma.service.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import type { AuthenticatedUser } from "../auth/session.guard.js";
import { writeAudit } from "../common/audit.js";
import { assertBody, optionalBoolean, optionalInt, requiredText } from "../common/validation.js";
import { addMonths, bucketize, lastMonths, monthKey, monthStart, toCsv } from "./buckets.js";
import { METRICS, descriptor, type MetricDefinition } from "./metrics.js";

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const UNIT_LABEL: Record<string, string> = { money: "devise", count: "nombre", hours: "h", kwh: "kWh", liters: "L" };

/**
 * INC-23 — Analytique (BC-23). Chaque indicateur est calcule a la demande sur
 * les donnees reelles du perimetre entreprise ; l'acces a un indicateur exige
 * la permission de lecture de son module, en plus de `analytics.report.read`.
 */
@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  catalog(permissions: Set<string>): AnalyticsCatalogEntry[] {
    return METRICS.map((metric) => ({ ...descriptor(metric), granted: permissions.has(metric.permission) }));
  }

  private metric(key: string, permissions: Set<string>): MetricDefinition {
    const metric = METRICS.find((candidate) => candidate.key === key);
    if (!metric) throw new NotFoundException("Indicateur inconnu");
    if (!permissions.has(metric.permission)) throw new ForbiddenException(`Permission ${metric.permission} requise pour l'indicateur « ${metric.label} »`);
    return metric;
  }

  async series(scope: CompanyScope, permissions: Set<string>, key: string, query: Record<string, unknown>, now = new Date()): Promise<AnalyticsSeriesView> {
    const metric = this.metric(key, permissions);
    const count = optionalInt(query.months, "months", { min: 3, max: 24 }) ?? 12;
    const months = lastMonths(now, count);
    const from = monthStart(months[0]!);
    const to = addMonths(monthStart(months[months.length - 1]!), 1);
    const { rows, sourceRows } = await metric.rows(this.prisma, scope, from, to);
    return {
      metric: descriptor(metric),
      months,
      series: bucketize(rows, months, metric.order, metric.unit === "money").map((serie) => ({ ...serie, label: serie.key })),
      sourceRows,
      window: { from: from.toISOString(), to: to.toISOString() },
      companyId: scope.companyId,
      computedAt: new Date().toISOString(),
    };
  }

  async csv(scope: CompanyScope, permissions: Set<string>, key: string, query: Record<string, unknown>): Promise<{ filename: string; content: string }> {
    const view = await this.series(scope, permissions, key, query);
    const rows = view.series.flatMap((serie) => view.months.map((month, index) => [month, serie.label, serie.values[index]!, UNIT_LABEL[view.metric.unit] === "devise" ? serie.key : UNIT_LABEL[view.metric.unit]!]));
    return { filename: `${key}-${view.months[0]}_${view.months[view.months.length - 1]}.csv`, content: toCsv(["mois", "serie", "valeur", "unite"], rows) };
  }

  // -------------------------------------------------------------------------
  // Instantanes mensuels figes
  // -------------------------------------------------------------------------

  async capture(scope: CompanyScope, user: AuthenticatedUser, permissions: Set<string>, body: unknown): Promise<AnalyticsSnapshotView> {
    const input = assertBody(body);
    const period = requiredText(input.period, "period", 7);
    if (!PERIOD.test(period)) throw new BadRequestException("period : mois attendu au format AAAA-MM");
    const periodStart = monthStart(period);
    if (period > monthKey(new Date())) throw new BadRequestException("Un mois futur ne peut pas être figé");
    const periodEnd = addMonths(periodStart, 1);
    const metrics: AnalyticsSnapshotMetric[] = [];
    const excluded: string[] = [];
    for (const metric of METRICS) {
      if (!permissions.has(metric.permission)) {
        excluded.push(metric.key);
        continue;
      }
      const { rows, sourceRows } = await metric.rows(this.prisma, scope, periodStart, periodEnd);
      metrics.push({ metric: metric.key, label: metric.label, unit: metric.unit, series: bucketize(rows, [period], metric.order, metric.unit === "money").map((serie) => ({ key: serie.key, label: serie.key, value: serie.values[0]! })), sourceRows });
    }
    try {
      const snapshot = await this.prisma.$transaction(async (tx) => {
        const organization = await tx.organization.findUniqueOrThrow({ where: { id: scope.organizationId }, select: { isDemo: true } });
        const version = (await tx.analyticsSnapshot.count({ where: { companyId: scope.companyId, period } })) + 1;
        const created = await tx.analyticsSnapshot.create({
          data: { ...scope, period, periodStart, periodEnd, version, isDemo: organization.isDemo, metrics: metrics as unknown as Prisma.InputJsonValue, excludedMetrics: excluded, capturedByUserId: user.id },
        });
        await writeAudit(tx, scope, user.id, "analytics.snapshot.captured", "AnalyticsSnapshot", created.id, { period, version, metrics: metrics.length, excluded: excluded.length });
        return created;
      });
      return this.snapshotView(snapshot, permissions, new Map([[user.id, user.fullName]]));
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ConflictException("Une autre capture de ce mois vient d'être enregistrée : réessayez");
      throw error;
    }
  }

  async snapshots(scope: CompanyScope, permissions: Set<string>): Promise<AnalyticsSnapshotView[]> {
    const rows = await this.prisma.analyticsSnapshot.findMany({ where: scope, orderBy: [{ period: "desc" }, { version: "desc" }], take: 60 });
    const users = new Map((await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((row) => row.capturedByUserId))] } }, select: { id: true, fullName: true } })).map((entry) => [entry.id, entry.fullName]));
    return rows.map((row) => this.snapshotView(row, permissions, users));
  }

  /** Les indicateurs figes restent soumis aux droits du LECTEUR : ceux qu'il ne peut pas lire sont masques. */
  private snapshotView(row: Prisma.AnalyticsSnapshotGetPayload<object>, permissions: Set<string>, users: Map<string, string>): AnalyticsSnapshotView {
    const stored = row.metrics as unknown as AnalyticsSnapshotMetric[];
    const visible = stored.filter((entry) => {
      const metric = METRICS.find((candidate) => candidate.key === entry.metric);
      return Boolean(metric && permissions.has(metric.permission));
    });
    return {
      id: row.id,
      period: row.period,
      periodStart: row.periodStart.toISOString(),
      periodEnd: row.periodEnd.toISOString(),
      version: row.version,
      isDemo: row.isDemo,
      capturedByName: users.get(row.capturedByUserId) ?? "—",
      capturedAt: row.capturedAt.toISOString(),
      metrics: visible,
      hiddenMetrics: stored.length - visible.length,
      excludedMetrics: row.excludedMetrics,
    };
  }

  // -------------------------------------------------------------------------
  // Tableaux de bord configurables
  // -------------------------------------------------------------------------

  private async dashboardViews(scope: CompanyScope, user: AuthenticatedUser, rows: Array<Prisma.AnalyticsDashboardGetPayload<object>>): Promise<AnalyticsDashboardView[]> {
    const owners = new Map((await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((row) => row.ownerUserId))] } }, select: { id: true, fullName: true } })).map((entry) => [entry.id, entry.fullName]));
    return rows.map((row) => ({ id: row.id, name: row.name, metrics: row.metrics, shared: row.shared, ownerName: owners.get(row.ownerUserId) ?? "—", mine: row.ownerUserId === user.id, updatedAt: row.updatedAt.toISOString() }));
  }

  async dashboards(scope: CompanyScope, user: AuthenticatedUser): Promise<AnalyticsDashboardView[]> {
    const rows = await this.prisma.analyticsDashboard.findMany({ where: { ...scope, OR: [{ ownerUserId: user.id }, { shared: true }] }, orderBy: { name: "asc" } });
    return this.dashboardViews(scope, user, rows);
  }

  private parseDashboard(body: unknown, permissions: Set<string>): { name: string; metrics: string[]; shared: boolean } {
    const input = assertBody(body);
    const name = requiredText(input.name, "name", 80);
    if (!Array.isArray(input.metrics) || input.metrics.length === 0 || input.metrics.length > 12) throw new BadRequestException("metrics : 1 à 12 indicateurs");
    const metrics = input.metrics.map((key) => String(key));
    if (new Set(metrics).size !== metrics.length) throw new BadRequestException("metrics : indicateur en double");
    for (const key of metrics) {
      const metric = METRICS.find((candidate) => candidate.key === key);
      if (!metric) throw new BadRequestException(`Indicateur inconnu : ${key}`);
      if (!permissions.has(metric.permission)) throw new ForbiddenException(`Vous ne pouvez pas ajouter l'indicateur « ${metric.label} » (permission ${metric.permission} absente)`);
    }
    return { name, metrics, shared: optionalBoolean(input.shared, "shared") ?? false };
  }

  async createDashboard(scope: CompanyScope, user: AuthenticatedUser, permissions: Set<string>, body: unknown): Promise<AnalyticsDashboardView> {
    const data = this.parseDashboard(body, permissions);
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.analyticsDashboard.create({ data: { ...scope, ownerUserId: user.id, ...data } });
      await writeAudit(tx, scope, user.id, "analytics.dashboard.created", "AnalyticsDashboard", row.id, { name: data.name, shared: data.shared });
      return row;
    });
    return (await this.dashboardViews(scope, user, [created]))[0]!;
  }

  private async ownDashboard(scope: CompanyScope, user: AuthenticatedUser, id: string): Promise<Prisma.AnalyticsDashboardGetPayload<object>> {
    const row = await this.prisma.analyticsDashboard.findFirst({ where: { ...scope, id, OR: [{ ownerUserId: user.id }, { shared: true }] } });
    if (!row) throw new NotFoundException("Tableau de bord introuvable");
    if (row.ownerUserId !== user.id) throw new ForbiddenException("Seul le propriétaire modifie un tableau de bord partagé");
    return row;
  }

  async updateDashboard(scope: CompanyScope, user: AuthenticatedUser, permissions: Set<string>, id: string, body: unknown): Promise<AnalyticsDashboardView> {
    await this.ownDashboard(scope, user, id);
    const data = this.parseDashboard(body, permissions);
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.analyticsDashboard.update({ where: { id }, data });
      await writeAudit(tx, scope, user.id, "analytics.dashboard.updated", "AnalyticsDashboard", id, { name: data.name, shared: data.shared });
      return row;
    });
    return (await this.dashboardViews(scope, user, [updated]))[0]!;
  }

  async deleteDashboard(scope: CompanyScope, user: AuthenticatedUser, id: string): Promise<{ deleted: true }> {
    const row = await this.ownDashboard(scope, user, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.analyticsDashboard.delete({ where: { id } });
      await writeAudit(tx, scope, user.id, "analytics.dashboard.deleted", "AnalyticsDashboard", id, { name: row.name });
    });
    return { deleted: true };
  }
}
