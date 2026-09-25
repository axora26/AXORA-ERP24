import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createHarness, registerTenant, type Harness, type Tenant } from "./support/harness.js";
import { createStartedProject, createUserWith } from "./support/fixtures.js";
import { jpeg, upload } from "./support/files.js";

/**
 * INC-11 — QHSE : Inspection -> NCR -> Action corrective -> Verification ->
 * Cloture (backlog §5.8). NCR et incidents immuables sur leurs faits ;
 * cloture et verification par une personne distincte (garanti en base).
 */
describe("QHSE (e2e)", () => {
  let harness: Harness;
  let owner: Tenant;
  let other: Tenant;
  let inspector: Tenant;
  let contractor: Tenant;
  let manager: Tenant;
  let projectId = "";
  let templateId = "";
  let inspectionId = "";
  let findingId = "";
  let incidentId = "";
  const past = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);

  beforeAll(async () => {
    harness = await createHarness();
    owner = await registerTenant(harness, "qhse-a");
    other = await registerTenant(harness, "qhse-b");
    projectId = (await createStartedProject(harness, owner)).projectId;
    inspector = await createUserWith(
      harness,
      owner,
      ["qhse.inspection.read", "qhse.inspection.manage", "qhse.finding.create", "qhse.incident.report", "qhse.permit.request", "qhse.toolbox.manage"],
      "preventeur",
    );
    contractor = await createUserWith(harness, owner, ["qhse.inspection.read", "qhse.action.manage"], "sous-traitant");
    manager = await createUserWith(harness, owner, ["qhse.inspection.read", "qhse.finding.close", "qhse.incident.manage", "qhse.permit.approve"], "responsable-hse");
  });

  afterAll(async () => {
    await harness.close();
  });

  it("modeles de checklist : points critiques, code unique", async () => {
    const created = await as(harness, inspector).post("/qhse/templates", {
      code: "sec-01",
      name: "Visite sécurité hebdomadaire",
      domain: "SAFETY",
      items: [
        { label: "Port des EPI (casque, chaussures, gilet)" },
        { label: "Garde-corps en place sur toutes les trémies", critical: true },
        { label: "Extincteurs accessibles et vérifiés" },
      ],
    });
    expect(created.status).toBe(201);
    templateId = created.body.find((template: { code: string }) => template.code === "SEC-01").id;
    expect((await as(harness, inspector).post("/qhse/templates", { code: "SEC-01", name: "Doublon", domain: "SAFETY", items: [{ label: "x" }] })).status).toBe(409);
    expect((await as(harness, inspector).post("/qhse/templates", { code: "VIDE", name: "Vide", domain: "SAFETY", items: [] })).status).toBe(400);
    expect((await as(harness, contractor).post("/qhse/templates", { code: "X", name: "X", domain: "SAFETY", items: [{ label: "x" }] })).status).toBe(403);
  });

  it("inspection : seul l'inspecteur designe renseigne ; un non-conforme doit etre decrit", async () => {
    const inspection = await as(harness, inspector).post("/qhse/inspections", { projectId, templateId, title: "Visite S39", scheduledAt: new Date().toISOString() });
    expect(inspection.status).toBe(201);
    inspectionId = inspection.body.id;
    expect(inspection.body.code).toMatch(/^INSP-\d{4}-\d{4}$/);
    expect(inspection.body).toMatchObject({ status: "PLANNED", total: 3, answered: 0, domain: "SAFETY" });
    const [epi, guard, extinguisher] = inspection.body.items;
    expect(guard.critical).toBe(true);

    expect((await as(harness, owner).put(`/qhse/inspections/${inspectionId}/items/${epi.id}`, { result: "CONFORM" })).status).toBe(403);
    expect((await as(harness, inspector).put(`/qhse/inspections/${inspectionId}/items/${epi.id}`, { result: "PASSED" })).status).toBe(400);
    const first = await as(harness, inspector).put(`/qhse/inspections/${inspectionId}/items/${epi.id}`, { result: "CONFORM" });
    expect(first.body.status).toBe("IN_PROGRESS");
    expect((await as(harness, inspector).put(`/qhse/inspections/${inspectionId}/items/${guard.id}`, { result: "NON_CONFORM" })).status).toBe(400);
    const photo = await upload(harness, inspector, jpeg(`tremie-${Date.now()}`), "tremie.jpg");
    expect(photo.status).toBe(201);
    await as(harness, inspector).put(`/qhse/inspections/${inspectionId}/items/${guard.id}`, {
      result: "NON_CONFORM",
      comment: "Trémie gaine palière N2 sans garde-corps.",
      fileId: photo.body.id,
    });
    expect((await as(harness, inspector).post(`/qhse/inspections/${inspectionId}/complete`)).status).toBe(400);
    await as(harness, inspector).put(`/qhse/inspections/${inspectionId}/items/${extinguisher.id}`, { result: "NOT_APPLICABLE", comment: "Zone non encore livrée" });
  });

  it("cloture de l'inspection : taux calcule, une NCR ouverte par point non conforme, checklist figee", async () => {
    const completed = await as(harness, inspector).post(`/qhse/inspections/${inspectionId}/complete`);
    expect(completed.status).toBe(201);
    expect(completed.body).toMatchObject({ status: "COMPLETED", conformityRate: "50.00", nonConform: 1 });
    const guard = completed.body.items.find((item: { critical: boolean }) => item.critical);
    expect(guard.findingCode).toMatch(/^NC-\d{4}-\d{4}$/);
    expect(guard.file.mimeType).toBe("image/jpeg");
    findingId = guard.findingId;

    const finding = await as(harness, inspector).get(`/qhse/findings/${findingId}`);
    expect(finding.body).toMatchObject({ severity: "CRITICAL", category: "SAFETY", status: "OPEN", inspectionId, description: "Trémie gaine palière N2 sans garde-corps." });

    expect((await as(harness, inspector).put(`/qhse/inspections/${inspectionId}/items/${guard.id}`, { result: "CONFORM" })).status).toBe(400);
    await expect(harness.prisma.qhseInspectionItem.update({ where: { id: guard.id }, data: { result: "CONFORM" } })).rejects.toThrow(/frozen/);
  });

  it("NCR : faits constates immuables et jamais supprimes, meme en base", async () => {
    await expect(harness.prisma.qhseFinding.update({ where: { id: findingId }, data: { description: "Réécrit" } })).rejects.toThrow(/immutable/);
    await expect(harness.prisma.qhseFinding.update({ where: { id: findingId }, data: { severity: "MINOR" } })).rejects.toThrow(/immutable/);
    await expect(harness.prisma.qhseFinding.delete({ where: { id: findingId } })).rejects.toThrow(/never deleted/);
  });

  it("actions correctives : realisation, refus motive, verification par un tiers", async () => {
    let finding = await as(harness, contractor).post(`/qhse/findings/${findingId}/actions`, {
      description: "Poser un garde-corps provisoire autour de la trémie",
      assigneeName: "Gros œuvre — chef d'équipe",
      dueDate: past,
    });
    expect(finding.status).toBe(201);
    expect(finding.body).toMatchObject({ status: "IN_PROGRESS", actionCount: 1, overdueActions: 1 });
    const actionId = finding.body.actions[0].id;
    expect(finding.body.actions[0].overdue).toBe(true);

    expect((await as(harness, contractor).post(`/qhse/actions/${actionId}/complete`, {})).status).toBe(400);
    const evidence = await upload(harness, contractor, jpeg(`gc-${Date.now()}`), "garde-corps.jpg");
    finding = await as(harness, contractor).post(`/qhse/actions/${actionId}/complete`, { note: "Garde-corps posé", fileId: evidence.body.id });
    expect(finding.body.actions[0]).toMatchObject({ status: "DONE", overdue: false });
    expect((await as(harness, contractor).post(`/qhse/actions/${actionId}/verify`)).status).toBe(403);

    expect((await as(harness, manager).post(`/qhse/actions/${actionId}/reject`, {})).status).toBe(400);
    finding = await as(harness, manager).post(`/qhse/actions/${actionId}/reject`, { note: "Plinthe manquante" });
    expect(finding.body.actions[0]).toMatchObject({ status: "OPEN", verificationNote: "Plinthe manquante" });
    await as(harness, contractor).post(`/qhse/actions/${actionId}/complete`, { note: "Plinthe ajoutée" });
    finding = await as(harness, manager).post(`/qhse/actions/${actionId}/verify`, { note: "Conforme sur place" });
    expect(finding.body.actions[0]).toMatchObject({ status: "VERIFIED", verifiedByName: expect.any(String) });

    // Separation des devoirs : celui qui realise ne verifie pas, meme avec toutes les permissions.
    finding = await as(harness, owner).post(`/qhse/findings/${findingId}/actions`, { description: "Former l'équipe au balisage des trémies", assigneeName: "Direction travaux", dueDate: soon });
    const secondId = finding.body.actions[1].id;
    await as(harness, owner).post(`/qhse/actions/${secondId}/complete`, { note: "Causerie tenue" });
    expect((await as(harness, owner).post(`/qhse/actions/${secondId}/verify`)).status).toBe(403);
    const action = await harness.prisma.qhseCorrectiveAction.findUniqueOrThrow({ where: { id: secondId } });
    await expect(
      harness.prisma.qhseCorrectiveAction.update({ where: { id: action.id }, data: { status: "VERIFIED", verifiedByUserId: owner.userId, verifiedAt: new Date() } }),
    ).rejects.toThrow(/qhse_actions_verified_by_third_party/);
    await expect(harness.prisma.qhseCorrectiveAction.delete({ where: { id: action.id } })).rejects.toThrow(/DELETE is forbidden/);
  });

  it("cloture de la NCR : toutes les actions verifiees, par une autre personne que le createur", async () => {
    expect((await as(harness, manager).post(`/qhse/findings/${findingId}/close`, { note: "OK" })).status).toBe(400);
    const pending = (await as(harness, manager).get(`/qhse/findings/${findingId}`)).body.actions.find((action: { status: string }) => action.status === "DONE");
    await as(harness, manager).post(`/qhse/actions/${pending.id}/verify`, { note: "Émargement vérifié" });
    expect((await as(harness, manager).post(`/qhse/findings/${findingId}/close`, {})).status).toBe(400);
    const closed = await as(harness, manager).post(`/qhse/findings/${findingId}/close`, { note: "Actions efficaces, trémies sécurisées" });
    expect(closed.status).toBe(201);
    expect(closed.body).toMatchObject({ status: "CLOSED", verifiedActions: 2 });
    expect((await as(harness, contractor).post(`/qhse/findings/${findingId}/actions`, { description: "Tardive", assigneeName: "X", dueDate: soon })).status).toBe(400);

    // NCR creee par le proprietaire : il ne peut pas la cloturer lui-meme.
    const own = await as(harness, owner).post("/qhse/findings", { projectId, title: "Déchets non triés", description: "Benne DIB contenant du plâtre.", category: "ENVIRONMENT", severity: "MINOR" });
    await as(harness, owner).post(`/qhse/findings/${own.body.id}/actions`, { description: "Tri", assigneeName: "Logistique", dueDate: soon });
    const ownAction = (await as(harness, owner).get(`/qhse/findings/${own.body.id}`)).body.actions[0].id;
    await as(harness, contractor).post(`/qhse/actions/${ownAction}/complete`, { note: "Benne triée" });
    await as(harness, owner).post(`/qhse/actions/${ownAction}/verify`, { note: "Vu" });
    expect((await as(harness, owner).post(`/qhse/findings/${own.body.id}/close`, { note: "Clos" })).status).toBe(403);
    await expect(
      harness.prisma.qhseFinding.update({ where: { id: own.body.id }, data: { status: "CLOSED", closedByUserId: owner.userId, closedAt: new Date() } }),
    ).rejects.toThrow(/qhse_findings_closed_by_third_party/);
  });

  it("incidents : faits immuables, arret jamais reduit, cloture apres enquete et NCR soldees", async () => {
    expect((await as(harness, inspector).post("/qhse/incidents", { projectId, type: "LOST_TIME", severity: "MAJOR", occurredAt: new Date().toISOString(), location: "N2", description: "Chute de plain-pied." })).status).toBe(400);
    const reported = await as(harness, inspector).post("/qhse/incidents", {
      projectId,
      type: "LOST_TIME",
      severity: "MAJOR",
      occurredAt: new Date(Date.now() - 86_400_000).toISOString(),
      location: "Escalier provisoire N1-N2",
      description: "Chute dans l'escalier provisoire, entorse de la cheville.",
      injuredPerson: "Compagnon lot plâtrerie",
      immediateActions: "Premiers secours, évacuation.",
      lostDays: 3,
    });
    expect(reported.status).toBe(201);
    incidentId = reported.body[0].id;
    expect(reported.body[0].code).toMatch(/^HSE-\d{4}-\d{4}$/);
    await expect(harness.prisma.safetyIncident.update({ where: { id: incidentId }, data: { description: "Rien" } })).rejects.toThrow(/immutable/);
    await expect(harness.prisma.safetyIncident.delete({ where: { id: incidentId } })).rejects.toThrow(/never deleted/);

    expect((await as(harness, manager).post(`/qhse/incidents/${incidentId}/close`)).status).toBe(400);
    expect((await as(harness, manager).post(`/qhse/incidents/${incidentId}/investigate`, { summary: "Marche non éclairée", lostDays: 2 })).status).toBe(400);
    const investigated = await as(harness, manager).post(`/qhse/incidents/${incidentId}/investigate`, { summary: "Marche non éclairée, main courante absente.", lostDays: 5 });
    expect(investigated.body[0]).toMatchObject({ status: "INVESTIGATED", lostDays: 5 });
    const linked = await as(harness, inspector).post("/qhse/findings", { projectId, incidentId, title: "Escalier provisoire non conforme", description: "Absence de main courante et d'éclairage.", category: "SAFETY", severity: "MAJOR" });
    expect(linked.body.incidentCode).toBe(reported.body[0].code);
    expect((await as(harness, manager).post(`/qhse/incidents/${incidentId}/close`)).status).toBe(400);
  });

  it("permis de travail : fenetre de validite, delivrance par un tiers", async () => {
    const now = Date.now();
    const window = { validFrom: new Date(now - 60_000).toISOString(), validTo: new Date(now + 8 * 3_600_000).toISOString() };
    const base = { projectId, type: "HOT_WORK", description: "Soudure support CTA toiture", precautions: "Extincteur, permis feu, surveillance 2 h après travaux" };
    expect((await as(harness, inspector).post("/qhse/permits", { ...base, validFrom: window.validTo, validTo: window.validFrom })).status).toBe(400);
    expect((await as(harness, inspector).post("/qhse/permits", { ...base, validFrom: window.validFrom, validTo: new Date(now + 20 * 86_400_000).toISOString() })).status).toBe(400);
    const requested = await as(harness, inspector).post("/qhse/permits", { ...base, ...window });
    expect(requested.status).toBe(201);
    const permitId = requested.body[0].id;
    expect(requested.body[0]).toMatchObject({ status: "REQUESTED", active: false });

    const ownPermit = await as(harness, owner).post("/qhse/permits", { ...base, ...window, type: "WORK_AT_HEIGHT" });
    const ownId = ownPermit.body.find((permit: { type: string }) => permit.type === "WORK_AT_HEIGHT").id;
    expect((await as(harness, owner).post(`/qhse/permits/${ownId}/approve`)).status).toBe(403);
    expect((await as(harness, inspector).post(`/qhse/permits/${permitId}/approve`)).status).toBe(403);
    const approved = await as(harness, manager).post(`/qhse/permits/${permitId}/approve`, { note: "Zone balisée" });
    expect(approved.body.find((permit: { id: string }) => permit.id === permitId)).toMatchObject({ status: "APPROVED", active: true });
    const closed = await as(harness, inspector).post(`/qhse/permits/${permitId}/close`);
    expect(closed.body.find((permit: { id: string }) => permit.id === permitId).status).toBe("CLOSED");
  });

  it("quart d'heure securite : emargement d'employes reels, append-only", async () => {
    const employee = await as(harness, owner).post("/hr/employees", { firstName: "Jean", lastName: "Mbala", jobTitle: "Maçon", hireDate: "2026-01-05", contractType: "PERMANENT" });
    expect((await as(harness, inspector).post("/qhse/toolbox", { projectId, heldAt: new Date().toISOString(), topic: "Trémies", content: "Balisage", attendeeEmployeeIds: ["inconnu"] })).status).toBe(404);
    expect((await as(harness, inspector).post("/qhse/toolbox", { projectId, heldAt: "2099-01-01T08:00:00Z", topic: "Trémies", content: "Balisage", attendeeEmployeeIds: [employee.body.id] })).status).toBe(400);
    const meeting = await as(harness, inspector).post("/qhse/toolbox", {
      projectId,
      heldAt: new Date().toISOString(),
      topic: "Chutes de hauteur et trémies",
      content: "Rappel des protections collectives, retour sur l'incident de l'escalier.",
      attendeeEmployeeIds: [employee.body.id, employee.body.id],
    });
    expect(meeting.status).toBe(201);
    expect(meeting.body[0].attendees).toEqual([{ employeeId: employee.body.id, name: "Jean Mbala" }]);
    await expect(harness.prisma.toolboxMeeting.update({ where: { id: meeting.body[0].id }, data: { topic: "Autre" } })).rejects.toThrow(/append-only/);
  });

  it("indicateurs calcules sur donnees reelles : taux de frequence sur heures validees (RH)", async () => {
    let summary = (await as(harness, manager).get("/qhse/summary")).body;
    expect(summary).toMatchObject({ lostTimeIncidents12m: 1, incidents30d: 1, daysSinceLastLostTime: 1, hoursWorked12m: "0.00", frequencyRate: null, inspectionsCompleted30d: 1, averageConformity30d: "50.00" });
    expect(summary.openFindings).toBe(2);

    const validator = await createUserWith(harness, owner, ["hr.employee.read", "hr.timesheet.validate"], "valideur-rh");
    const employee = await as(harness, owner).post("/hr/employees", { firstName: "Luc", lastName: "Tshala", jobTitle: "Électricien", hireDate: "2026-01-05", contractType: "PERMANENT" });
    const monday = new Date(Date.now() - 7 * 86_400_000);
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    const day = (offset: number) => new Date(monday.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
    const sheet = await as(harness, owner).post("/hr/timesheets", { employeeId: employee.body.id, weekStart: day(0) });
    await as(harness, owner).put(`/hr/timesheets/${sheet.body.id}/entries`, { entries: [{ workDate: day(0), hours: "8" }, { workDate: day(1), hours: "8" }] });
    await as(harness, owner).post(`/hr/timesheets/${sheet.body.id}/submit`);
    expect((await as(harness, validator).post(`/hr/timesheets/${sheet.body.id}/validate`)).status).toBe(201);

    summary = (await as(harness, manager).get("/qhse/summary")).body;
    expect(summary.hoursWorked12m).toBe("16.00");
    expect(summary.frequencyRate).toBe("62500.00");
  });

  it("isolation et audit", async () => {
    expect((await as(harness, other).get("/qhse/findings")).body).toHaveLength(0);
    expect((await as(harness, other).get(`/qhse/findings/${findingId}`)).status).toBe(404);
    expect((await as(harness, other).get(`/qhse/inspections/${inspectionId}`)).status).toBe(404);
    expect((await as(harness, other).post("/qhse/findings", { projectId, title: "x", description: "x", category: "SAFETY", severity: "MINOR" })).status).toBe(404);
    expect((await as(harness, other).post(`/qhse/incidents/${incidentId}/investigate`, { summary: "x" })).status).toBe(404);

    const audit = await harness.prisma.auditLog.findMany({ where: { organizationId: owner.organizationId, action: { startsWith: "qhse." } } });
    const actions = new Set(audit.map((entry) => entry.action));
    for (const action of ["qhse.inspection.completed", "qhse.finding.created", "qhse.action.verified", "qhse.action.rejected", "qhse.finding.closed", "qhse.incident.reported", "qhse.permit.approved", "qhse.toolbox.recorded"]) {
      expect(actions.has(action)).toBe(true);
    }
    const reported = audit.find((entry) => entry.action === "qhse.incident.reported");
    expect(JSON.stringify(reported?.metadata)).toContain("entorse");
  });
});
