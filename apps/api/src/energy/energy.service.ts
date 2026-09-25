import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type {
  EnergyAlertView,
  EnergyAutonomyView,
  EnergyBalanceView,
  EnergyIngestResult,
  EnergyKindTotal,
  EnergyMeterDetailView,
  EnergyMeterKind,
  EnergyMeterView,
  EnergySummaryView,
} from "@axora24/contracts";
import { Prisma } from "@axora24/database";
import { PrismaService } from "../core/prisma.service.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import { writeAudit } from "../common/audit.js";
import { assertBody, optionalDecimal, optionalId, optionalInt, optionalText, requiredDate, requiredDecimal, requiredEnum, requiredId, requiredInt, requiredText } from "../common/validation.js";
import type { GatewayContext } from "../smart/gateway-token.guard.js";
import {
  AUTONOMY_WINDOW_HOURS,
  MAX_LEVEL_AGE_MINUTES,
  MIN_AUTONOMY_COVERAGE,
  computeAutonomy,
  coverage,
  expectedIntervals,
  isAligned,
  meterUnit,
  startOfUtcDay,
  tariffAt,
} from "./energy-math.js";

type D = Prisma.Decimal;
type Meter = Prisma.EnergyMeterGetPayload<object>;

const KINDS = ["GRID_IMPORT", "GRID_EXPORT", "PV_PRODUCTION", "GENSET_PRODUCTION", "BATTERY_CHARGE", "BATTERY_DISCHARGE", "CONSUMPTION", "GENSET_FUEL"] as const;
const COST_KINDS = new Set<string>(["GRID_IMPORT", "GENSET_FUEL"]);
// 1 500 intervalles ~ 80 Ko : reste sous la limite par defaut du corps JSON (100 Ko).
const MAX_BATCH = 1500;
const MAX_CLOCK_SKEW_MS = 5 * 60_000;
const COMPARISON_MIN_COVERAGE = 95;
const DECIMAL = /^\d{1,12}(\.\d{1,4})?$/;
const DAY_MS = 86_400_000;
const ZERO = new Prisma.Decimal(0);

interface Row {
  index: number;
  meter: Meter;
  periodStart: Date;
  value: D;
}

function str(value: D | string | null): string | null {
  return value === null ? null : new Prisma.Decimal(value).toString();
}

function sum(values: D[]): D {
  return values.reduce((total, value) => total.plus(value), ZERO);
}

/**
 * INC-17 — Energie : compteurs, intervalles (ingestion idempotente par
 * passerelle ou import), tarifs historises, bilans avec couverture,
 * autonomie sur donnees reelles, alertes figees.
 */
@Injectable()
export class EnergyService {
  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------------------
  // Ingestion (chemin unique)
  // -------------------------------------------------------------------

  /** Intervalles envoyes par une passerelle GTB : uniquement pour SES compteurs. */
  async ingestFromGateway(gateway: GatewayContext, body: unknown): Promise<EnergyIngestResult> {
    const rows = this.parseRows(assertBody(body).intervals, true);
    const refs = [...new Set(rows.parsed.map((row) => row.ref!))];
    const [meters, meta] = await Promise.all([
      this.prisma.energyMeter.findMany({ where: { gatewayId: gateway.id, externalRef: { in: refs } } }),
      this.prisma.smartGateway.findUniqueOrThrow({ where: { id: gateway.id }, select: { simulated: true } }),
    ]);
    const byRef = new Map(meters.map((meter) => [meter.externalRef!, meter]));
    const resolved: Row[] = [];
    for (const row of rows.parsed) {
      const meter = byRef.get(row.ref!);
      if (!meter) rows.rejected.push({ index: row.index, reason: `unknown meter ${row.ref}` });
      else resolved.push({ index: row.index, meter, periodStart: row.periodStart, value: row.value });
    }
    await this.prisma.smartGateway.update({ where: { id: gateway.id }, data: { lastSeenAt: new Date() } });
    return this.ingest(gateway, resolved, rows.rejected, { source: "GATEWAY", gatewayId: gateway.id, simulated: meta.simulated, userId: null });
  }

  /** Import de releves (export fournisseur, releve manuel) par un utilisateur habilite. */
  async importIntervals(scope: CompanyScope, meterId: string, body: unknown, actorUserId: string): Promise<EnergyIngestResult> {
    const meter = await this.prisma.energyMeter.findFirst({ where: { id: meterId, ...scope } });
    if (!meter) throw new NotFoundException("Meter not found");
    const rows = this.parseRows(assertBody(body).intervals, false);
    const result = await this.ingest(
      scope,
      rows.parsed.map((row) => ({ index: row.index, meter, periodStart: row.periodStart, value: row.value })),
      rows.rejected,
      { source: "IMPORT", gatewayId: null, simulated: false, userId: actorUserId },
    );
    if (result.accepted > 0) {
      await this.prisma.$transaction((tx) => writeAudit(tx, scope, actorUserId, "energy.intervals.imported", "EnergyMeter", meterId, { accepted: result.accepted, duplicates: result.duplicates, conflicts: result.conflicts.length }));
    }
    return result;
  }

