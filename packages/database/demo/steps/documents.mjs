import { createClient } from "../client.mjs";
import { DEMO_USERS } from "./admin.mjs";
import { textPdf } from "../media.mjs";

async function directionClient(api) {
  const roles = await api.get("/admin/roles");
  const direction = roles.find((role) => role.name === "Direction (lecture)");
  const needed = ["documents.document.approve", "field.issue.close", "field.log.sign"];
  if (direction && needed.some((key) => !direction.permissions.includes(key))) {
    await api.put(`/admin/roles/${direction.id}/permissions`, { permissions: [...new Set([...direction.permissions, ...needed])] });
  }
  const user = DEMO_USERS.find((candidate) => candidate.role === "Direction (lecture)");
  const client = createClient(api.baseUrl);
  await client.post("/auth/login", { email: user.email, password: user.password });
  return client;
}

/** GED DEMO : arborescence projet, plans et fiches versionnes, visa par la direction. */
export const documentsStep = {
  name: "GED (arborescence, révisions, visas)",
  async isDone(api) {
    const documents = await api.get("/documents");
    return documents.length > 0;
  },
  async run(api) {
    const direction = await directionClient(api);
    const projects = await api.get("/projects");
    const project = projects.find((candidate) => candidate.status === "IN_PROGRESS") ?? projects[0];
    const projectId = project?.id;

    let folders = await api.post("/documents/folders", { name: "Plans d'exécution", projectId });
    const plans = folders.find((folder) => folder.name === "Plans d'exécution").id;
    folders = await api.post("/documents/folders", { name: "Lot CVC", parentId: plans });
    const cvc = folders.find((folder) => folder.name === "Lot CVC").id;
    folders = await api.post("/documents/folders", { name: "Fiches techniques", projectId });
    const sheets = folders.find((folder) => folder.name === "Fiches techniques").id;
    folders = await api.post("/documents/folders", { name: "PV & comptes rendus", projectId });
    const minutes = folders.find((folder) => folder.name === "PV & comptes rendus").id;

    // Plan CVC : indice A approuve, indice B soumis au visa.
    const planA = await api.upload(
      textPdf("Plan CVC R+1 - reseaux aerauliques - indice A", ["Reseau de soufflage et de reprise, niveau 1.", "Gaines galvanisees calorifugees 25 mm.", "Echelle 1/50."]),
      "CVC-R1-EXE-001_A.pdf",
      "application/pdf",
    );
    const plan = await api.post("/documents", { title: "Plan CVC R+1 — réseaux aérauliques", category: "PLAN", folderId: cvc, fileId: planA.id, keywords: "cvc gaines soufflage r+1" });
    await api.post(`/documents/${plan.id}/submit`);
    await direction.post(`/documents/${plan.id}/approve`, { note: "Bon pour exécution" });
    const planB = await api.upload(
      textPdf("Plan CVC R+1 - reseaux aerauliques - indice B", ["Deviation de la gaine principale axe C (reserve RES).", "Ajout de trappes de visite.", "Echelle 1/50."]),
      "CVC-R1-EXE-001_B.pdf",
      "application/pdf",
    );
    await api.post(`/documents/${plan.id}/versions`, { fileId: planB.id, changeNote: "Déviation axe C et trappes de visite" });
    await api.post(`/documents/${plan.id}/submit`);

    // Fiche technique : approuvee.
    const sheetFile = await api.upload(
      textPdf("Fiche technique - Centrale de traitement d'air CTA-01", ["Debit nominal : 12 000 m3/h.", "Recuperateur rotatif, filtres F7.", "Document fournisseur (fictif)."]),
      "FT-CTA-01.pdf",
      "application/pdf",
    );
    const sheet = await api.post("/documents", { title: "Fiche technique CTA-01", category: "TECHNICAL_SHEET", folderId: sheets, fileId: sheetFile.id, keywords: "cta centrale air" });
    await api.post(`/documents/${sheet.id}/submit`);
    await direction.post(`/documents/${sheet.id}/approve`, {});

    // PV de reunion : brouillon.
    const pvFile = await api.upload(
      textPdf("PV de reunion de chantier n. 12", ["Presents : MOA, MOE, entreprises CVC et electricite.", "Avancement lot CVC : 42 %.", "Actions : levee des reserves du niveau 1."]),
      "PV-chantier-12.pdf",
      "application/pdf",
    );
    await api.post("/documents", { title: "PV de réunion de chantier n°12", category: "MINUTES", folderId: minutes, fileId: pvFile.id });
  },
};
