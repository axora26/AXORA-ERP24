import type { ProjectDetailView, ProjectOperationsView } from "@axora24/contracts";
import { PrintableDocument } from "../common/printable-document.js";

export async function projectOperationsPdf(project: ProjectDetailView, operations: ProjectOperationsView, companyName: string, demo = false): Promise<Buffer> {
  const doc = new PrintableDocument("Rapport de chantier", project.code, companyName, demo);
  doc.paragraph(project.name, 13, "#1E3A8A");
  doc.paragraph(`Période : ${operations.from} au ${operations.to} · Heures UTC · Devise : ${project.currency}`);
  if (project.location) doc.paragraph(`Localisation : ${project.location}`);
  doc.section("Budget du projet — situation actuelle");
  doc.table([{ label: "Indicateur", width: 358 }, { label: `Montant ${project.currency}`, width: 165, align: "right" }], [
    ["Montant contractuel", project.cockpit.contractAmount], ["Budget initial", project.cockpit.initialBudget],
    ["Avenants approuvés", project.cockpit.approvedChangeOrders], ["Budget révisé", project.cockpit.revisedBudget],
    ["Marge prévisionnelle", project.cockpit.forecastMargin],
    ["Engagé", project.cockpit.committed.available ? project.cockpit.committed.amount : "Indisponible"],
    ["Consommé", project.cockpit.consumed.available ? project.cockpit.consumed.amount : "Indisponible"],
  ]);
  if (project.budgetLines.length) {
    doc.section("Lignes budgétaires");
    doc.table([{ label: "Description", width: 298 }, { label: "Catégorie", width: 110 }, { label: "Montant", width: 115, align: "right" }],
      project.budgetLines.map(line => [line.description, { MATERIAL: "Matériel", LABOR: "Main d’œuvre", EQUIPMENT: "Équipement", SUBCONTRACT: "Sous-traitance", OVERHEAD: "Frais généraux", OTHER: "Autre" }[line.category], line.amount]));
  }
  doc.section("Présences sur la période");
  if (!operations.attendance) doc.paragraph("Données de présence indisponibles pour ce profil.");
  else {
    doc.paragraph(`${operations.attendance.summary.employeeCount} salarié(s) · ${operations.attendance.summary.workedMinutes} minutes constatées · ${operations.attendance.summary.openIntervals} intervalle(s) ouvert(s)`);
    doc.table([{ label: "Salarié", width: 173 }, { label: "Entrée UTC", width: 110 }, { label: "Sortie UTC", width: 110 }, { label: "Minutes", width: 55, align: "right" }, { label: "À vérifier", width: 75 }],
      operations.attendance.rows.map(row => [row.employeeName, row.clockInAt.replace("T", " ").slice(0, 16), row.clockOutAt?.replace("T", " ").slice(0, 16) ?? "Ouvert", String(row.minutes), row.anomalies.map(code => ({ MISSING_OUT: "Sortie manquante", MISSING_OUT_BEFORE_NEXT_IN: "Sortie manquante avant nouvelle entrée", PROJECT_CHANGED_AT_OUT: "Projet différent à la sortie", OUT_WITHOUT_IN: "Entrée manquante" }[code] ?? "Pointage à vérifier")).join(", ")]));
  }
  doc.section("Temps validés et coûts de la période");
  if (operations.timesheets) doc.paragraph(`Heures validées : ${operations.timesheets.validatedHours} · Coût de main d’œuvre : ${operations.timesheets.validatedCost ?? "Indisponible"} ${operations.timesheets.validatedCost === null ? "" : project.currency}`);
  else doc.paragraph("Feuilles de temps indisponibles pour ce profil.");
  doc.table([{ label: "Source", width: 358 }, { label: `Coût ${project.currency}`, width: 165, align: "right" }],
    ([ ["Matériel", operations.costs.materials], ["Main d’œuvre", operations.costs.labor], ["Sous-traitance", operations.costs.subcontract], ["Réceptions directes", operations.costs.directReceipts], ["Total", operations.costs.total] ] as const)
      .map(([label, cost]) => [label, cost.available && cost.amount !== null ? cost.amount : "Indisponible"]));
  doc.section("Matériel — sorties et retours de la période");
  if (!operations.materials) doc.paragraph("Données de stock indisponibles pour ce profil.");
  else {
    doc.table([{ label: "Article / magasin", width: 223 }, { label: "Date", width: 70 }, { label: "Mouvement", width: 90 }, { label: "Quantité", width: 60, align: "right" }, { label: "Valeur", width: 80, align: "right" }],
      operations.materials.rows.map(row => [`${row.itemCode} — ${row.itemName}\n${row.warehouseName}`, row.date.slice(0, 10), row.type === "ISSUE" ? "Sortie" : "Retour", `${row.quantityDelta} ${row.unitCode}`, row.valueDelta]));
    doc.paragraph(`Coût net des mouvements : ${operations.materials.netCost} ${project.currency}`);
    doc.section("Stock actuel des magasins du chantier");
    doc.paragraph(`Situation relevée le ${operations.materials.balancesAsOf.replace("T", " ").slice(0, 19)} UTC. Cette situation est indépendante de la période du rapport.`);
    doc.table([{ label: "Article", width: 223 }, { label: "Magasin", width: 130 }, { label: "Quantité", width: 90, align: "right" }, { label: "Valeur", width: 80, align: "right" }],
      operations.materials.siteBalances.map(row => [`${row.itemCode} — ${row.itemName}`, row.warehouseName, `${row.quantity} ${row.unitCode}`, row.value]));
  }
  doc.section("Parc affecté au projet");
  if (!operations.equipment?.fleetAssignments) doc.paragraph("Affectations du parc indisponibles pour ce profil.");
  else doc.table([{ label: "Véhicule", width: 183 }, { label: "Responsable / usage", width: 190 }, { label: "Début", width: 75 }, { label: "Fin", width: 75 }],
    operations.equipment.fleetAssignments.map(row => [`${row.code} — ${row.name}`, `${row.employeeName ?? "Non attribué"}\n${row.purpose}`, row.startAt.slice(0, 10), row.endAt?.slice(0, 10) ?? "En cours"]));
  if (operations.equipment?.assets?.length) {
    doc.section("Immobilisations mises en service depuis ce projet");
    doc.paragraph("Le projet décrit ici l’origine de la mise en service des actifs.");
    doc.table([{ label: "Actif", width: 223 }, { label: "État", width: 110 }, { label: "Localisation", width: 190 }],
      operations.equipment.assets.map(row => [`${row.code} — ${row.name}`, { IN_SERVICE: "En service", OUT_OF_SERVICE: "Hors service", RETIRED: "Retiré" }[row.status], row.location]));
  }
  return doc.finish();
}