  private parseRows(raw: unknown, withRef: boolean) {
    if (!Array.isArray(raw) || raw.length === 0) throw new BadRequestException("intervals must be a non-empty array");
    if (raw.length > MAX_BATCH) throw new BadRequestException(`At most ${MAX_BATCH} intervals per batch`);
    const parsed: Array<{ index: number; ref: string | null; periodStart: Date; value: D }> = [];
    const rejected: EnergyIngestResult["rejected"] = [];
    raw.forEach((item: unknown, index: number) => {
      if (!item || typeof item !== "object") return rejected.push({ index, reason: "interval must be an object" });
      const { ref, start, value } = item as Record<string, unknown>;
      if (withRef && (typeof ref !== "string" || !ref.trim())) return rejected.push({ index, reason: "ref is required" });
      const periodStart = typeof start === "string" ? new Date(start) : null;
      if (!periodStart || Number.isNaN(periodStart.getTime())) return rejected.push({ index, reason: "start must be an ISO-8601 timestamp" });
      if (typeof value !== "string" || !DECIMAL.test(value.trim())) return rejected.push({ index, reason: "value must be a non-negative decimal string (max 4 decimals)" });
      parsed.push({ index, ref: withRef ? (ref as string).trim() : null, periodStart, value: new Prisma.Decimal(value.trim()) });
      return undefined;
    });
    return { parsed, rejected };
  }

  private async ingest(
    scope: Pick<CompanyScope, "organizationId" | "companyId">,
    rows: Row[],
    rejected: EnergyIngestResult["rejected"],
    context: { source: "GATEWAY" | "IMPORT"; gatewayId: string | null; simulated: boolean; userId: string | null },
  ): Promise<EnergyIngestResult> {
    const result: EnergyIngestResult = { accepted: 0, duplicates: 0, conflicts: [], rejected, alertsRaised: 0 };
    const valid: Row[] = [];
    const seen = new Map<string, Row>();
    for (const row of rows) {
      if (!row.meter.active) {
        rejected.push({ index: row.index, reason: `meter ${row.meter.code} is inactive` });
        continue;
      }
      if (!isAligned(row.periodStart, row.meter.intervalMinutes)) {
        rejected.push({ index: row.index, reason: `start must be aligned on ${row.meter.intervalMinutes} min` });
        continue;
      }
      if (row.periodStart.getTime() + row.meter.intervalMinutes * 60_000 > Date.now() + MAX_CLOCK_SKEW_MS) {
        rejected.push({ index: row.index, reason: "interval is not finished yet" });
        continue;
      }
      const key = `${row.meter.id}|${row.periodStart.toISOString()}`;
      const twin = seen.get(key);
      if (twin) {
        if (twin.value.equals(row.value)) result.duplicates += 1;
        else result.conflicts.push({ meter: row.meter.code, periodStart: row.periodStart.toISOString(), value: row.value.toString(), existing: twin.value.toString() });
        continue;
      }
      seen.set(key, row);
      valid.push(row);
    }

    if (valid.length > 0) {
      await this.prisma.$transaction(
        async (tx) => {
          const meterIds = [...new Set(valid.map((row) => row.meter.id))].sort();
          await tx.$queryRaw`SELECT "id" FROM "energy_meters" WHERE "id" IN (${Prisma.join(meterIds)}) ORDER BY "id" FOR UPDATE`;
          const existing = await tx.energyInterval.findMany({
            where: { meterId: { in: meterIds }, periodStart: { in: [...new Set(valid.map((row) => row.periodStart))] } },
            select: { meterId: true, periodStart: true, value: true },
          });
          const stored = new Map(existing.map((row) => [`${row.meterId}|${row.periodStart.toISOString()}`, new Prisma.Decimal(row.value)]));
          const fresh: Row[] = [];
          for (const row of valid) {
            const current = stored.get(`${row.meter.id}|${row.periodStart.toISOString()}`);
            if (!current) fresh.push(row);
            else if (current.equals(row.value)) result.duplicates += 1;
            else result.conflicts.push({ meter: row.meter.code, periodStart: row.periodStart.toISOString(), value: row.value.toString(), existing: current.toString() });
          }
          if (fresh.length === 0) return;
          await tx.energyInterval.createMany({
            data: fresh.map((row) => ({
              organizationId: scope.organizationId,
              companyId: scope.companyId,
              meterId: row.meter.id,
              periodStart: row.periodStart,
              value: row.value,
              source: context.source,
              gatewayId: context.gatewayId,
              simulated: context.simulated,
              recordedByUserId: context.userId,
            })),
          });
          result.accepted = fresh.length;
          result.alertsRaised = await this.evaluateAlerts(tx, scope, fresh);
        },
        { timeout: 30_000 },
      );
    }
    result.rejected.sort((a, b) => a.index - b.index);
    return result;
  }

