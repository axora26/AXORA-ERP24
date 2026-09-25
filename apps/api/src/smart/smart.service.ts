import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import type {
  SmartAlarmRuleView,
  SmartAlarmView,
  SmartBuildingView,
  SmartGatewayTestView,
  SmartGatewayTokenView,
  SmartGatewayView,
  SmartPointDetailView,
  SmartPointView,
  SmartSetpointView,
  SmartSummaryView,
  SmartTrendView,
} from "@axora24/contracts";
import { Prisma } from "@axora24/database";
import { hashSessionToken } from "@axora24/security";
import { PrismaService } from "../core/prisma.service.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import { writeAudit } from "../common/audit.js";
import { assertBody, optionalDecimal, optionalEnum, optionalId, optionalInt, optionalText, requiredDecimal, requiredEnum, requiredId, requiredText } from "../common/validation.js";
import { connectivityLevels, type TestEvidence } from "./connectivity.js";
import { withinTolerance } from "./alarm-engine.js";

type Decimalish = Prisma.Decimal | string | number | null;

const PROTOCOLS = ["HTTP_API", "MQTT", "BACNET_IP", "MODBUS_TCP", "KNX_IP"] as const;
const KINDS = ["ANALOG", "BINARY", "MULTISTATE"] as const;
const CONDITIONS = ["ABOVE", "BELOW", "EQUALS"] as const;
const SEVERITIES = ["INFO", "WARNING", "CRITICAL"] as const;
const STALE_MS = 60 * 60_000;
const READ_TEST_FRESHNESS_MS = 15 * 60_000;

function num(value: Decimalish): string | null {
  return value === null ? null : new Prisma.Decimal(value).toString();
}

function code(value: unknown, field: string): string {
  const text = requiredText(value, field, 40).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._-]*$/.test(text)) throw new BadRequestException(`${field} must contain letters, digits, dot, dash or underscore`);
  return text;
}

function newGatewayToken(): { token: string; hash: string; prefix: string } {
  const token = `axgw_${randomBytes(24).toString("base64url")}`;
  return { token, hash: hashSessionToken(token), prefix: token.slice(0, 10) };
}

/**
 * INC-16 — Smart Building : configuration (batiments, passerelles, points,
 * regles), exploitation (tendances, alarmes, consignes) et essais reels.
 * L'ecriture de la telemetrie passe exclusivement par SmartIngestionService.
 */
