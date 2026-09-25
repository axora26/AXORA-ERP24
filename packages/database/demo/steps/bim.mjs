import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createClient } from "../client.mjs";
import { DEMO_USERS } from "./admin.mjs";

const fixture = (name) => readFileSync(new URL(`../fixtures/ifc/${name}`, import.meta.url));

/**
 * BIM DEMO : maquette d'exemple buildingSMART (fichiers IFC reels, CC BY 4.0,
 * voir fixtures/ifc/README.md) importee en IFC2X3 puis IFC4, visa de la
 * direction et conflit de synthese en cours de resolution.
 */
export const bimStep = {
  name: "BIM (maquette IFC réelle, versions, conflit)",
  async isDone(api) {
    return (await api.get("/bim/models")).length > 0;
  },
  async run(api) {
    const roles = await api.get("/admin/roles");
    const direction = roles.find((role) => role.name === "Direction (lecture)");
    const needed = ["bim.model.read", "bim.model.approve"];
    if (direction && needed.some((key) => !direction.permissions.includes(key))) {
      await api.put(`/admin/roles/${direction.id}/permissions`, { permissions: [...new Set([...direction.permissions, ...needed])] });
    }
    const directionUser = DEMO_USERS.find((user) => user.role === "Direction (lecture)");
    const director = createClient(api.baseUrl);
    await director.post("/auth/login", { email: directionUser.email, password: directionUser.password });

    const projects = await api.get("/projects");
    const projectId = (projects.find((candidate) => candidate.status === "IN_PROGRESS") ?? projects[0]).id;
    const model = await api.post("/bim/models", { projectId, name: "Maquette d'exemple buildingSMART — réseau de fumisterie", discipline: "HVAC" });

    const versions = [];
    for (const name of ["Building-Hvac-IFC2X3.ifc", "Building-Hvac-IFC4.ifc"]) {
      const content = fixture(name);
      const file = await api.upload(content, name, "application/octet-stream");
      const expectedSha256 = createHash("sha256").update(content).digest("hex");
      versions.push((await api.post(`/bim/models/${model.id}/versions`, { fileId: file.id, expectedSha256 })).versionId);
    }
    await director.post(`/bim/versions/${versions[0]}/reject`, { note: "Remplacée par l'export IFC4 (ReferenceView)" });
    await director.post(`/bim/versions/${versions[1]}/approve`, { note: "Maquette de référence pour la synthèse" });

    const [clash] = await api.post(`/bim/models/${model.id}/clashes`, {
      elementAGlobalId: "38WbwIGD90nB_3T2BTU5Ed",
      elementBGlobalId: "34Y6EIt3nDCAS1k$kPGOKm",
      description: "Le conduit traverse la réservation du chapeau de cheminée : dévoiement à étudier.",
    });
    await api.post(`/bim/clashes/${clash.id}/comments`, { body: "Vérifier l'impact sur la hauteur sous plafond du niveau 00." });
    await api.post(`/bim/clashes/${clash.id}/propose`, { proposal: "Dévoyer le conduit de 15 cm vers l'est, réservation inchangée." });
  },
};