  /** Alertes figees : depassement d'intervalle a l'arrivee ; depassement journalier seulement sur un jour complet. */
  private async evaluateAlerts(tx: Prisma.TransactionClient, scope: Pick<CompanyScope, "organizationId" | "companyId">, fresh: Row[]): Promise<number> {
    const meterIds = [...new Set(fresh.map((row) => row.meter.id))];
    const rules = await tx.energyAlertRule.findMany({ where: { meterId: { in: meterIds }, active: true } });
    if (rules.length === 0) return 0;
    const alerts: Prisma.EnergyAlertCreateManyInput[] = [];
    for (const rule of rules) {
      const threshold = new Prisma.Decimal(rule.threshold);
      const mine = fresh.filter((row) => row.meter.id === rule.meterId);
      if (rule.kind === "INTERVAL_ABOVE") {
        for (const row of mine.filter((candidate) => candidate.value.greaterThan(threshold))) {
          alerts.push({ ...scope, ruleId: rule.id, meterId: rule.meterId, kind: rule.kind, threshold, message: rule.message, periodStart: row.periodStart, value: row.value });
        }
        continue;
      }
      const meter = mine[0]!.meter;
      const days = [...new Set(mine.map((row) => startOfUtcDay(row.periodStart).getTime()))];
      for (const dayMs of days) {
        const day = new Date(dayMs);
        const aggregate = await tx.energyInterval.aggregate({ where: { meterId: rule.meterId, periodStart: { gte: day, lt: new Date(dayMs + DAY_MS) } }, _sum: { value: true }, _count: { _all: true } });
        const complete = aggregate._count._all === (24 * 60) / meter.intervalMinutes;
        const total = new Prisma.Decimal(aggregate._sum.value ?? 0);
        if (complete && total.greaterThan(threshold)) alerts.push({ ...scope, ruleId: rule.id, meterId: rule.meterId, kind: rule.kind, threshold, message: rule.message, periodStart: day, value: total });
      }
    }
    if (alerts.length === 0) return 0;
    return (await tx.energyAlert.createMany({ data: alerts, skipDuplicates: true })).count;
  }

  // -------------------------------------------------------------------
  // Compteurs, tarifs, regles, stockages
  // -------------------------------------------------------------------

  /** Batiments comptes (lecture energie sans exiger les droits GTB). */
  async buildings(scope: CompanyScope) {
    const buildings = await this.prisma.smartBuilding.findMany({ where: scope, orderBy: { code: "asc" }, include: { _count: { select: { energyMeters: true, energyStorages: true } } } });
    return buildings.map((building) => ({
      id: building.id,
      code: building.code,
      name: building.name,
      floorAreaM2: str(building.floorAreaM2),
      meters: building._count.energyMeters,
      storages: building._count.energyStorages,
    }));
  }

  async listMeters(scope: CompanyScope, query: Record<string, unknown>): Promise<EnergyMeterView[]> {
    const buildingId = optionalId(query.buildingId, "buildingId");
    const meters = await this.prisma.energyMeter.findMany({ where: { ...scope, ...(buildingId ? { buildingId } : {}) }, orderBy: [{ buildingId: "asc" }, { code: "asc" }] });
    return this.meterViews(scope, meters);
  }

  async getMeter(scope: CompanyScope, meterId: string): Promise<EnergyMeterDetailView> {
    const meter = await this.prisma.energyMeter.findFirst({ where: { id: meterId, ...scope } });
    if (!meter) throw new NotFoundException("Meter not found");
    const since = startOfUtcDay(new Date(Date.now() - 29 * DAY_MS));
    const [[view], tariffs, rules, daily, recent] = await Promise.all([
      this.meterViews(scope, [meter]),
      this.prisma.energyTariff.findMany({ where: { meterId }, orderBy: { validFrom: "asc" } }),
      this.prisma.energyAlertRule.findMany({ where: { meterId }, orderBy: { createdAt: "asc" } }),
      this.prisma.$queryRaw<Array<{ day: Date; total: D; n: bigint }>>`
        SELECT date_trunc('day', "periodStart") AS day, sum("value") AS total, count(*) AS n
        FROM "energy_intervals" WHERE "meterId" = ${meterId} AND "periodStart" >= ${since}
        GROUP BY 1 ORDER BY 1
      `,
      this.prisma.energyInterval.findMany({ where: { meterId }, orderBy: { periodStart: "desc" }, take: 24 }),
    ]);
    const perDay = (24 * 60) / meter.intervalMinutes;
    return {
      ...view!,
      tariffs: tariffs.map((tariff) => ({ id: tariff.id, validFrom: tariff.validFrom.toISOString().slice(0, 10), unitPrice: str(tariff.unitPrice)!, note: tariff.note })),
      rules: rules.map((rule) => ({ id: rule.id, kind: rule.kind, threshold: str(rule.threshold)!, message: rule.message, active: rule.active })),
      daily: daily.map((row) => ({ day: row.day.toISOString().slice(0, 10), value: new Prisma.Decimal(row.total).toString(), intervals: Number(row.n), expected: perDay })),
      recent: recent.map((row) => ({ periodStart: row.periodStart.toISOString(), value: str(row.value)!, source: row.source, simulated: row.simulated })),
    };
  }

