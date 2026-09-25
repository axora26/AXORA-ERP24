import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createHarness, registerTenant, type Harness, type Tenant } from "./support/harness.js";
import { createStartedProject, createUserWith } from "./support/fixtures.js";
import { jpeg, pdf, upload } from "./support/files.js";

/**
 * INC-10 — Chantier : Tache -> Photo -> Controle -> Reserve -> Correction ->
 * Fermeture (backlog §5.7), et synchronisation hors ligne : creation hors
 * ligne -> reprise reseau -> rejeu idempotent -> conflit resolu explicitement.
 */
describe("Chantier (e2e)", () => {
  let harness: Harness;
  let owner: Tenant;
  let other: Tenant;
  let worker: Tenant;
  let conductor: Tenant;
  let projectId = "";
  let taskId = "";
  let zoneId = "";
  let photoId = "";
  const issueClientId = `issue-${randomUUID()}`;
  let issueId = "";
  let logId = "";
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString();

  beforeAll(async () => {
    harness = await createHarness();
    owner = await registerTenant(harness, "field-a");
    other = await registerTenant(harness, "field-b");
    const project = await createStartedProject(harness, owner);
    projectId = project.projectId;
    const withTask = await as(harness, owner).post(`/projects/${projectId}/tasks`, { wbsItemId: project.leafId, name: "Pose des gaines niveau 1" });
    taskId = withTask.body.tasks.find((task: { name: string }) => task.name === "Pose des gaines niveau 1").id;
    worker = await createUserWith(
      harness,
      owner,
      ["field.site.read", "field.evidence.create", "field.issue.manage", "field.log.manage"],
      "compagnon",
    );
    conductor = await createUserWith(harness, owner, ["field.site.read", "field.issue.close", "field.log.sign"], "conducteur");
  });

  afterAll(async () => {
    await harness.close();
  });

  const sync = (tenant: Tenant, operations: unknown[]) => as(harness, tenant).post("/field/sync", { operations });

  it("zones de chantier : code unique par projet, RBAC", async () => {
    const zones = await as(harness, worker).post("/field/zones", { projectId, code: "n1", name: "Niveau 1 — plateau bureaux" });
    expect(zones.status).toBe(201);
    zoneId = zones.body.find((zone: { code: string }) => zone.code === "N1").id;
    expect((await as(harness, worker).post("/field/zones", { projectId, code: "N1", name: "Doublon" })).status).toBe(409);
    expect((await as(harness, conductor).post("/field/zones", { projectId, code: "N2", name: "Interdit" })).status).toBe(403);
  });

  it("hors ligne : un lot cree sur l'appareil est applique, chaque operation invalide est rejetee sans bloquer les autres", async () => {
    const photo = await upload(harness, worker, jpeg(`gaine-${randomUUID()}`), "IMG_0042.jpg", "image/jpeg");
    expect(photo.status).toBe(201);
    photoId = photo.body.id;
    const batch = [
      {
        clientId: issueClientId,
        type: "issue.create",
        payload: {
          projectId,
          title: "Gaine non calorifugée",
          description: "Tronçon de 3 m sans isolant entre les axes B et C.",
          category: "QUALITY",
          severity: "HIGH",
          zoneId,
          taskId,
          assigneeName: "Entreprise ThermoClim (sous-traitant CVC)",
          dueDate: "2026-01-15",
        },
      },
      { clientId: `ev-${randomUUID()}`, type: "evidence.create", payload: { projectId, kind: "PHOTO", fileId: photoId, issueClientId, takenAt: yesterday, latitude: "-4.325000", longitude: "15.322200" } },
      { clientId: `ev-${randomUUID()}`, type: "evidence.create", payload: { projectId, kind: "OBSERVATION", note: "Supports posés à 1,20 m d'entraxe.", taskId, takenAt: yesterday } },
      { clientId: `ev-${randomUUID()}`, type: "evidence.create", payload: { projectId, kind: "OBSERVATION", note: "Photo flottante", takenAt: yesterday } },
      { clientId: `op-${randomUUID()}`, type: "issue.delete", payload: {} },
      { clientId: "short", type: "issue.create", payload: {} },
    ];
    const first = await sync(worker, batch);
    expect(first.status).toBe(201);
    expect(first.body.results.map((result: { status: string }) => result.status)).toEqual(["APPLIED", "APPLIED", "APPLIED", "REJECTED", "REJECTED", "REJECTED"]);
    expect(first.body.results[3].message).toContain("rattachée");
    issueId = first.body.results[0].entityId;

    // Reprise reseau instable : le meme lot est renvoye. Aucun doublon.
    const replay = await sync(worker, batch);
    expect(replay.body.results.slice(0, 3).map((result: { status: string }) => result.status)).toEqual(["DUPLICATE", "DUPLICATE", "DUPLICATE"]);
    expect(replay.body.results[0].entityId).toBe(issueId);
    expect(await harness.prisma.siteIssue.count({ where: { companyId: owner.companyId, clientId: issueClientId } })).toBe(1);
    expect(await harness.prisma.siteEvidence.count({ where: { projectId } })).toBe(2);

    const issue = await as(harness, worker).get(`/field/issues/${issueId}`);
    expect(issue.body).toMatchObject({ status: "OPEN", version: 1, zoneName: "Niveau 1 — plateau bureaux", taskName: "Pose des gaines niveau 1", overdue: true });
    expect(issue.body.code).toMatch(/^RES-\d{4}-\d{4}$/);
    expect(issue.body.evidence[0]).toMatchObject({ kind: "PHOTO", latitude: "-4.325000", issueCode: issue.body.code });
    expect(issue.body.evidence[0].file.mimeType).toBe("image/jpeg");
    expect(issue.body.evidence[0].takenAt).toBe(yesterday);
  });

  it("preuves : photo obligatoire et reellement une image, permissions verifiees operation par operation", async () => {
    const document = await upload(harness, worker, pdf(`pv-${randomUUID()}`), "pv.pdf");
    const results = (
      await sync(worker, [
        { clientId: `ev-${randomUUID()}`, type: "evidence.create", payload: { projectId, kind: "PHOTO", issueId, takenAt: yesterday } },
        { clientId: `ev-${randomUUID()}`, type: "evidence.create", payload: { projectId, kind: "PHOTO", fileId: document.body.id, issueId, takenAt: yesterday } },
        { clientId: `ev-${randomUUID()}`, type: "evidence.create", payload: { projectId, kind: "PHOTO", fileId: photoId, issueId, takenAt: "2099-01-01T00:00:00Z" } },
      ])
    ).body.results;
    expect(results.map((result: { status: string }) => result.status)).toEqual(["REJECTED", "REJECTED", "REJECTED"]);
    expect(results[1].message).toContain("doit être une photo");

    const denied = await sync(conductor, [{ clientId: `op-${randomUUID()}`, type: "issue.create", payload: { projectId } }]);
    expect(denied.body.results[0]).toMatchObject({ status: "REJECTED", message: "Permission manquante : field.issue.manage" });
  });

  it("garanties en base : preuves append-only et toujours rattachees a un contexte", async () => {
    const evidence = await harness.prisma.siteEvidence.findFirstOrThrow({ where: { issueId } });
    await expect(harness.prisma.siteEvidence.update({ where: { id: evidence.id }, data: { note: "Retouche" } })).rejects.toThrow(/append-only/);
    await expect(harness.prisma.siteEvidence.delete({ where: { id: evidence.id } })).rejects.toThrow(/append-only/);
    await expect(
      harness.prisma.siteEvidence.create({
        data: { organizationId: owner.organizationId, companyId: owner.companyId, projectId, kind: "OBSERVATION", note: "Sans contexte", takenAt: new Date(), createdByUserId: owner.userId },
      }),
    ).rejects.toThrow(/site_evidence_has_context/);
  });

  it("correction : preuve photo exigee, puis conflit explicite pour un appareil reste sur une version perimee", async () => {
    const noProof = await sync(worker, [{ clientId: `op-${randomUUID()}`, type: "issue.submitCorrection", baseVersion: 1, payload: { issueId, note: "Isolant posé" } }]);
    expect(noProof.body.results[0].status).toBe("REJECTED");
    expect(noProof.body.results[0].message).toContain("photo de correction");

    const fix = await upload(harness, worker, jpeg(`fix-${randomUUID()}`), "correction.jpg");
    const deviceA = await sync(worker, [
      { clientId: `ev-${randomUUID()}`, type: "evidence.create", payload: { projectId, kind: "CORRECTION", fileId: fix.body.id, issueId, takenAt: new Date().toISOString(), note: "Calorifuge posé" } },
      { clientId: `op-${randomUUID()}`, type: "issue.submitCorrection", baseVersion: 1, payload: { issueId, note: "Isolant posé sur les 3 m" } },
    ]);
    expect(deviceA.body.results.map((result: { status: string }) => result.status)).toEqual(["APPLIED", "APPLIED"]);

    // Second appareil, hors ligne depuis la version 1 : son envoi ne doit rien ecraser.
    const deviceB = await sync(owner, [{ clientId: `op-${randomUUID()}`, type: "issue.submitCorrection", baseVersion: 1, payload: { issueId, note: "Autre saisie" } }]);
    expect(deviceB.body.results[0].status).toBe("CONFLICT");
    expect(deviceB.body.results[0].server).toMatchObject({ id: issueId, status: "CORRECTION_SUBMITTED", version: 2, correctionNote: "Isolant posé sur les 3 m" });
  });

  it("verification par un tiers : refus -> nouvelle preuve exigee -> fermeture", async () => {
    expect((await as(harness, worker).post(`/field/issues/${issueId}/close`)).status).toBe(403);
    expect((await as(harness, conductor).post(`/field/issues/${issueId}/reopen`, {})).status).toBe(400);
    const reopened = await as(harness, conductor).post(`/field/issues/${issueId}/reopen`, { note: "Jonction non traitée" });
    expect(reopened.body).toMatchObject({ status: "OPEN", version: 3 });

    // L'ancienne photo de correction ne suffit plus : une preuve posterieure au refus est exigee.
    const stale = await sync(worker, [{ clientId: `op-${randomUUID()}`, type: "issue.submitCorrection", baseVersion: 3, payload: { issueId, note: "Repris" } }]);
    expect(stale.body.results[0].status).toBe("REJECTED");
    const again = await upload(harness, worker, jpeg(`fix2-${randomUUID()}`), "correction-2.jpg");
    const resubmitted = await sync(worker, [
      { clientId: `ev-${randomUUID()}`, type: "evidence.create", payload: { projectId, kind: "CORRECTION", fileId: again.body.id, issueId, takenAt: new Date().toISOString() } },
      { clientId: `op-${randomUUID()}`, type: "issue.submitCorrection", baseVersion: 3, payload: { issueId, note: "Jonction reprise" } },
    ]);
    expect(resubmitted.body.results.map((result: { status: string }) => result.status)).toEqual(["APPLIED", "APPLIED"]);

    expect((await as(harness, conductor).post(`/field/issues/${issueId}/close`, { version: 3 })).status).toBe(409);
    const closed = await as(harness, conductor).post(`/field/issues/${issueId}/close`, { version: 4, note: "Contrôle visuel conforme" });
    expect(closed.status).toBe(201);
    expect(closed.body).toMatchObject({ status: "CLOSED", overdue: false, closureNote: "Contrôle visuel conforme" });
    expect(closed.body.evidence.filter((evidence: { kind: string }) => evidence.kind === "CORRECTION")).toHaveLength(2);

    const late = await sync(worker, [{ clientId: `ev-${randomUUID()}`, type: "evidence.create", payload: { projectId, kind: "OBSERVATION", note: "Après coup", issueId, takenAt: new Date().toISOString() } }]);
    expect(late.body.results[0].status).toBe("REJECTED");
  });

  it("separation des devoirs : celui qui declare la correction ne la valide pas (garantie aussi en base)", async () => {
    const created = await sync(owner, [
      { clientId: `issue-${randomUUID()}`, type: "issue.create", payload: { projectId, title: "Trappe manquante", description: "Plafond local technique.", category: "SAFETY", severity: "MEDIUM", assigneeName: "Plâtrerie", dueDate: "2027-01-01" } },
    ]);
    const secondId = created.body.results[0].entityId;
    const photo = await upload(harness, owner, jpeg(`trappe-${randomUUID()}`), "trappe.jpg");
    await sync(owner, [
      { clientId: `ev-${randomUUID()}`, type: "evidence.create", payload: { projectId, kind: "CORRECTION", fileId: photo.body.id, issueId: secondId, takenAt: new Date().toISOString() } },
      { clientId: `op-${randomUUID()}`, type: "issue.submitCorrection", baseVersion: 1, payload: { issueId: secondId, note: "Trappe posée" } },
    ]);
    expect((await as(harness, owner).post(`/field/issues/${secondId}/close`)).status).toBe(403);
    await expect(
      harness.prisma.siteIssue.update({ where: { id: secondId }, data: { status: "CLOSED", closedByUserId: owner.userId, closedAt: new Date() } }),
    ).rejects.toThrow(/site_issues_closed_after_correction/);
  });

  it("journal : conflit entre deux appareils resolu explicitement, puis signature qui fige", async () => {
    const employee = await as(harness, owner).post("/hr/employees", { firstName: "Paul", lastName: "Nsimba", jobTitle: "Monteur", hireDate: "2026-01-05", contractType: "PERMANENT", badgeCode: `F-${randomUUID()}` });
    await as(harness, owner).post("/hr/attendance/scan", { badgeCode: employee.body.badgeCode, type: "IN", projectId });

    const deviceA = await sync(worker, [
      { clientId: `log-${randomUUID()}`, type: "log.save", payload: { projectId, logDate: today, weather: "Ensoleillé", workforceCount: 12, summary: "Pose gaines N1 axes A-C." } },
    ]);
    expect(deviceA.body.results[0].status).toBe("APPLIED");
    logId = deviceA.body.results[0].entityId;

    const deviceBClientId = `log-${randomUUID()}`;
    const deviceB = await sync(owner, [{ clientId: deviceBClientId, type: "log.save", payload: { projectId, logDate: today, workforceCount: 14, summary: "Livraison CTA." } }]);
    expect(deviceB.body.results[0].status).toBe("CONFLICT");
    expect(deviceB.body.results[0].server).toMatchObject({ id: logId, version: 1, summary: "Pose gaines N1 axes A-C." });

    // Resolution explicite : fusion sur la version serveur lue, meme identifiant d'operation.
    const merged = await sync(owner, [
      {
        clientId: deviceBClientId,
        type: "log.save",
        baseVersion: 1,
        payload: { projectId, logDate: today, weather: "Ensoleillé", workforceCount: 14, summary: "Pose gaines N1 axes A-C.\nLivraison CTA." },
      },
    ]);
    expect(merged.body.results[0]).toMatchObject({ status: "APPLIED", entityId: logId });

    const staleA = await sync(worker, [{ clientId: `log-${randomUUID()}`, type: "log.save", baseVersion: 1, payload: { projectId, logDate: today, workforceCount: 11, summary: "Écrasement ?" } }]);
    expect(staleA.body.results[0].status).toBe("CONFLICT");

    const evidence = await sync(worker, [{ clientId: `ev-${randomUUID()}`, type: "evidence.create", payload: { projectId, kind: "OBSERVATION", note: "Réunion de chantier 10 h.", dailyLogId: logId, takenAt: new Date().toISOString() } }]);
    expect(evidence.body.results[0].status).toBe("APPLIED");

    const log = await as(harness, worker).get(`/field/logs/${logId}`);
    expect(log.body).toMatchObject({ version: 2, workforceCount: 14, clockedInCount: 1, status: "DRAFT", stockIssues: [] });
    expect(log.body.summary).toBe("Pose gaines N1 axes A-C.\nLivraison CTA.");
    expect(log.body.evidence).toHaveLength(1);

    expect((await as(harness, worker).post(`/field/logs/${logId}/sign`)).status).toBe(403);
    expect((await as(harness, conductor).post(`/field/logs/${logId}/sign`, { version: 1 })).status).toBe(409);
    const signed = await as(harness, conductor).post(`/field/logs/${logId}/sign`, { version: 2 });
    expect(signed.body.status).toBe("SIGNED");

    const afterSign = await sync(worker, [{ clientId: `log-${randomUUID()}`, type: "log.save", baseVersion: 2, payload: { projectId, logDate: today, workforceCount: 1, summary: "Modif" } }]);
    expect(afterSign.body.results[0].status).toBe("CONFLICT");
    const lateEvidence = await sync(worker, [{ clientId: `ev-${randomUUID()}`, type: "evidence.create", payload: { projectId, kind: "OBSERVATION", note: "Tardive", dailyLogId: logId, takenAt: new Date().toISOString() } }]);
    expect(lateEvidence.body.results[0].status).toBe("REJECTED");
    await expect(harness.prisma.siteDailyLog.update({ where: { id: logId }, data: { summary: "Réécrit" } })).rejects.toThrow(/frozen/);
  });

  it("isolation : aucun element de chantier visible ni referencable depuis un autre tenant", async () => {
    expect((await as(harness, other).get(`/field/issues?projectId=${projectId}`)).body).toHaveLength(0);
    expect((await as(harness, other).get(`/field/issues/${issueId}`)).status).toBe(404);
    expect((await as(harness, other).get(`/field/logs/${logId}`)).status).toBe(404);
    const foreign = await sync(other, [{ clientId: `ev-${randomUUID()}`, type: "evidence.create", payload: { projectId, kind: "OBSERVATION", note: "Intrusion", issueId, takenAt: new Date().toISOString() } }]);
    expect(foreign.body.results[0].status).toBe("REJECTED");
    const replay = await sync(other, [{ clientId: issueClientId, type: "issue.create", payload: { projectId } }]);
    expect(replay.body.results[0].status).toBe("REJECTED");

    const audit = await harness.prisma.auditLog.findMany({ where: { organizationId: owner.organizationId, action: { startsWith: "field." } } });
    const actions = new Set(audit.map((entry) => entry.action));
    for (const action of ["field.issue.created", "field.evidence.recorded", "field.issue.correction_submitted", "field.issue.reopened", "field.issue.closed", "field.log.signed"]) {
      expect(actions.has(action)).toBe(true);
    }
  });
});
