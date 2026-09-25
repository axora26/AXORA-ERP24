import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createHarness, registerTenant, type Harness, type Tenant } from "./support/harness.js";
import { createUserWith } from "./support/fixtures.js";

const Q = 15 * 60_000;
const DAY = 86_400_000;

function today(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

/** Intervalles de 15 min entre deux instants (debut inclus, fin exclue), meme valeur. */
function quarterHours(fromMs: number, toMs: number, value: string, ref?: string) {
  const rows = [];
  for (let t = fromMs; t < toMs; t += Q) rows.push({ ...(ref ? { ref } : {}), start: new Date(t).toISOString(), value });
  return rows;
}

/**
 * INC-17 — Energie. DoD : ingestion d'intervalles avec garde de rejeu et
 * d'idempotence ; bilans portant leur couverture ; autonomie calculee
 * uniquement sur donnees reellement disponibles.
 */
describe("Energie (e2e)", () => {
  let harness: Harness;
  let owner: Tenant;
  let other: Tenant;
  let reader: Tenant;
  let buildingId = "";
  let token = "";
  let gatewayId = "";
  let consumption = "";
  let grid = "";
  let pv = "";
  let exportMeter = "";
  let genset = "";
  let socPointId = "";
  const midnight = today();

  const gw = () => ({
    energy: (intervals: unknown[]) => harness.http().post("/api/v1/smart/gateway/energy-intervals").set("Authorization", `Bearer ${token}`).send({ intervals }),
    readings: (readings: unknown[]) => harness.http().post("/api/v1/smart/gateway/readings").set("Authorization", `Bearer ${token}`).send({ readings }),
  });

  beforeAll(async () => {
    harness = await createHarness();
    owner = await registerTenant(harness, "nrj-a");
    other = await registerTenant(harness, "nrj-b");
    reader = await createUserWith(harness, owner, ["energy.meter.read"], "lecteur-energie");
    const api = as(harness, owner);
    buildingId = (await api.post("/smart/buildings", { code: "SIEGE", name: "Siège", floorAreaM2: "1200" })).body[0].id;
    const gateway = await api.post("/smart/gateways", { buildingId, code: "EDGE-1", name: "Concentrateur de comptage", protocol: "MODBUS_TCP" });
    token = gateway.body.token;
    gatewayId = gateway.body.gateway.id;
    socPointId = (await api.post("/smart/points", { gatewayId, externalRef: "bms/soc", name: "Batterie — état de charge", kind: "ANALOG", unit: "%", minPlausible: "0", maxPlausible: "100" })).body.id;
  });

  afterAll(async () => {
    await harness.close();
  });

  const api = () => as(harness, owner);

  it("compteurs : pas de temps normalise, liaison passerelle coherente, code unique", async () => {
    expect((await api().post("/energy/meters", { buildingId, code: "X", name: "x", kind: "CONSUMPTION", intervalMinutes: 7 })).status).toBe(400);
    expect((await api().post("/energy/meters", { buildingId, code: "X", name: "x", kind: "CONSUMPTION", gatewayId })).status).toBe(400);
    const created = await api().post("/energy/meters", { buildingId, code: "tgbt", name: "TGBT — consommation générale", kind: "CONSUMPTION" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ code: "TGBT", unit: "kWh", intervalMinutes: 15, coverage24h: "0.0" });
    consumption = created.body.id;
    expect((await api().post("/energy/meters", { buildingId, code: "TGBT", name: "Doublon", kind: "CONSUMPTION" })).status).toBe(409);
    grid = (await api().post("/energy/meters", { buildingId, code: "GRID", name: "Arrivée réseau SNEL", kind: "GRID_IMPORT", gatewayId, externalRef: "modbus/1/import" })).body.id;
    pv = (await api().post("/energy/meters", { buildingId, code: "PV", name: "Onduleurs PV", kind: "PV_PRODUCTION" })).body.id;
    exportMeter = (await api().post("/energy/meters", { buildingId, code: "EXPORT", name: "Injection réseau", kind: "GRID_EXPORT" })).body.id;
    genset = (await api().post("/energy/meters", { buildingId, code: "GE-PROD", name: "Groupe électrogène", kind: "GENSET_PRODUCTION", gatewayId, externalRef: "modbus/2/ge" })).body.id;
  });

  it("ingestion passerelle : validation, rejeu idempotent, conflit refuse, append-only", async () => {
    const base = midnight - 2 * DAY + 10 * 3_600_000;
    const batch = [
      { ref: "modbus/2/ge", start: new Date(base).toISOString(), value: "12.5" },
      { ref: "modbus/2/ge", start: new Date(base + Q).toISOString(), value: "13.0" },
      { ref: "modbus/2/ge", start: new Date(base + 5 * 60_000).toISOString(), value: "1" },
      { ref: "modbus/2/ge", start: new Date(Math.floor(Date.now() / Q) * Q + 4 * Q).toISOString(), value: "1" },
      { ref: "modbus/2/ge", start: new Date(base + 2 * Q).toISOString(), value: "-1" },
      { ref: "modbus/2/ge", start: new Date(base + 3 * Q).toISOString(), value: 4 },
      { ref: "compteur-inconnu", start: new Date(base).toISOString(), value: "1" },
    ];
    const first = await gw().energy(batch);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ accepted: 2, duplicates: 0, conflicts: [] });
    expect(first.body.rejected.map((row: { index: number }) => row.index)).toEqual([2, 3, 4, 5, 6]);
    expect(first.body.rejected[0].reason).toMatch(/aligned/);
    expect(first.body.rejected[1].reason).toMatch(/not finished/);

    const replay = await gw().energy(batch.slice(0, 2));
    expect(replay.body).toMatchObject({ accepted: 0, duplicates: 2 });
    const conflict = await gw().energy([{ ref: "modbus/2/ge", start: new Date(base).toISOString(), value: "99" }]);
    expect(conflict.body.conflicts).toEqual([{ meter: "GE-PROD", periodStart: new Date(base).toISOString(), value: "99", existing: "12.5" }]);
    expect(await harness.prisma.energyInterval.count({ where: { meterId: genset } })).toBe(2);

    // Un compteur non rattache a la passerelle lui est inaccessible.
    expect((await gw().energy([{ ref: "TGBT", start: new Date(base).toISOString(), value: "1" }])).body.rejected[0].reason).toMatch(/unknown meter/);
    const row = await harness.prisma.energyInterval.findFirstOrThrow({ where: { meterId: genset } });
    await expect(harness.prisma.energyInterval.update({ where: { id: row.id }, data: { value: "1" } })).rejects.toThrow(/append-only/);
    expect((await harness.http().post("/api/v1/smart/gateway/energy-intervals").send({ intervals: [] })).status).toBe(401);
  });

  it("import utilisateur : permission distincte ; alertes d'intervalle et journaliere (jour complet uniquement)", async () => {
    expect((await as(harness, reader).post(`/energy/meters/${consumption}/intervals`, { intervals: [] })).status).toBe(403);
    await api().post(`/energy/meters/${consumption}/rules`, { kind: "INTERVAL_ABOVE", threshold: "10", message: "Pic de puissance TGBT" });
    await api().post(`/energy/meters/${consumption}/rules`, { kind: "DAILY_ABOVE", threshold: "250", message: "Consommation journalière TGBT > 250 kWh" });

    // Periode precedente (J-14 a J-8) a 2.5 kWh/15 min, periode courante (J-7 a J-1) a 3 kWh/15 min.
    const previous = quarterHours(midnight - 14 * DAY, midnight - 7 * DAY, "2.5");
    const current = quarterHours(midnight - 7 * DAY, midnight, "3");
    // Le dernier quart d'heure de J-1 est retenu pour prouver qu'un jour incomplet ne declenche pas d'alerte journaliere.
    const lastQuarter = current.pop()!;
    const imported = await api().post(`/energy/meters/${consumption}/intervals`, { intervals: [...previous, ...current] });
    expect(imported.status).toBe(200);
    expect(imported.body).toMatchObject({ accepted: previous.length + current.length, duplicates: 0 });
    // 7 jours complets a 288 kWh > 250 ; J-1 incomplet : pas encore d'alerte.
    expect(imported.body.alertsRaised).toBe(6);
    const completed = await api().post(`/energy/meters/${consumption}/intervals`, { intervals: [lastQuarter, { start: new Date(midnight - 30 * DAY).toISOString(), value: "11" }] });
    expect(completed.body).toMatchObject({ accepted: 2, alertsRaised: 2 });
    const replay = await api().post(`/energy/meters/${consumption}/intervals`, { intervals: [lastQuarter, { start: new Date(midnight - 30 * DAY).toISOString(), value: "11" }] });
    expect(replay.body).toMatchObject({ accepted: 0, duplicates: 2, alertsRaised: 0 });

    const alerts = await api().get("/energy/alerts");
    expect(alerts.body).toHaveLength(8);
    const peak = alerts.body.find((alert: { kind: string }) => alert.kind === "INTERVAL_ABOVE");
    expect(peak).toMatchObject({ value: "11", threshold: "10", meterCode: "TGBT" });
    const daily = alerts.body.find((alert: { kind: string; periodStart: string }) => alert.kind === "DAILY_ABOVE" && alert.periodStart === new Date(midnight - DAY).toISOString());
    expect(daily).toMatchObject({ value: "288", threshold: "250" });
    const acked = await api().post(`/energy/alerts/${peak.id}/acknowledge`, { note: "Démarrage simultané des CTA, séquencement demandé" });
    expect(acked.body.find((alert: { id: string }) => alert.id === peak.id)).toMatchObject({ status: "ACKNOWLEDGED", acknowledgeNote: "Démarrage simultané des CTA, séquencement demandé" });
    await expect(harness.prisma.energyAlert.update({ where: { id: peak.id }, data: { value: "1" } })).rejects.toThrow(/immutable/);
  });

  it("bilan : couverture, comparaison fiable, part renouvelable, intensite, cout au tarif historise", async () => {
    // Reseau par la passerelle : 2 kWh / 15 min sur la periode courante (672 intervalles).
    const gridRows = quarterHours(midnight - 7 * DAY, midnight, "2", "modbus/1/import");
    expect((await gw().energy(gridRows)).body.accepted).toBe(672);
    await api().post(`/energy/meters/${pv}/intervals`, { intervals: quarterHours(midnight - 7 * DAY, midnight, "1") });
    await api().post(`/energy/meters/${exportMeter}/intervals`, { intervals: quarterHours(midnight - 7 * DAY, midnight, "0.5") });
    // Tarif 0.10 jusqu'a J-4, 0.20 a partir de J-3 : le cout suit la date de chaque jour.
    await api().post(`/energy/meters/${grid}/tariffs`, { validFrom: new Date(midnight - 30 * DAY).toISOString().slice(0, 10), unitPrice: "0.10" });
    await api().post(`/energy/meters/${grid}/tariffs`, { validFrom: new Date(midnight - 3 * DAY).toISOString().slice(0, 10), unitPrice: "0.20" });
    expect((await api().post(`/energy/meters/${grid}/tariffs`, { validFrom: new Date(midnight - 3 * DAY).toISOString().slice(0, 10), unitPrice: "0.30" })).status).toBe(409);

    const balance = await api().get(`/energy/balance?buildingId=${buildingId}&days=7`);
    expect(balance.status).toBe(200);
    expect(balance.body.consumption).toMatchObject({ value: "2016.00", method: "MEASURED", coverage: "100.0" });
    expect(balance.body.previousConsumption).toMatchObject({ value: "1680.00", coverage: "100.0" });
    expect(balance.body.consumptionChangePercent).toBe("20.0");
    // (672 - 336) / 2016 = 16.7 %
    expect(balance.body.renewableSharePercent).toBe("16.7");
    expect(balance.body.intensityKwhPerM2).toBe("1.680");
    const gridTotal = balance.body.totals.find((total: { kind: string }) => total.kind === "GRID_IMPORT");
    // 4 j x 192 kWh x 0.10 + 3 j x 192 kWh x 0.20 = 192.00
    expect(gridTotal).toMatchObject({ value: "1344.00", coverage: "100.0", cost: "192.00", costComplete: true });
    expect(balance.body.cost).toBe("192.00");
    // Le groupe n'a qu'un releve partiel (2 intervalles) : sa couverture le dit.
    expect(balance.body.totals.find((total: { kind: string }) => total.kind === "GENSET_PRODUCTION").coverage).toBe("0.3");
    expect(balance.body.series).toHaveLength(7);
    expect(balance.body.simulatedData).toBe(false);

    const longer = await api().get(`/energy/balance?buildingId=${buildingId}&days=14`);
    expect(longer.body.consumptionChangePercent).toBeNull();
    expect(longer.body.comparisonNote).toMatch(/non fiable/);
  });

  it("autonomie : calculee sur niveau recent et couverture suffisante, sinon non calculable avec la raison", async () => {
    const lastStart = Math.floor(Date.now() / Q) * Q - Q;
    if (lastStart >= midnight) await api().post(`/energy/meters/${consumption}/intervals`, { intervals: quarterHours(midnight, lastStart + Q, "3") });
    expect((await api().post("/energy/storages", { buildingId, name: "Batterie", kind: "BATTERY", usableCapacity: "200", levelIsPercent: true, reserve: "20", levelPointId: socPointId, drainMeterId: genset })).status).toBe(201);
    const storages = await api().post("/energy/storages", { buildingId, name: "Parc batteries lithium", kind: "BATTERY", usableCapacity: "200", levelIsPercent: true, reserve: "20", levelPointId: socPointId, drainMeterId: consumption });
    // Aucun niveau recu : non calculable, jamais estime.
    const pending = storages.body.find((storage: { name: string }) => storage.name === "Parc batteries lithium");
    expect(pending).toMatchObject({ state: "NOT_COMPUTABLE", hours: null });
    expect(pending.reason).toMatch(/Aucun niveau/);

    await gw().readings([{ ref: "bms/soc", ts: new Date().toISOString(), value: "80" }]);
    const computed = (await api().get(`/energy/autonomy?buildingId=${buildingId}`)).body.find((storage: { name: string }) => storage.name === "Parc batteries lithium");
    // 200 kWh x (80 - 20) % = 120 kWh ; 3 kWh / 15 min = 12 kWh/h -> 10 h.
    expect(computed).toMatchObject({ state: "COMPUTED", hours: "10.0", simulatedInputs: false });
    expect(computed.formula).toMatch(/capacité × \(niveau − réserve\)/);
    // Le groupe n'a que 2 intervalles historiques : couverture insuffisante sur 24 h.
    const partial = (await api().get(`/energy/autonomy?buildingId=${buildingId}`)).body.find((storage: { name: string }) => storage.name === "Batterie");
    expect(partial).toMatchObject({ state: "NOT_COMPUTABLE" });
    expect(partial.reason).toMatch(/Couverture/);
    expect((await api().post("/energy/storages", { buildingId, name: "Cuve", kind: "FUEL_TANK", usableCapacity: "1000", levelIsPercent: false, levelPointId: socPointId, drainMeterId: consumption })).status).toBe(400);
  });

  it("isolation, lecture seule, audit", async () => {
    expect((await as(harness, other).get(`/energy/meters/${consumption}`)).status).toBe(404);
    expect((await as(harness, other).get(`/energy/balance?buildingId=${buildingId}`)).status).toBe(404);
    expect((await as(harness, other).post(`/energy/meters/${consumption}/intervals`, { intervals: [{ start: new Date(midnight - 40 * DAY).toISOString(), value: "1" }] })).status).toBe(404);
    expect((await as(harness, reader).get(`/energy/balance?buildingId=${buildingId}`)).status).toBe(200);
    expect((await as(harness, reader).post(`/energy/meters/${grid}/tariffs`, { validFrom: "2026-01-01", unitPrice: "1" })).status).toBe(403);
    const audit = await harness.prisma.auditLog.findMany({ where: { organizationId: owner.organizationId, action: { startsWith: "energy." } } });
    const actions = new Set(audit.map((entry) => entry.action));
    for (const action of ["energy.meter.created", "energy.intervals.imported", "energy.tariff.created", "energy.rule.created", "energy.alert.acknowledged", "energy.storage.created"]) {
      expect(actions.has(action)).toBe(true);
    }
  });
});