  async createMeter(scope: CompanyScope, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const buildingId = requiredId(input.buildingId, "buildingId");
    const code = requiredText(input.code, "code", 40).toUpperCase();
    const kind = requiredEnum(input.kind, "kind", KINDS);
    const intervalMinutes = requiredInt(input.intervalMinutes ?? 15, "intervalMinutes");
    if (![5, 10, 15, 30, 60].includes(intervalMinutes)) throw new BadRequestException("intervalMinutes must be 5, 10, 15, 30 or 60");
    const gatewayId = optionalId(input.gatewayId, "gatewayId");
    const externalRef = optionalText(input.externalRef, "externalRef", 200);
    if (Boolean(gatewayId) !== Boolean(externalRef)) throw new BadRequestException("gatewayId and externalRef go together");
    const assetId = optionalId(input.assetId, "assetId");
    const id = await this.prisma.$transaction(async (tx) => {
      if (!(await tx.smartBuilding.findFirst({ where: { id: buildingId, ...scope }, select: { id: true } }))) throw new NotFoundException("Building not found");
      if (gatewayId && !(await tx.smartGateway.findFirst({ where: { id: gatewayId, buildingId, ...scope }, select: { id: true } }))) throw new NotFoundException("Gateway not found in this building");
      if (assetId && !(await tx.asset.findFirst({ where: { id: assetId, ...scope }, select: { id: true } }))) throw new NotFoundException("Asset not found");
      if (await tx.energyMeter.findFirst({ where: { companyId: scope.companyId, code } })) throw new ConflictException(`Meter ${code} already exists`);
      if (gatewayId && (await tx.energyMeter.findFirst({ where: { gatewayId, externalRef } }))) throw new ConflictException("This gateway reference is already bound to a meter");
      const meter = await tx.energyMeter.create({
        data: { ...scope, buildingId, code, name: requiredText(input.name, "name", 200), kind, intervalMinutes, gatewayId, externalRef, assetId, createdByUserId: actorUserId },
      });
      await writeAudit(tx, scope, actorUserId, "energy.meter.created", "EnergyMeter", meter.id, { code, kind, intervalMinutes });
      return meter.id;
    });
    return this.getMeter(scope, id);
  }

  async updateMeter(scope: CompanyScope, meterId: string, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    if (input.active !== undefined && typeof input.active !== "boolean") throw new BadRequestException("active must be a boolean");
    await this.prisma.$transaction(async (tx) => {
      const meter = await tx.energyMeter.findFirst({ where: { id: meterId, ...scope } });
      if (!meter) throw new NotFoundException("Meter not found");
      await tx.energyMeter.update({ where: { id: meterId }, data: { ...(input.name !== undefined ? { name: requiredText(input.name, "name", 200) } : {}), ...(typeof input.active === "boolean" ? { active: input.active } : {}) } });
      await writeAudit(tx, scope, actorUserId, "energy.meter.updated", "EnergyMeter", meterId, { active: input.active });
    });
    return this.getMeter(scope, meterId);
  }

  /** Nouveau tarif a partir d'une date (les tarifs passes restent intacts). */
  async addTariff(scope: CompanyScope, meterId: string, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const validFrom = requiredDate(input.validFrom, "validFrom");
    const unitPrice = requiredDecimal(input.unitPrice, "unitPrice");
    await this.prisma.$transaction(async (tx) => {
      if (!(await tx.energyMeter.findFirst({ where: { id: meterId, ...scope }, select: { id: true } }))) throw new NotFoundException("Meter not found");
      if (await tx.energyTariff.findFirst({ where: { meterId, validFrom: startOfUtcDay(validFrom) } })) throw new ConflictException("A tariff already starts on this date");
      const tariff = await tx.energyTariff.create({ data: { ...scope, meterId, validFrom: startOfUtcDay(validFrom), unitPrice, note: optionalText(input.note, "note", 300), createdByUserId: actorUserId } });
      await writeAudit(tx, scope, actorUserId, "energy.tariff.created", "EnergyTariff", tariff.id, { meterId, validFrom: validFrom.toISOString().slice(0, 10), unitPrice: unitPrice.toString() });
    });
    return this.getMeter(scope, meterId);
  }

  async addRule(scope: CompanyScope, meterId: string, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const kind = requiredEnum(input.kind, "kind", ["INTERVAL_ABOVE", "DAILY_ABOVE"] as const);
    const threshold = requiredDecimal(input.threshold, "threshold", { positive: true });
    await this.prisma.$transaction(async (tx) => {
      if (!(await tx.energyMeter.findFirst({ where: { id: meterId, ...scope }, select: { id: true } }))) throw new NotFoundException("Meter not found");
      const rule = await tx.energyAlertRule.create({ data: { ...scope, meterId, kind, threshold, message: requiredText(input.message, "message", 300), createdByUserId: actorUserId } });
      await writeAudit(tx, scope, actorUserId, "energy.rule.created", "EnergyAlertRule", rule.id, { meterId, kind, threshold: threshold.toString() });
    });
    return this.getMeter(scope, meterId);
  }

  async setRuleActive(scope: CompanyScope, ruleId: string, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    if (typeof input.active !== "boolean") throw new BadRequestException("active must be a boolean");
    const rule = await this.prisma.$transaction(async (tx) => {
      const current = await tx.energyAlertRule.findFirst({ where: { id: ruleId, ...scope } });
      if (!current) throw new NotFoundException("Rule not found");
      await tx.energyAlertRule.update({ where: { id: ruleId }, data: { active: input.active as boolean } });
      await writeAudit(tx, scope, actorUserId, "energy.rule.updated", "EnergyAlertRule", ruleId, { active: input.active });
      return current;
    });
    return this.getMeter(scope, rule.meterId);
  }

