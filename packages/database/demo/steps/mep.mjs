import { createClient } from "../client.mjs";
import { DEMO_USERS } from "./admin.mjs";

async function directionClient(api, needed) {
  const roles = await api.get("/admin/roles");
  const direction = roles.find((role) => role.name === "Direction (lecture)");
  if (direction && needed.some((key) => !direction.permissions.includes(key))) {
    await api.put(`/admin/roles/${direction.id}/permissions`, { permissions: [...new Set([...direction.permissions, ...needed])] });
  }
  const user = DEMO_USERS.find((candidate) => candidate.role === "Direction (lecture)");
  const client = createClient(api.baseUrl);
  await client.post("/auth/login", { email: user.email, password: user.password });
  return client;
}

/**
 * MEP DEMO : systemes par discipline, equipements de reference, notes de
 * calcul (entrees sourcees), l'une validee par la direction technique.
 */
export const mepStep = {
  name: "MEP (systèmes, équipements, notes de calcul)",
  async isDone(api) {
    const projects = await api.get("/projects");
    const project = projects.find((candidate) => candidate.status === "IN_PROGRESS") ?? projects[0];
    return (await api.get(`/mep/systems?projectId=${project.id}`)).length > 0;
  },
  async run(api) {
    const director = await directionClient(api, ["mep.system.read", "mep.calculation.validate", "commissioning.activity.read", "commissioning.activity.accept"]);
    const projects = await api.get("/projects");
    const projectId = (projects.find((candidate) => candidate.status === "IN_PROGRESS") ?? projects[0]).id;
    const documents = await api.get("/documents?q=CTA-01");
    const sheet = documents.find((document) => document.category === "TECHNICAL_SHEET");

    const systemsDef = [
      { code: "CVC-01", name: "Traitement d'air bloc opératoire", discipline: "HVAC" },
      { code: "CVC-02", name: "Production d'eau glacée", discipline: "HVAC" },
      { code: "ELEC-01", name: "Distribution basse tension", discipline: "ELECTRICAL" },
      { code: "PLB-01", name: "Eau chaude sanitaire", discipline: "PLUMBING" },
      { code: "SSI-01", name: "Système de sécurité incendie", discipline: "FIRE_PROTECTION" },
    ];
    let systems = [];
    for (const system of systemsDef) systems = await api.post("/mep/systems", { projectId, ...system });
    const sys = (code) => systems.find((system) => system.code === code).id;

    const cta = await api.post("/mep/equipment", {
      systemId: sys("CVC-01"),
      tag: "CTA-01",
      name: "Centrale de traitement d'air — bloc opératoire",
      manufacturer: "Fabricant DEMO",
      model: "CTA-12000 HR",
      location: "Toiture technique",
      technicalDocumentId: sheet?.id,
      specs: [
        { name: "Débit nominal", value: "12000", unit: "m³/h" },
        { name: "Puissance froid", value: "85", unit: "kW" },
        { name: "Filtration", value: "F7 + H13", unit: "" },
      ],
    });
    const chiller = await api.post("/mep/equipment", {
      systemId: sys("CVC-02"),
      tag: "GF-01",
      name: "Groupe de production d'eau glacée",
      manufacturer: "Fabricant DEMO",
      model: "GF-180",
      location: "Toiture technique",
      specs: [
        { name: "Puissance frigorifique", value: "180", unit: "kW" },
        { name: "Régime d'eau", value: "7 / 12", unit: "°C" },
      ],
    });
    const tgbt = await api.post("/mep/equipment", { systemId: sys("ELEC-01"), tag: "TGBT", name: "Tableau général basse tension", location: "Local TGBT RDC", specs: [{ name: "Intensité nominale", value: "630", unit: "A" }] });
    await api.post("/mep/equipment", { systemId: sys("PLB-01"), tag: "BALLON-ECS-01", name: "Préparateur d'eau chaude sanitaire", location: "Chaufferie", specs: [{ name: "Volume", value: "1500", unit: "L" }] });
    await api.post("/mep/equipment", { systemId: sys("SSI-01"), tag: "CMSI", name: "Centralisateur de mise en sécurité incendie", location: "PC sécurité", specs: [] });
    for (const item of [cta, chiller]) {
      await api.patch(`/mep/equipment/${item.id}`, { status: "SELECTED" });
      await api.patch(`/mep/equipment/${item.id}`, { status: "INSTALLED" });
    }
    await api.patch(`/mep/equipment/${tgbt.id}`, { status: "SELECTED" });

    const airFlow = await api.post("/mep/calculations", {
      projectId,
      equipmentId: cta.id,
      systemId: sys("CVC-01"),
      calcType: "hvac.air_flow_sensible",
      title: "Débit de soufflage — salles d'opération 1 et 2",
      inputs: { power: "32000", density: "1.2", heatCapacity: "1006", deltaT: "9" },
      sources: "Bilan d'apports BET (note DEMO indice B) ; propriétés de l'air à 20 °C au niveau de la mer",
      notes: "Apports matériels et éclairage scialytique inclus",
    });
    await director.post(`/mep/calculations/${airFlow.id}/validate`, { note: "Hypothèses cohérentes avec le programme" });
    await api.post("/mep/calculations", {
      projectId,
      equipmentId: chiller.id,
      calcType: "hvac.water_flow",
      title: "Débit d'eau glacée — boucle primaire",
      inputs: { power: "180000", density: "1000", heatCapacity: "4180", deltaT: "5" },
      sources: "Fiche technique GF-180 (DEMO) ; eau non glycolée",
    });
    await api.post("/mep/calculations", {
      projectId,
      equipmentId: tgbt.id,
      calcType: "elec.current_three_phase",
      title: "Courant d'emploi du départ CTA-01",
      inputs: { power: "22000", voltage: "400", powerFactor: "0.85" },
    });
    await api.post("/mep/calculations", {
      projectId,
      calcType: "elec.voltage_drop_three_phase",
      title: "Chute de tension du départ CTA-01 (résistive)",
      inputs: { current: "37.36", length: "65", section: "16", resistivity: "0.0225", voltage: "400" },
      sources: "Résistivité du cuivre à la température de service retenue par le BET (DEMO)",
    });
  },
};

