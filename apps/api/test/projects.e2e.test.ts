import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createHarness, registerTenant, type Harness, type Tenant } from "./support/harness.js";
import { createActiveContract, createUserWith } from "./support/fixtures.js";

/** INC-05 — Projets & Construction : provenance contrat, WBS, baseline, avenants, avancement. */
describe("Projets & Construction (e2e)", () => {
  let harness: Harness;
  let owner: Tenant;
  let other: Tenant;
  let approver: Tenant;
  let contractId = "";
  let projectId = "";
  const wbs: Record<string, string> = {};

  beforeAll(async () => {
    harness = await createHarness();
    owner = await registerTenant(harness, "projects-a");
    other = await registerTenant(harness, "projects-b");
    ({ contractId } = await createActiveContract(harness, owner));
    approver = await createUserWith(
      harness,
      owner,
      ["projects.project.read", "projects.changeorder.approve"],
      "approver",
    );
  });

  afterAll(async () => {
    await harness.close();
  });

  const api = () => as(harness, owner);

  it("cree un projet depuis un contrat actif : numerotation, provenance, montant fige, WBS importe", async () => {
    const response = await api().post("/projects", {
      contractId,
      name: "Extension bloc operatoire",
      plannedStart: "2026-10-01",
      plannedEnd: "2027-06-30",
      importContractLines: true,
    });
    expect(response.status).toBe(201);
    projectId = response.body.id;
    expect(response.body.code).toMatch(/^PRJ-\d{4}-\d{4}$/);
    expect(response.body.contractId).toBe(contractId);
    expect(response.body.contractAmount).toBe("50000.00");
    expect(response.body.status).toBe("PLANNED");
    expect(response.body.wbs.map((node: { code: string }) => node.code)).toEqual(["GO-01", "CVC-01"]);
    expect(response.body.cockpit.committed.available).toBe(false);
  });

  it("un contrat ne peut engendrer qu'un seul projet racine", async () => {
    const duplicate = await api().post("/projects", { contractId, name: "Doublon" });
    expect(duplicate.status).toBe(409);
  });

  it("isolation : un autre tenant ne voit ni le projet ni le contrat", async () => {
    expect((await as(harness, other).get(`/projects/${projectId}`)).status).toBe(404);
    expect((await as(harness, other).get("/projects")).body).toEqual([]);
    expect((await as(harness, other).post("/projects", { contractId, name: "Vol" })).status).toBe(404);
  });

  it("WBS : structure lot -> sous-lots, dates incoherentes refusees", async () => {
    let response = await api().post(`/projects/${projectId}/wbs`, { code: "ELEC", name: "Electricite", kind: "LOT" });
    expect(response.status).toBe(201);
    wbs.ELEC = response.body.wbs.find((node: { code: string }) => node.code === "ELEC").id;
    response = await api().post(`/projects/${projectId}/wbs`, { code: "ELEC-1", name: "TGBT", parentId: wbs.ELEC });
    wbs.ELEC1 = response.body.wbs.find((node: { code: string }) => node.code === "ELEC-1").id;
    response = await api().post(`/projects/${projectId}/wbs`, { code: "ELEC-2", name: "Distribution", parentId: wbs.ELEC });
    wbs.ELEC2 = response.body.wbs.find((node: { code: string }) => node.code === "ELEC-2").id;
    wbs.GO = response.body.wbs.find((node: { code: string }) => node.code === "GO-01").id;
    expect((await api().post(`/projects/${projectId}/wbs`, { code: "ELEC", name: "Doublon" })).status).toBe(409);
    const badDates = await api().post("/projects", { name: "X", plannedStart: "2026-05-01", plannedEnd: "2026-01-01" });
    expect(badDates.status).toBe(400);
  });

  it("budget porte par les feuilles uniquement ; parents derives, sans double comptage", async () => {
    expect(
      (await api().post(`/projects/${projectId}/budget-lines`, { wbsItemId: wbs.ELEC, category: "MATERIAL", description: "X", amount: "10.00" })).status,
    ).toBe(400);
    await api().post(`/projects/${projectId}/budget-lines`, { wbsItemId: wbs.ELEC1, category: "MATERIAL", description: "TGBT", amount: "18000.50" });
    await api().post(`/projects/${projectId}/budget-lines`, { wbsItemId: wbs.ELEC1, category: "LABOR", description: "Pose", amount: "2999.50" });
    await api().post(`/projects/${projectId}/budget-lines`, { wbsItemId: wbs.ELEC2, category: "SUBCONTRACT", description: "Cablage", amount: "7000.00" });
    const response = await api().post(`/projects/${projectId}/budget-lines`, {
      wbsItemId: wbs.GO,
      category: "MATERIAL",
      description: "Beton",
      amount: "0.10",
    });
    const nodes = Object.fromEntries(response.body.wbs.map((node: { code: string; initialBudget: string }) => [node.code, node.initialBudget]));
    expect(nodes["ELEC-1"]).toBe("21000.00");
    expect(nodes["ELEC-2"]).toBe("7000.00");
    expect(nodes.ELEC).toBe("28000.00");
    expect(response.body.cockpit.initialBudget).toBe("28000.10");
    expect(response.body.cockpit.forecastMargin).toBe("21999.90");

    // Un noeud porteur de budget ne peut plus recevoir d'enfant.
    expect((await api().post(`/projects/${projectId}/wbs`, { code: "ELEC-1-A", name: "X", parentId: wbs.ELEC1 })).status).toBe(400);
    // Montant en nombre JSON refuse (precision).
    expect(
      (await api().post(`/projects/${projectId}/budget-lines`, { wbsItemId: wbs.GO, category: "MATERIAL", description: "X", amount: 12.5 })).status,
    ).toBe(400);
  });

  it("demarrage impossible sans baseline ; baseline fige les lignes", async () => {
    expect((await api().post(`/projects/${projectId}/status`, { status: "IN_PROGRESS" })).status).toBe(400);
    expect((await api().post(`/projects/${projectId}/change-orders`, { wbsItemId: wbs.GO, title: "Av", reason: "R", amount: "10.00" })).status).toBe(400);
    const baseline = await api().post(`/projects/${projectId}/baseline`);
    expect(baseline.status).toBe(201);
    expect(baseline.body.budgetBaselinedAt).toBeTruthy();
    const lineId = baseline.body.budgetLines[0].id;
    expect((await api().delete(`/projects/${projectId}/budget-lines/${lineId}`)).status).toBe(400);
    expect(
      (await api().post(`/projects/${projectId}/budget-lines`, { wbsItemId: wbs.GO, category: "MATERIAL", description: "X", amount: "1.00" })).status,
    ).toBe(400);
    const started = await api().post(`/projects/${projectId}/status`, { status: "IN_PROGRESS" });
    expect(started.status).toBe(201);
    expect(started.body.status).toBe("IN_PROGRESS");
  });

  it("avenants : separation des devoirs, budget revise = initial + approuves", async () => {
    let response = await api().post(`/projects/${projectId}/change-orders`, {
      wbsItemId: wbs.ELEC2,
      title: "Ajout eclairage de securite",
      reason: "Demande du bureau de controle",
      amount: "4500.00",
    });
    expect(response.status).toBe(201);
    const increase = response.body.changeOrders.find((order: { code: string }) => order.code === "AV-001");
    response = await api().post(`/projects/${projectId}/change-orders`, {
      wbsItemId: wbs.GO,
      title: "Economie sur coffrage",
      reason: "Variante validee",
      amount: "-0.10",
    });
    const decrease = response.body.changeOrders.find((order: { code: string }) => order.code === "AV-002");

    // L'auteur ne peut pas approuver sa propre demande.
    expect((await api().post(`/projects/${projectId}/change-orders/${increase.id}/approve`)).status).toBe(403);
    // Un utilisateur sans la permission d'approbation est refuse par le RBAC.
    const reader = await createUserWith(harness, owner, ["projects.project.read"], "reader");
    expect((await as(harness, reader).post(`/projects/${projectId}/change-orders/${increase.id}/approve`)).status).toBe(403);

    const approved = await as(harness, approver).post(`/projects/${projectId}/change-orders/${increase.id}/approve`);
    expect(approved.status).toBe(201);
    expect((await as(harness, approver).post(`/projects/${projectId}/change-orders/${increase.id}/approve`)).status).toBe(400);
    expect((await as(harness, approver).post(`/projects/${projectId}/change-orders/${decrease.id}/reject`, {})).status).toBe(400);
    const rejected = await as(harness, approver).post(`/projects/${projectId}/change-orders/${decrease.id}/reject`, {
      note: "Variante non conforme",
    });
    expect(rejected.status).toBe(201);
    expect(rejected.body.cockpit.approvedChangeOrders).toBe("4500.00");
    expect(rejected.body.cockpit.revisedBudget).toBe("32500.10");
    const elec = rejected.body.wbs.find((node: { code: string }) => node.code === "ELEC");
    expect(elec.initialBudget).toBe("28000.00");
    expect(elec.revisedBudget).toBe("32500.00");
  });

  it("avancement physique derive des taches (ponderees), jamais saisi", async () => {
    let response = await api().post(`/projects/${projectId}/tasks`, { wbsItemId: wbs.ELEC1, name: "Pose TGBT", weight: "3", plannedStart: "2026-10-05", plannedEnd: "2026-10-20" });
    expect(response.status).toBe(201);
    response = await api().post(`/projects/${projectId}/tasks`, { wbsItemId: wbs.ELEC2, name: "Tirage cables", weight: "1" });
    expect((await api().post(`/projects/${projectId}/tasks`, { wbsItemId: wbs.ELEC, name: "Sur parent" })).status).toBe(400);
    const task = response.body.tasks.find((item: { name: string }) => item.name === "Pose TGBT");
    response = await api().patch(`/projects/${projectId}/tasks/${task.id}/status`, { status: "DONE" });
    expect(response.body.physicalProgress).toBe("75.0");
    expect(response.body.cockpit.taskCounts.DONE).toBe(1);
    const elec = response.body.wbs.find((node: { code: string }) => node.code === "ELEC");
    expect(elec.physicalProgress).toBe("75.0");
    const go = response.body.wbs.find((node: { code: string }) => node.code === "GO-01");
    expect(go.physicalProgress).toBe("0.0");
  });

  it("cloture impossible tant qu'une tache est ouverte ; jalons et risques", async () => {
    expect((await api().post(`/projects/${projectId}/status`, { status: "COMPLETED" })).status).toBe(400);
    let response = await api().post(`/projects/${projectId}/milestones`, { name: "Reception lot electricite", dueDate: "2020-01-01" });
    const milestone = response.body.milestones[0];
    expect(milestone.overdue).toBe(true);
    response = await api().post(`/projects/${projectId}/milestones/${milestone.id}/achieve`);
    expect(response.body.milestones[0].status).toBe("ACHIEVED");
    expect((await api().post(`/projects/${projectId}/milestones/${milestone.id}/achieve`)).status).toBe(400);

    response = await api().post(`/projects/${projectId}/risks`, { title: "Retard d'importation", probability: 4, impact: 3 });
    expect(response.body.risks[0].score).toBe(12);
    expect((await api().post(`/projects/${projectId}/risks`, { title: "X", probability: 6, impact: 1 })).status).toBe(400);
  });

  it("suspension et annulation exigent un motif ; un projet annule est fige", async () => {
    expect((await api().post(`/projects/${projectId}/status`, { status: "ON_HOLD" })).status).toBe(400);
    const hold = await api().post(`/projects/${projectId}/status`, { status: "ON_HOLD", reason: "Attente permis" });
    expect(hold.body.status).toBe("ON_HOLD");
    const task = hold.body.tasks.find((item: { status: string }) => item.status !== "DONE");
    expect((await api().patch(`/projects/${projectId}/tasks/${task.id}/status`, { status: "DONE" })).status).toBe(400);

    const standalone = await api().post("/projects", { name: "Projet interne", currency: "EUR" });
    expect(standalone.status).toBe(201);
    expect(standalone.body.contractAmount).toBe("0.00");
    const cancelled = await api().post(`/projects/${standalone.body.id}/status`, { status: "CANCELLED", reason: "Abandon" });
    expect(cancelled.body.status).toBe("CANCELLED");
    expect((await api().post(`/projects/${standalone.body.id}/wbs`, { code: "A", name: "A" })).status).toBe(400);
    expect((await api().post(`/projects/${standalone.body.id}/status`, { status: "IN_PROGRESS" })).status).toBe(400);
  });

  it("RBAC : lecture seule ne permet ni creation ni saisie budgetaire", async () => {
    const reader = await createUserWith(harness, owner, ["projects.project.read"], "reader2");
    const client = as(harness, reader);
    expect((await client.get(`/projects/${projectId}`)).status).toBe(200);
    expect((await client.post("/projects", { name: "X" })).status).toBe(403);
    expect((await client.post(`/projects/${projectId}/tasks`, { wbsItemId: wbs.GO, name: "X" })).status).toBe(403);
  });

  it("audit : chaque mutation budgetaire est tracee", async () => {
    const logs = await harness.prisma.auditLog.findMany({
      where: { organizationId: owner.organizationId, action: { startsWith: "projects." } },
      select: { action: true },
    });
    const actions = new Set(logs.map((log) => log.action));
    for (const action of [
      "projects.project.created",
      "projects.budget.line_added",
      "projects.budget.baselined",
      "projects.changeorder.requested",
      "projects.changeorder.approved",
      "projects.changeorder.rejected",
      "projects.task.status_changed",
      "projects.project.status_changed",
    ]) {
      expect(actions.has(action)).toBe(true);
    }
  });
});