  async createStorage(scope: CompanyScope, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const buildingId = requiredId(input.buildingId, "buildingId");
    const kind = requiredEnum(input.kind, "kind", ["BATTERY", "FUEL_TANK"] as const);
    const levelPointId = requiredId(input.levelPointId, "levelPointId");
    const drainMeterId = requiredId(input.drainMeterId, "drainMeterId");
    const usableCapacity = requiredDecimal(input.usableCapacity, "usableCapacity", { positive: true });
    if (typeof input.levelIsPercent !== "boolean") throw new BadRequestException("levelIsPercent must be a boolean");
    const reserve = optionalDecimal(input.reserve, "reserve") ?? ZERO;
    if (input.levelIsPercent && reserve.greaterThanOrEqualTo(100)) throw new BadRequestException("reserve must be below 100 %");
    await this.prisma.$transaction(async (tx) => {
      if (!(await tx.smartBuilding.findFirst({ where: { id: buildingId, ...scope }, select: { id: true } }))) throw new NotFoundException("Building not found");
      if (!(await tx.smartPoint.findFirst({ where: { id: levelPointId, ...scope, kind: "ANALOG" }, select: { id: true } }))) throw new NotFoundException("Analog level point not found");
      const meter = await tx.energyMeter.findFirst({ where: { id: drainMeterId, ...scope } });
      if (!meter) throw new NotFoundException("Drain meter not found");
      if (meterUnit(meter.kind) !== (kind === "BATTERY" ? "kWh" : "L")) throw new BadRequestException(kind === "BATTERY" ? "A battery drains an energy meter (kWh)" : "A fuel tank drains a fuel meter (L)");
      const storage = await tx.energyStorage.create({
        data: { ...scope, buildingId, name: requiredText(input.name, "name", 200), kind, usableCapacity, levelPointId, levelIsPercent: input.levelIsPercent as boolean, reserve, drainMeterId, createdByUserId: actorUserId },
      });
      await writeAudit(tx, scope, actorUserId, "energy.storage.created", "EnergyStorage", storage.id, { kind, usableCapacity: usableCapacity.toString() });
    });
    return this.autonomy(scope, { buildingId });
  }

  // -------------------------------------------------------------------
  // Bilans, autonomie, alertes
  // -------------------------------------------------------------------