@Injectable()
export class SmartService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(scope: CompanyScope): Promise<SmartSummaryView> {
    const since = new Date(Date.now() - 86_400_000);
    const [buildings, gateways, points, stalePoints, activeAlarms, criticalAlarms, pendingSetpoints, readings24h, tests] = await Promise.all([
      this.prisma.smartBuilding.count({ where: scope }),
      this.prisma.smartGateway.findMany({ where: { ...scope, active: true }, select: { id: true, simulated: true } }),
      this.prisma.smartPoint.count({ where: { ...scope, active: true } }),
      this.prisma.smartPoint.count({ where: { ...scope, active: true, OR: [{ lastReadingAt: null }, { lastReadingAt: { lt: new Date(Date.now() - STALE_MS) } }] } }),
      this.prisma.smartAlarm.count({ where: { ...scope, status: { in: ["ACTIVE", "ACKNOWLEDGED"] } } }),
      this.prisma.smartAlarm.count({ where: { ...scope, status: "ACTIVE", severity: "CRITICAL" } }),
      this.prisma.smartSetpoint.count({ where: { ...scope, status: { in: ["REQUESTED", "DISPATCHED", "ACKNOWLEDGED"] } } }),
      this.prisma.smartReading.count({ where: { ...scope, ts: { gte: since } } }),
      this.prisma.smartGatewayTest.findMany({ where: { ...scope, outcome: "PASS" }, select: { gatewayId: true, kind: true } }),
    ]);
    const physical = new Set(gateways.filter((gateway) => !gateway.simulated).map((gateway) => gateway.id));
    return {
      buildings,
      gateways: gateways.length,
      simulatedGateways: gateways.filter((gateway) => gateway.simulated).length,
      physicalReadTested: new Set(tests.filter((test) => test.kind === "READ" && physical.has(test.gatewayId)).map((test) => test.gatewayId)).size,
      physicalWriteTested: new Set(tests.filter((test) => test.kind === "WRITE" && physical.has(test.gatewayId)).map((test) => test.gatewayId)).size,
      points,
      stalePoints,
      activeAlarms,
      criticalAlarms,
      pendingSetpoints,
      readings24h,
    };
  }

  // -------------------------------------------------------------------
  // Batiments et passerelles
  // -------------------------------------------------------------------

  async listBuildings(scope: CompanyScope): Promise<SmartBuildingView[]> {
    const buildings = await this.prisma.smartBuilding.findMany({ where: scope, orderBy: { code: "asc" }, include: { gateways: { select: { id: true } } } });
    const gatewayIds = buildings.flatMap((building) => building.gateways.map((gateway) => gateway.id));
    const [points, alarms, projects] = await Promise.all([
      this.prisma.smartPoint.groupBy({ by: ["gatewayId"], where: { ...scope, gatewayId: { in: gatewayIds } }, _count: { _all: true } }),
      this.prisma.smartAlarm.findMany({ where: { ...scope, status: { in: ["ACTIVE", "ACKNOWLEDGED"] } }, select: { pointId: true } }),
      this.prisma.project.findMany({ where: { ...scope, id: { in: buildings.map((building) => building.projectId).filter((id): id is string => Boolean(id)) } }, select: { id: true, code: true } }),
    ]);
    const alarmPoints = alarms.length
      ? await this.prisma.smartPoint.findMany({ where: { id: { in: alarms.map((alarm) => alarm.pointId) } }, select: { id: true, gatewayId: true } })
      : [];
    return buildings.map((building) => {
      const ids = new Set(building.gateways.map((gateway) => gateway.id));
      return {
        id: building.id,
        code: building.code,
        name: building.name,
        address: building.address,
        projectId: building.projectId,
        projectCode: projects.find((project) => project.id === building.projectId)?.code ?? null,
        floorAreaM2: num(building.floorAreaM2),
        gateways: building.gateways.length,
        points: points.filter((row) => ids.has(row.gatewayId)).reduce((sum, row) => sum + row._count._all, 0),
        activeAlarms: alarms.filter((alarm) => ids.has(alarmPoints.find((point) => point.id === alarm.pointId)?.gatewayId ?? "")).length,
      };
    });
  }

  async createBuilding(scope: CompanyScope, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const buildingCode = code(input.code, "code");
    const projectId = optionalId(input.projectId, "projectId");
    await this.prisma.$transaction(async (tx) => {
      if (projectId && !(await tx.project.findFirst({ where: { id: projectId, ...scope }, select: { id: true } }))) throw new NotFoundException("Project not found");
      if (await tx.smartBuilding.findFirst({ where: { companyId: scope.companyId, code: buildingCode } })) throw new ConflictException(`Building ${buildingCode} already exists`);
      const building = await tx.smartBuilding.create({
        data: {
          ...scope,
          code: buildingCode,
          name: requiredText(input.name, "name", 200),
          address: optionalText(input.address, "address", 300),
          projectId,
          floorAreaM2: optionalDecimal(input.floorAreaM2, "floorAreaM2", { positive: true }),
          createdByUserId: actorUserId,
        },
      });
      await writeAudit(tx, scope, actorUserId, "smart.building.created", "SmartBuilding", building.id, { code: buildingCode });
    });
    return this.listBuildings(scope);
  }

  async updateBuilding(scope: CompanyScope, buildingId: string, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    await this.prisma.$transaction(async (tx) => {
      if (!(await tx.smartBuilding.findFirst({ where: { id: buildingId, ...scope }, select: { id: true } }))) throw new NotFoundException("Building not found");
      await tx.smartBuilding.update({
        where: { id: buildingId },
        data: {
          ...(input.name !== undefined ? { name: requiredText(input.name, "name", 200) } : {}),
          ...(input.address !== undefined ? { address: optionalText(input.address, "address", 300) } : {}),
          ...(input.floorAreaM2 !== undefined ? { floorAreaM2: optionalDecimal(input.floorAreaM2, "floorAreaM2", { positive: true }) } : {}),
        },
      });
      await writeAudit(tx, scope, actorUserId, "smart.building.updated", "SmartBuilding", buildingId, { floorAreaM2: input.floorAreaM2 });
    });
    return this.listBuildings(scope);
  }

  async listGateways(scope: CompanyScope): Promise<SmartGatewayView[]> {
    const gateways = await this.prisma.smartGateway.findMany({ where: scope, orderBy: { code: "asc" } });
    return this.gatewayViews(scope, gateways, false);
  }

  async getGateway(scope: CompanyScope, gatewayId: string): Promise<SmartGatewayView> {
    const gateway = await this.prisma.smartGateway.findFirst({ where: { id: gatewayId, ...scope } });
    if (!gateway) throw new NotFoundException("Gateway not found");
    const [view] = await this.gatewayViews(scope, [gateway], true);
    return view!;
  }

  /** Le jeton en clair n'est retourne qu'ici (et a la rotation) ; seule son empreinte est stockee. */
  async createGateway(scope: CompanyScope, body: unknown, actorUserId: string): Promise<SmartGatewayTokenView> {
    const input = assertBody(body);
    const buildingId = requiredId(input.buildingId, "buildingId");
    const gatewayCode = code(input.code, "code");
    const protocol = requiredEnum(input.protocol, "protocol", PROTOCOLS);
    if (input.simulated !== undefined && typeof input.simulated !== "boolean") throw new BadRequestException("simulated must be a boolean");
    const token = newGatewayToken();
    const id = await this.prisma.$transaction(async (tx) => {
      if (!(await tx.smartBuilding.findFirst({ where: { id: buildingId, ...scope }, select: { id: true } }))) throw new NotFoundException("Building not found");
      if (await tx.smartGateway.findFirst({ where: { companyId: scope.companyId, code: gatewayCode } })) throw new ConflictException(`Gateway ${gatewayCode} already exists`);
      const gateway = await tx.smartGateway.create({
        data: {
          ...scope,
          buildingId,
          code: gatewayCode,
          name: requiredText(input.name, "name", 200),
          protocol,
          endpoint: optionalText(input.endpoint, "endpoint", 300),
          simulated: input.simulated === true,
          tokenHash: token.hash,
          tokenPrefix: token.prefix,
          createdByUserId: actorUserId,
        },
      });
      await writeAudit(tx, scope, actorUserId, "smart.gateway.created", "SmartGateway", gateway.id, { code: gatewayCode, protocol, simulated: input.simulated === true });
      return gateway.id;
    });
    return { gateway: await this.getGateway(scope, id), token: token.token };
  }

  async rotateToken(scope: CompanyScope, gatewayId: string, actorUserId: string): Promise<SmartGatewayTokenView> {
    const token = newGatewayToken();
    await this.prisma.$transaction(async (tx) => {
      const gateway = await tx.smartGateway.findFirst({ where: { id: gatewayId, ...scope } });
      if (!gateway) throw new NotFoundException("Gateway not found");
      await tx.smartGateway.update({ where: { id: gatewayId }, data: { tokenHash: token.hash, tokenPrefix: token.prefix } });
      await writeAudit(tx, scope, actorUserId, "smart.gateway.token_rotated", "SmartGateway", gatewayId, { code: gateway.code });
    });
    return { gateway: await this.getGateway(scope, gatewayId), token: token.token };
  }

  async updateGateway(scope: CompanyScope, gatewayId: string, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    if (input.active !== undefined && typeof input.active !== "boolean") throw new BadRequestException("active must be a boolean");
    await this.prisma.$transaction(async (tx) => {
      const gateway = await tx.smartGateway.findFirst({ where: { id: gatewayId, ...scope } });
      if (!gateway) throw new NotFoundException("Gateway not found");
      await tx.smartGateway.update({
        where: { id: gatewayId },
        data: {
          ...(input.name !== undefined ? { name: requiredText(input.name, "name", 200) } : {}),
          ...(input.endpoint !== undefined ? { endpoint: optionalText(input.endpoint, "endpoint", 300) } : {}),
          ...(typeof input.active === "boolean" ? { active: input.active } : {}),
        },
      });
      await writeAudit(tx, scope, actorUserId, "smart.gateway.updated", "SmartGateway", gatewayId, { active: input.active });
    });
    return this.getGateway(scope, gatewayId);
  }

  // -------------------------------------------------------------------
  // Points, tendances, regles
  // -------------------------------------------------------------------

  async listPoints(scope: CompanyScope, query: Record<string, unknown>): Promise<SmartPointView[]> {
    const gatewayId = optionalId(query.gatewayId, "gatewayId");
    const assetId = optionalId(query.assetId, "assetId");
    const points = await this.prisma.smartPoint.findMany({
      where: { ...scope, ...(gatewayId ? { gatewayId } : {}), ...(assetId ? { assetId } : {}) },
      orderBy: [{ gatewayId: "asc" }, { externalRef: "asc" }],
      take: 1000,
    });
    return this.pointViews(scope, points);
  }

  async getPoint(scope: CompanyScope, pointId: string): Promise<SmartPointDetailView> {
    const point = await this.prisma.smartPoint.findFirst({ where: { id: pointId, ...scope } });
    if (!point) throw new NotFoundException("Point not found");
    const [[view], rules, alarms, setpoints, recent] = await Promise.all([
      this.pointViews(scope, [point]),
      this.prisma.smartAlarmRule.findMany({ where: { pointId, ...scope }, orderBy: { createdAt: "asc" } }),
      this.listAlarms(scope, { pointId, status: "ALL" }),
      this.listSetpoints(scope, { pointId }),
      this.prisma.smartReading.findMany({ where: { pointId }, orderBy: { ts: "desc" }, take: 20 }),
    ]);
    return {
      ...view!,
      rules: rules.map((rule) => this.ruleView(rule)),
      alarms: alarms.slice(0, 50),
      setpoints: setpoints.slice(0, 20),
      recent: recent.map((reading) => ({ ts: reading.ts.toISOString(), value: num(reading.value)!, quality: reading.quality })),
    };
  }

  async createPoint(scope: CompanyScope, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const gatewayId = requiredId(input.gatewayId, "gatewayId");
    const externalRef = requiredText(input.externalRef, "externalRef", 200);
    const kind = requiredEnum(input.kind, "kind", KINDS);
    const assetId = optionalId(input.assetId, "assetId");
    if (input.writable !== undefined && typeof input.writable !== "boolean") throw new BadRequestException("writable must be a boolean");
    const writable = input.writable === true;
    const writeTolerance = optionalDecimal(input.writeTolerance, "writeTolerance");
    if (writeTolerance && (!writable || writeTolerance.isNegative())) throw new BadRequestException("writeTolerance applies to a writable point and must be >= 0");
    const minPlausible = optionalDecimal(input.minPlausible, "minPlausible", { allowNegative: true });
    const maxPlausible = optionalDecimal(input.maxPlausible, "maxPlausible", { allowNegative: true });
    if (minPlausible && maxPlausible && !minPlausible.lessThan(maxPlausible)) throw new BadRequestException("minPlausible must be lower than maxPlausible");
    const id = await this.prisma.$transaction(async (tx) => {
      if (!(await tx.smartGateway.findFirst({ where: { id: gatewayId, ...scope }, select: { id: true } }))) throw new NotFoundException("Gateway not found");
      if (assetId && !(await tx.asset.findFirst({ where: { id: assetId, ...scope }, select: { id: true } }))) throw new NotFoundException("Asset not found");
      if (await tx.smartPoint.findFirst({ where: { gatewayId, externalRef } })) throw new ConflictException(`Point ${externalRef} already exists on this gateway`);
      const point = await tx.smartPoint.create({
        data: {
          ...scope,
          gatewayId,
          externalRef,
          name: requiredText(input.name, "name", 200),
          kind,
          unit: optionalText(input.unit, "unit", 20),
          assetId,
          writable,
          writeTolerance: writable ? (writeTolerance ?? new Prisma.Decimal(0)) : null,
          minPlausible,
          maxPlausible,
          createdByUserId: actorUserId,
        },
      });
      await writeAudit(tx, scope, actorUserId, "smart.point.created", "SmartPoint", point.id, { externalRef, kind, writable });
      return point.id;
    });
    return this.getPoint(scope, id);
  }

  async updatePoint(scope: CompanyScope, pointId: string, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    if (input.active !== undefined && typeof input.active !== "boolean") throw new BadRequestException("active must be a boolean");
    const assetId = input.assetId === null ? null : optionalId(input.assetId, "assetId");
    await this.prisma.$transaction(async (tx) => {
      const point = await tx.smartPoint.findFirst({ where: { id: pointId, ...scope } });
      if (!point) throw new NotFoundException("Point not found");
      if (assetId && !(await tx.asset.findFirst({ where: { id: assetId, ...scope }, select: { id: true } }))) throw new NotFoundException("Asset not found");
      await tx.smartPoint.update({
        where: { id: pointId },
        data: {
          ...(input.name !== undefined ? { name: requiredText(input.name, "name", 200) } : {}),
          ...(input.unit !== undefined ? { unit: optionalText(input.unit, "unit", 20) } : {}),
          ...(input.assetId !== undefined ? { assetId } : {}),
          ...(typeof input.active === "boolean" ? { active: input.active } : {}),
        },
      });
      await writeAudit(tx, scope, actorUserId, "smart.point.updated", "SmartPoint", pointId, { active: input.active, assetId });
    });
    return this.getPoint(scope, pointId);
  }

  /** Tendance : brute jusqu'a 48 h, agregee a l'heure au-dela (min / moyenne / max), lectures BAD exclues et comptees. */
  async trend(scope: CompanyScope, pointId: string, query: Record<string, unknown>): Promise<SmartTrendView> {
    const hours = optionalInt(query.hours, "hours", { min: 1, max: 24 * 93 }) ?? 24;
    const point = await this.prisma.smartPoint.findFirst({ where: { id: pointId, ...scope }, select: { id: true } });
    if (!point) throw new NotFoundException("Point not found");
    const to = new Date();
    const from = new Date(to.getTime() - hours * 3_600_000);
    const badReadings = await this.prisma.smartReading.count({ where: { pointId, ts: { gte: from, lte: to }, quality: "BAD" } });
    if (hours <= 48) {
      const rows = await this.prisma.smartReading.findMany({ where: { pointId, ts: { gte: from, lte: to }, quality: { not: "BAD" } }, orderBy: { ts: "asc" }, take: 5000 });
      return {
        pointId,
        from: from.toISOString(),
        to: to.toISOString(),
        bucket: "raw",
        badReadings,
        series: rows.map((row) => ({ ts: row.ts.toISOString(), min: num(row.value)!, avg: num(row.value)!, max: num(row.value)!, count: 1 })),
      };
    }
    const rows = await this.prisma.$queryRaw<Array<{ bucket: Date; min: Prisma.Decimal; avg: Prisma.Decimal; max: Prisma.Decimal; count: bigint }>>`
      SELECT date_trunc('hour', "ts") AS bucket, min("value") AS min, avg("value") AS avg, max("value") AS max, count(*) AS count
      FROM "smart_readings"
      WHERE "pointId" = ${pointId} AND "ts" >= ${from} AND "ts" <= ${to} AND "quality" <> 'BAD'
      GROUP BY 1 ORDER BY 1
    `;
    return {
      pointId,
      from: from.toISOString(),
      to: to.toISOString(),
      bucket: "hour",
      badReadings,
      series: rows.map((row) => ({ ts: row.bucket.toISOString(), min: num(row.min)!, avg: new Prisma.Decimal(row.avg).toDecimalPlaces(6).toString(), max: num(row.max)!, count: Number(row.count) })),
    };
  }

  /** Seuil immuable : pour le modifier, desactiver la regle et en creer une nouvelle (historique d'alarmes intact). */
  async createRule(scope: CompanyScope, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const pointId = requiredId(input.pointId, "pointId");
    const condition = requiredEnum(input.condition, "condition", CONDITIONS);
    const threshold = requiredDecimal(input.threshold, "threshold", { allowNegative: true });
    await this.prisma.$transaction(async (tx) => {
      const point = await tx.smartPoint.findFirst({ where: { id: pointId, ...scope } });
      if (!point) throw new NotFoundException("Point not found");
      if (point.kind !== "ANALOG" && condition !== "EQUALS") throw new BadRequestException("A binary or multistate point uses the EQUALS condition");
      const rule = await tx.smartAlarmRule.create({
        data: { ...scope, pointId, condition, threshold, severity: optionalEnum(input.severity, "severity", SEVERITIES) ?? "WARNING", message: requiredText(input.message, "message", 300), createdByUserId: actorUserId },
      });
      await writeAudit(tx, scope, actorUserId, "smart.rule.created", "SmartAlarmRule", rule.id, { pointId, condition, threshold: threshold.toString() });
    });
    return this.getPoint(scope, pointId);
  }

  async setRuleActive(scope: CompanyScope, ruleId: string, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    if (typeof input.active !== "boolean") throw new BadRequestException("active must be a boolean");
    const rule = await this.prisma.$transaction(async (tx) => {
      const current = await tx.smartAlarmRule.findFirst({ where: { id: ruleId, ...scope } });
      if (!current) throw new NotFoundException("Rule not found");
      await tx.smartAlarmRule.update({ where: { id: ruleId }, data: { active: input.active as boolean } });
      await writeAudit(tx, scope, actorUserId, "smart.rule.updated", "SmartAlarmRule", ruleId, { active: input.active });
      return current;
    });
    return this.getPoint(scope, rule.pointId);
  }

  // -------------------------------------------------------------------
  // Alarmes
  // -------------------------------------------------------------------

  async listAlarms(scope: CompanyScope, query: Record<string, unknown>): Promise<SmartAlarmView[]> {
    const status = typeof query.status === "string" && query.status === "ALL" ? undefined : optionalEnum(query.status, "status", ["ACTIVE", "ACKNOWLEDGED", "CLEARED"] as const);
    const pointId = optionalId(query.pointId, "pointId");
    const openOnly = query.status === undefined;
    const alarms = await this.prisma.smartAlarm.findMany({
      where: { ...scope, ...(pointId ? { pointId } : {}), ...(status ? { status } : openOnly ? { status: { in: ["ACTIVE", "ACKNOWLEDGED"] } } : {}) },
      orderBy: { raisedAt: "desc" },
      take: 300,
    });
    const points = await this.prisma.smartPoint.findMany({ where: { id: { in: [...new Set(alarms.map((alarm) => alarm.pointId))] }, ...scope }, include: { gateway: { include: { building: { select: { code: true } } } } } });
    const users = await this.userNames(scope, alarms.map((alarm) => alarm.acknowledgedByUserId).filter((id): id is string => Boolean(id)));
    return alarms.map((alarm) => {
      const point = points.find((candidate) => candidate.id === alarm.pointId);
      return {
        id: alarm.id,
        ruleId: alarm.ruleId,
        pointId: alarm.pointId,
        pointName: point?.name ?? "—",
        pointRef: point?.externalRef ?? "—",
        unit: point?.unit ?? null,
        gatewayCode: point?.gateway.code ?? "—",
        buildingCode: point?.gateway.building.code ?? "—",
        condition: alarm.condition,
        threshold: num(alarm.threshold)!,
        severity: alarm.severity,
        message: alarm.message,
        triggerValue: num(alarm.triggerValue)!,
        triggerReadingAt: alarm.triggerReadingAt.toISOString(),
        raisedAt: alarm.raisedAt.toISOString(),
        status: alarm.status,
        acknowledgedByName: alarm.acknowledgedByUserId ? (users.get(alarm.acknowledgedByUserId) ?? "—") : null,
        acknowledgedAt: alarm.acknowledgedAt?.toISOString() ?? null,
        acknowledgeNote: alarm.acknowledgeNote,
        clearedAt: alarm.clearedAt?.toISOString() ?? null,
        clearValue: num(alarm.clearValue),
      };
    });
  }

  /** Acquitter = « pris en compte » ; seule une lecture revenue a la normale leve l'alarme. */
  async acknowledgeAlarm(scope: CompanyScope, alarmId: string, body: unknown, actorUserId: string) {
    const note = requiredText(assertBody(body ?? {}).note, "note", 1000);
    await this.prisma.$transaction(async (tx) => {
      const alarm = await tx.smartAlarm.findFirst({ where: { id: alarmId, ...scope } });
      if (!alarm) throw new NotFoundException("Alarm not found");
      if (alarm.status !== "ACTIVE") throw new BadRequestException(`Alarm is ${alarm.status}`);
      await tx.smartAlarm.update({ where: { id: alarmId }, data: { status: "ACKNOWLEDGED", acknowledgedByUserId: actorUserId, acknowledgedAt: new Date(), acknowledgeNote: note } });
      await writeAudit(tx, scope, actorUserId, "smart.alarm.acknowledged", "SmartAlarm", alarmId, { note });
    });
    return (await this.listAlarms(scope, { status: "ALL" })).find((alarm) => alarm.id === alarmId)!;
  }

  // -------------------------------------------------------------------
  // Consignes
  // -------------------------------------------------------------------

  async listSetpoints(scope: CompanyScope, query: Record<string, unknown>): Promise<SmartSetpointView[]> {
    const pointId = optionalId(query.pointId, "pointId");
    const setpoints = await this.prisma.smartSetpoint.findMany({ where: { ...scope, ...(pointId ? { pointId } : {}) }, orderBy: { requestedAt: "desc" }, take: 200, include: { point: { select: { name: true, unit: true } } } });
    const users = await this.userNames(scope, setpoints.map((setpoint) => setpoint.requestedByUserId));
    return setpoints.map((setpoint) => ({
      id: setpoint.id,
      pointId: setpoint.pointId,
      pointName: setpoint.point.name,
      unit: setpoint.point.unit,
      requestedValue: num(setpoint.requestedValue)!,
      reason: setpoint.reason,
      requestedByName: users.get(setpoint.requestedByUserId) ?? "—",
      requestedAt: setpoint.requestedAt.toISOString(),
      status: setpoint.status,
      dispatchedAt: setpoint.dispatchedAt?.toISOString() ?? null,
      acknowledgedAt: setpoint.acknowledgedAt?.toISOString() ?? null,
      gatewayNote: setpoint.gatewayNote,
      confirmedAt: setpoint.confirmedAt?.toISOString() ?? null,
      confirmReadingAt: setpoint.confirmReadingAt?.toISOString() ?? null,
      confirmValue: num(setpoint.confirmValue),
    }));
  }

  async requestSetpoint(scope: CompanyScope, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const pointId = requiredId(input.pointId, "pointId");
    const value = requiredDecimal(input.value, "value", { allowNegative: true });
    const reason = requiredText(input.reason, "reason", 500);
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "smart_points" WHERE "id" = ${pointId} FOR UPDATE`;
      const point = await tx.smartPoint.findFirst({ where: { id: pointId, ...scope }, include: { gateway: true } });
      if (!point) throw new NotFoundException("Point not found");
      if (!point.writable) throw new BadRequestException("This point is read-only");
      if (!point.active || !point.gateway.active) throw new BadRequestException("The point or its gateway is inactive");
      if ((point.minPlausible !== null && value.lessThan(point.minPlausible)) || (point.maxPlausible !== null && value.greaterThan(point.maxPlausible))) {
        throw new BadRequestException("The setpoint is outside the plausible range of the point");
      }
      if (point.kind === "BINARY" && !value.equals(0) && !value.equals(1)) throw new BadRequestException("A binary point expects 0 or 1");
      const pending = await tx.smartSetpoint.findFirst({ where: { pointId, status: { in: ["REQUESTED", "DISPATCHED", "ACKNOWLEDGED"] } }, select: { id: true } });
      if (pending) throw new ConflictException("A setpoint is already pending on this point: cancel it or wait for its confirmation");
      const setpoint = await tx.smartSetpoint.create({ data: { ...scope, pointId, requestedValue: value, reason, requestedByUserId: actorUserId } });
      await writeAudit(tx, scope, actorUserId, "smart.setpoint.requested", "SmartSetpoint", setpoint.id, { pointId, value: value.toString(), reason });
    });
    return this.listSetpoints(scope, { pointId });
  }

  async cancelSetpoint(scope: CompanyScope, setpointId: string, actorUserId: string) {
    const setpoint = await this.prisma.$transaction(async (tx) => {
      const current = await tx.smartSetpoint.findFirst({ where: { id: setpointId, ...scope } });
      if (!current) throw new NotFoundException("Setpoint not found");
      if (!["REQUESTED", "DISPATCHED", "ACKNOWLEDGED"].includes(current.status)) throw new BadRequestException(`Setpoint is ${current.status}`);
      await tx.smartSetpoint.update({ where: { id: setpointId }, data: { status: "CANCELLED", cancelledByUserId: actorUserId } });
      await writeAudit(tx, scope, actorUserId, "smart.setpoint.cancelled", "SmartSetpoint", setpointId, { from: current.status });
      return current;
    });
    return this.listSetpoints(scope, { pointId: setpoint.pointId });
  }

  // -------------------------------------------------------------------
  // Essais reels (attestations)
  // -------------------------------------------------------------------

  /**
   * Essai de lecture point-a-point : la derniere lecture recue (< 15 min) est
   * comparee a une mesure de reference independante ; le verdict est calcule
   * par le serveur. Essai d'ecriture : consigne confirmee par relecture ET
   * constat physique. Refuse sur une passerelle de simulation (API et base).
   */
  async attestTest(scope: CompanyScope, gatewayId: string, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const kind = requiredEnum(input.kind, "kind", ["READ", "WRITE"] as const);
    const evidence = requiredText(input.evidence, "evidence", 2000);
    await this.prisma.$transaction(async (tx) => {
      const gateway = await tx.smartGateway.findFirst({ where: { id: gatewayId, ...scope } });
      if (!gateway) throw new NotFoundException("Gateway not found");
      if (gateway.simulated) throw new BadRequestException("A simulator is never evidence of physical communication");
      if (kind === "READ") {
        const pointId = requiredId(input.pointId, "pointId");
        const referenceValue = requiredDecimal(input.referenceValue, "referenceValue", { allowNegative: true });
        const tolerance = requiredDecimal(input.tolerance, "tolerance");
        const point = await tx.smartPoint.findFirst({ where: { id: pointId, gatewayId, ...scope } });
        if (!point) throw new NotFoundException("Point not found on this gateway");
        const reading = await tx.smartReading.findFirst({ where: { pointId, quality: "GOOD" }, orderBy: { ts: "desc" } });
        if (!reading || Date.now() - reading.ts.getTime() > READ_TEST_FRESHNESS_MS) throw new BadRequestException("No reading received from this point in the last 15 minutes");
        const observed = new Prisma.Decimal(reading.value);
        const outcome = withinTolerance(observed, referenceValue, tolerance) ? "PASS" : "FAIL";
        const test = await tx.smartGatewayTest.create({
          data: { ...scope, gatewayId, pointId, kind, referenceValue, tolerance, observedValue: observed, observedAt: reading.ts, outcome, evidence, performedByUserId: actorUserId },
        });
        await writeAudit(tx, scope, actorUserId, "smart.test.recorded", "SmartGatewayTest", test.id, { gateway: gateway.code, kind, outcome });
      } else {
        const setpointId = requiredId(input.setpointId, "setpointId");
        if (typeof input.physicallyObserved !== "boolean") throw new BadRequestException("physicallyObserved must be a boolean");
        const setpoint = await tx.smartSetpoint.findFirst({ where: { id: setpointId, ...scope, point: { gatewayId } } });
        if (!setpoint) throw new NotFoundException("Setpoint not found on this gateway");
        if (setpoint.status !== "CONFIRMED" || !setpoint.confirmValue || !setpoint.confirmReadingAt) throw new BadRequestException("Only a setpoint confirmed by readback can support a write test");
        const outcome = input.physicallyObserved ? "PASS" : "FAIL";
        const test = await tx.smartGatewayTest.create({
          data: { ...scope, gatewayId, pointId: setpoint.pointId, kind, observedValue: setpoint.confirmValue, observedAt: setpoint.confirmReadingAt, setpointId, outcome, evidence, performedByUserId: actorUserId },
        });
        await writeAudit(tx, scope, actorUserId, "smart.test.recorded", "SmartGatewayTest", test.id, { gateway: gateway.code, kind, outcome });
      }
    });
    return this.getGateway(scope, gatewayId);
  }

  // -------------------------------------------------------------------
  // Internes
  // -------------------------------------------------------------------

  private ruleView(rule: Prisma.SmartAlarmRuleGetPayload<object>): SmartAlarmRuleView {
    return { id: rule.id, pointId: rule.pointId, condition: rule.condition, threshold: num(rule.threshold)!, severity: rule.severity, message: rule.message, active: rule.active };
  }

  private async gatewayViews(scope: CompanyScope, gateways: Prisma.SmartGatewayGetPayload<object>[], detailed: boolean): Promise<SmartGatewayView[]> {
    const ids = gateways.map((gateway) => gateway.id);
    const since = new Date(Date.now() - 86_400_000);
    const [buildings, points, tests] = await Promise.all([
      this.prisma.smartBuilding.findMany({ where: { id: { in: gateways.map((gateway) => gateway.buildingId) }, ...scope }, select: { id: true, code: true } }),
      this.prisma.smartPoint.findMany({ where: { gatewayId: { in: ids }, ...scope }, select: { id: true, gatewayId: true, name: true } }),
      this.prisma.smartGatewayTest.findMany({ where: { gatewayId: { in: ids }, ...scope }, orderBy: { performedAt: "desc" } }),
    ]);
    const readings = points.length
      ? await this.prisma.smartReading.groupBy({ by: ["pointId"], where: { pointId: { in: points.map((point) => point.id) }, ts: { gte: since } }, _count: { _all: true } })
      : [];
    const users = await this.userNames(scope, tests.map((test) => test.performedByUserId));
    return gateways.map((gateway) => {
      const mine = points.filter((point) => point.gatewayId === gateway.id);
      const myTests = tests.filter((test) => test.gatewayId === gateway.id);
      const pass = (kind: "READ" | "WRITE"): TestEvidence | null => {
        const test = myTests.find((candidate) => candidate.kind === kind && candidate.outcome === "PASS");
        return test ? { at: test.performedAt, by: users.get(test.performedByUserId) ?? "—" } : null;
      };
      const view: SmartGatewayView = {
        id: gateway.id,
        code: gateway.code,
        name: gateway.name,
        buildingId: gateway.buildingId,
        buildingCode: buildings.find((building) => building.id === gateway.buildingId)?.code ?? "—",
        protocol: gateway.protocol,
        endpoint: gateway.endpoint,
        simulated: gateway.simulated,
        tokenPrefix: gateway.tokenPrefix,
        active: gateway.active,
        lastSeenAt: gateway.lastSeenAt?.toISOString() ?? null,
        points: mine.length,
        readings24h: readings.filter((row) => mine.some((point) => point.id === row.pointId)).reduce((sum, row) => sum + row._count._all, 0),
        levels: connectivityLevels({ protocol: gateway.protocol, simulated: gateway.simulated, lastSeenAt: gateway.lastSeenAt, readPass: pass("READ"), writePass: pass("WRITE") }),
      };
      if (detailed) {
        view.tests = myTests.map(
          (test): SmartGatewayTestView => ({
            id: test.id,
            pointId: test.pointId,
            pointName: mine.find((point) => point.id === test.pointId)?.name ?? "—",
            kind: test.kind,
            referenceValue: num(test.referenceValue),
            tolerance: num(test.tolerance),
            observedValue: num(test.observedValue)!,
            observedAt: test.observedAt.toISOString(),
            setpointId: test.setpointId,
            outcome: test.outcome,
            evidence: test.evidence,
            performedByName: users.get(test.performedByUserId) ?? "—",
            performedAt: test.performedAt.toISOString(),
          }),
        );
      }
      return view;
    });
  }

  private async pointViews(scope: CompanyScope, points: Prisma.SmartPointGetPayload<object>[]): Promise<SmartPointView[]> {
    const [gateways, assets, alarms] = await Promise.all([
      this.prisma.smartGateway.findMany({ where: { id: { in: [...new Set(points.map((point) => point.gatewayId))] }, ...scope }, include: { building: { select: { code: true } } } }),
      this.prisma.asset.findMany({ where: { id: { in: points.map((point) => point.assetId).filter((id): id is string => Boolean(id)) }, ...scope }, select: { id: true, code: true } }),
      this.prisma.smartAlarm.groupBy({ by: ["pointId"], where: { ...scope, pointId: { in: points.map((point) => point.id) }, status: { in: ["ACTIVE", "ACKNOWLEDGED"] } }, _count: { _all: true } }),
    ]);
    const staleBefore = Date.now() - STALE_MS;
    return points.map((point) => {
      const gateway = gateways.find((candidate) => candidate.id === point.gatewayId);
      return {
        id: point.id,
        gatewayId: point.gatewayId,
        gatewayCode: gateway?.code ?? "—",
        buildingCode: gateway?.building.code ?? "—",
        simulated: gateway?.simulated ?? false,
        externalRef: point.externalRef,
        name: point.name,
        kind: point.kind,
        unit: point.unit,
        assetId: point.assetId,
        assetCode: assets.find((asset) => asset.id === point.assetId)?.code ?? null,
        writable: point.writable,
        writeTolerance: num(point.writeTolerance),
        minPlausible: num(point.minPlausible),
        maxPlausible: num(point.maxPlausible),
        lastValue: num(point.lastValue),
        lastReadingAt: point.lastReadingAt?.toISOString() ?? null,
        stale: point.active && (!point.lastReadingAt || point.lastReadingAt.getTime() < staleBefore),
        active: point.active,
        activeAlarms: alarms.find((row) => row.pointId === point.id)?._count._all ?? 0,
      };
    });
  }

  private async userNames(scope: CompanyScope, ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(ids)] }, organizationId: scope.organizationId }, select: { id: true, fullName: true } });
    return new Map(users.map((user) => [user.id, user.fullName]));
  }
}

