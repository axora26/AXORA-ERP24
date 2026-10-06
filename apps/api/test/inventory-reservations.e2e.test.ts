import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createHarness, registerTenant, type Harness, type Tenant } from "./support/harness.js";
import { createStartedProject } from "./support/fixtures.js";

describe("Inventory reservations: material secured for a project", () => {
  let harness: Harness;
  let owner: Tenant;
  let projectId: string;
  let leafId: string;
  let itemId: string;
  let warehouseId: string;

  beforeAll(async () => {
    harness = await createHarness();
    owner = await registerTenant(harness, "inventory-reservations");
    const project = await createStartedProject(harness, owner);
    projectId = project.projectId;
    leafId = project.leafId;
    const api = as(harness, owner);
    const item = await api.post("/inventory/items", { name: "Acier réservation", unitCode: "u" });
    expect(item.status).toBe(201);
    itemId = item.body.id;
    const warehouse = await api.post("/inventory/warehouses", { code: "SITE-RES", name: "Site réservation", kind: "SITE", projectId });
    expect(warehouse.status).toBe(201);
    warehouseId = warehouse.body.id;
    expect((await api.post("/inventory/adjustments", { warehouseId, itemId, quantityDelta: "10", unitCost: "20.00", reason: "Stock initial chantier" })).status).toBe(201);
  }, 60_000);

  afterAll(async () => {
    await harness?.close();
  });

  it("enforces free quantity, consumes by issue and releases idempotently", async () => {
    const api = as(harness, owner);
    const reservation = await api.post("/inventory/reservations", {
      projectId,
      wbsItemId: leafId,
      itemId,
      warehouseId,
      quantity: "6.000",
      neededAt: "2026-12-01",
      reason: "Lot façade",
      idempotencyKey: "RES-001",
    });
    expect(reservation.status).toBe(201);
    expect(reservation.body.status).toBe("ACTIVE");
    expect(reservation.body.remainingQuantity).toBe("6.000");

    const replay = await api.post("/inventory/reservations", {
      projectId,
      wbsItemId: leafId,
      itemId,
      warehouseId,
      quantity: "6.000",
      neededAt: "2026-12-01",
      reason: "Lot façade",
      idempotencyKey: "RES-001",
    });
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(reservation.body.id);

    const tooMuch = await api.post("/inventory/reservations", {
      projectId,
      itemId,
      warehouseId,
      quantity: "5.000",
      reason: "Dépassement du stock libre",
      idempotencyKey: "RES-002",
    });
    expect(tooMuch.status).toBe(400);

    const issue = await api.post("/inventory/issues", {
      warehouseId,
      projectId,
      wbsItemId: leafId,
      idempotencyKey: "ISSUE-RES-001",
      lines: [{ itemId, quantity: "2.000", reservationId: reservation.body.id }],
    });
    expect(issue.status).toBe(201);
    const listed = await api.get(`/inventory/reservations?projectId=${projectId}`);
    expect(listed.status).toBe(200);
    expect(listed.body.find((row: { id: string }) => row.id === reservation.body.id).remainingQuantity).toBe("4.000");

    const released = await api.post(`/inventory/reservations/${reservation.body.id}/release`, { reason: "Lot reporté", idempotencyKey: "REL-001" });
    expect(released.status).toBe(201);
    expect(released.body.status).toBe("RELEASED");
    expect(released.body.remainingQuantity).toBe("0.000");
    const releaseReplay = await api.post(`/inventory/reservations/${reservation.body.id}/release`, { reason: "Lot reporté", idempotencyKey: "REL-001" });
    expect(releaseReplay.status).toBe(201);
    expect(releaseReplay.body.status).toBe("RELEASED");

    const audit = await harness.prisma.auditLog.findMany({
      where: { organizationId: owner.organizationId, resourceType: "StockReservation", resourceId: reservation.body.id },
      orderBy: { createdAt: "asc" },
      select: { action: true },
    });
    expect(audit.map((row) => row.action)).toEqual(["inventory.reservation.created", "inventory.reservation.released"]);
  });
});