  async balance(scope: CompanyScope, query: Record<string, unknown>): Promise<EnergyBalanceView> {
    const buildingId = requiredId(query.buildingId, "buildingId");
    const days = optionalInt(query.days, "days", { min: 1, max: 90 }) ?? 7;
    const building = await this.prisma.smartBuilding.findFirst({ where: { id: buildingId, ...scope } });
    if (!building) throw new NotFoundException("Building not found");
    const to = startOfUtcDay(new Date());
    const from = new Date(to.getTime() - days * DAY_MS);
    const previousFrom = new Date(from.getTime() - days * DAY_MS);
    const [meters, company] = await Promise.all([
      this.prisma.energyMeter.findMany({ where: { buildingId, ...scope }, include: { tariffs: { orderBy: { validFrom: "asc" } } } }),
      this.prisma.company.findUniqueOrThrow({ where: { id: scope.companyId }, select: { currency: true } }),
    ]);
    const ids = meters.map((meter) => meter.id);
    const rows = ids.length
      ? await this.prisma.$queryRaw<Array<{ meterId: string; day: Date; total: D; n: bigint; simulated: boolean }>>`
          SELECT "meterId", date_trunc('day', "periodStart") AS day, sum("value") AS total, count(*) AS n, bool_or("simulated") AS simulated
          FROM "energy_intervals"
          WHERE "meterId" IN (${Prisma.join(ids)}) AND "periodStart" >= ${previousFrom} AND "periodStart" < ${to}
          GROUP BY 1, 2
        `
      : [];

    const window = (meter: Meter, start: Date, end: Date) => {
      const mine = rows.filter((row) => row.meterId === meter.id && row.day >= start && row.day < end);
      return { value: sum(mine.map((row) => new Prisma.Decimal(row.total))), received: mine.reduce((total, row) => total + Number(row.n), 0), expected: expectedIntervals(start, end, meter.intervalMinutes), rows: mine };
    };
    const kindWindow = (kind: string, start: Date, end: Date) => {
      const selected = meters.filter((meter) => meter.kind === kind);
      const parts = selected.map((meter) => window(meter, start, end));
      const received = parts.reduce((total, part) => total + part.received, 0);
      const expected = parts.reduce((total, part) => total + part.expected, 0);
      return { present: selected.length > 0, value: sum(parts.map((part) => part.value)), coverage: coverage(received, expected), meters: selected.length };
    };

    const totals: EnergyKindTotal[] = [];
    let cost = ZERO;
    let costComplete = true;
    for (const kind of KINDS) {
      const selected = meters.filter((meter) => meter.kind === kind);
      if (selected.length === 0) continue;
      const current = kindWindow(kind, from, to);
      let kindCost: D | null = ZERO;
      let complete = true;
      for (const meter of selected) {
        for (const row of window(meter, from, to).rows) {
          const price = tariffAt(meter.tariffs, row.day);
          if (price === null) complete = false;
          else kindCost = kindCost!.plus(new Prisma.Decimal(row.total).mul(price));
        }
      }
      if (!complete && kindCost!.isZero()) kindCost = null;
      if (COST_KINDS.has(kind)) {
        cost = cost.plus(kindCost ?? ZERO);
        if (!complete) costComplete = false;
      }
      totals.push({ kind, unit: meterUnit(kind), value: current.value.toFixed(2), coverage: current.coverage.toFixed(1), meters: current.meters, cost: kindCost === null ? null : kindCost.toFixed(2), costComplete: complete });
    }

    const consumptionFor = (start: Date, end: Date) => {
      const measured = kindWindow("CONSUMPTION", start, end);
      if (measured.present) return { value: measured.value, coverage: measured.coverage, method: "MEASURED" as const, detail: "Somme des compteurs de consommation." };
      const supply = ["GRID_IMPORT", "PV_PRODUCTION", "GENSET_PRODUCTION", "BATTERY_DISCHARGE"].map((kind) => kindWindow(kind, start, end)).filter((part) => part.present);
      const sinks = ["GRID_EXPORT", "BATTERY_CHARGE"].map((kind) => kindWindow(kind, start, end)).filter((part) => part.present);
      if (supply.length === 0) return { value: null, coverage: null, method: "UNAVAILABLE" as const, detail: "Aucun compteur de consommation ni de source d'énergie." };
      const involved = [...supply, ...sinks];
      return {
        value: sum(supply.map((part) => part.value)).minus(sum(sinks.map((part) => part.value))),
        coverage: involved.reduce((min, part) => Prisma.Decimal.min(min, part.coverage), new Prisma.Decimal(100)),
        method: "BALANCE" as const,
        detail: "Bilan des sources : réseau + PV + groupe + décharge batterie − injection − charge batterie (couverture = la plus faible des compteurs).",
      };
    };
    const current = consumptionFor(from, to);
    const previous = consumptionFor(previousFrom, from);
    const comparable = current.value !== null && previous.value !== null && current.coverage!.greaterThanOrEqualTo(COMPARISON_MIN_COVERAGE) && previous.coverage!.greaterThanOrEqualTo(COMPARISON_MIN_COVERAGE) && !previous.value.isZero();

    const pv = kindWindow("PV_PRODUCTION", from, to);
    const exported = kindWindow("GRID_EXPORT", from, to);
    const renewable = pv.present && exported.present && current.value !== null && current.value.greaterThan(0) ? Prisma.Decimal.max(ZERO, pv.value.minus(exported.value)).div(current.value).mul(100) : null;
    const area = building.floorAreaM2 === null ? null : new Prisma.Decimal(building.floorAreaM2);

    return {
      buildingId,
      buildingCode: building.code,
      from: from.toISOString(),
      to: to.toISOString(),
      days,
      currency: company.currency.trim(),
      totals,
      consumption: { value: current.value?.toFixed(2) ?? null, method: current.method, coverage: current.coverage?.toFixed(1) ?? null, detail: current.detail },
      previousConsumption: { value: previous.value?.toFixed(2) ?? null, coverage: previous.coverage?.toFixed(1) ?? null },
      consumptionChangePercent: comparable ? current.value!.minus(previous.value!).div(previous.value!).mul(100).toFixed(1) : null,
      comparisonNote: comparable ? `Période précédente de ${days} j, couvertures ≥ ${COMPARISON_MIN_COVERAGE} %.` : `Comparaison non fiable : couverture < ${COMPARISON_MIN_COVERAGE} % sur l'une des périodes (ou données absentes).`,
      renewableSharePercent: renewable === null ? null : renewable.toFixed(1),
      intensityKwhPerM2: area && current.value !== null && area.greaterThan(0) ? current.value.div(area).toFixed(3) : null,
      intensityNote: area ? `Surface de référence ${area.toFixed(0)} m² ; consommation brute de la période (non annualisée).` : "Surface du bâtiment non renseignée : intensité non calculable.",
      cost: cost.toFixed(2),
      costComplete,
      simulatedData: rows.some((row) => row.simulated && row.day >= from),
      series: Array.from({ length: days }, (_, index) => {
        const day = new Date(from.getTime() + index * DAY_MS);
        const values: Partial<Record<EnergyMeterKind, string>> = {};
        for (const kind of KINDS) {
          const dayRows = rows.filter((row) => row.day.getTime() === day.getTime() && meters.find((meter) => meter.id === row.meterId)?.kind === kind);
          if (dayRows.length) values[kind] = sum(dayRows.map((row) => new Prisma.Decimal(row.total))).toFixed(2);
        }
        return { day: day.toISOString().slice(0, 10), values };
      }),
    };
  }

