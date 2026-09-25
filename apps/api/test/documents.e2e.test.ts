import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createHarness, registerTenant, type Harness, type Tenant } from "./support/harness.js";
import { createStartedProject, createUserWith } from "./support/fixtures.js";
import { jpeg, pdf, upload } from "./support/files.js";

/** INC-10 — GED : fichiers immuables par empreinte, versions immuables, approbation par un tiers. */
describe("GED (e2e)", () => {
  let harness: Harness;
  let owner: Tenant;
  let other: Tenant;
  let approver: Tenant;
  let fieldReader: Tenant;
  let projectId = "";
  let folderId = "";
  let documentId = "";
  let fileA = "";
  let fileB = "";
  const seed = `${Date.now()}-${Math.random()}`;

  beforeAll(async () => {
    harness = await createHarness();
    owner = await registerTenant(harness, "ged-a");
    other = await registerTenant(harness, "ged-b");
    projectId = (await createStartedProject(harness, owner)).projectId;
    approver = await createUserWith(harness, owner, ["documents.document.read", "documents.document.approve"], "visa");
    fieldReader = await createUserWith(harness, owner, ["field.site.read"], "lecteur-chantier");
  });

  afterAll(async () => {
    await harness.close();
  });

  const api = () => as(harness, owner);

  it("fichiers : type detecte par le contenu, televersement idempotent, types non autorises refuses", async () => {
    const first = await upload(harness, owner, pdf(`plan-${seed}`), "Plan RDC.pdf", "text/html");
    expect(first.status).toBe(201);
    expect(first.body.mimeType).toBe("application/pdf");
    expect(first.body.sha256).toMatch(/^[0-9a-f]{64}$/);
    fileA = first.body.id;
    const again = await upload(harness, owner, pdf(`plan-${seed}`), "copie.pdf");
    expect(again.body.id).toBe(fileA);

    expect((await upload(harness, owner, Buffer.from("<html><script>alert(1)</script></html>"), "page.pdf", "application/pdf")).status).toBe(415);
    expect((await upload(harness, owner, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), "logo.svg", "image/svg+xml")).status).toBe(415);
    expect((await harness.http().post("/api/v1/files").set("Cookie", owner.cookie)).status).toBe(400);
    expect((await upload(harness, approver, pdf("x"), "x.pdf")).status).toBe(403);

    const second = await upload(harness, owner, pdf(`plan-rev-${seed}`), "Plan RDC indB.pdf");
    fileB = second.body.id;
  });

  it("contenu : servi avec son type reel, nosniff, et invisible depuis un autre tenant", async () => {
    const content = await harness.http().get(`/api/v1/files/${fileA}/content`).set("Cookie", owner.cookie).buffer(true);
    expect(content.status).toBe(200);
    expect(content.headers["content-type"]).toBe("application/pdf");
    expect(content.headers["x-content-type-options"]).toBe("nosniff");
    expect(content.headers["content-disposition"]).toContain("inline");
    expect(Buffer.from(content.body).toString("latin1")).toContain(`plan-${seed}`);
    // Lecture transverse : une permission chantier suffit a lire un fichier (l'une des permissions requises).
    expect((await harness.http().get(`/api/v1/files/${fileA}/content`).set("Cookie", fieldReader.cookie)).status).toBe(200);
    expect((await harness.http().get(`/api/v1/files/${fileA}/content`).set("Cookie", other.cookie)).status).toBe(404);
    expect((await as(harness, other).get(`/files/${fileA}`)).status).toBe(404);
  });

  it("arborescence projet et creation d'un document : revision A en brouillon", async () => {
    const folders = await api().post("/documents/folders", { name: "Plans d'exécution", projectId });
    expect(folders.status).toBe(201);
    folderId = folders.body.find((folder: { name: string }) => folder.name === "Plans d'exécution").id;
    expect((await api().post("/documents/folders", { name: "plans d'EXÉCUTION", projectId })).status).toBe(409);
    const sub = await api().post("/documents/folders", { name: "Lot CVC", parentId: folderId });
    expect(sub.body.find((folder: { name: string }) => folder.name === "Lot CVC").projectId).toBe(projectId);

    expect((await as(harness, other).post("/documents", { title: "Vol", category: "PLAN", fileId: fileA })).status).toBe(404);
    const created = await api().post("/documents", { title: "Plan RDC — CVC", category: "PLAN", folderId, fileId: fileA, keywords: "rdc cvc gaines" });
    expect(created.status).toBe(201);
    documentId = created.body.id;
    expect(created.body.code).toMatch(/^DOC-\d{4}-\d{4}$/);
    expect(created.body.projectId).toBe(projectId);
    expect(created.body).toMatchObject({ status: "DRAFT", currentRevision: "A", approvedRevision: null });
    expect(created.body.versions).toHaveLength(1);
    expect(created.body.versions[0].file.url).toBe(`/api/v1/files/${fileA}/content`);
  });

  it("revisions : jamais de reecriture, contenu identique refuse, brouillon remplace", async () => {
    expect((await api().post(`/documents/${documentId}/versions`, { fileId: fileA, changeNote: "Identique" })).status).toBe(400);
    const revised = await api().post(`/documents/${documentId}/versions`, { fileId: fileB, changeNote: "Ajout des gaines" });
    expect(revised.status).toBe(201);
    expect(revised.body.currentRevision).toBe("B");
    expect(revised.body.versions.map((version: { revision: string; status: string }) => `${version.revision}:${version.status}`)).toEqual(["B:DRAFT", "A:SUPERSEDED"]);
  });

  it("approbation par un tiers : l'auteur ne vise pas sa propre revision", async () => {
    const submitted = await api().post(`/documents/${documentId}/submit`);
    expect(submitted.body.status).toBe("SUBMITTED");
    expect((await api().post(`/documents/${documentId}/versions`, { fileId: fileA, changeNote: "Pendant visa" })).status).toBe(400);
    expect((await api().post(`/documents/${documentId}/approve`)).status).toBe(403);
    const approved = await as(harness, approver).post(`/documents/${documentId}/approve`, { note: "Bon pour exécution" });
    expect(approved.status).toBe(201);
    expect(approved.body).toMatchObject({ status: "APPROVED", approvedRevision: "B" });

    const photo = await upload(harness, owner, jpeg(`rev-c-${seed}`), "annotation.jpg");
    await api().post(`/documents/${documentId}/versions`, { fileId: photo.body.id, changeNote: "Indice C" });
    await api().post(`/documents/${documentId}/submit`);
    expect((await as(harness, approver).post(`/documents/${documentId}/reject`, {})).status).toBe(400);
    const rejected = await as(harness, approver).post(`/documents/${documentId}/reject`, { note: "Cotes manquantes" });
    expect(rejected.body.status).toBe("REJECTED");
    // La revision approuvee applicable reste B.
    expect(rejected.body.approvedRevision).toBe("B");
    expect(rejected.body.versions.map((version: { status: string }) => version.status)).toEqual(["REJECTED", "APPROVED", "SUPERSEDED"]);
  });

  it("garanties en base : contenu d'une version et fichier immuables", async () => {
    const version = await harness.prisma.documentVersion.findFirstOrThrow({ where: { documentId, versionNumber: 1 } });
    await expect(harness.prisma.documentVersion.update({ where: { id: version.id }, data: { fileId: fileB } })).rejects.toThrow(/immutable/);
    await expect(harness.prisma.documentVersion.delete({ where: { id: version.id } })).rejects.toThrow(/immutable/);
    await expect(harness.prisma.storedFile.update({ where: { id: fileA }, data: { originalName: "x.pdf" } })).rejects.toThrow(/append-only/);
    await expect(harness.prisma.storedFile.delete({ where: { id: fileA } })).rejects.toThrow();
  });

  it("recherche, filtres, RBAC et archivage", async () => {
    const byTitle = await api().get("/documents?q=cvc");
    expect(byTitle.body.map((document: { id: string }) => document.id)).toContain(documentId);
    const byFileName = await api().get(`/documents?q=${encodeURIComponent("indB")}`);
    expect(byFileName.body.map((document: { id: string }) => document.id)).toContain(documentId);
    expect((await api().get("/documents?status=APPROVED")).body.some((document: { id: string }) => document.id === documentId)).toBe(false);
    expect((await api().get(`/documents?folderId=${folderId}`)).body).toHaveLength(1);
    expect((await as(harness, other).get("/documents")).body).toHaveLength(0);
    expect((await as(harness, fieldReader).get("/documents")).status).toBe(403);

    expect((await as(harness, approver).post(`/documents/${documentId}/archive`, {})).status).toBe(400);
    const archived = await as(harness, approver).post(`/documents/${documentId}/archive`, { reason: "Remplacé par le lot 2" });
    expect(archived.body.status).toBe("ARCHIVED");
    expect((await api().post(`/documents/${documentId}/versions`, { fileId: fileA, changeNote: "Après archive" })).status).toBe(400);

    const audit = await harness.prisma.auditLog.findMany({ where: { organizationId: owner.organizationId, action: { startsWith: "documents." } } });
    const actions = new Set(audit.map((entry) => entry.action));
    for (const action of ["documents.file.uploaded", "documents.document.created", "documents.version.approved", "documents.version.rejected", "documents.document.archived"]) {
      expect(actions.has(action)).toBe(true);
    }
  });
});
