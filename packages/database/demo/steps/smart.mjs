import { createGatewayClient } from "../client.mjs";

const QUARTER = 15 * 60_000;

/** Courbe journaliere deterministe (simulateur declare comme tel : aucune donnee n'est presentee comme mesuree). */
function simulated(base, amplitude, index, phase = 0) {
  const hour = (index * 0.25) % 24;
  return base + amplitude * Math.sin(((hour - 6 + phase) / 24) * 2 * Math.PI);
}

/**
 * SMART BUILDING DEMO : un batiment, une passerelle de SIMULATION (etiquetee
 * comme telle, aucun niveau physique) qui alimente l'API d'ingestion reelle,
 * et une passerelle BACnet declaree mais jamais connectee (tout NOT_TESTED).
 */
export const smartStep = {
  name: "Smart Building (passerelles, télémétrie, alarmes, consignes)",
  async isDone(api) {
    return (await api.get("/smart/buildings")).length > 0;
  },
  async run(api) {
    const projects = await api.get("/projects");
    const project = projects.find((candidate) => candidate.status === "IN_PROGRESS") ?? projects[0];
    const [building] = await api.post("/smart/buildings", { code: "CLIN-STLUC", name: "Clinique Saint-Luc — bloc opératoire", address: "Avenue Kasa-Vubu, Lubumbashi", projectId: project?.id });
    const assets = await api.get("/assets");
    const cta = assets.find((asset) => asset.equipmentTag === "CTA-01");

    const sim = await api.post("/smart/gateways", {
      buildingId: building.id,
      code: "SIM-CTA01",
      name: "Simulateur de démonstration — CTA bloc",
      protocol: "HTTP_API",
      simulated: true,
    });
    await api.post("/smart/gateways", {
      buildingId: building.id,
      code: "GW-BACNET-01",
      name: "Automate GTB local technique (BACnet/IP)",
      protocol: "BACNET_IP",
      endpoint: "10.20.0.15:47808 (déclaré, non vérifié)",
    });

    const point = (input) => api.post("/smart/points", { gatewayId: sim.gateway.id, ...(cta ? { assetId: cta.id } : {}), ...input });
    const supply = await point({ externalRef: "cta01/soufflage/temperature", name: "CTA-01 — température de soufflage", kind: "ANALOG", unit: "°C", minPlausible: "-10", maxPlausible: "60" });
    const room = await point({ externalRef: "bloc1/salle/temperature", name: "Salle d'opération 1 — température", kind: "ANALOG", unit: "°C", minPlausible: "0", maxPlausible: "50" });
    const filter = await point({ externalRef: "cta01/filtre-f7/delta-p", name: "CTA-01 — encrassement filtre F7", kind: "ANALOG", unit: "Pa", minPlausible: "0", maxPlausible: "600" });
    const valve = await point({ externalRef: "cta01/vanne-froid/position", name: "CTA-01 — vanne batterie froide", kind: "ANALOG", unit: "%", writable: true, writeTolerance: "1.5", minPlausible: "0", maxPlausible: "100" });
    const fan = await point({ externalRef: "cta01/ventilateur/marche", name: "CTA-01 — ventilateur de soufflage", kind: "BINARY" });

    await api.post("/smart/rules", { pointId: room.id, condition: "ABOVE", threshold: "24", severity: "CRITICAL", message: "Température salle d'opération 1 au-dessus de 24 °C" });
    await api.post("/smart/rules", { pointId: filter.id, condition: "ABOVE", threshold: "250", severity: "WARNING", message: "Filtre F7 encrassé : prévoir remplacement" });
    await api.post("/smart/rules", { pointId: fan.id, condition: "EQUALS", threshold: "0", severity: "CRITICAL", message: "Ventilateur de soufflage à l'arrêt" });

    const gateway = createGatewayClient(api.baseUrl, sim.token);
    const now = Date.now() - (Date.now() % QUARTER);
    const count = 4 * 48;
    const series = [];
    for (let i = 0; i < count; i += 1) {
      const ts = new Date(now - (count - 1 - i) * QUARTER).toISOString();
      const hoursAgo = ((count - 1 - i) * QUARTER) / 3_600_000;
      // Episode de surchauffe (il y a 26 h a 25 h) puis remise en regime ; derive recente de la salle.
      const excursion = hoursAgo <= 26 && hoursAgo >= 25 ? 3.1 : 0;
      const recentDrift = hoursAgo <= 0.5 ? 3.4 : 0;
      series.push({ ref: "cta01/soufflage/temperature", ts, value: simulated(16.5, 1.2, i).toFixed(1) });
      series.push({ ref: "bloc1/salle/temperature", ts, value: (simulated(21.6, 0.8, i, 2) + excursion + recentDrift).toFixed(1) });
      series.push({ ref: "cta01/filtre-f7/delta-p", ts, value: (180 + i * 0.42 + (hoursAgo < 20 && hoursAgo > 19 ? 90 : 0)).toFixed(0) });
      series.push({ ref: "cta01/vanne-froid/position", ts, value: Math.max(0, Math.min(100, simulated(35, 15, i, 1))).toFixed(1) });
      series.push({ ref: "cta01/ventilateur/marche", ts, value: "1" });
    }
    for (let start = 0; start < series.length; start += 900) await gateway.readings(series.slice(start, start + 900));

    // Consigne : demandee, recuperee et acquittee par la passerelle, confirmee par relecture.
    const [setpoint] = await api.post("/smart/setpoints", { pointId: valve.id, value: "45", reason: "Ouverture vanne froide : température salle 1 au-dessus de la cible" });
    await gateway.setpoints();
    await gateway.ack(setpoint.id, { applied: true, note: "Écrit sur la sortie analogique (simulation)" });
    await gateway.readings([{ ref: "cta01/vanne-froid/position", ts: new Date(Date.now() + 1000).toISOString(), value: "44.6" }]);

    const active = await api.get("/smart/alarms");
    const filterAlarm = active.find((alarm) => alarm.pointId === filter.id);
    if (filterAlarm) await api.post(`/smart/alarms/${filterAlarm.id}/acknowledge`, { note: "OT de remplacement des filtres planifié (préventif CTA)" });
    return { supply, room, filter, valve, fan };
  },
};