  async autonomy(scope: CompanyScope, query: Record<string, unknown>): Promise<EnergyAutonomyView[]> {
    const buildingId = optionalId(query.buildingId, "buildingId");
    const storages = await this.prisma.energyStorage.findMany({
      where: { ...scope, ...(buildingId ? { buildingId } : {}) },
      include: { levelPoint: { include: { gateway: { select: { simulated: true } } } }, drainMeter: true },
      orderBy: { createdAt: "asc" },
    });
    const now = new Date();
    const views: EnergyAutonomyView[] = [];
    for (const storage of storages) {
      const meter = storage.drainMeter;
      const stepMs = meter.intervalMinutes * 60_000;
      const end = new Date(Math.floor(now.getTime() / stepMs) * stepMs);
      const start = new Date(end.getTime() - AUTONOMY_WINDOW_HOURS * 3_600_000);
      const aggregate = await this.prisma.energyInterval.aggregate({ where: { meterId: meter.id, periodStart: { gte: start, lt: end } }, _sum: { value: true }, _count: { _all: true } });
      const simulatedIntervals = await this.prisma.energyInterval.count({ where: { meterId: meter.id, periodStart: { gte: start, lt: end }, simulated: true } });
      const unit = meterUnit(meter.kind);
      const levelUnit = storage.levelIsPercent ? "%" : unit;
      const result = computeAutonomy({
        kind: storage.kind,
        usableCapacity: new Prisma.Decimal(storage.usableCapacity),
        levelIsPercent: storage.levelIsPercent,
        reserve: new Prisma.Decimal(storage.reserve),
        level: storage.levelPoint.lastValue === null ? null : new Prisma.Decimal(storage.levelPoint.lastValue),
        levelAt: storage.levelPoint.lastReadingAt,
        now,
        drainSum: new Prisma.Decimal(aggregate._sum.value ?? 0),
        drainIntervals: aggregate._count._all,
        expectedIntervals: expectedIntervals(start, end, meter.intervalMinutes),
        intervalMinutes: meter.intervalMinutes,
        unit,
      });
      views.push({
        storageId: storage.id,
        name: storage.name,
        kind: storage.kind,
        state: result.state,
        hours: result.hours?.toFixed(1) ?? null,
        reason: result.reason,
        inputs: [
          { label: "Capacité utile", value: `${new Prisma.Decimal(storage.usableCapacity).toString()} ${unit}` },
          { label: "Niveau reçu", value: storage.levelPoint.lastValue === null ? "aucun" : `${new Prisma.Decimal(storage.levelPoint.lastValue).toString()} ${levelUnit} (reçu ${storage.levelPoint.lastReadingAt ? `${storage.levelPoint.lastReadingAt.toISOString().slice(0, 16).replace("T", " ")} UTC` : "—"})` },
          { label: "Réserve non exploitable", value: `${new Prisma.Decimal(storage.reserve).toString()} ${levelUnit}` },
          { label: `Consommation ${meter.code} sur ${AUTONOMY_WINDOW_HOURS} h`, value: `${new Prisma.Decimal(aggregate._sum.value ?? 0).toString()} ${unit} sur ${aggregate._count._all} intervalle(s) — couverture ${result.coverage.toString()} %` },
          ...(result.available ? [{ label: "Disponible au-dessus de la réserve", value: `${result.available.toString()} ${unit}` }] : []),
          ...(result.ratePerHour ? [{ label: "Rythme moyen mesuré", value: `${result.ratePerHour.toString()} ${unit}/h` }] : []),
        ],
        formula: storage.levelIsPercent ? `autonomie (h) = capacité × (niveau − réserve) / 100 ÷ rythme moyen (${unit}/h)` : `autonomie (h) = (niveau − réserve) ÷ rythme moyen (${unit}/h)`,
        assumptions: [
          `Rythme moyen des intervalles reçus sur les ${AUTONOMY_WINDOW_HOURS} dernières heures (couverture minimale ${MIN_AUTONOMY_COVERAGE} %).`,
          storage.kind === "BATTERY" ? "Sans recharge ni production pendant la durée calculée." : "Consommation moyenne heures d'arrêt incluses, sans ravitaillement.",
          `Niveau reçu depuis moins de ${MAX_LEVEL_AGE_MINUTES} min.`,
        ],
        simulatedInputs: storage.levelPoint.gateway.simulated || simulatedIntervals > 0,
      });
    }
    return views;
  }

  async listAlerts(scope: CompanyScope, query: Record<string, unknown>): Promise<EnergyAlertView[]> {
    const status = query.status === "ALL" ? undefined : ((query.status as string | undefined) ?? "OPEN");
    if (status && status !== "OPEN" && status !== "ACKNOWLEDGED") throw new BadRequestException("status must be OPEN, ACKNOWLEDGED or ALL");
    const alerts = await this.prisma.energyAlert.findMany({ where: { ...scope, ...(status ? { status: status as "OPEN" | "ACKNOWLEDGED" } : {}) }, orderBy: { periodStart: "desc" }, take: 300 });
    const [meters, users] = await Promise.all([
      this.prisma.energyMeter.findMany({ where: { id: { in: [...new Set(alerts.map((alert) => alert.meterId))] }, ...scope }, select: { id: true, code: true, name: true, kind: true } }),
      this.prisma.user.findMany({ where: { id: { in: alerts.map((alert) => alert.acknowledgedByUserId).filter((id): id is string => Boolean(id)) }, organizationId: scope.organizationId }, select: { id: true, fullName: true } }),
    ]);
    return alerts.map((alert) => {
      const meter = meters.find((candidate) => candidate.id === alert.meterId);
      return {
        id: alert.id,
        meterId: alert.meterId,
        meterCode: meter?.code ?? "—",
        meterName: meter?.name ?? "—",
        unit: meterUnit(meter?.kind ?? "CONSUMPTION"),
        kind: alert.kind,
        threshold: str(alert.threshold)!,
        message: alert.message,
        periodStart: alert.periodStart.toISOString(),
        value: str(alert.value)!,
        raisedAt: alert.raisedAt.toISOString(),
        status: alert.status,
        acknowledgedByName: users.find((user) => user.id === alert.acknowledgedByUserId)?.fullName ?? null,
        acknowledgeNote: alert.acknowledgeNote,
      };
    });
  }

