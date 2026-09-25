import { randomUUID } from "node:crypto";
import { createClient } from "../client.mjs";
import { DEMO_USERS } from "./admin.mjs";
import { scenePng } from "../media.mjs";

const DAY_MS = 86_400_000;
const id = (prefix) => `${prefix}-${randomUUID()}`;

async function sync(client, operations) {
  const { results } = await client.post("/field/sync", { operations });
  const failed = results.filter((result) => result.status !== "APPLIED" && result.status !== "DUPLICATE");
  if (failed.length > 0) throw new Error(`Synchronisation DEMO refusee : ${JSON.stringify(failed)}`);
  return results;
}

/**
 * Chantier DEMO : zones, reserves avec photos, une correction a verifier,
 * une reserve levee par un tiers, journal d'hier signe et journal du jour.
 * Tout passe par /field/sync, comme la saisie terrain (hors ligne ou non).
 */
export const fieldStep = {
  name: "Chantier (zones, réserves, photos, journal)",
  async isDone(api) {
    const issues = await api.get("/field/issues");
    return issues.length > 0;
  },
  async run(api) {
    const directionUser = DEMO_USERS.find((user) => user.role === "Direction (lecture)");
    const direction = createClient(api.baseUrl);
    await direction.post("/auth/login", { email: directionUser.email, password: directionUser.password });

    const projects = await api.get("/projects");
    const project = projects.find((candidate) => candidate.status === "IN_PROGRESS") ?? projects[0];
    const projectId = project.id;
    const detail = await api.get(`/projects/${projectId}`);
    const task = detail.tasks[0];

    let zones = await api.post("/field/zones", { projectId, code: "RDC", name: "Rez-de-chaussée — hall et locaux techniques" });
    zones = await api.post("/field/zones", { projectId, code: "N1", name: "Niveau 1 — plateau bureaux" });
    zones = await api.post("/field/zones", { projectId, code: "TT", name: "Toiture technique" });
    const zone = (code) => zones.find((candidate) => candidate.code === code).id;

    const photo = async (scene, name, seed) => (await api.upload(scenePng(scene, seed), name, "image/png")).id;
    const now = Date.now();
    const at = (daysAgo, hour) => new Date(Math.floor((now - daysAgo * DAY_MS) / DAY_MS) * DAY_MS + hour * 3_600_000).toISOString();
    const iso = (days) => new Date(now + days * DAY_MS).toISOString().slice(0, 10);

    // Reserve 1 : gaine non calorifugee, correction declaree, en attente de verification.
    const duct = id("issue");
    await sync(api, [
      {
        clientId: duct,
        type: "issue.create",
        payload: {
          projectId,
          title: "Gaine de soufflage non calorifugée",
          description: "Tronçon d'environ 3 m sans isolant entre les axes B et C, risque de condensation.",
          category: "QUALITY",
          severity: "HIGH",
          zoneId: zone("N1"),
          taskId: task?.id,
          assigneeName: "Entreprise ThermoClim (lot CVC)",
          dueDate: iso(-2),
        },
      },
      { clientId: id("ev"), type: "evidence.create", payload: { projectId, kind: "PHOTO", fileId: await photo("duct", "IMG_2041.png", 1), issueClientId: duct, takenAt: at(6, 9), note: "Constat axe B-C", latitude: "-4.322450", longitude: "15.307120" } },
    ]);
    const ductIssue = (await api.get("/field/issues")).find((issue) => issue.title.startsWith("Gaine"));
    await sync(api, [
      { clientId: id("ev"), type: "evidence.create", payload: { projectId, kind: "CORRECTION", fileId: await photo("ductFixed", "IMG_2107.png", 2), issueId: ductIssue.id, takenAt: at(1, 15), note: "Calorifuge 25 mm posé" } },
      { clientId: id("op"), type: "issue.submitCorrection", baseVersion: ductIssue.version, payload: { issueId: ductIssue.id, note: "Calorifuge posé sur tout le tronçon, jonctions adhésivées." } },
    ]);

    // Reserve 2 : trappe manquante, ouverte.
    const hatch = id("issue");
    await sync(api, [
      {
        clientId: hatch,
        type: "issue.create",
        payload: {
          projectId,
          title: "Trappe de visite absente — faux plafond local CTA",
          description: "Accès aux registres coupe-feu impossible sans trappe 60x60.",
          category: "QUALITY",
          severity: "MEDIUM",
          zoneId: zone("RDC"),
          assigneeName: "Plâtrerie Kinoise (lot faux plafonds)",
          dueDate: iso(9),
        },
      },
      { clientId: id("ev"), type: "evidence.create", payload: { projectId, kind: "PHOTO", fileId: await photo("ceiling", "IMG_2088.png", 3), issueClientId: hatch, takenAt: at(3, 11) } },
    ]);

    // Reserve 3 : securite, corrigee puis levee par la direction.
    const guard = id("issue");
    await sync(api, [
      {
        clientId: guard,
        type: "issue.create",
        payload: {
          projectId,
          title: "Garde-corps provisoire absent en rive de toiture",
          description: "Risque de chute de hauteur côté nord, zone d'implantation des groupes froids.",
          category: "SAFETY",
          severity: "CRITICAL",
          zoneId: zone("TT"),
          assigneeName: "Gros œuvre — chef d'équipe",
          dueDate: iso(-5),
        },
      },
      { clientId: id("ev"), type: "evidence.create", payload: { projectId, kind: "PHOTO", fileId: await photo("roof", "IMG_1990.png", 4), issueClientId: guard, takenAt: at(8, 8) } },
    ]);
    const guardIssue = (await api.get("/field/issues")).find((issue) => issue.title.startsWith("Garde-corps"));
    await sync(api, [
      { clientId: id("ev"), type: "evidence.create", payload: { projectId, kind: "CORRECTION", fileId: await photo("roofFixed", "IMG_2002.png", 5), issueId: guardIssue.id, takenAt: at(7, 16) } },
      { clientId: id("op"), type: "issue.submitCorrection", baseVersion: guardIssue.version, payload: { issueId: guardIssue.id, note: "Garde-corps provisoires posés sur 24 m." } },
    ]);
    await direction.post(`/field/issues/${guardIssue.id}/close`, { version: guardIssue.version + 1, note: "Contrôlé sur place, conforme." });

    // Journal d'hier, signe par la direction ; journal du jour en brouillon.
    const yesterday = new Date(now - DAY_MS).toISOString().slice(0, 10);
    const [created] = await sync(api, [
      {
        clientId: id("log"),
        type: "log.save",
        payload: {
          projectId,
          logDate: yesterday,
          weather: "Nuageux, averse en fin de journée",
          temperature: "26 °C",
          workforceCount: 3,
          summary: "Calorifugeage des gaines N1 axes A-C.\nPose des supports de chemins de câbles RDC.\nRéception d'un lot de cuivre.",
          safetyNotes: "Rappel port du harnais en toiture (1/4 h sécurité).",
        },
      },
    ]);
    await sync(api, [{ clientId: id("ev"), type: "evidence.create", payload: { projectId, kind: "PHOTO", fileId: await photo("site", "IMG_2110.png", 6), dailyLogId: created.entityId, takenAt: at(1, 17), note: "Vue générale plateau N1" } }]);
    await direction.post(`/field/logs/${created.entityId}/sign`, { version: 1 });

    const today = new Date(now).toISOString().slice(0, 10);
    await sync(api, [
      {
        clientId: id("log"),
        type: "log.save",
        payload: { projectId, logDate: today, weather: "Ensoleillé", temperature: "29 °C", workforceCount: 4, summary: "Raccordement CTA-01 (réseau soufflage).\nTirage de câbles CFO niveau 1." },
      },
    ]);
    if (task) {
      await sync(api, [{ clientId: id("ev"), type: "evidence.create", payload: { projectId, kind: "OBSERVATION", taskId: task.id, takenAt: new Date(now - 3_600_000).toISOString(), note: "Supports de gaines posés à 1,20 m d'entraxe, conforme au plan indice A." } }]);
    }
  },
};
