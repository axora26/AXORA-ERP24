import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createHarness, registerTenant, type Harness, type Tenant } from "./support/harness.js";
import { createStartedProject, createUserWith } from "./support/fixtures.js";

const HOUR = 3_600_000;

/**
 * INC-15 — Actifs / GMAO : Actif -> Ticket -> OT -> Intervention -> Cloture
 * (backlog §5.10). DoD : un actif a une origine tracee, un OT ne se clot pas
 * sans temps ni compte-rendu, MTBF/MTTR viennent de l'historique reel.
 */
describe("Actifs / GMAO (e2e)", () => {
  let harness: Harness;
  let owner: Tenant;
  let other: Tenant;
  let requester: Tenant;
  let activityId = "";
  let assetId = "";
  let manualAssetId = "";
  let employeeId = "";
  let itemId = "";
  let warehouseId = "";
  let workOrderId = "";
  let ticketId = "";

  beforeAll(async () => {
    harness = await createHarness();
    owner = await registerTenant(harness, "gmao-a");
    other = await registerTenant(harness, "gmao-b");
    requester = await createUserWith(harness, owner, ["assets.asset.read", "assets.ticket.create"], "exploitant");
    const tester = await createUserWith(harness, owner, ["commissioning.activity.read", "commissioning.activity.manage"], "technicien-cx");
    const api = as(harness, owner);
    const { projectId } = await createStartedProject(harness, owner);
    const systems = await api.post("/mep/systems", { projectId, code: "CVC-01", name: "Traitement d'air", discipline: "HVAC" });
    const equipment = await api.post("/mep/equipment", { systemId: systems.body[0].id, tag: "CTA-01", name: "Centrale de traitement d'air", manufacturer: "Carrier", model: "39HQ" });
    await api.patch(`/mep/equipment/${equipment.body.id}`, { status: "SELECTED" });
    await api.patch(`/mep/equipment/${equipment.body.id}`, { status: "INSTALLED" });
    const activity = await as(harness, tester).post("/commissioning/activities", { equipmentId: equipment.body.id, procedure: "Procédure CTA" });
    activityId = activity.body.id;
    await as(harness, tester).post(`/commissioning/activities/${activityId}/tests`, { kind: "PRECOMMISSIONING", checks: [{ label: "Filtres posés", ok: true }] });
    const functional = await as(harness, tester).post(`/commissioning/activities/${activityId}/tests`, {
      kind: "FUNCTIONAL",
      measurements: [{ name: "Débit", unit: "m³/h", min: "11400", max: "12600", measured: "12000" }],
    });
    expect(functional.body.stage).toBe("READY_FOR_ACCEPTANCE");

    employeeId = (await api.post("/hr/employees", { firstName: "Jules", lastName: "Mbala", jobTitle: "Frigoriste", hireDate: "2025-03-01", contractType: "PERMANENT", hourlyCost: "32.50" })).body.id;
    itemId = (await api.post("/inventory/items", { code: "FLT-G4", name: "Filtre G4 592x592", unitCode: "u" })).body.id;
    warehouseId = (await api.post("/inventory/warehouses", { code: "MAG-MAINT", name: "Magasin maintenance" })).body.id;
    await api.post("/inventory/adjustments", { warehouseId, itemId, quantityDelta: "10", unitCost: "18.40", reason: "Stock initial maintenance" });
  });

  afterAll(async () => {
    await harness.close();
  });

  const api = () => as(harness, owner);

  it("passeport : uniquement depuis une mise en service receptionnee, une seule fois par equipement", async () => {
    const early = await api().post("/assets/from-commissioning", { commissioningActivityId: activityId });
    expect(early.status).toBe(400);
    expect((await api().post(`/commissioning/activities/${activityId}/accept`, { note: "Conforme" })).status).toBe(201);

    const created = await api().post("/assets/from-commissioning", { commissioningActivityId: activityId, serialNumber: "SN-39HQ-7781", criticality: "HIGH", warrantyEndsAt: "2028-09-30" });
    expect(created.status).toBe(201);
    assetId = created.body.id;
    expect(created.body).toMatchObject({ origin: "COMMISSIONING", equipmentTag: "CTA-01", manufacturer: "Carrier", model: "39HQ", status: "IN_SERVICE", underWarranty: true });
    expect(created.body.code).toMatch(/^AST-\d{4}-\d{4}$/);
    expect(created.body.commissioningCode).toMatch(/^CX-/);
    expect(created.body.reliability).toMatchObject({ failures: 0, mtbfHours: null, mttrHours: null });
    expect((await api().post("/assets/from-commissioning", { commissioningActivityId: activityId })).status).toBe(409);
    // Fixture : l'actif est suppose en service depuis 60 jours (historique d'exploitation a analyser).
    await harness.prisma.asset.update({ where: { id: assetId }, data: { installedAt: new Date(Date.now() - 60 * 86_400_000) } });
  });

  it("actif manuel : justification d'origine obligatoire, en API comme en base", async () => {
    const base = { name: "Groupe électrogène existant", location: "Local GE", installedAt: "2019-06-01" };
    expect((await api().post("/assets/manual", base)).status).toBe(400);
    const manual = await api().post("/assets/manual", { ...base, originJustification: "Équipement existant repris à l'inventaire contradictoire du 12/09/2026" });
    expect(manual.status).toBe(201);
    manualAssetId = manual.body.id;
    expect(manual.body).toMatchObject({ origin: "MANUAL", projectId: null, equipmentId: null });
    await expect(harness.prisma.asset.update({ where: { id: manualAssetId }, data: { originJustification: null } })).rejects.toThrow(/assets_origin_traceable/);
    await expect(harness.prisma.asset.delete({ where: { id: manualAssetId } })).rejects.toThrow(/DELETE is forbidden/);
  });

  it("preventif : generation idempotente des OT echus, echeance suivante avancee", async () => {
    const past = new Date(Date.now() - 40 * 86_400_000).toISOString().slice(0, 10);
    const plan = await api().post("/assets/plans", { assetId, title: "Changement filtres CTA", instructions: "Remplacer les filtres G4, contrôler la courroie", intervalDays: 30, firstDueDate: past, estimatedHours: "1.50" });
    expect(plan.status).toBe(201);
    expect(plan.body[0]).toMatchObject({ due: true, intervalDays: 30 });
    const first = await api().post("/assets/plans/generate", {});
    // Echeances a J-40 et J-10 : deux OT, l'echeance suivante passe dans le futur.
    expect(first.body.created).toHaveLength(2);
    const replay = await api().post("/assets/plans/generate", {});
    expect(replay.body.created).toHaveLength(0);
    const plans = await api().get(`/assets/plans?assetId=${assetId}`);
    expect(plans.body[0].due).toBe(false);
    const orders = await api().get(`/assets/work-orders?assetId=${assetId}`);
    expect(orders.body.filter((order: { type: string }) => order.type === "PREVENTIVE")).toHaveLength(2);
    expect(orders.body.some((order: { overdue: boolean }) => order.overdue)).toBe(true);
  });

  it("ticket : cree par l'exploitant, converti explicitement en OT correctif (pas d'auto-cloture)", async () => {
    const failureAt = new Date(Date.now() - 30 * HOUR).toISOString();
    expect((await as(harness, requester).post("/assets/tickets", { assetId, title: "Panne", description: "Avant mise en service", failureAt: new Date(Date.now() - 90 * 86_400_000).toISOString() })).status).toBe(400);
    expect((await as(harness, requester).post("/assets/tickets", { assetId, title: "CTA à l'arrêt", description: "Alarme défaut moteur", failureAt: new Date(Date.now() + 2 * HOUR).toISOString() })).status).toBe(400);
    const tickets = await as(harness, requester).post("/assets/tickets", { assetId, title: "CTA à l'arrêt", description: "Alarme défaut moteur ventilateur", priority: "URGENT", failureAt, outOfService: true });
    expect(tickets.status).toBe(201);
    ticketId = tickets.body[0].id;
    expect(tickets.body[0]).toMatchObject({ status: "OPEN", code: expect.stringMatching(/^TKT-/) });
    expect((await api().get(`/assets/items/${assetId}`)).body.status).toBe("OUT_OF_SERVICE");
    // L'exploitant signale mais ne pilote pas les OT.
    expect((await as(harness, requester).post(`/assets/tickets/${ticketId}/convert`, { dueDate: new Date().toISOString() })).status).toBe(403);

    const converted = await api().post(`/assets/tickets/${ticketId}/convert`, { dueDate: new Date(Date.now() + 86_400_000).toISOString(), assignedEmployeeId: employeeId });
    expect(converted.status).toBe(201);
    workOrderId = converted.body.id;
    expect(converted.body).toMatchObject({ type: "CORRECTIVE", status: "OPEN", ticketId, failureAt, assignedEmployeeName: "Jules Mbala" });
    expect((await api().post(`/assets/tickets/${ticketId}/convert`, { dueDate: new Date().toISOString() })).status).toBe(400);
  });

  it("intervention : temps au cout RH fige, pieces sorties du stock au cout moyen", async () => {
    expect((await api().post(`/assets/work-orders/${workOrderId}/labor`, { employeeId, workDate: "2026-09-24", hours: "3" })).status).toBe(400);
    expect((await api().post(`/assets/work-orders/${workOrderId}/start`, {})).status).toBe(201);
    expect((await api().post(`/assets/work-orders/${workOrderId}/labor`, { employeeId, workDate: "2026-09-24", hours: "25" })).status).toBe(400);
    const labor = await api().post(`/assets/work-orders/${workOrderId}/labor`, { employeeId, workDate: "2026-09-24", hours: "3.5" });
    expect(labor.body.labor[0]).toMatchObject({ employeeName: "Jules Mbala", hours: "3.50", hourlyCost: "32.50", cost: "113.75" });

    expect((await api().post(`/assets/work-orders/${workOrderId}/parts`, { itemId, warehouseId, quantity: "50" })).status).toBe(400);
    const part = await api().post(`/assets/work-orders/${workOrderId}/parts`, { itemId, warehouseId, quantity: "2" });
    expect(part.body.parts[0]).toMatchObject({ itemCode: "FLT-G4", quantity: "2.000", cost: "36.80" });
    expect(part.body).toMatchObject({ laborCost: "113.75", partsCost: "36.80", totalCost: "150.55" });
    const movement = await harness.prisma.stockMovement.findUniqueOrThrow({ where: { id: part.body.parts[0].stockMovementId } });
    expect(movement).toMatchObject({ type: "MAINTENANCE_ISSUE", reference: part.body.code });
    const balance = await api().get(`/inventory/balances?warehouseId=${warehouseId}`);
    expect(balance.body.find((row: { itemId: string }) => row.itemId === itemId).quantity).toBe("8.000");

    const line = await harness.prisma.workOrderLabor.findFirstOrThrow({ where: { workOrderId } });
    await expect(harness.prisma.workOrderLabor.update({ where: { id: line.id }, data: { hours: "1" } })).rejects.toThrow(/append-only/);
  });

  it("DoD : cloture bloquee sans compte-rendu ni remise en service valide (API et base)", async () => {
    expect((await api().post(`/assets/work-orders/${workOrderId}/complete`, {})).status).toBe(400);
    const tooEarly = new Date(Date.now() - 40 * HOUR).toISOString();
    expect((await api().post(`/assets/work-orders/${workOrderId}/complete`, { report: "Moteur remplacé", restoredAt: tooEarly })).status).toBe(400);
    await expect(harness.prisma.workOrder.update({ where: { id: workOrderId }, data: { status: "COMPLETED", completedAt: new Date() } })).rejects.toThrow(/completion report/);

    const restoredAt = new Date(Date.now() - 24 * HOUR).toISOString();
    const done = await api().post(`/assets/work-orders/${workOrderId}/complete`, { report: "Roulement moteur ventilateur remplacé, courroie retendue, essais OK", restoredAt });
    expect(done.status).toBe(201);
    expect(done.body).toMatchObject({ status: "COMPLETED", restoredAt, completedOnTime: true });
    expect((await api().get(`/assets/items/${assetId}`)).body.status).toBe("IN_SERVICE");
    await expect(harness.prisma.workOrder.update({ where: { id: workOrderId }, data: { completionReport: "réécrit" } })).rejects.toThrow(/is closed/);
    expect((await api().post(`/assets/work-orders/${workOrderId}/labor`, { employeeId, workDate: "2026-09-24", hours: "1" })).status).toBe(400);
  });

  it("fiabilite : MTTR/MTBF/disponibilite calcules sur l'historique reel des OT correctifs", async () => {
    const asset = await api().get(`/assets/items/${assetId}`);
    const reliability = asset.body.reliability;
    expect(reliability.failures).toBe(1);
    expect(reliability.downtimeHours).toBe("6.00");
    expect(reliability.mttrHours).toBe("6.00");
    const period = Number(reliability.periodHours);
    expect(Number(reliability.mtbfHours)).toBeCloseTo(period - 6, 1);
    expect(reliability.formula).toContain("MTBF");
    expect(asset.body.maintenanceCost).toBe("150.55");
    expect(asset.body.workOrders.length).toBe(3);

    const summary = await api().get("/assets/summary");
    expect(summary.body).toMatchObject({ assets: 2, openTickets: 0, overdueWorkOrders: 2, onTimeRate: "100.0", maintenanceCost: "150.55" });
    expect(summary.body.fleet).toMatchObject({ failures: 1, mttrHours: "6.00", downtimeHours: "6.00" });
  });

  it("annulation : motif obligatoire, impossible une fois du temps saisi ; rejet de ticket motive", async () => {
    const preventive = (await api().get(`/assets/work-orders?assetId=${assetId}&status=OPEN`)).body[0];
    expect((await api().post(`/assets/work-orders/${preventive.id}/cancel`, {})).status).toBe(400);
    const cancelled = await api().post(`/assets/work-orders/${preventive.id}/cancel`, { reason: "Filtres remplacés lors de l'OT correctif" });
    expect(cancelled.body.status).toBe("CANCELLED");
    const ticket = await as(harness, requester).post("/assets/tickets", { assetId: manualAssetId, title: "Bruit", description: "Bruit inhabituel au démarrage" });
    const id = ticket.body.find((row: { title: string }) => row.title === "Bruit").id;
    expect((await api().post(`/assets/tickets/${id}/reject`, {})).status).toBe(400);
    const rejected = await api().post(`/assets/tickets/${id}/reject`, { note: "Fonctionnement normal au démarrage à froid" });
    expect(rejected.body.find((row: { id: string }) => row.id === id)).toMatchObject({ status: "REJECTED", decisionNote: "Fonctionnement normal au démarrage à froid" });
  });

  it("mise au rebut : refusee tant qu'un OT est ouvert ; isolation et audit", async () => {
    expect((await api().patch(`/assets/items/${assetId}`, { status: "RETIRED" })).status).toBe(400);
    expect((await as(harness, other).get(`/assets/items/${assetId}`)).status).toBe(404);
    expect((await as(harness, other).get("/assets")).body).toHaveLength(0);
    expect((await as(harness, other).post(`/assets/work-orders/${workOrderId}/start`, {})).status).toBe(404);
    expect((await as(harness, other).post("/assets/tickets", { assetId, title: "x", description: "y" })).status).toBe(404);
    expect((await as(harness, requester).post("/assets/manual", { name: "x" })).status).toBe(403);
    const audit = await harness.prisma.auditLog.findMany({ where: { organizationId: owner.organizationId, action: { startsWith: "assets." } } });
    const actions = new Set(audit.map((entry) => entry.action));
    for (const action of ["assets.asset.created", "assets.plan.generated", "assets.ticket.converted", "assets.workorder.labor", "assets.workorder.part", "assets.workorder.completed", "assets.ticket.rejected"]) {
      expect(actions.has(action)).toBe(true);
    }
  });
});
