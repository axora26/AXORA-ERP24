import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createHarness, registerTenant, type Harness, type Tenant } from "./support/harness.js";
import { createStartedProject, createUserWith } from "./support/fixtures.js";
import { operationsRange } from "../src/projects/project-operations.service.js";

describe("Project operations: real sources and permission boundaries", () => {
  let harness: Harness; let owner: Tenant; let other: Tenant; let reader: Tenant; let noPay: Tenant; let fleetReader: Tenant; let manager: Tenant;
  let projectId: string; let leafId: string; let employeeId: string; let assetId: string; let itemId: string; let warehouseId: string;
  const today = new Date().toISOString().slice(0, 10);
  const day = (offset: number) => new Date(new Date(`${today}T00:00:00Z`).getTime() + offset * 86_400_000).toISOString().slice(0, 10);
  const range = () => `from=${day(-2)}&to=${today}`;
  const operations = (tenant = owner, dates = range()) => as(harness, tenant).get(`/projects/${projectId}/operations?${dates}`);
  beforeAll(async () => {
    if (!new URL(process.env.DATABASE_URL!).pathname.endsWith("_test")) throw new Error("Operations tests require an isolated _test database");
    harness = await createHarness(); owner = await registerTenant(harness, "operations"); other = await registerTenant(harness, "operations-other");
    ({ projectId, leafId } = await createStartedProject(harness, owner));
    reader = await createUserWith(harness, owner, ["projects.project.read"], "project-reader");
    noPay = await createUserWith(harness, owner, ["projects.project.read", "hr.employee.read", "inventory.item.read", "fleet.vehicle.read", "assets.asset.read"], "operations-no-pay");
    fleetReader = await createUserWith(harness, owner, ["projects.project.read", "fleet.vehicle.read"], "operations-fleet-reader");
    manager = await createUserWith(harness, owner, ["hr.employee.read", "hr.timesheet.validate"], "operations-validator");
    const api = as(harness, owner);
    const employee = await api.post("/hr/employees", { firstName: "Amani", lastName: "Operations", jobTitle: "Technicien", hireDate: "2025-01-01", contractType: "PERMANENT", hourlyCost: "25.00", currency: "USD" });
    expect(employee.status).toBe(201); employeeId = employee.body.id;
    for (const [type, occurredAt, linkedProject] of [
      ["IN", `${day(-2)}T23:00:00Z`, projectId], ["OUT", `${day(-1)}T02:00:00Z`, undefined],
      ["IN", `${day(-1)}T03:00:00Z`, undefined], ["OUT", `${day(-1)}T04:00:00Z`, undefined],
      ["IN", `${day(-1)}T05:00:00Z`, projectId],
    ] as const) expect((await api.post("/hr/attendance", { employeeId, type, occurredAt, ...(linkedProject ? { projectId: linkedProject } : {}) })).status).toBe(201);
    const start = new Date(`${today}T00:00:00Z`); start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
    const sheet = await api.post("/hr/timesheets", { employeeId, weekStart: start.toISOString().slice(0, 10) }); expect(sheet.status).toBe(201);
    expect((await api.put(`/hr/timesheets/${sheet.body.id}/entries`, { entries: [{ workDate: today, hours: "2.5", projectId, wbsItemId: leafId, description: "Installation réelle" }] })).status).toBe(200);
    expect((await api.post(`/hr/timesheets/${sheet.body.id}/submit`)).status).toBe(201);
    expect((await as(harness, manager).post(`/hr/timesheets/${sheet.body.id}/validate`)).status).toBe(201);
    itemId = (await api.post("/inventory/items", { code: "OPS-MAT", name: "Câbles", unitCode: "m" })).body.id;
    warehouseId = (await api.post("/inventory/warehouses", { code: "OPS-SITE", name: "Magasin du chantier", kind: "SITE", projectId })).body.id;
    expect((await api.post("/inventory/adjustments", { warehouseId, itemId, quantityDelta: "10", unitCost: "12.50", reason: "Stock réel initial" })).status).toBe(201);
    expect((await api.post("/inventory/issues", { warehouseId, projectId, wbsItemId: leafId, idempotencyKey: "OPS-ISSUE", lines: [{ itemId, quantity: "4" }] })).status).toBe(201);
    expect((await api.post("/inventory/returns", { warehouseId, projectId, wbsItemId: leafId, idempotencyKey: "OPS-RETURN", lines: [{ itemId, quantity: "1" }] })).status).toBe(201);
    const scope = { organizationId: owner.organizationId, companyId: owner.companyId };
    const asset = await harness.prisma.asset.create({ data: { ...scope, projectId, code: "OPS-ASSET", name: "Pompe installée", location: "Local technique", installedAt: new Date(`${day(-3)}T00:00:00Z`), origin: "MANUAL", originJustification: "Actif préexistant documenté", createdByUserId: owner.userId } }); assetId = asset.id;
    const fleetAsset = await harness.prisma.asset.create({ data: { ...scope, code: "OPS-FLT-ASSET", name: "Véhicule chantier", location: "Dépôt", installedAt: new Date(), origin: "MANUAL", originJustification: "Acquisition documentée", createdByUserId: owner.userId } });
    const vehicle = await harness.prisma.fleetVehicle.create({ data: { ...scope, code: "OPS-VEH", kind: "MACHINE", category: "Utilitaire", make: "Axora", model: "Machine chantier", fuelType: "NONE", usageUnit: "HOURS", assetId: fleetAsset.id, acquisitionDate: new Date(), homeBase: "Dépôt", createdByUserId: owner.userId } });
    await harness.prisma.fleetAssignment.create({ data: { ...scope, code: "OPS-AFFECT", vehicleId: vehicle.id, employeeId, projectId, purpose: "Travaux du chantier", startAt: new Date(`${day(-1)}T06:00:00Z`), startReading: "0", createdByUserId: owner.userId } });
  });
  afterAll(async () => { await harness?.close(); });

  it("clips genuine overnight attendance and signals open intervals without invented hours", async () => {
    const response = await operations(); expect(response.status).toBe(200);
    expect(response.body.attendance.summary).toEqual({ employeeCount: 1, workedMinutes: 180, openIntervals: 1 });
    expect(response.body.attendance.rows.filter((row: { open: boolean }) => !row.open).map((row: { minutes: number }) => row.minutes)).toEqual([60, 120]);
    expect(response.body.attendance.rows.find((row: { open: boolean }) => row.open)).toMatchObject({ minutes: 0, clockOutAt: null });
    const clipped = await operations(owner, `from=${day(-1)}&to=${day(-1)}`);
    expect(clipped.body.attendance.summary.workedMinutes).toBe(120);
    expect(clipped.body.attendance.rows[0].clockInAt).toBe(`${day(-1)}T00:00:00.000Z`);
  });

  it("joins actual net material, validated time and current site balances without double counting stock", async () => {
    const response = await operations(); expect(response.status).toBe(200);
    expect(response.body.materials.rows.map((row: { type: string }) => row.type)).toEqual(["ISSUE", "RETURN"]);
    expect(response.body.materials.netCost).toBe("37.50");
    expect(response.body.materials.rows[0]).toMatchObject({ itemId, wbsItemId: leafId, quantityDelta: "-4.000", valueDelta: "-50.00" });
    expect(response.body.materials.siteBalances[0]).toMatchObject({ itemId, warehouseId, quantity: "7.000", value: "87.50" });
    expect(response.body.timesheets).toMatchObject({ validatedHours: "2.50", validatedCost: "62.50" });
    expect(response.body.timesheets.rows[0]).toMatchObject({ employeeId, costAmount: "62.50", status: "VALIDATED" });
    expect(response.body.costs.total).toMatchObject({ available: true, amount: "100.00" });
    const before = await operations(owner, `from=${day(-2)}&to=${day(-2)}`);
    expect(before.body.materials.rows).toEqual([]); expect(before.body.costs.materials.amount).toBe("0.00");
    expect(before.body.materials.siteBalances[0].quantity).toBe("7.000");
  });

  it("distinguishes genuine fleet assignment from project-origin assets", async () => {
    const response = await operations();
    expect(response.body.equipment.fleetAssignments[0]).toMatchObject({ code: "OPS-VEH", employeeId, employeeName: "Amani Operations", endAt: null });
    expect(response.body.equipment.assets).toEqual([{ id: assetId, code: "OPS-ASSET", name: "Pompe installée", location: "Local technique", status: "IN_SERVICE", source: "PROJECT_ORIGIN" }]);
    const before = await operations(owner, `from=${day(-2)}&to=${day(-2)}`); expect(before.body.equipment.fleetAssignments).toEqual([]);
  });

  it("requires every source permission and keeps unknown values explicit", async () => {
    const response = await operations(reader); expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ attendance: null, timesheets: null, materials: null, equipment: null });
    for (const value of Object.values(response.body.costs) as Array<{ amount: string | null; available: boolean }>) expect(value).toMatchObject({ amount: null, available: false });
    expect(Object.values(response.body.actions)).toEqual([false, false, false, false]);
    const protectedCockpit = await as(harness, reader).get(`/projects/${projectId}`);
    expect(protectedCockpit.body.cockpit.initialBudget).toBe("40000.00");
    expect(protectedCockpit.body.cockpit.consumed).toMatchObject({ available: false });
    expect(protectedCockpit.body.cockpit.consumed.source).toContain("Paie");
    const writer = await createUserWith(harness, owner, ["projects.project.read", "projects.project.manage"], "operations-writer");
    const changed = await as(harness, writer).post(`/projects/${projectId}/risks`, { title: "Confidentialité", description: "Réponse mutation sans fuite coût", probability: 1, impact: 1 });
    expect(changed.status).toBe(201); expect(changed.body.cockpit.consumed.available).toBe(false);
    const payroll = await operations(noPay);
    expect(payroll.body.timesheets.rows[0].costAmount).toBeNull(); expect(payroll.body.timesheets.validatedCost).toBeNull();
    expect(payroll.body.timesheets.validatedHours).toBe("2.50"); expect(payroll.body.costs.labor.amount).toBeNull(); expect(payroll.body.costs.total.amount).toBeNull();
    const fleet = await operations(fleetReader);
    expect(fleet.body.equipment.assets).toBeNull(); expect(fleet.body.equipment.fleetAssignments[0]).toMatchObject({ employeeId: null, employeeName: null });
  });

  it("allocates split direct receipt rounding cumulatively and keeps report totals equal to the cockpit", async () => {
    const scope = { organizationId: owner.organizationId, companyId: owner.companyId };
    const supplier = await harness.prisma.supplier.create({ data: { ...scope, code: "OPS-SUP", name: "Prestataire réel" } });
    const order = await harness.prisma.purchaseOrder.create({ data: { ...scope, code: "OPS-ORDER", supplierId: supplier.id, projectId, currency: "USD", status: "RECEIVED", total: "0.01", createdByUserId: owner.userId } });
    const line = await harness.prisma.purchaseOrderLine.create({ data: { ...scope, orderId: order.id, position: 1, description: "Consommation directe", unitCode: "u", quantity: "1", receivedQuantity: "1", unitPrice: "0.01", lineTotal: "0.01", projectId, wbsItemId: leafId } });
    for (const [index, quantity] of ["0.333", "0.333", "0.334"].entries()) {
      await harness.prisma.goodsReceipt.create({ data: { ...scope, code: `OPS-RCPT-${index}`, orderId: order.id, idempotencyKey: `OPS-RCPT-${index}`, receivedByUserId: owner.userId, receivedAt: new Date(`${day(index - 2)}T00:00:00Z`), lines: { create: { orderLineId: line.id, quantity } } } });
    }
    const costs: string[] = [];
    for (const offset of [-2, -1, 0]) costs.push((await operations(owner, `from=${day(offset)}&to=${day(offset)}`)).body.costs.directReceipts.amount);
    expect(costs).toEqual(["0.00", "0.01", "0.00"]);
    const response = await operations(); expect(response.body.costs.directReceipts.amount).toBe("0.01");
    const cockpit = await as(harness, owner).get(`/projects/${projectId}`);
    expect(response.body.costs.total.amount).toBe(cockpit.body.cockpit.consumed.amount);
  });

  it("does not silently combine labor currencies or manufacture missing payroll values", async () => {
    const api = as(harness, owner);
    const employee = await api.post("/hr/employees", { firstName: "Euro", lastName: "Operations", jobTitle: "Technicien", hireDate: "2025-01-01", contractType: "PERMANENT", hourlyCost: "10.00", currency: "EUR" }); expect(employee.status).toBe(201);
    const start = new Date(`${today}T00:00:00Z`); start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
    const sheet = await api.post("/hr/timesheets", { employeeId: employee.body.id, weekStart: start.toISOString().slice(0, 10) }); expect(sheet.status).toBe(201);
    expect((await api.put(`/hr/timesheets/${sheet.body.id}/entries`, { entries: [{ workDate: today, hours: "1", projectId }] })).status).toBe(200);
    expect((await api.post(`/hr/timesheets/${sheet.body.id}/submit`)).status).toBe(201);
    expect((await as(harness, manager).post(`/hr/timesheets/${sheet.body.id}/validate`)).status).toBe(201);
    const response = await operations(); expect(response.status).toBe(200);
    expect(response.body.timesheets.validatedHours).toBe("3.50");
    expect(response.body.timesheets.rows.find((row: { employeeId: string }) => row.employeeId === employee.body.id).costAmount).toBeNull();
    expect(response.body.costs.labor).toMatchObject({ available: false, amount: null }); expect(response.body.costs.total.amount).toBeNull();
    expect(response.body.costs.labor.source).toContain("devises différentes");
    const cockpit = await api.get(`/projects/${projectId}`); expect(cockpit.body.cockpit.consumed.available).toBe(false);
    expect(cockpit.body.cockpit.consumed.source).toContain("devises différentes");
  });

  it("isolates company/project and refuses malformed or excessive calendar ranges", async () => {
    expect((await operations(other)).status).toBe(404);
    expect((await as(harness, manager).get(`/projects/${projectId}/operations?${range()}`)).status).toBe(403);
    for (const query of ["from=2026-02-30&to=2026-03-01", "from=2026-01-01&to=2026-02-01", "from=2026-03-02&to=2026-03-01", "from=2026-01-01T00:00:00Z&to=2026-01-02", "from=2026-01-01&to=2026-01-02&permissions=all", "from=2026-01-01&from=2026-01-02&to=2026-01-02"]) expect((await operations(owner, query)).status).toBe(400);
    const defaultRange = operationsRange({}, new Date("2026-10-03T12:00:00Z")); expect(defaultRange.fromLabel).toBe("2026-09-27"); expect(defaultRange.toLabel).toBe("2026-10-03");
    expect(operationsRange({ from: "2026-01-01", to: "2026-01-31" }).toLabel).toBe("2026-01-31");
  });
});
