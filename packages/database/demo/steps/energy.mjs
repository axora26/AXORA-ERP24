import { createGatewayClient } from "../client.mjs";

const Q = 15 * 60_000;
const DAY = 86_400_000;

/** Pseudo-aleatoire deterministe (meme jeu de donnees a chaque seed). */
function noise(seed) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

const fixed = (value, digits = 2) => Math.max(0, value).toFixed(digits);

/**
 * ENERGIE DEMO : releves de 30 jours importes (profil de clinique : talon de
 * nuit, pointe de jour, PV en cloche, deux coupures reseau couvertes par le
 * groupe), bilan coherent (conso = reseau + PV - injection + groupe), tarifs
 * historises, alertes, batterie dont le niveau vient de la passerelle de
 * SIMULATION (l'autonomie l'affiche).
 */
export const energyStep = {
  name: "Énergie (compteurs, relevés, tarifs, autonomie)",
  async isDone(api) {
    return (await api.get("/energy/meters")).length > 0;
  },
  async run(api) {
    const buildings = await api.get("/smart/buildings");
    const building = buildings.find((candidate) => candidate.code === "CLIN-STLUC");
    if (!building) return;
    await api.patch(`/smart/buildings/${building.id}`, { floorAreaM2: "4200" });
    const meter = (input) => api.post("/energy/meters", { buildingId: building.id, intervalMinutes: 15, ...input });
    const grid = await meter({ code: "CLIN-RESEAU", name: "Arrivée réseau SNEL (TGBT)", kind: "GRID_IMPORT" });
    const pv = await meter({ code: "CLIN-PV", name: "Centrale PV toiture 180 kWc", kind: "PV_PRODUCTION" });
    const exported = await meter({ code: "CLIN-INJ", name: "Injection réseau", kind: "GRID_EXPORT" });
    const genset = await meter({ code: "CLIN-GE", name: "Groupe électrogène 250 kVA", kind: "GENSET_PRODUCTION" });
    const fuel = await meter({ code: "CLIN-GASOIL", name: "Débitmètre gasoil groupe", kind: "GENSET_FUEL", intervalMinutes: 60 });
    const load = await meter({ code: "CLIN-TGBT", name: "Consommation générale clinique", kind: "CONSUMPTION" });

    const now = Date.now();
    const midnight = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());
    const start = midnight - 30 * DAY;
    const lastStart = Math.floor(now / Q) * Q - Q;
    const outages = [
      [midnight - 21 * DAY + 13 * 3_600_000, midnight - 21 * DAY + 16 * 3_600_000],
      [midnight - 6 * DAY + 8 * 3_600_000, midnight - 6 * DAY + 10.5 * 3_600_000],
    ];
    const rows = { grid: [], pv: [], exported: [], genset: [], load: [] };
    const fuelByHour = new Map();
    for (let t = start, i = 0; t <= lastStart; t += Q, i += 1) {
      const hour = ((t % DAY) / 3_600_000 + 2) % 24; // heure locale Lubumbashi (UTC+2)
      const day = Math.floor((t - start) / DAY);
      const weekend = new Date(t + 2 * 3_600_000).getUTCDay() % 6 === 0;
      const base = hour >= 7 && hour < 20 ? (weekend ? 15 : 19.5) : 10.5;
      const consumption = base + noise(i) * 2.2 + (hour >= 11 && hour < 12 && !weekend && noise(day) > 0.8 ? 7 : 0);
      const cloud = 0.55 + 0.45 * noise(day + 100);
      const solar = hour >= 6.5 && hour <= 17.5 ? Math.sin(((hour - 6.5) / 11) * Math.PI) * 15 * cloud : 0;
      const outage = outages.some(([from, to]) => t >= from && t < to);
      const pvUsed = Math.min(solar, consumption);
      const surplus = solar - pvUsed;
      const gensetKwh = outage ? consumption - pvUsed : 0;
      const gridKwh = outage ? 0 : consumption - pvUsed;
      const at = new Date(t).toISOString();
      rows.load.push({ start: at, value: fixed(consumption) });
      if (t < midnight) {
        rows.pv.push({ start: at, value: fixed(solar) });
        rows.exported.push({ start: at, value: fixed(outage ? 0 : surplus) });
        rows.genset.push({ start: at, value: fixed(gensetKwh) });
        rows.grid.push({ start: at, value: fixed(gridKwh) });
        const hourStart = t - (t % 3_600_000);
        fuelByHour.set(hourStart, (fuelByHour.get(hourStart) ?? 0) + gensetKwh * 0.29 + (outage ? 0.4 : 0));
      }
    }
    const push = async (id, list) => {
      for (let offset = 0; offset < list.length; offset += 1400) await api.post(`/energy/meters/${id}/intervals`, { intervals: list.slice(offset, offset + 1400) });
    };
    await api.post(`/energy/meters/${load.id}/rules`, { kind: "DAILY_ABOVE", threshold: "1500", message: "Consommation journalière clinique au-dessus de 1 500 kWh" });
    await api.post(`/energy/meters/${load.id}/rules`, { kind: "INTERVAL_ABOVE", threshold: "27", message: "Pic de puissance TGBT (> 108 kW sur 15 min)" });
    await push(grid.id, rows.grid);
    await push(pv.id, rows.pv);
    await push(exported.id, rows.exported);
    await push(genset.id, rows.genset);
    await push(load.id, rows.load);
    await push(fuel.id, [...fuelByHour.entries()].map(([hourStart, liters]) => ({ start: new Date(hourStart).toISOString(), value: fixed(liters) })));

    await api.post(`/energy/meters/${grid.id}/tariffs`, { validFrom: "2026-01-01", unitPrice: "0.12", note: "Contrat SNEL MT 2026" });
    await api.post(`/energy/meters/${grid.id}/tariffs`, { validFrom: new Date(midnight - 15 * DAY).toISOString().slice(0, 10), unitPrice: "0.14", note: "Révision tarifaire SNEL (avenant n°2)" });
    await api.post(`/energy/meters/${fuel.id}/tariffs`, { validFrom: "2026-01-01", unitPrice: "1.45", note: "Prix gasoil livré Lubumbashi" });

    // Niveau batterie depuis la passerelle de simulation (etiquete comme tel dans l'autonomie).
    const gateways = await api.get("/smart/gateways");
    const sim = gateways.find((gateway) => gateway.code === "SIM-CTA01");
    if (sim) {
      const soc = await api.post("/smart/points", { gatewayId: sim.id, externalRef: "bms/soc", name: "Parc batteries — état de charge", kind: "ANALOG", unit: "%", minPlausible: "0", maxPlausible: "100" });
      const rotated = await api.post(`/smart/gateways/${sim.id}/rotate-token`);
      await createGatewayClient(api.baseUrl, rotated.token).readings([{ ref: "bms/soc", ts: new Date().toISOString(), value: "76" }]);
      await api.post("/energy/storages", { buildingId: building.id, name: "Parc batteries lithium 250 kWh", kind: "BATTERY", usableCapacity: "250", levelIsPercent: true, reserve: "20", levelPointId: soc.id, drainMeterId: load.id });
    }
    const alerts = await api.get("/energy/alerts");
    const peak = alerts.find((alert) => alert.kind === "INTERVAL_ABOVE");
    if (peak) await api.post(`/energy/alerts/${peak.id}/acknowledge`, { note: "Démarrage simultané des deux CTA du bloc : séquencement demandé à l'automaticien." });
  },
};
