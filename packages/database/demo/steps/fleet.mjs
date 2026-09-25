const DAY = 86_400_000;
const at = (daysAgo, hour = 8) => new Date(Date.now() - daysAgo * DAY + (hour - 8) * 3_600_000).toISOString();
const day = (offset) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);

/**
 * PARC DEMO : quatre equipements repris avec leur releve date, pieces
 * reglementaires (dont une assurance echue et un controle qui arrive a
 * echeance), historique de pleins imputes au projet, affectations aux
 * chauffeurs habilites (competences RH), incident avec ticket GMAO.
 */
export const fleetStep = {
  name: "Parc (véhicules, engins, affectations, carburant, incidents)",
  async isDone(api) {
    return (await api.get("/fleet/vehicles")).length > 0;
  },
  async run(api) {
    const employees = await api.get("/hr/employees");
    const byName = (lastName) => employees.find((employee) => employee.lastName === lastName);
    const patrick = byName("Ilunga");
    const grace = byName("Mbuyi");
    await api.post(`/hr/employees/${patrick.id}/skills`, { name: "Permis C", level: 4, certifiedUntil: day(900) });
    await api.post(`/hr/employees/${grace.id}/skills`, { name: "Permis B", level: 3, certifiedUntil: day(1500) });
    const operator = await api.post("/hr/employees", { firstName: "Moïse", lastName: "Kabeya", jobTitle: "Conducteur d'engins", hireDate: "2023-02-01", contractType: "PERMANENT", hourlyCost: "18.50", baseSalary: "2300.00" });
    await api.post(`/hr/employees/${operator.id}/skills`, { name: "CACES R482", level: 4, certifiedUntil: day(600) });

    const projects = await api.get("/projects");
    const project = projects.find((candidate) => candidate.status === "IN_PROGRESS") ?? projects[0];
    const vehicle = (input) => api.post("/fleet/vehicles", { acquisitionDate: "2024-02-15", initialReadingAt: at(40), homeBase: "Dépôt central Lubumbashi", fuelType: "DIESEL", ...input });
    const hilux = await vehicle({ kind: "VEHICLE", category: "Pick-up double cabine", make: "Toyota", model: "Hilux 2.8 GD-6", registration: "CGO-4471-KT", year: 2024, usageUnit: "KM", requiredLicence: "Permis B", initialReading: "38120", acquisitionCost: "41500.00", originJustification: "Facture CFAO Motors n° FV-24-0212, carte grise du 15/02/2024" });
    const actros = await vehicle({ kind: "VEHICLE", category: "Porteur benne 26 t", make: "Mercedes-Benz", model: "Actros 2640", registration: "CGO-9012-KT", year: 2022, usageUnit: "KM", requiredLicence: "Permis C", initialReading: "128400", acquisitionCost: "118000.00", originJustification: "Reprise du parc existant, carte grise du 03/05/2022 et PV d'inventaire 09/2026" });
    const excavator = await vehicle({ kind: "ENGINE", category: "Pelle sur chenilles 20 t", make: "Caterpillar", model: "320 GC", serialNumber: "CAT0320GKZB01842", year: 2023, usageUnit: "HOURS", requiredLicence: "CACES R482", initialReading: "2410.0", acquisitionCost: "162000.00", originJustification: "Contrat de crédit-bail Bergerat Monnoyeur n° CB-2023-077" });
    const navara = await vehicle({ kind: "VEHICLE", category: "Pick-up simple cabine", make: "Nissan", model: "Navara", registration: "CGO-2208-KT", year: 2019, usageUnit: "KM", requiredLicence: "Permis B", initialReading: "164300", originJustification: "Reprise du parc existant, carte grise du 11/2019" });

    const documents = [
      [hilux, "INSURANCE", "SONAS-AUTO-88412", "SONAS", -200, 165, "1850.00"],
      [hilux, "REGISTRATION", "CG-CGO-4471-KT", "DGI Haut-Katanga", -580, 3000, null],
      [hilux, "INSPECTION", "CT-2026-0441", "Contrôle technique Lubumbashi", -60, 305, "85.00"],
      [actros, "INSURANCE", "SONAS-PL-11903", "SONAS", -120, 245, "4200.00"],
      [actros, "REGISTRATION", "CG-CGO-9012-KT", "DGI Haut-Katanga", -1240, 2400, null],
      [actros, "INSPECTION", "CT-2025-1188", "Contrôle technique Lubumbashi", -345, 20, "140.00"],
      [excavator, "INSURANCE", "RC-ENG-2026-17", "Rawbank Assurances", -90, 275, "3100.00"],
      [excavator, "INSPECTION", "VGP-2026-0317", "Bureau Veritas", -30, 150, "260.00"],
      [navara, "INSURANCE", "SONAS-AUTO-55120", "SONAS", -375, -10, "1600.00"],
      [navara, "REGISTRATION", "CG-CGO-2208-KT", "DGI Haut-Katanga", -2500, 1200, null],
      [navara, "INSPECTION", "CT-2026-0102", "Contrôle technique Lubumbashi", -150, 215, "85.00"],
    ];
    for (const [target, kind, reference, issuer, from, until, cost] of documents) {
      await api.post(`/fleet/vehicles/${target.id}/documents`, { kind, reference, issuer, validFrom: day(from), validUntil: day(until), ...(cost ? { cost } : {}) });
    }

    // Historique de pleins (avant les affectations en cours), imputes au projet.
    let odo = 128400;
    for (let daysAgo = 35, index = 0; daysAgo >= 3; daysAgo -= 4, index += 1) {
      odo += 610 + ((index * 37) % 90);
      await api.post("/fleet/fuel", { vehicleId: actros.id, filledAt: at(daysAgo, 7), liters: String(210 + ((index * 13) % 25)), unitPrice: index < 5 ? "1.52" : "1.58", reading: String(odo), fullTank: index % 3 !== 1, station: "Engen Route Likasi", projectId: project?.id });
    }
    let hours = 2410;
    for (let daysAgo = 34, index = 0; daysAgo >= 2; daysAgo -= 5, index += 1) {
      hours += 38 + (index % 4) * 3.5;
      await api.post("/fleet/fuel", { vehicleId: excavator.id, filledAt: at(daysAgo, 17), liters: String(470 + (index % 3) * 20), unitPrice: "1.52", reading: hours.toFixed(1), fullTank: true, station: "Citerne chantier", projectId: project?.id });
    }
    let km = 38120;
    for (let daysAgo = 30, index = 0; daysAgo >= 2; daysAgo -= 7, index += 1) {
      km += 540 + index * 25;
      await api.post("/fleet/fuel", { vehicleId: hilux.id, filledAt: at(daysAgo, 12), liters: String(58 + index), unitPrice: "1.55", reading: String(km), fullTank: true, station: "Total Kasapa" });
    }

    // Panne passee de la pelle : ticket GMAO a l'heure de la defaillance.
    await api.post("/fleet/incidents", { vehicleId: excavator.id, kind: "BREAKDOWN", occurredAt: at(12, 14), description: "Fuite hydraulique sur vérin de flèche, arrêt du terrassement", location: project ? `Chantier ${project.code}` : "Chantier", createTicket: true, cost: "780.00" });

    // Affectations en cours aux chauffeurs habilites.
    await api.post("/fleet/assignments", { vehicleId: actros.id, employeeId: patrick.id, projectId: project?.id, purpose: "Évacuation des déblais et approvisionnement granulats", startReading: String(odo + 12) });
    await api.post("/fleet/assignments", { vehicleId: excavator.id, employeeId: operator.id, projectId: project?.id, purpose: "Terrassement fondations bloc B", startReading: (hours + 2).toFixed(1) });
    await api.post("/fleet/assignments", { vehicleId: hilux.id, employeeId: grace.id, purpose: "Liaisons chantier / dépôt, astreinte électrique", startReading: String(km + 40) });
    await api.post("/fleet/incidents", { vehicleId: hilux.id, kind: "DAMAGE", occurredAt: new Date().toISOString(), description: "Rétroviseur gauche cassé en manœuvre sur le parking du dépôt", location: "Dépôt central", cost: "95.00" });
  },
};
