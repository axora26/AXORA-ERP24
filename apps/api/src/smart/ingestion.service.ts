import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import type { SmartIngestResult } from "@axora24/contracts";
import { Prisma } from "@axora24/database";
import { PrismaService } from "../core/prisma.service.js";
import { writeAudit } from "../common/audit.js";
import { AutomationService } from "../workflow/automation.service.js";
import { assertBody, optionalText } from "../common/validation.js";
import { conditionMet, parseReadingValue, withinTolerance } from "./alarm-engine.js";
import type { GatewayContext } from "./gateway-token.guard.js";

const MAX_BATCH = 1000;
const MAX_CLOCK_SKEW_MS = 5 * 60_000;
const QUALITIES = new Set(["GOOD", "UNCERTAIN", "BAD"]);

interface Candidate {
  index: number;
  ref: string;
  ts: Date;
  value: Prisma.Decimal;
  quality: "GOOD" | "UNCERTAIN" | "BAD";
}

/**
 * Chemin unique d'ecriture de la telemetrie (API passerelle) :
 * - serialise par passerelle (verrou) ; rejeu idempotent (meme point, meme
 *   instant, meme valeur = doublon) ; valeur differente = conflit refuse ;
 * - seules les lectures plus recentes que la derniere connue pilotent l'etat
 *   courant (valeur, alarmes) : une lecture tardive enrichit l'historique
 *   sans faire « revivre » une alarme ;
 * - hors plage plausible : conservee en qualite BAD, jamais interpretee.
 */
