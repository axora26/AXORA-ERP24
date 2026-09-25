import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createHarness, registerTenant, type Harness, type Tenant } from "./support/harness.js";
import { createUserWith } from "./support/fixtures.js";

const MIN = 60_000;

/**
 * INC-16 — Smart Building. DoD : ingestion testee via l'API passerelle reelle
 * (jeton, rejeu idempotent, conflits), alarmes tracees au seuil exact,
 * consignes jamais declarees appliquees sans relecture, cinq niveaux de
 * connectivite distincts et aucun niveau physique pour un simulateur.
 */
describe("Smart Building (e2e)", () => {
  let harness: Harness;
  let owner: Tenant;
  let other: Tenant;
  let operator: Tenant;
  let buildingId = "";
  let gatewayId = "";
  let token = "";
  let simulatorId = "";
  let simulatorToken = "";
  let temperatureId = "";
  let valveId = "";
  let setpointId = "";

  const gw = (bearer: string) => ({
    readings: (readings: unknown[]) => harness.http().post("/api/v1/smart/gateway/readings").set("Authorization", `Bearer ${bearer}`).send({ readings }),
    setpoints: () => harness.http().get("/api/v1/smart/gateway/setpoints").set("Authorization", `Bearer ${bearer}`),
    ack: (id: string, body: object) => harness.http().post(`/api/v1/smart/gateway/setpoints/${id}/ack`).set("Authorization", `Bearer ${bearer}`).send(body),
  });
  const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * MIN).toISOString();

  beforeAll(async () => {
    harness = await createHarness();
    owner = await registerTenant(harness, "gtb-a");
    other = await registerTenant(harness, "gtb-b");
    operator = await createUserWith(harness, owner, ["smart.building.read", "smart.alarm.acknowledge"], "exploitant-gtb");
  });

  afterAll(async () => {
    await harness.close();
  });

  const api = () => as(harness, owner);

  it("passerelle : jeton montre une seule fois, seule son empreinte est stockee", async () => {
    const buildings = await api().post("/smart/buildings", { code: "bat-a", name: "Clinique — bâtiment A" });
    buildingId = buildings.body[0].id;
    expect(buildings.body[0].code).toBe("BAT-A");
    const created = await api().post("/smart/gateways", { buildingId, code: "GW-A", name: "Automate CTA (passerelle edge)", protocol: "BACNET_IP", endpoint: "192.168.10.20:47808" });
    expect(created.status).toBe(201);
    token = created.body.token;
    gatewayId = created.body.gateway.id;
    expect(token).toMatch(/^axgw_/);
    const stored = await harness.prisma.smartGateway.findUniqueOrThrow({ where: { id: gatewayId } });
    expect(stored.tokenHash).not.toContain(token);
    expect(JSON.stringify(await api().get(`/smart/gateways/${gatewayId}`).then((r) => r.body))).not.toContain(token);
    expect(created.body.gateway.levels.map((level: { state: string }) => level.state)).toEqual(["YES", "NO", "NOT_TESTED", "NOT_TESTED", "NOT_TESTED"]);

    const sim = await api().post("/smart/gateways", { buildingId, code: "SIM-A", name: "Simulateur de recette", protocol: "HTTP_API", simulated: true });
    simulatorId = sim.body.gateway.id;
    simulatorToken = sim.body.token;

    const temp = await api().post("/smart/points", { gatewayId, externalRef: "analog-input:3", name: "Température reprise salle 1", kind: "ANALOG", unit: "°C", minPlausible: "-20", maxPlausible: "60" });
    temperatureId = temp.body.id;
    const valve = await api().post("/smart/points", { gatewayId, externalRef: "analog-output:1", name: "Vanne batterie froide", kind: "ANALOG", unit: "%", writable: true, writeTolerance: "1", minPlausible: "0", maxPlausible: "100" });
    valveId = valve.body.id;
    expect((await api().post("/smart/points", { gatewayId, externalRef: "analog-input:3", name: "Doublon", kind: "ANALOG" })).status).toBe(409);
    await api().post("/smart/rules", { pointId: temperatureId, condition: "ABOVE", threshold: "26", severity: "CRITICAL", message: "Surchauffe salle 1" });
  });

  it("authentification machine : sans jeton, jeton invalide ou passerelle desactivee -> 401", async () => {
    expect((await harness.http().post("/api/v1/smart/gateway/readings").send({ readings: [] })).status).toBe(401);
    expect((await gw("axgw_invalidinvalidinvalidinvalid").readings([{ ref: "x", ts: at(1), value: "1" }])).status).toBe(401);
    // Une session utilisateur ne donne pas acces a l'API passerelle.
    expect((await harness.http().post("/api/v1/smart/gateway/readings").set("Cookie", owner.cookie).send({ readings: [] })).status).toBe(401);
  });

  it("ingestion : validation par lecture, hors plage conservee en BAD, rejeu idempotent, conflit refuse", async () => {
    const batch = [
      { ref: "analog-input:3", ts: at(30), value: "22.4" },
      { ref: "analog-input:3", ts: at(20), value: "23.1" },
      { ref: "analog-input:3", ts: at(10), value: "99.9" },
      { ref: "analog-input:3", ts: at(5), value: 23.5 },
      { ref: "inconnu", ts: at(5), value: "1" },
      { ref: "analog-input:3", ts: new Date(Date.now() + 60 * MIN).toISOString(), value: "20" },
    ];
    const first = await gw(token).readings(batch);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ accepted: 3, duplicates: 0, conflicts: [] });
    expect(first.body.rejected.map((row: { index: number }) => row.index)).toEqual([3, 4, 5]);
    const bad = await harness.prisma.smartReading.findFirstOrThrow({ where: { pointId: temperatureId, value: "99.9" } });
    expect(bad.quality).toBe("BAD");

    const replay = await gw(token).readings(batch.slice(0, 3));
    expect(replay.body).toMatchObject({ accepted: 0, duplicates: 3, conflicts: [] });
    const conflict = await gw(token).readings([{ ref: "analog-input:3", ts: batch[1]!.ts, value: "25.0" }]);
    expect(conflict.body.conflicts).toEqual([{ ref: "analog-input:3", ts: batch[1]!.ts, value: "25", existing: "23.1" }]);
    expect(await harness.prisma.smartReading.count({ where: { pointId: temperatureId } })).toBe(3);

    const point = await api().get(`/smart/points/${temperatureId}`);
    // La lecture BAD ne devient pas la valeur courante.
    expect(point.body).toMatchObject({ lastValue: "23.1", stale: false });
    const reading = await harness.prisma.smartReading.findFirstOrThrow({ where: { pointId: temperatureId } });
    await expect(harness.prisma.smartReading.update({ where: { id: reading.id }, data: { value: "0" } })).rejects.toThrow(/append-only/);
  });

  it("alarme : declenchee au seuil exact, acquittee par l'exploitant, levee par une lecture revenue a la normale", async () => {
    const hot = await gw(token).readings([{ ref: "analog-input:3", ts: at(4), value: "26.8" }]);
    expect(hot.body.alarmsRaised).toBe(1);
    // Rejeu : pas de seconde alarme.
    expect((await gw(token).readings([{ ref: "analog-input:3", ts: at(3), value: "27.2" }])).body.alarmsRaised).toBe(0);
    const alarms = await as(harness, operator).get("/smart/alarms");
    expect(alarms.body).toHaveLength(1);
    const alarm = alarms.body[0];
    expect(alarm).toMatchObject({ status: "ACTIVE", condition: "ABOVE", threshold: "26", triggerValue: "26.8", severity: "CRITICAL", pointRef: "analog-input:3" });

    expect((await as(harness, operator).post(`/smart/alarms/${alarm.id}/acknowledge`, {})).status).toBe(400);
    const acked = await as(harness, operator).post(`/smart/alarms/${alarm.id}/acknowledge`, { note: "Technicien envoyé, porte de salle ouverte" });
    expect(acked.body).toMatchObject({ status: "ACKNOWLEDGED", acknowledgedByName: expect.stringMatching(/^exploitant-gtb/) });
    await expect(harness.prisma.smartAlarm.update({ where: { id: alarm.id }, data: { threshold: "30" } })).rejects.toThrow(/immutable/);

    // Lecture tardive (anterieure a la derniere connue) : historique enrichi, etat courant inchange.
    const late = await gw(token).readings([{ ref: "analog-input:3", ts: at(25), value: "21.0" }]);
    expect(late.body).toMatchObject({ accepted: 1, alarmsCleared: 0 });
    const normal = await gw(token).readings([{ ref: "analog-input:3", ts: at(2), value: "24.0" }]);
    expect(normal.body.alarmsCleared).toBe(1);
    const cleared = (await api().get("/smart/alarms?status=CLEARED")).body[0];
    expect(cleared).toMatchObject({ status: "CLEARED", clearValue: "24", triggerValue: "26.8" });
    await expect(harness.prisma.smartAlarm.update({ where: { id: alarm.id }, data: { acknowledgeNote: "x" } })).rejects.toThrow(/history/);
    expect((await as(harness, operator).post("/smart/rules", { pointId: temperatureId, condition: "BELOW", threshold: "10", message: "x" })).status).toBe(403);
  });

  it("consigne : jamais « appliquee » sur la foi de la passerelle, confirmee uniquement par relecture", async () => {
    expect((await api().post("/smart/setpoints", { pointId: temperatureId, value: "20", reason: "x" })).status).toBe(400);
    expect((await api().post("/smart/setpoints", { pointId: valveId, value: "140", reason: "x" })).status).toBe(400);
    expect((await as(harness, operator).post("/smart/setpoints", { pointId: valveId, value: "40", reason: "x" })).status).toBe(403);
    const requested = await api().post("/smart/setpoints", { pointId: valveId, value: "40", reason: "Relance froid après surchauffe salle 1" });
    setpointId = requested.body[0].id;
    expect(requested.body[0].status).toBe("REQUESTED");
    expect((await api().post("/smart/setpoints", { pointId: valveId, value: "50", reason: "doublon" })).status).toBe(409);

    // Ack avant distribution refuse ; la passerelle recupere, puis acquitte.
    expect((await gw(token).ack(setpointId, { applied: true })).status).toBe(400);
    const pending = await gw(token).setpoints();
    expect(pending.body).toEqual([expect.objectContaining({ id: setpointId, ref: "analog-output:1", value: "40" })]);
    expect((await gw(simulatorToken).setpoints()).body).toEqual([]);
    expect((await gw(simulatorToken).ack(setpointId, { applied: true })).status).toBe(404);
    const ack = await gw(token).ack(setpointId, { applied: true, note: "Écrit en priorité 8" });
    expect(ack.body.status).toBe("ACKNOWLEDGED");
    const acknowledged = (await api().get(`/smart/setpoints?pointId=${valveId}`)).body[0];
    expect(acknowledged).toMatchObject({ status: "ACKNOWLEDGED", confirmedAt: null });

    // La base refuse une confirmation sans relecture.
    await expect(harness.prisma.smartSetpoint.update({ where: { id: setpointId }, data: { status: "CONFIRMED", confirmedAt: new Date() } })).rejects.toThrow(/smart_setpoints_confirmed_by_readback/);
    // Relecture hors tolerance : toujours en attente ; dans la tolerance : confirmee.
    expect((await gw(token).readings([{ ref: "analog-output:1", ts: new Date().toISOString(), value: "35" }])).body.setpointsConfirmed).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const readback = await gw(token).readings([{ ref: "analog-output:1", ts: new Date().toISOString(), value: "40.6" }]);
    expect(readback.body.setpointsConfirmed).toBe(1);
    const confirmed = (await api().get(`/smart/setpoints?pointId=${valveId}`)).body[0];
    expect(confirmed).toMatchObject({ status: "CONFIRMED", confirmValue: "40.6" });
  });

  it("essais reels : verdict calcule, jamais sur un simulateur (API et base), niveaux mis a jour", async () => {
    await gw(token).readings([{ ref: "analog-input:3", ts: new Date().toISOString(), value: "22.9" }]);
    const failed = await api().post(`/smart/gateways/${gatewayId}/tests`, { kind: "READ", pointId: temperatureId, referenceValue: "24.5", tolerance: "0.5", evidence: "Thermomètre étalonné TH-12 en reprise salle 1" });
    expect(failed.body.tests[0]).toMatchObject({ outcome: "FAIL", observedValue: "22.9" });
    expect(failed.body.levels[3].state).toBe("NOT_TESTED");
    const passed = await api().post(`/smart/gateways/${gatewayId}/tests`, { kind: "READ", pointId: temperatureId, referenceValue: "23.1", tolerance: "0.5", evidence: "Thermomètre étalonné TH-12 (certificat 2026-118)" });
    expect(passed.body.levels.map((level: { state: string }) => level.state)).toEqual(["YES", "NO", "YES", "YES", "NOT_TESTED"]);
    const write = await api().post(`/smart/gateways/${gatewayId}/tests`, { kind: "WRITE", setpointId, physicallyObserved: true, evidence: "Course de vanne observée à 40 % sur l'actionneur" });
    expect(write.body.levels[4].state).toBe("YES");

    const simPoint = await api().post("/smart/points", { gatewayId: simulatorId, externalRef: "sim/temp", name: "Température simulée", kind: "ANALOG" });
    await gw(simulatorToken).readings([{ ref: "sim/temp", ts: new Date().toISOString(), value: "21" }]);
    expect((await api().post(`/smart/gateways/${simulatorId}/tests`, { kind: "READ", pointId: simPoint.body.id, referenceValue: "21", tolerance: "1", evidence: "x" })).status).toBe(400);
    await expect(
      harness.prisma.smartGatewayTest.create({
        data: { organizationId: owner.organizationId, companyId: owner.companyId, gatewayId: simulatorId, pointId: simPoint.body.id, kind: "READ", referenceValue: "21", tolerance: "1", observedValue: "21", observedAt: new Date(), outcome: "PASS", evidence: "x", performedByUserId: owner.userId },
      }),
    ).rejects.toThrow(/simulator is never evidence/);
    await expect(harness.prisma.smartGateway.update({ where: { id: simulatorId }, data: { simulated: false } })).rejects.toThrow(/cannot be requalified/);
    const sim = await api().get(`/smart/gateways/${simulatorId}`);
    expect(sim.body.levels.slice(2).map((level: { state: string }) => level.state)).toEqual(["SIMULATED", "SIMULATED", "SIMULATED"]);
  });

  it("tendance, rotation de jeton, desactivation, isolation", async () => {
    const trend = await api().get(`/smart/points/${temperatureId}/trend?hours=1`);
    expect(trend.body.bucket).toBe("raw");
    expect(trend.body.badReadings).toBe(1);
    expect(trend.body.series.every((row: { max: string }) => row.max !== "99.9")).toBe(true);
    const hourly = await api().get(`/smart/points/${temperatureId}/trend?hours=72`);
    expect(hourly.body.bucket).toBe("hour");
    expect(hourly.body.series.reduce((sum: number, row: { count: number }) => sum + row.count, 0)).toBe(trend.body.series.length);

    const rotated = await api().post(`/smart/gateways/${gatewayId}/rotate-token`);
    expect((await gw(token).readings([{ ref: "analog-input:3", ts: new Date().toISOString(), value: "22" }])).status).toBe(401);
    token = rotated.body.token;
    expect((await gw(token).readings([{ ref: "analog-input:3", ts: new Date().toISOString(), value: "22" }])).status).toBe(200);
    await api().patch(`/smart/gateways/${gatewayId}`, { active: false });
    expect((await gw(token).readings([{ ref: "analog-input:3", ts: new Date().toISOString(), value: "22" }])).status).toBe(401);

    expect((await as(harness, other).get(`/smart/points/${temperatureId}`)).status).toBe(404);
    expect((await as(harness, other).get("/smart/alarms?status=ALL")).body).toHaveLength(0);
    expect((await as(harness, other).post("/smart/setpoints", { pointId: valveId, value: "10", reason: "x" })).status).toBe(404);
    expect((await as(harness, other).post(`/smart/gateways/${gatewayId}/rotate-token`)).status).toBe(404);
    const audit = await harness.prisma.auditLog.findMany({ where: { organizationId: owner.organizationId, action: { startsWith: "smart." } } });
    const actions = new Set(audit.map((entry) => entry.action));
    for (const action of ["smart.gateway.created", "smart.alarm.acknowledged", "smart.setpoint.requested", "smart.setpoint.acknowledged", "smart.test.recorded", "smart.gateway.token_rotated"]) {
      expect(actions.has(action)).toBe(true);
    }
    expect(audit.some((entry) => JSON.stringify(entry.metadata).includes("axgw_"))).toBe(false);
  });
});
