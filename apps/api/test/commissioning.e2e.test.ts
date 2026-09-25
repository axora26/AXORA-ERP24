import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createHarness, registerTenant, type Harness, type Tenant } from "./support/harness.js";
import { createStartedProject, createUserWith } from "./support/fixtures.js";
import { pdf, upload } from "./support/files.js";

/**
 * INC-12 — Commissioning : Equipement -> Essai -> Anomalie -> Correction ->
 * Retest -> Acceptation (backlog §5.9). DoD : acceptation bloquee sans
 * retest, en API comme en base.
 */
describe("Commissioning (e2e)", () => {
  let harness: Harness;
  let owner: Tenant;
  let other: Tenant;
  let technician: Tenant;
  let acceptor: Tenant;
  let equipmentId = "";
  let activityId = "";
  let punchItemId = "";
  let approvedDoc = "";
  let draftDoc = "";

  beforeAll(async () => {
    harness = await createHarness();
    owner = await registerTenant(harness, "cx-a");
    other = await registerTenant(harness, "cx-b");
    const { projectId } = await createStartedProject(harness, owner);
    technician = await createUserWith(harness, owner, ["commissioning.activity.read", "commissioning.activity.manage"], "technicien-cx");
    acceptor = await createUserWith(harness, owner, ["commissioning.activity.read", "commissioning.activity.accept", "documents.document.approve", "documents.document.read"], "moe");
    const systems = await as(harness, owner).post("/mep/systems", { projectId, code: "CVC-01", name: "Traitement d'air", discipline: "HVAC" });
    const equipment = await as(harness, owner).post("/mep/equipment", { systemId: systems.body[0].id, tag: "CTA-01", name: "Centrale de traitement d'air" });
    equipmentId = equipment.body.id;
    const file = await upload(harness, owner, pdf(`doe-${Date.now()}`), "DOE-CTA-01.pdf");
    const doc = await as(harness, owner).post("/documents", { title: "DOE CTA-01", category: "DOE", projectId, fileId: file.body.id });
    approvedDoc = doc.body.id;
    await as(harness, owner).post(`/documents/${approvedDoc}/submit`);
    await as(harness, acceptor).post(`/documents/${approvedDoc}/approve`);
    const draftFile = await upload(harness, owner, pdf(`draft-${Date.now()}`), "brouillon.pdf");
    draftDoc = (await as(harness, owner).post("/documents", { title: "PV brouillon", category: "MINUTES", projectId, fileId: draftFile.body.id })).body.id;
  });

  afterAll(async () => {
    await harness.close();
  });

  const tech = () => as(harness, technician);

  it("activite : uniquement sur un equipement installe, une seule par equipement", async () => {
    expect((await tech().post("/commissioning/activities", { equipmentId, procedure: "Procédure CTA" })).status).toBe(400);
    await as(harness, owner).patch(`/mep/equipment/${equipmentId}`, { status: "SELECTED" });
    await as(harness, owner).patch(`/mep/equipment/${equipmentId}`, { status: "INSTALLED" });
    const created = await tech().post("/commissioning/activities", { equipmentId, procedure: "1. Contrôles visuels\n2. Mesure des débits\n3. Essais de régulation" });
    expect(created.status).toBe(201);
    activityId = created.body.id;
    expect(created.body).toMatchObject({ status: "PLANNED", stage: "PRECOMMISSIONING", equipmentTag: "CTA-01" });
    expect(created.body.code).toMatch(/^CX-\d{4}-\d{4}$/);
    expect((await tech().post("/commissioning/activities", { equipmentId, procedure: "Doublon" })).status).toBe(409);
  });

  it("sequence : pas d'essai fonctionnel sans precommissioning reussi ; un echec documente ses anomalies", async () => {
    expect((await tech().post(`/commissioning/activities/${activityId}/tests`, { kind: "FUNCTIONAL", checks: [{ label: "Démarrage", ok: true }] })).status).toBe(400);
    expect((await tech().post(`/commissioning/activities/${activityId}/tests`, { kind: "PRECOMMISSIONING", checks: [{ label: "Filtres posés", ok: false }] })).status).toBe(400);
    const pre = await tech().post(`/commissioning/activities/${activityId}/tests`, {
      kind: "PRECOMMISSIONING",
      checks: [
        { label: "Filtres posés", ok: true },
        { label: "Sens de rotation ventilateur", ok: true },
      ],
    });
    expect(pre.status).toBe(201);
    expect(pre.body).toMatchObject({ status: "IN_PROGRESS", stage: "FUNCTIONAL_TEST" });
    expect(pre.body.tests[0]).toMatchObject({ sequence: 1, outcome: "PASS" });
    expect((await tech().post(`/commissioning/activities/${activityId}/tests`, { kind: "PRECOMMISSIONING", checks: [{ label: "x", ok: true }] })).status).toBe(400);
  });

  it("essai fonctionnel : resultat calcule par le serveur sur les bornes d'acceptation", async () => {
    expect((await tech().post(`/commissioning/activities/${activityId}/tests`, { kind: "FUNCTIONAL", measurements: [{ name: "Débit", unit: "m³/h", measured: "10500" }] })).status).toBe(400);
    const failed = await tech().post(`/commissioning/activities/${activityId}/tests`, {
      kind: "FUNCTIONAL",
      measurements: [
        { name: "Débit soufflage", unit: "m³/h", min: "11400", max: "12600", measured: "10500" },
        { name: "Température soufflage", unit: "°C", min: "16", max: "20", measured: "18.5" },
      ],
      anomalies: [{ description: "Débit insuffisant : courroie ventilateur détendue", severity: "MAJOR" }],
    });
    expect(failed.status).toBe(201);
    expect(failed.body.tests[1]).toMatchObject({ kind: "FUNCTIONAL", outcome: "FAIL" });
    expect(failed.body.tests[1].measurements.map((measurement: { pass: boolean }) => measurement.pass)).toEqual([false, true]);
    expect(failed.body.stage).toBe("CORRECTIONS");
    punchItemId = failed.body.punchItems[0].id;
    expect(failed.body.punchItems[0]).toMatchObject({ status: "OPEN", testSequence: 2 });
  });

  it("DoD : reception bloquee sans correction ET sans retest reussi posterieur (API et base)", async () => {
    const blocked = await as(harness, acceptor).post(`/commissioning/activities/${activityId}/accept`, { note: "OK" });
    expect(blocked.status).toBe(400);
    expect(blocked.body.message).toContain("anomalie");
    expect((await tech().post(`/commissioning/activities/${activityId}/tests`, { kind: "RETEST", checks: [{ label: "x", ok: true }] })).status).toBe(400);

    const corrected = await tech().post(`/commissioning/punch-items/${punchItemId}/correct`, { note: "Courroie retendue et alignée" });
    expect(corrected.body).toMatchObject({ stage: "RETEST" });
    const stillBlocked = await as(harness, acceptor).post(`/commissioning/activities/${activityId}/accept`, { note: "OK" });
    expect(stillBlocked.status).toBe(400);
    expect(stillBlocked.body.message).toContain("retest");

    // Meme en contournant l'API, la base refuse une reception sans retest.
    await expect(
      harness.prisma.commissioningActivity.update({ where: { id: activityId }, data: { status: "ACCEPTED", acceptedByUserId: acceptor.userId, acceptedAt: new Date() } }),
    ).rejects.toThrow(/punch items remain|retest/);
  });

  it("retest reussi : anomalies soldees, puis reception par une autre personne que le dernier essayeur", async () => {
    const retest = await tech().post(`/commissioning/activities/${activityId}/tests`, {
      kind: "RETEST",
      measurements: [{ name: "Débit soufflage", unit: "m³/h", min: "11400", max: "12600", measured: "11950" }],
    });
    expect(retest.body.tests[2]).toMatchObject({ kind: "RETEST", outcome: "PASS" });
    expect(retest.body.punchItems[0]).toMatchObject({ status: "CLOSED", closedByTestSequence: 3 });
    expect(retest.body).toMatchObject({ stage: "READY_FOR_ACCEPTANCE", blockers: [] });

    await expect(
      harness.prisma.commissioningActivity.update({ where: { id: activityId }, data: { status: "ACCEPTED", acceptedByUserId: technician.userId, acceptedAt: new Date() } }),
    ).rejects.toThrow(/other than the last tester/);
    expect((await tech().post(`/commissioning/activities/${activityId}/accept`, { note: "OK" })).status).toBe(403);
    expect((await as(harness, acceptor).post(`/commissioning/activities/${activityId}/accept`, {})).status).toBe(400);
    const accepted = await as(harness, acceptor).post(`/commissioning/activities/${activityId}/accept`, { note: "Performances conformes au CCTP" });
    expect(accepted.status).toBe(201);
    expect(accepted.body).toMatchObject({ status: "ACCEPTED", stage: "ACCEPTED" });
    expect((await as(harness, owner).get(`/mep/equipment/${equipmentId}`)).body.status).toBe("COMMISSIONED");
    expect((await tech().post(`/commissioning/activities/${activityId}/tests`, { kind: "RETEST", checks: [{ label: "x", ok: true }] })).status).toBe(400);
  });

  it("remise au client : DOE approuve obligatoire, fiches d'essai et statut irreversibles", async () => {
    expect((await as(harness, acceptor).post(`/commissioning/activities/${activityId}/handover`, { recipient: "Clinique Saint-Luc", documentIds: [draftDoc] })).status).toBe(400);
    expect((await as(harness, acceptor).post(`/commissioning/activities/${activityId}/handover`, { recipient: "Clinique Saint-Luc", documentIds: [] })).status).toBe(400);
    const handed = await as(harness, acceptor).post(`/commissioning/activities/${activityId}/handover`, { recipient: "Clinique Saint-Luc — service technique", documentIds: [approvedDoc] });
    expect(handed.body).toMatchObject({ status: "HANDED_OVER", handoverRecipient: "Clinique Saint-Luc — service technique" });
    expect(handed.body.documents).toEqual([expect.objectContaining({ id: approvedDoc, status: "APPROVED" })]);

    const test = await harness.prisma.commissioningTest.findFirstOrThrow({ where: { activityId, sequence: 2 } });
    await expect(harness.prisma.commissioningTest.update({ where: { id: test.id }, data: { outcome: "PASS" } })).rejects.toThrow(/append-only/);
    await expect(harness.prisma.commissioningActivity.update({ where: { id: activityId }, data: { status: "IN_PROGRESS" } })).rejects.toThrow(/cannot go back/);
    await expect(harness.prisma.commissioningActivity.delete({ where: { id: activityId } })).rejects.toThrow(/never deleted/);
  });

  it("isolation et audit", async () => {
    expect((await as(harness, other).get(`/commissioning/activities/${activityId}`)).status).toBe(404);
    expect((await as(harness, other).get("/commissioning/activities")).body).toHaveLength(0);
    expect((await as(harness, other).post(`/commissioning/punch-items/${punchItemId}/correct`, { note: "x" })).status).toBe(404);
    const audit = await harness.prisma.auditLog.findMany({ where: { organizationId: owner.organizationId, action: { startsWith: "commissioning." } } });
    const actions = new Set(audit.map((entry) => entry.action));
    for (const action of ["commissioning.activity.created", "commissioning.test.recorded", "commissioning.punch.corrected", "commissioning.activity.accepted", "commissioning.activity.handed_over"]) {
      expect(actions.has(action)).toBe(true);
    }
  });
});