@Injectable()
export class SmartIngestionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly automation: AutomationService,
  ) {}

  async ingest(gateway: GatewayContext, body: unknown, ip: string | undefined): Promise<SmartIngestResult> {
    const input = assertBody(body);
    const rows = input.readings;
    if (!Array.isArray(rows) || rows.length === 0) throw new BadRequestException("readings must be a non-empty array");
    if (rows.length > MAX_BATCH) throw new BadRequestException(`At most ${MAX_BATCH} readings per batch`);

    const result: SmartIngestResult = { accepted: 0, duplicates: 0, conflicts: [], rejected: [], alarmsRaised: 0, alarmsCleared: 0, setpointsConfirmed: 0 };
    const parsed: Array<{ index: number; ref: string; ts: Date; raw: unknown; quality: Candidate["quality"] }> = [];
    rows.forEach((row: unknown, index: number) => {
      if (!row || typeof row !== "object") return result.rejected.push({ index, reason: "reading must be an object" });
      const { ref, ts, value, quality } = row as Record<string, unknown>;
      if (typeof ref !== "string" || ref.trim().length === 0 || ref.length > 200) return result.rejected.push({ index, reason: "ref is required" });
      const at = typeof ts === "string" ? new Date(ts) : null;
      if (!at || Number.isNaN(at.getTime())) return result.rejected.push({ index, reason: "ts must be an ISO-8601 timestamp" });
      if (at.getTime() > Date.now() + MAX_CLOCK_SKEW_MS) return result.rejected.push({ index, reason: "timestamp is in the future" });
      if (quality !== undefined && (typeof quality !== "string" || !QUALITIES.has(quality))) return result.rejected.push({ index, reason: "quality must be GOOD, UNCERTAIN or BAD" });
      parsed.push({ index, ref: ref.trim(), ts: at, raw: value, quality: (quality as Candidate["quality"]) ?? "GOOD" });
      return undefined;
    });

    await this.prisma.$transaction(
      async (tx) => {
        const locked = await tx.$queryRaw<Array<{ active: boolean }>>`SELECT "active" FROM "smart_gateways" WHERE "id" = ${gateway.id} FOR UPDATE`;
        if (!locked[0]?.active) throw new UnauthorizedException("Gateway disabled");
        await tx.smartGateway.update({ where: { id: gateway.id }, data: { lastSeenAt: new Date(), lastSeenIp: ip ?? null } });
        if (parsed.length === 0) return;

        const points = await tx.smartPoint.findMany({ where: { gatewayId: gateway.id, externalRef: { in: [...new Set(parsed.map((row) => row.ref))] } } });
        const byRef = new Map(points.map((point) => [point.externalRef, point]));
        const candidates: Candidate[] = [];
        const seen = new Map<string, Candidate>();
        for (const row of parsed) {
          const point = byRef.get(row.ref);
          if (!point) {
            result.rejected.push({ index: row.index, reason: `unknown point ${row.ref}` });
            continue;
          }
          if (!point.active) {
            result.rejected.push({ index: row.index, reason: `point ${row.ref} is inactive` });
            continue;
          }
          const value = parseReadingValue(row.raw, point.kind);
          if (typeof value === "string") {
            result.rejected.push({ index: row.index, reason: value });
            continue;
          }
          const key = `${point.id}|${row.ts.toISOString()}`;
          const twin = seen.get(key);
          if (twin) {
            if (twin.value.equals(value)) result.duplicates += 1;
            else result.conflicts.push({ ref: row.ref, ts: row.ts.toISOString(), value: value.toString(), existing: twin.value.toString() });
            continue;
          }
          const outOfRange = (point.minPlausible !== null && value.lessThan(point.minPlausible)) || (point.maxPlausible !== null && value.greaterThan(point.maxPlausible));
          const candidate: Candidate = { index: row.index, ref: row.ref, ts: row.ts, value, quality: outOfRange ? "BAD" : row.quality };
          seen.set(key, candidate);
          candidates.push(candidate);
        }
        if (candidates.length === 0) return;

        const existing = await tx.smartReading.findMany({
          where: { pointId: { in: [...new Set(candidates.map((row) => byRef.get(row.ref)!.id))] }, ts: { in: [...new Set(candidates.map((row) => row.ts))] } },
          select: { pointId: true, ts: true, value: true },
        });
        const existingByKey = new Map(existing.map((row) => [`${row.pointId}|${row.ts.toISOString()}`, row.value]));
        const fresh: Candidate[] = [];
        for (const candidate of candidates) {
          const stored = existingByKey.get(`${byRef.get(candidate.ref)!.id}|${candidate.ts.toISOString()}`);
          if (stored === undefined) fresh.push(candidate);
          else if (new Prisma.Decimal(stored).equals(candidate.value)) result.duplicates += 1;
          else result.conflicts.push({ ref: candidate.ref, ts: candidate.ts.toISOString(), value: candidate.value.toString(), existing: new Prisma.Decimal(stored).toString() });
        }
        if (fresh.length === 0) return;
        await tx.smartReading.createMany({
          data: fresh.map((candidate) => ({
            organizationId: gateway.organizationId,
            companyId: gateway.companyId,
            pointId: byRef.get(candidate.ref)!.id,
            ts: candidate.ts,
            value: candidate.value,
            quality: candidate.quality,
          })),
        });
        result.accepted = fresh.length;

        for (const point of points) {
          const mine = fresh.filter((candidate) => candidate.ref === point.externalRef && candidate.quality !== "BAD").sort((a, b) => a.ts.getTime() - b.ts.getTime());
          if (mine.length === 0) continue;
          const newer = mine.filter((candidate) => !point.lastReadingAt || candidate.ts > point.lastReadingAt);

          if (newer.length > 0) {
            const rules = await tx.smartAlarmRule.findMany({ where: { pointId: point.id, active: true } });
            const open = await tx.smartAlarm.findMany({ where: { ruleId: { in: rules.map((rule) => rule.id) }, status: { in: ["ACTIVE", "ACKNOWLEDGED"] } }, select: { id: true, ruleId: true } });
            const openByRule = new Map(open.map((alarm) => [alarm.ruleId, alarm.id]));
            for (const reading of newer) {
              for (const rule of rules) {
                const met = conditionMet(rule.condition, reading.value, new Prisma.Decimal(rule.threshold));
                const current = openByRule.get(rule.id);
                if (met && !current) {
                  const alarm = await tx.smartAlarm.create({
                    data: {
                      organizationId: gateway.organizationId,
                      companyId: gateway.companyId,
                      ruleId: rule.id,
                      pointId: point.id,
                      condition: rule.condition,
                      threshold: rule.threshold,
                      severity: rule.severity,
                      message: rule.message,
                      triggerValue: reading.value,
                      triggerReadingAt: reading.ts,
                    },
                  });
                  openByRule.set(rule.id, alarm.id);
                  result.alarmsRaised += 1;
                  await this.automation.emit(
                    tx,
                    { organizationId: gateway.organizationId, companyId: gateway.companyId },
                    { type: "smart.alarm.raised", resourceId: alarm.id, actorUserId: null, link: `/smart/points/${point.id}`, payload: { message: rule.message, severity: rule.severity, triggerValue: reading.value.toString(), pointName: point.name } },
                  );
                } else if (!met && current) {
                  await tx.smartAlarm.update({ where: { id: current }, data: { status: "CLEARED", clearedAt: reading.ts, clearValue: reading.value } });
                  openByRule.delete(rule.id);
                  result.alarmsCleared += 1;
                }
              }
            }
            const last = newer[newer.length - 1]!;
            await tx.smartPoint.update({ where: { id: point.id }, data: { lastValue: last.value, lastReadingAt: last.ts } });
          }

          if (point.writable) {
            const pending = await tx.smartSetpoint.findMany({ where: { pointId: point.id, status: "ACKNOWLEDGED" } });
            for (const setpoint of pending) {
              const readback = mine.find(
                (reading) => reading.quality === "GOOD" && setpoint.acknowledgedAt && reading.ts >= setpoint.acknowledgedAt && withinTolerance(reading.value, new Prisma.Decimal(setpoint.requestedValue), point.writeTolerance === null ? null : new Prisma.Decimal(point.writeTolerance)),
              );
              if (readback) {
                await tx.smartSetpoint.update({ where: { id: setpoint.id }, data: { status: "CONFIRMED", confirmedAt: new Date(), confirmReadingAt: readback.ts, confirmValue: readback.value } });
                result.setpointsConfirmed += 1;
              }
            }
          }
        }
      },
      { timeout: 30_000 },
    );
    result.rejected.sort((a, b) => a.index - b.index);
    return result;
  }

  /** Consignes a appliquer : REQUESTED passe DISPATCHED (redistribuees tant qu'elles ne sont pas acquittees). */
  async pendingSetpoints(gateway: GatewayContext) {
    return this.prisma.$transaction(async (tx) => {
      await tx.smartGateway.update({ where: { id: gateway.id }, data: { lastSeenAt: new Date() } });
      const setpoints = await tx.smartSetpoint.findMany({
        where: { status: { in: ["REQUESTED", "DISPATCHED"] }, point: { gatewayId: gateway.id } },
        include: { point: { select: { externalRef: true } } },
        orderBy: { requestedAt: "asc" },
      });
      const toDispatch = setpoints.filter((setpoint) => setpoint.status === "REQUESTED").map((setpoint) => setpoint.id);
      if (toDispatch.length) await tx.smartSetpoint.updateMany({ where: { id: { in: toDispatch } }, data: { status: "DISPATCHED", dispatchedAt: new Date() } });
      return setpoints.map((setpoint) => ({ id: setpoint.id, ref: setpoint.point.externalRef, value: new Prisma.Decimal(setpoint.requestedValue).toString(), requestedAt: setpoint.requestedAt.toISOString() }));
    });
  }

  /** Acquit de la passerelle : « appliquee » n'est qu'une declaration ; la confirmation viendra d'une relecture. */
  async acknowledgeSetpoint(gateway: GatewayContext, setpointId: string, body: unknown) {
    const input = assertBody(body);
    if (typeof input.applied !== "boolean") throw new BadRequestException("applied must be a boolean");
    const note = optionalText(input.note, "note", 1000);
    return this.prisma.$transaction(async (tx) => {
      const setpoint = await tx.smartSetpoint.findFirst({ where: { id: setpointId, point: { gatewayId: gateway.id } } });
      if (!setpoint) throw new NotFoundException("Setpoint not found");
      if (setpoint.status !== "DISPATCHED") throw new BadRequestException(`Setpoint is ${setpoint.status}`);
      const status = input.applied ? "ACKNOWLEDGED" : "FAILED";
      await tx.smartSetpoint.update({ where: { id: setpointId }, data: { status, acknowledgedAt: new Date(), gatewayNote: note } });
      await writeAudit(tx, gateway, null, input.applied ? "smart.setpoint.acknowledged" : "smart.setpoint.failed", "SmartSetpoint", setpointId, { gateway: gateway.code, note });
      return { id: setpointId, status };
    });
  }
}
