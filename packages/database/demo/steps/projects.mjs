import { createClient } from "../client.mjs";
import { DEMO_USERS } from "./admin.mjs";

/** Projet DEMO issu du contrat de la chaine commerciale. */

const BUDGET = {
  "GO-01": [["MATERIAL", "Béton, aciers, coffrages", "21400.00"], ["LABOR", "Équipe terrassement", "6300.00"]],
  "GO-02": [["MATERIAL", "Béton armé C30/37", "52800.00"], ["LABOR", "Coffreurs-ferrailleurs", "18900.00"]],
  "CVC-01": [["EQUIPMENT", "2 CTA 12 000 m3/h", "71200.00"], ["SUBCONTRACT", "Raccordements aérauliques", "9600.00"]],
  "ELEC-01": [["EQUIPMENT", "TGBT et protections", "41500.00"], ["LABOR", "Câblage et essais", "7400.00"]],
  "FLU-01": [["SUBCONTRACT", "Réseau gaz médicaux (sous-traité)", "48200.00"]],
  "SEC-01": [["SUBCONTRACT", "Détection incendie SSI", "29800.00"]],
};

const TASKS = [
  ["GO-01", "Implantation et terrassement", "2", "2026-10-05", "2026-10-23", "DONE"],
  ["GO-01", "Fondations superficielles", "3", "2026-10-19", "2026-11-13", "DONE"],
  ["GO-02", "Voiles et poteaux R+0", "4", "2026-11-09", "2026-12-18", "IN_PROGRESS"],
  ["GO-02", "Dalle haute R+1", "4", "2027-01-04", "2027-02-12", "TODO"],
  ["CVC-01", "Réception et pose des CTA", "3", "2027-02-15", "2027-03-19", "TODO"],
  ["ELEC-01", "Pose du TGBT", "2", "2027-02-22", "2027-03-12", "TODO"],
  ["FLU-01", "Réseau gaz médicaux", "3", "2027-03-01", "2027-04-09", "BLOCKED"],
  ["SEC-01", "Détection incendie et essais", "2", "2027-04-05", "2027-04-30", "TODO"],
];

export const projectsStep = {
  name: "Projets (WBS, budget, planning, avenants)",
  async isDone(api) {
    const projects = await api.get("/projects");
    return projects.length > 0;
  },
  async run(api, ctx) {
    const contracts = await api.get("/sales/contracts");
    const contract = contracts.find((candidate) => candidate.status === "ACTIVE");
    if (!contract) throw new Error("Aucun contrat actif pour le projet DEMO");

    // La Direction approuve les avenants (separation des devoirs avec le chef de projet).
    const catalog = await api.get("/admin/permissions");
    const readKeys = catalog.flatMap((group) => group.permissions.map((permission) => permission.key)).filter((key) => key.endsWith(".read"));
    const roles = await api.get("/admin/roles");
    const direction = roles.find((role) => role.name === "Direction (lecture)");
    if (direction) {
      await api.put(`/admin/roles/${direction.id}/permissions`, {
        permissions: [...new Set([...readKeys, "projects.changeorder.approve"])],
      });
    }

    let project = await api.post("/projects", {
      contractId: contract.id,
      name: "Extension du bloc opératoire — Clinique Saint-Luc",
      location: "Lubumbashi",
      plannedStart: "2026-10-05",
      plannedEnd: "2027-05-28",
      importContractLines: true,
      description: "Construction d'une extension R+1 de 1 250 m² : deux salles d'opération, salle de réveil, locaux techniques.",
    });
    const leafByCode = Object.fromEntries(project.wbs.map((node) => [node.code, node.id]));
    for (const [code, lines] of Object.entries(BUDGET)) {
      for (const [category, description, amount] of lines) {
        project = await api.post(`/projects/${project.id}/budget-lines`, { wbsItemId: leafByCode[code], category, description, amount });
      }
    }
    await api.post(`/projects/${project.id}/baseline`);
    await api.post(`/projects/${project.id}/status`, { status: "IN_PROGRESS" });

    for (const [code, name, weight, plannedStart, plannedEnd] of TASKS) {
      project = await api.post(`/projects/${project.id}/tasks`, { wbsItemId: leafByCode[code], name, weight, plannedStart, plannedEnd });
    }
    for (const [code, name, , , , status] of TASKS) {
      if (status === "TODO") continue;
      const task = project.tasks.find((candidate) => candidate.name === name && candidate.wbsItemId === leafByCode[code]);
      project = await api.patch(`/projects/${project.id}/tasks/${task.id}/status`, { status });
    }

    await api.post(`/projects/${project.id}/milestones`, { name: "Fin du gros œuvre", dueDate: "2027-02-12" });
    const withMilestone = await api.post(`/projects/${project.id}/milestones`, { name: "Démarrage des fondations", dueDate: "2026-10-19" });
    const started = withMilestone.milestones.find((milestone) => milestone.name === "Démarrage des fondations");
    await api.post(`/projects/${project.id}/milestones/${started.id}/achieve`);
    await api.post(`/projects/${project.id}/milestones`, { name: "Réception des travaux", dueDate: "2027-05-28" });

    await api.post(`/projects/${project.id}/risks`, {
      title: "Délai d'importation des CTA (14 semaines)",
      probability: 4,
      impact: 4,
      mitigation: "Commande anticipée dès validation des plans d'exécution",
    });
    await api.post(`/projects/${project.id}/risks`, {
      title: "Accès chantier en exploitation hospitalière",
      probability: 3,
      impact: 3,
      mitigation: "Plan de circulation validé avec l'hygiène hospitalière",
    });

    project = await api.post(`/projects/${project.id}/change-orders`, {
      wbsItemId: leafByCode["ELEC-01"],
      title: "Éclairage de sécurité des salles",
      reason: "Prescription du bureau de contrôle (rapport BC-07)",
      amount: "6850.00",
    });
    project = await api.post(`/projects/${project.id}/change-orders`, {
      wbsItemId: leafByCode["GO-02"],
      title: "Variante de coffrage réutilisable",
      reason: "Économie proposée par l'équipe travaux",
      amount: "-3200.00",
    });

    const directionUser = DEMO_USERS.find((user) => user.role === "Direction (lecture)");
    const directionApi = createClient(api.baseUrl);
    await directionApi.post("/auth/login", { email: directionUser.email, password: directionUser.password });
    const lighting = project.changeOrders.find((order) => order.title.startsWith("Éclairage"));
    await directionApi.post(`/projects/${project.id}/change-orders/${lighting.id}/approve`, { note: "Obligation réglementaire" });
    ctx.projectId = project.id;
  },
};
