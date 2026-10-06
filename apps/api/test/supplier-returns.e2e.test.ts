import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createHarness, registerTenant, type Harness, type Tenant } from "./support/harness.js";
import { createStartedProject, createUserWith } from "./support/fixtures.js";

/**
 * INC-06 — Retour physique fournisseur.
 * Un retour diminue la quantite recue d'une ligne de commande (jamais au-dela
 * du recu net), fait sortir l'article stocke du depot de reception au cout
 * moyen et rouvre la commande. Idempotent, audite, borne au tenant.
 */
describe("Achats — retours fournisseur (e2e)", () => {
  let harness: Harness;
  let owner: Tenant;
  let other: Tenant;
  let project: { projectId: string; leafId: string };
  let site = "";
  let rebar = "";
  let orderId = "";
  let stockedLineId = "";
  let directLineId = "";
  const key = (label: string) => `${label}-${Date.now()}-${Math.random()}`;
  const api = () => as(harness, owner);
  const balanceOf = async (itemId: string, warehouseId: string) =>
    (await api().get(`/inventory/balances?itemId=${itemId}&warehouseId=${warehouseId}`)).body[0];

  beforeAll(async () => {
    harness = await createHarness();
    owner = await registerTenant(harness, "supplier-returns-a");
    other = await registerTenant(harness, "supplier-returns-b");
    project = await createStartedProject(harness, owner);
    const approver = await createUserWith(harness, owner, ["procurement.request.read", "procurement.request.approve"], "valideur-retour");

    rebar = (await api().post("/inventory/items", { code: "HA16", name: "Aciers HA 16", unitCode: "t" })).body.id;
    site = (await api().post("/inventory/warehouses", { code: "CHT-RET", name: "Magasin chantier retours", kind: "SITE", projectId: project.projectId })).body.id;
    const supplier = await api().post("/procurement/suppliers", { name: `Aciers retours ${Date.now()}` });

    let request = await api().post("/procurement/requests", {
      title: "Aciers et coffrage",
      projectId: project.projectId,
      lines: [
        { inventoryItemId: rebar, quantity: "10", estimatedUnitPrice: "1000.00", wbsItemId: project.leafId },
        { description: "Panneaux coffrage", unitCode: "u", quantity: "20", estimatedUnitPrice: "50.00", wbsItemId: project.leafId },
      ],
    });
    expect(request.status).toBe(201);
    await api().post(`/procurement/requests/${request.body.id}/submit`);
    await as(harness, approver).post(`/procurement/requests/${request.body.id}/approve`);
    request = await api().post(`/procurement/requests/${request.body.id}/quotes`, {
      supplierId: supplier.body.id,
      lines: [
        { requestLineId: request.body.lines[0].id, unitPrice: "1100.00" },
        { requestLineId: request.body.lines[1].id, unitPrice: "45.00" },
      ],
    });
    const order = await api().post("/procurement/orders", { requestId: request.body.id, quoteId: request.body.quotes[0].id });
    orderId = order.body.id;
    stockedLineId = order.body.lines[0].id;
    directLineId = order.body.lines[1].id;
    await api().post(`/procurement/orders/${orderId}/issue`);
    const received = await api().post(`/procurement/orders/${orderId}/receipts`, {
      idempotencyKey: key("rcpt"),
      warehouseId: site,
      lines: [
        { orderLineId: stockedLineId, quantity: "10" },
        { orderLineId: directLineId, quantity: "20" },
      ],
    });
    expect(received.status).toBe(201);
    expect(received.body.status).toBe("RECEIVED");
  }, 120_000);

  afterAll(async () => {
    await harness.close();
  });

  it("refuse un retour au-dela du recu, sans motif ou sans ligne", async () => {
    const over = await api().post(`/procurement/orders/${orderId}/returns`, {
      idempotencyKey: key("ret"),
      reason: "Non conforme",
      lines: [{ orderLineId: stockedLineId, quantity: "10.001" }],
    });
    expect(over.status).toBe(400);
    const noReason = await api().post(`/procurement/orders/${orderId}/returns`, {
      idempotencyKey: key("ret"),
      lines: [{ orderLineId: stockedLineId, quantity: "1" }],
    });
    expect(noReason.status).toBe(400);
    const empty = await api().post(`/procurement/orders/${orderId}/returns`, { idempotencyKey: key("ret"), reason: "x", lines: [] });
    expect(empty.status).toBe(400);
  });

  it("retour partiel : stock sorti au cout moyen, recu net diminue, commande rouverte, projet desengage du consomme", async () => {
    const consumedBefore = (await api().get(`/projects/${project.projectId}`)).body.cockpit.consumed.amount;
    const returnKey = key("ret");
    const response = await api().post(`/procurement/orders/${orderId}/returns`, {
      idempotencyKey: returnKey,
      reason: "Aciers oxydés à la livraison",
      lines: [
        { orderLineId: stockedLineId, quantity: "2.500" },
        { orderLineId: directLineId, quantity: "4" },
      ],
    });
    expect(response.status).toBe(201);
    expect(response.body.status).toBe("PARTIALLY_RECEIVED");
    const stocked = response.body.lines.find((line: { id: string }) => line.id === stockedLineId);
    expect(stocked.receivedQuantity).toBe("7.500");
    expect(stocked.returnedQuantity).toBe("2.500");
    expect(stocked.remainingQuantity).toBe("2.500");
    expect(response.body.returns).toHaveLength(1);
    expect(response.body.returns[0].code).toMatch(/^RF-\d{4}-\d{4}$/);
    expect(response.body.returns[0].reason).toBe("Aciers oxydés à la livraison");
    expect(response.body.receivedValue).toBe("8970.00"); // 7.5 x 1100 + 16 x 45

    const balance = await balanceOf(rebar, site);
    expect(balance.quantity).toBe("7.500");
    expect(balance.value).toBe("8250.00");
    const movements = (await api().get(`/inventory/movements?itemId=${rebar}&warehouseId=${site}`)).body;
    const out = movements.find((movement: { type: string }) => movement.type === "SUPPLIER_RETURN");
    expect(out.quantityDelta).toBe("-2.500");
    expect(out.valueDelta).toBe("-2750.00");

    // Seul le direct (non stocke) etait consomme par le projet : 4 x 45 retires.
    const consumedAfter = (await api().get(`/projects/${project.projectId}`)).body.cockpit.consumed.amount;
    expect(Number(consumedBefore) - Number(consumedAfter)).toBeCloseTo(180, 2);

    const replay = await api().post(`/procurement/orders/${orderId}/returns`, {
      idempotencyKey: returnKey,
      reason: "Aciers oxydés à la livraison",
      lines: [{ orderLineId: stockedLineId, quantity: "2.500" }],
    });
    expect(replay.status).toBe(201);
    expect(replay.body.returns).toHaveLength(1);
    expect((await balanceOf(rebar, site)).quantity).toBe("7.500");
  });

  it("la marchandise retournee peut etre re-receptionnee, sans depasser la commande", async () => {
    const again = await api().post(`/procurement/orders/${orderId}/receipts`, {
      idempotencyKey: key("rcpt"),
      warehouseId: site,
      lines: [{ orderLineId: stockedLineId, quantity: "2.500" }],
    });
    expect(again.status).toBe(201);
    const over = await api().post(`/procurement/orders/${orderId}/receipts`, {
      idempotencyKey: key("rcpt"),
      lines: [{ orderLineId: directLineId, quantity: "4.001" }],
    });
    expect(over.status).toBe(400);
  });

  it("un retour stocke exige le stock libre du depot de reception", async () => {
    await api().post("/inventory/reservations", {
      projectId: project.projectId,
      wbsItemId: project.leafId,
      itemId: rebar,
      warehouseId: site,
      quantity: "9.000",
      reason: "Voiles R+1",
      idempotencyKey: key("res"),
    });
    const blocked = await api().post(`/procurement/orders/${orderId}/returns`, {
      idempotencyKey: key("ret"),
      reason: "Surplus",
      lines: [{ orderLineId: stockedLineId, quantity: "2" }],
    });
    expect(blocked.status).toBe(400);
    expect((await balanceOf(rebar, site)).quantity).toBe("10.000");
  });

  it("concurrence : deux retours simultanes ne depassent jamais le recu net", async () => {
    const attempts = await Promise.all(
      ["a", "b"].map((suffix) =>
        api().post(`/procurement/orders/${orderId}/returns`, {
          idempotencyKey: key(`race-${suffix}`),
          reason: "Doublon de livraison",
          lines: [{ orderLineId: directLineId, quantity: "16" }],
        }),
      ),
    );
    expect(attempts.map((attempt) => attempt.status).sort()).toEqual([201, 400]);
    const order = await api().get(`/procurement/orders/${orderId}`);
    const direct = order.body.lines.find((line: { id: string }) => line.id === directLineId);
    expect(direct.receivedQuantity).toBe("0.000");
    expect(direct.returnedQuantity).toBe("20.000");
  });

  it("RBAC, isolation tenant et audit", async () => {
    const receiver = await createUserWith(harness, owner, ["procurement.order.read", "procurement.receipt.create"], "receptionnaire");
    const denied = await as(harness, receiver).post(`/procurement/orders/${orderId}/returns`, {
      idempotencyKey: key("ret"),
      reason: "x",
      lines: [{ orderLineId: stockedLineId, quantity: "1" }],
    });
    expect(denied.status).toBe(403);
    const intrusion = await as(harness, other).post(`/procurement/orders/${orderId}/returns`, {
      idempotencyKey: key("ret"),
      reason: "x",
      lines: [{ orderLineId: stockedLineId, quantity: "1" }],
    });
    expect(intrusion.status).toBe(404);
    const audit = await api().get("/admin/audit?action=procurement.return.&pageSize=50");
    expect(audit.status).toBe(200);
    expect(audit.body.items.map((item: { action: string }) => item.action)).toContain("procurement.return.created");
  });
});
