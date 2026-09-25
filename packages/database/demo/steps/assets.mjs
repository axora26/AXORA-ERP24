const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function ago(ms) {
  return new Date(Date.now() - ms).toISOString();
}

/** Intervention corrective complete : ticket -> OT -> temps -> pieces -> cloture (dates declarees dans le passe). */
async function correctiveHistory(api, { assetId, title, description, failureAt, restoredAt, employeeId, hours, part, report }) {
  const tickets = await api.post("/assets/tickets", { assetId, title, description, priority: "HIGH", failureAt });
  const ticket = tickets.find((row) => row.title === title && row.status === "OPEN");
  const order = await api.post(`/assets/tickets/${ticket.id}/convert`, { dueDate: failureAt, assignedEmployeeId: employeeId });
  await api.post(`/assets/work-orders/${order.id}/start`, {});
  await api.post(`/assets/work-orders/${order.id}/labor`, { employeeId, workDate: failureAt.slice(0, 10), hours });
  if (part) await api.post(`/assets/work-orders/${order.id}/parts`, part);
  await api.post(`/assets/work-orders/${order.id}/complete`, { report, restoredAt });
}

/**
 * GMAO DEMO : passeport de la CTA receptionnee (INC-12), actifs existants
 * repris avec justification, historique de pannes reel (saisi par l'API)
 * dont decoulent MTBF/MTTR, preventif echu et ticket en attente.
 */
export const assetsStep = {
  name: "Actifs & GMAO (passeports, préventif, correctif, fiabilité)",
  async isDone(api) {
    return (await api.get("/assets")).length > 0;
  },
  async run(api) {
    const employees = await api.get("/hr/employees");
    const frigoriste = employees.find((employee) => employee.lastName === "Kasongo");
    const electricienne = employees.find((employee) => employee.lastName === "Mbuyi");
    const warehouses = await api.get("/inventory/warehouses");
    const central = warehouses.find((warehouse) => warehouse.code === "MAG-CENTRAL");
    const filter = await api.post("/inventory/items", { code: "FLT-F7", name: "Filtre poche F7 592x592", unitCode: "u", category: "Maintenance CVC", minStock: "6" });
    const belt = await api.post("/inventory/items", { code: "CRR-SPB", name: "Courroie trapézoïdale SPB 2360", unitCode: "u", category: "Maintenance CVC", minStock: "2" });
    await api.post("/inventory/adjustments", { warehouseId: central.id, itemId: filter.id, quantityDelta: "24", unitCost: "21.50", reason: "Stock initial pièces de maintenance" });
    await api.post("/inventory/adjustments", { warehouseId: central.id, itemId: belt.id, quantityDelta: "6", unitCost: "34.00", reason: "Stock initial pièces de maintenance" });
    const breaker = (await api.get("/inventory/items")).find((item) => item.code === "DIS-16A");

    const activities = await api.get("/commissioning/activities");
    const accepted = activities.find((activity) => activity.equipmentTag === "CTA-01" && (activity.status === "ACCEPTED" || activity.status === "HANDED_OVER"));
    if (accepted) {
      const cta = await api.post("/assets/from-commissioning", { commissioningActivityId: accepted.id, serialNumber: "39HQ-2026-00417", criticality: "CRITICAL", warrantyEndsAt: "2028-09-30" });
      await api.post("/assets/plans", {
        assetId: cta.id,
        title: "Remplacement filtres et contrôle courroies CTA",
        instructions: "1. Consigner la CTA\n2. Remplacer les filtres F7\n3. Contrôler tension et usure des courroies\n4. Relever la perte de charge filtres",
        intervalDays: 90,
        firstDueDate: new Date().toISOString().slice(0, 10),
        estimatedHours: "2.00",
      });
    }

    const genset = await api.post("/assets/manual", {
      name: "Groupe électrogène 250 kVA",
      location: "Local GE — siège Lubumbashi",
      installedAt: "2021-03-15",
      manufacturer: "SDMO",
      model: "J250K",
      serialNumber: "SDMO-J250-88213",
      criticality: "CRITICAL",
      originJustification: "Équipement existant du siège, repris à l'inventaire technique contradictoire du 12/09/2026 (PV INV-TECH-2026-03).",
    });
    const chiller = await api.post("/assets/manual", {
      name: "Groupe froid bureaux (split gainable 35 kW)",
      location: "Toiture bâtiment administratif",
      installedAt: "2022-06-01",
      manufacturer: "Daikin",
      model: "FDA125",
      criticality: "MEDIUM",
      originJustification: "Installation antérieure à l'ERP, reprise du contrat de maintenance Froid Services (avenant 2026-07).",
    });

    await correctiveHistory(api, {
      assetId: genset.id,
      title: "Démarrage automatique en échec",
      description: "Le GE ne démarre pas lors de la coupure réseau de 06:40, alarme batterie faible.",
      failureAt: ago(52 * DAY + 3 * HOUR),
      restoredAt: ago(52 * DAY - 2 * HOUR),
      employeeId: electricienne.id,
      hours: "4.50",
      part: { itemId: breaker.id, warehouseId: central.id, quantity: "1" },
      report: "Batterie de démarrage remplacée (fournie par le client), disjoncteur de charge 16 A remplacé, essai de basculement réseau/GE conforme.",
    });
    await correctiveHistory(api, {
      assetId: genset.id,
      title: "Arrêt sur défaut température",
      description: "Arrêt du GE après 40 min de charge, défaut température moteur.",
      failureAt: ago(18 * DAY + 5 * HOUR),
      restoredAt: ago(17 * DAY + 20 * HOUR),
      employeeId: electricienne.id,
      hours: "6.00",
      report: "Radiateur colmaté nettoyé, liquide de refroidissement complété, thermostat contrôlé. Essai en charge 2 h sans défaut.",
    });
    await correctiveHistory(api, {
      assetId: chiller.id,
      title: "Perte de froid bureaux",
      description: "Température bureaux 29 °C, unité extérieure en défaut haute pression.",
      failureAt: ago(9 * DAY + 4 * HOUR),
      restoredAt: ago(9 * DAY - 3 * HOUR),
      employeeId: frigoriste.id,
      hours: "5.00",
      part: { itemId: belt.id, warehouseId: central.id, quantity: "1" },
      report: "Condenseur encrassé nettoyé, ventilateur extérieur : courroie remplacée. Pressions HP/BP conformes après intervention.",
    });

    await api.post("/assets/plans", {
      assetId: genset.id,
      title: "Entretien 250 h groupe électrogène",
      instructions: "Vidange huile, remplacement filtres huile/gasoil/air, contrôle batterie et niveau liquide de refroidissement, essai en charge 30 min.",
      intervalDays: 60,
      firstDueDate: ago(12 * DAY).slice(0, 10),
      estimatedHours: "3.00",
    });
    await api.post("/assets/plans/generate", {});

    await api.post("/assets/tickets", {
      assetId: chiller.id,
      title: "Bruit anormal unité extérieure",
      description: "Vibrations et bruit métallique au démarrage du compresseur, signalé par l'accueil.",
      priority: "NORMAL",
    });
  },
};