  async acknowledgeAlert(scope: CompanyScope, alertId: string, body: unknown, actorUserId: string) {
    const note = requiredText(assertBody(body ?? {}).note, "note", 1000);
    await this.prisma.$transaction(async (tx) => {
      const alert = await tx.energyAlert.findFirst({ where: { id: alertId, ...scope } });
      if (!alert) throw new NotFoundException("Alert not found");
      if (alert.status !== "OPEN") throw new BadRequestException("Alert already acknowledged");
      await tx.energyAlert.update({ where: { id: alertId }, data: { status: "ACKNOWLEDGED", acknowledgedByUserId: actorUserId, acknowledgedAt: new Date(), acknowledgeNote: note } });
      await writeAudit(tx, scope, actorUserId, "energy.alert.acknowledged", "EnergyAlert", alertId, { note });
    });
    return this.listAlerts(scope, { status: "ALL" });
  }

  async summary(scope: CompanyScope): Promise<EnergySummaryView> {
    const meters = await this.prisma.energyMeter.findMany({ where: { ...scope, active: true } });
    const views = await this.meterViews(scope, meters);
    const to = startOfUtcDay(new Date());
    const from = new Date(to.getTime() - 7 * DAY_MS);
    const consumptionMeters = meters.filter((meter) => meter.kind === "CONSUMPTION");
    let consumption: D | null = null;
    let cover: D | null = null;
    if (consumptionMeters.length) {
      const aggregate = await this.prisma.energyInterval.aggregate({ where: { meterId: { in: consumptionMeters.map((meter) => meter.id) }, periodStart: { gte: from, lt: to } }, _sum: { value: true }, _count: { _all: true } });
      consumption = new Prisma.Decimal(aggregate._sum.value ?? 0);
      cover = coverage(aggregate._count._all, consumptionMeters.reduce((total, meter) => total + expectedIntervals(from, to, meter.intervalMinutes), 0));
    }
    return {
      meters: meters.length,
      openAlerts: await this.prisma.energyAlert.count({ where: { ...scope, status: "OPEN" } }),
      lowCoverageMeters: views.filter((view) => Number(view.coverage24h) < MIN_AUTONOMY_COVERAGE).length,
      consumption7d: consumption?.toFixed(2) ?? null,
      consumption7dCoverage: cover?.toFixed(1) ?? null,
    };
  }

  private async meterViews(scope: CompanyScope, meters: Meter[]): Promise<EnergyMeterView[]> {
    const ids = meters.map((meter) => meter.id);
    const since = new Date(Date.now() - DAY_MS);
    const [buildings, gateways, assets, recent, last, tariffs] = await Promise.all([
      this.prisma.smartBuilding.findMany({ where: { id: { in: [...new Set(meters.map((meter) => meter.buildingId))] }, ...scope }, select: { id: true, code: true } }),
      this.prisma.smartGateway.findMany({ where: { id: { in: meters.map((meter) => meter.gatewayId).filter((id): id is string => Boolean(id)) }, ...scope }, select: { id: true, code: true, simulated: true } }),
      this.prisma.asset.findMany({ where: { id: { in: meters.map((meter) => meter.assetId).filter((id): id is string => Boolean(id)) }, ...scope }, select: { id: true, code: true } }),
      this.prisma.energyInterval.groupBy({ by: ["meterId"], where: { meterId: { in: ids }, periodStart: { gte: since } }, _count: { _all: true } }),
      this.prisma.energyInterval.groupBy({ by: ["meterId"], where: { meterId: { in: ids } }, _max: { periodStart: true } }),
      this.prisma.energyTariff.findMany({ where: { meterId: { in: ids } }, orderBy: { validFrom: "asc" } }),
    ]);
    const today = startOfUtcDay(new Date());
    return meters.map((meter) => {
      const gateway = gateways.find((candidate) => candidate.id === meter.gatewayId);
      const received = recent.find((row) => row.meterId === meter.id)?._count._all ?? 0;
      const tariff = tariffAt(tariffs.filter((row) => row.meterId === meter.id), today);
      return {
        id: meter.id,
        code: meter.code,
        name: meter.name,
        buildingId: meter.buildingId,
        buildingCode: buildings.find((building) => building.id === meter.buildingId)?.code ?? "—",
        kind: meter.kind,
        unit: meterUnit(meter.kind),
        intervalMinutes: meter.intervalMinutes,
        gatewayId: meter.gatewayId,
        gatewayCode: gateway?.code ?? null,
        externalRef: meter.externalRef,
        assetId: meter.assetId,
        assetCode: assets.find((asset) => asset.id === meter.assetId)?.code ?? null,
        active: meter.active,
        lastPeriodStart: last.find((row) => row.meterId === meter.id)?._max.periodStart?.toISOString() ?? null,
        coverage24h: coverage(received, (24 * 60) / meter.intervalMinutes).toFixed(1),
        simulated: gateway?.simulated ?? false,
        currentTariff: tariff?.toString() ?? null,
      };
    });
  }
}
