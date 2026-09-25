import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createHarness, registerTenant, type Harness, type Tenant } from "./support/harness.js";
import { createStartedProject, createUserWith } from "./support/fixtures.js";
import { pdf, upload } from "./support/files.js";

const fixture = (name: string) => readFileSync(join(__dirname, "../../../packages/database/demo/fixtures/ifc", name));
const SHA_IFC4 = "2c17ecad2b0fbd3335420ee42ba48963b5a395294e86bcdcfc786ee559f9a344";
const SHA_IFC2X3 = "f39478ce12ae2029eed8b565551412a3a4b518d10a8b501bc5e9c2a8a6d78bdb";
const DUCT = "38WbwIGD90nB_3T2BTU5Ed";
const TERMINAL = "23uPJWDfXEcwHH3kdFgV9c";

/** INC-14 — BIM : import IFC reel verifie par empreinte, versions, liaisons MEP, conflits, connecteur Revit honnete. */
describe("BIM / IFC (e2e)", () => {
  let harness: Harness;
  let owner: Tenant;
  let other: Tenant;
  let modeler: Tenant;
  let approver: Tenant;
  let projectId = "";
  let modelId = "";
  let v1 = "";
  let v2 = "";
  let file2x3 = "";
  let file4 = "";
  let clashId = "";

  beforeAll(async () => {
    harness = await createHarness();
    owner = await registerTenant(harness, "bim-a");
    other = await registerTenant(harness, "bim-b");
    projectId = (await createStartedProject(harness, owner)).projectId;
    modeler = await createUserWith(harness, owner, ["bim.model.read", "bim.model.manage", "bim.clash.manage", "documents.file.upload"], "modeleur");
    approver = await createUserWith(harness, owner, ["bim.model.read", "bim.model.approve"], "bim-manager");
  });

  afterAll(async () => {
    await harness.close();
  });

  const bim = () => as(harness, modeler);

  it("connecteur Revit : six etats distincts, aucun presente comme connecte ou teste", async () => {
    const status = (await as(harness, approver).get("/bim/connectors/revit")).body;
    const states = ["connectorAvailable", "revitDetected", "connectionEstablished", "documentOpen", "readTested", "writeTested"].map((key) => status[key].state);
    expect(states).toEqual(["NOT_AVAILABLE", "NOT_TESTED", "NOT_TESTED", "NOT_TESTED", "NOT_TESTED", "NOT_TESTED"]);
    for (const key of ["connectorAvailable", "revitDetected", "connectionEstablished", "documentOpen", "readTested", "writeTested"]) expect(status[key].evidence.length).toBeGreaterThan(10);
    expect(status.interoperability).toMatchObject({ state: "TESTED", schemas: expect.arrayContaining(["IFC2X3", "IFC4"]) });
  });

  it("fichiers IFC reels : type detecte sur le contenu, empreinte identique a la reference", async () => {
    const uploaded2x3 = await upload(harness, modeler, fixture("Building-Hvac-IFC2X3.ifc"), "Building-Hvac-IFC2X3.ifc", "application/octet-stream");
    expect(uploaded2x3.status).toBe(201);
    expect(uploaded2x3.body).toMatchObject({ mimeType: "application/x-step", sha256: SHA_IFC2X3 });
    file2x3 = uploaded2x3.body.id;
    const uploaded4 = await upload(harness, modeler, fixture("Building-Hvac-IFC4.ifc"), "Building-Hvac-IFC4.ifc");
    expect(uploaded4.body.sha256).toBe(SHA_IFC4);
    file4 = uploaded4.body.id;
  });

  it("import : empreinte annoncee verifiee, fichier non IFC ou invalide refuse, contenu importe", async () => {
    const model = await bim().post("/bim/models", { projectId, name: "Maquette CVC", discipline: "HVAC" });
    expect(model.status).toBe(201);
    modelId = model.body.id;
    expect(model.body.code).toMatch(/^BIM-\d{4}-\d{4}$/);

    expect((await bim().post(`/bim/models/${modelId}/versions`, { fileId: file2x3, expectedSha256: SHA_IFC4 })).status).toBe(409);
    const notIfc = await upload(harness, modeler, pdf(`plan-${Date.now()}`), "plan.pdf");
    expect((await bim().post(`/bim/models/${modelId}/versions`, { fileId: notIfc.body.id })).status).toBe(400);
    const broken = await upload(harness, modeler, Buffer.from(`ISO-10303-21;\nHEADER;ENDSEC;\nDATA;\n#1=IFCWALL('x';\nENDSEC;\n${Date.now()}`), "casse.ifc");
    expect(broken.body.mimeType).toBe("application/x-step");
    expect((await bim().post(`/bim/models/${modelId}/versions`, { fileId: broken.body.id })).status).toBe(400);

    const imported = await bim().post(`/bim/models/${modelId}/versions`, { fileId: file2x3, expectedSha256: SHA_IFC2X3 });
    expect(imported.status).toBe(201);
    v1 = imported.body.versionId;
    expect(imported.body.model.latestVersion).toMatchObject({ versionNumber: 1, schema: "IFC2X3", sha256: SHA_IFC2X3, entityCount: 1625, elementCount: 6, status: "IMPORTED" });
    expect(imported.body.model.latestVersion.summary.spatial.map((node: { ifcType: string }) => node.ifcType)).toContain("IFCBUILDINGSTOREY");
    expect((await bim().post(`/bim/models/${modelId}/versions`, { fileId: file2x3 })).status).toBe(409);

    const second = await bim().post(`/bim/models/${modelId}/versions`, { fileId: file4, expectedSha256: SHA_IFC4 });
    v2 = second.body.versionId;
    expect(second.body.model.latestVersion).toMatchObject({ versionNumber: 2, schema: "IFC4", elementCount: 6 });
  });

  it("comparaison de versions par GlobalId et reverification d'empreinte", async () => {
    const diff = (await bim().get(`/bim/versions/${v2}/diff?against=${v1}`)).body;
    expect(diff).toMatchObject({ fromVersion: 1, toVersion: 2 });
    // Memes GlobalId dans les deux schemas : 4 elements changent de classe (IFCFLOWSEGMENT -> IFCDUCTSEGMENT...), 2 inchanges.
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toHaveLength(4);
    expect(diff.unchanged).toBe(2);
    expect(diff.changed.find((element: { globalId: string }) => element.globalId === DUCT).fields).toEqual(["ifcType"]);

    const verify = (await as(harness, approver).get(`/bim/versions/${v2}/verify`)).body;
    expect(verify).toMatchObject({ verified: true, sha256: SHA_IFC4, recomputed: SHA_IFC4 });
  });

  it("elements : filtres par classe IFC, niveau, systeme de distribution", async () => {
    const ducts = (await bim().get(`/bim/versions/${v2}/elements?ifcType=ifcductsegment`)).body;
    expect(ducts).toEqual([expect.objectContaining({ globalId: DUCT, storeyName: "00 groundfloor", systems: ["house - chimney flue"], equipment: null })]);
    expect((await bim().get(`/bim/versions/${v2}/elements?q=chimney`)).body.length).toBeGreaterThanOrEqual(2);
  });

  it("visa : par une autre personne que l'importateur ; contenu importe immuable en base", async () => {
    expect((await as(harness, modeler).post(`/bim/versions/${v2}/approve`)).status).toBe(403);
    expect((await as(harness, approver).post(`/bim/versions/${v1}/reject`, {})).status).toBe(400);
    await as(harness, approver).post(`/bim/versions/${v1}/reject`, { note: "Schéma IFC2X3 remplacé par IFC4" });
    const approved = await as(harness, approver).post(`/bim/versions/${v2}/approve`, { note: "Maquette de référence" });
    expect(approved.body).toMatchObject({ approvedVersionNumber: 2 });
    expect(approved.body.versions.map((version: { status: string }) => version.status)).toEqual(["APPROVED", "REJECTED"]);

    await expect(harness.prisma.bimModelVersion.update({ where: { id: v2 }, data: { sha256: "0".repeat(64) } })).rejects.toThrow(/immutable/);
    await expect(harness.prisma.bimModelVersion.delete({ where: { id: v1 } })).rejects.toThrow(/never deleted/);
    const element = await harness.prisma.bimElement.findFirstOrThrow({ where: { versionId: v2, globalId: DUCT } });
    await expect(harness.prisma.bimElement.update({ where: { id: element.id }, data: { name: "x" } })).rejects.toThrow(/append-only/);
  });

  it("liaison equipement MEP <-> element BIM sans duplication d'identite", async () => {
    const systems = await as(harness, owner).post("/mep/systems", { projectId, code: "CVC-01", name: "Fumisterie", discipline: "HVAC" });
    const equipment = await as(harness, owner).post("/mep/equipment", { systemId: systems.body[0].id, tag: "CONDUIT-01", name: "Conduit de fumée" });
    expect((await bim().post(`/bim/models/${modelId}/bindings`, { equipmentId: equipment.body.id, globalId: "0000000000000000000000" })).status).toBe(404);
    const bound = await bim().post(`/bim/models/${modelId}/bindings`, { equipmentId: equipment.body.id, globalId: DUCT });
    expect(bound.status).toBe(201);
    expect(bound.body.find((element: { globalId: string }) => element.globalId === DUCT).equipment).toMatchObject({ tag: "CONDUIT-01" });
    const passport = (await as(harness, owner).get(`/bim/equipment/${equipment.body.id}/bindings`)).body;
    expect(passport).toEqual([expect.objectContaining({ globalId: DUCT, presentInLatestVersion: true, ifcType: "IFCDUCTSEGMENT", versionNumber: 2 })]);
    const second = await as(harness, owner).post("/mep/equipment", { systemId: systems.body[0].id, tag: "CONDUIT-02", name: "Autre" });
    expect((await bim().post(`/bim/models/${modelId}/bindings`, { equipmentId: second.body.id, globalId: DUCT })).status).toBe(409);
  });

  it("conflits de synthese : deux elements reels, discussion, resolution approuvee par un tiers", async () => {
    expect((await bim().post(`/bim/models/${modelId}/clashes`, { elementAGlobalId: DUCT, elementBGlobalId: DUCT, description: "x" })).status).toBe(400);
    expect((await bim().post(`/bim/models/${modelId}/clashes`, { elementAGlobalId: DUCT, elementBGlobalId: "0000000000000000000000", description: "x" })).status).toBe(404);
    let clashes = await bim().post(`/bim/models/${modelId}/clashes`, { elementAGlobalId: DUCT, elementBGlobalId: TERMINAL, description: "Conduit traversant la réservation de la bouche" });
    expect(clashes.status).toBe(201);
    clashId = clashes.body[0].id;
    expect(clashes.body[0]).toMatchObject({ status: "OPEN", versionNumber: 2, elementA: { ifcType: "IFCDUCTSEGMENT" }, elementB: { ifcType: "IFCAIRTERMINAL" } });
    await bim().post(`/bim/clashes/${clashId}/comments`, { body: "Réservation à décaler de 20 cm côté est." });
    await bim().post(`/bim/clashes/${clashId}/propose`, { proposal: "Décaler la bouche de 20 cm" });
    expect((await as(harness, approver).post(`/bim/clashes/${clashId}/refuse`, {})).status).toBe(400);
    clashes = await as(harness, approver).post(`/bim/clashes/${clashId}/refuse`, { note: "Impact structure non vérifié" });
    expect(clashes.body[0]).toMatchObject({ status: "OPEN", proposal: null });
    expect(clashes.body[0].comments).toHaveLength(2);
    await bim().post(`/bim/clashes/${clashId}/propose`, { proposal: "Dévoyer le conduit de 15 cm, réservation inchangée" });
    const resolved = await as(harness, approver).post(`/bim/clashes/${clashId}/resolve`, { note: "Validé en réunion de synthèse" });
    expect(resolved.body[0]).toMatchObject({ status: "RESOLVED", resolutionNote: "Validé en réunion de synthèse" });
    await expect(
      harness.prisma.bimClash.update({ where: { id: clashId }, data: { resolvedByUserId: modeler.userId } }),
    ).rejects.toThrow(/bim_clash_resolved_by_third_party/);
  });

  it("isolation et audit", async () => {
    expect((await as(harness, other).get(`/bim/models/${modelId}`)).status).toBe(404);
    expect((await as(harness, other).get(`/bim/versions/${v2}/verify`)).status).toBe(404);
    expect((await as(harness, other).get(`/bim/versions/${v2}/elements`)).status).toBe(404);
    expect((await as(harness, other).post(`/bim/models/${modelId}/versions`, { fileId: file4 })).status).toBe(404);
    const audit = await harness.prisma.auditLog.findMany({ where: { organizationId: owner.organizationId, action: { startsWith: "bim." } } });
    const actions = new Set(audit.map((entry) => entry.action));
    for (const action of ["bim.model.created", "bim.version.imported", "bim.version.approved", "bim.equipment.bound", "bim.clash.created", "bim.clash.resolved"]) expect(actions.has(action)).toBe(true);
    expect(JSON.stringify(audit.find((entry) => entry.action === "bim.version.imported")?.metadata)).toContain(SHA_IFC2X3);
  });
});