/** Mise en service DEMO : CTA-01 receptionnee et remise, GF-01 bloquee par une anomalie. */
export const commissioningStep = {
  name: "Mise en service (essais, anomalies, réception)",
  async isDone(api) {
    return (await api.get("/commissioning/activities")).length > 0;
  },
  async run(api) {
    const directionUser = DEMO_USERS.find((user) => user.role === "Direction (lecture)");
    const director = createClient(api.baseUrl);
    await director.post("/auth/login", { email: directionUser.email, password: directionUser.password });
    const equipment = await api.get("/mep/equipment?status=INSTALLED");
    const cta = equipment.find((item) => item.tag === "CTA-01");
    const chiller = equipment.find((item) => item.tag === "GF-01");

    let activity = await api.post("/commissioning/activities", {
      equipmentId: cta.id,
      procedure: "1. Contrôles de précommissioning (filtres, courroies, sens de rotation)\n2. Mesure des débits de soufflage et de reprise\n3. Essais de régulation de température\n4. Mesure des pressions différentielles salles",
    });
    await api.post(`/commissioning/activities/${activity.id}/tests`, {
      kind: "PRECOMMISSIONING",
      checks: [
        { label: "Filtres F7 et H13 posés, cadres étanches", ok: true },
        { label: "Sens de rotation ventilateurs", ok: true },
        { label: "Raccordements électriques serrés", ok: true },
      ],
    });
    activity = await api.post(`/commissioning/activities/${activity.id}/tests`, {
      kind: "FUNCTIONAL",
      measurements: [
        { name: "Débit soufflage", unit: "m³/h", min: "11400", max: "12600", measured: "10820" },
        { name: "Température de soufflage", unit: "°C", min: "16", max: "20", measured: "18.2" },
      ],
      anomalies: [{ description: "Débit de soufflage insuffisant : courroie du ventilateur détendue", severity: "MAJOR" }],
    });
    await api.post(`/commissioning/punch-items/${activity.punchItems[0].id}/correct`, { note: "Courroie retendue, poulies réalignées" });
    await api.post(`/commissioning/activities/${activity.id}/tests`, {
      kind: "RETEST",
      measurements: [
        { name: "Débit soufflage", unit: "m³/h", min: "11400", max: "12600", measured: "12040" },
        { name: "Pression différentielle salle 1", unit: "Pa", min: "15", max: "30", measured: "21" },
      ],
    });
    await director.post(`/commissioning/activities/${activity.id}/accept`, { note: "Performances conformes au CCTP, essais contradictoires réalisés." });
    const approved = await api.get("/documents?status=APPROVED&q=CTA-01");
    if (approved.length > 0) {
      await director.post(`/commissioning/activities/${activity.id}/handover`, { recipient: "Clinique Saint-Luc — service technique", documentIds: approved.map((document) => document.id) });
    }

    const second = await api.post("/commissioning/activities", { equipmentId: chiller.id, procedure: "1. Précommissioning\n2. Essais de production d'eau glacée à charge partielle et nominale" });
    await api.post(`/commissioning/activities/${second.id}/tests`, { kind: "PRECOMMISSIONING", checks: [{ label: "Circuit hydraulique rempli et purgé", ok: true }, { label: "Contrôle d'étanchéité frigorifique", ok: true }] });
    await api.post(`/commissioning/activities/${second.id}/tests`, {
      kind: "FUNCTIONAL",
      measurements: [{ name: "Température départ eau glacée", unit: "°C", min: "6", max: "8", measured: "9.4" }],
      anomalies: [{ description: "Consigne non atteinte : sonde de départ mal positionnée", severity: "MAJOR" }],
    });
  },
};
