import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createHarness, registerTenant, type Harness, type Tenant } from "./support/harness.js";
import { createStartedProject, createUserWith } from "./support/fixtures.js";

/** INC-07 — Stock : grand livre append-only, solde non negatif, cout moyen, flux chantier. */
describe("Stock & Logistique (e2e)", () => {
  let harness: Harness;
  let owner: Tenant;
  let other: Tenant;
  let project: { projectId: string; leafId: string };
  let central = "";
  let site = "";
  let cement = "";
  let rebar = "";

  beforeAll(async () => {
    harness = await createHarness();
    owner = await registerTenant(harness, "inventory-a");
    other = await registerTenant(harness, "inventory-b");
    project = await createStartedProject(harness, owner);
  });

  afterAll(async () => {
    await harness.close();
  });

  const api = () => as(harness, owner);
  const key = (label: string) => `${label}-${Date.now()}-${Math.random()}`;
  const balanceOf = async (itemId: string, warehouseId: string) =>
    (await api().get(`/inventory/balances?itemId=${itemId}&warehouseId=${warehouseId}`)).body[0];

  it("articles et magasins : un magasin de chantier est rattache a un projet", async () => {
    const item = await api().post("/inventory/items", { name: "Ciment CEM II 42.5", unitCode: "t", minStock: "20" });
    expect(item.status).toBe(201);
    expect(item.body.code).toMatch(/^ART-\d{4}-\d{4}$/);
    cement = item.body.id;
    rebar = (await api().post("/inventory/items", { code: "HA12", name: "Aciers HA 12", unitCode: "t" })).body.id;
    expect((await api().post("/inventory/items", { code: "HA12", name: "Doublon", unitCode: "t" })).status).toBe(409);

    central = (await api().post("/inventory/warehouses", { code: "mag-central", name: "Magasin central" })).body.id;
    expect((await api().post("/inventory/warehouses", { code: "CHT-X", name: "Chantier", kind: "SITE" })).status).toBe(400);
    const siteStore = await api().post("/inventory/warehouses", { code: "CHT-1", name: "Magasin chantier", kind: "SITE", projectId: project.projectId });
    expect(siteStore.status).toBe(201);
    site = siteStore.body.id;
    expect(siteStore.body.projectCode).toMatch(/^PRJ-/);
  });

  it("cout moyen pondere : deux entrees a des prix differents, sortie au cout moyen", async () => {
    await api().post("/inventory/adjustments", { warehouseId: central, itemId: cement, quantityDelta: "10", unitCost: "100.00", reason: "Stock initial" });
    const second = await api().post("/inventory/adjustments", { warehouseId: central, itemId: cement, quantityDelta: "10", unitCost: "130.00", reason: "Stock initial lot 2" });
    expect(second.status).toBe(201);
    let balance = await balanceOf(cement, central);
    expect(balance.quantity).toBe("20.000");
    expect(balance.value).toBe("2300.00");
    expect(balance.averageCost).toBe("115.0000");

    const issued = await api().post("/inventory/issues", {
      warehouseId: central,
      projectId: project.projectId,
      wbsItemId: project.leafId,
      idempotencyKey: key("issue"),
      reference: "BS-001",
      lines: [{ itemId: cement, quantity: "5" }],
    });
    expect(issued.status).toBe(201);
    balance = await balanceOf(cement, central);
    expect(balance.quantity).toBe("15.000");
    expect(balance.value).toBe("1725.00");

    const cockpit = (await api().get(`/projects/${project.projectId}`)).body.cockpit;
    expect(cockpit.consumed.amount).toBe("575.00");
  });

  it("solde jamais negatif : une sortie au-dela du disponible est refusee", async () => {
    const response = await api().post("/inventory/issues", {
      warehouseId: central,
      projectId: project.projectId,
      idempotencyKey: key("too-much"),
      lines: [{ itemId: cement, quantity: "15.001" }],
    });
    expect(response.status).toBe(400);
    expect(response.body.message).toContain("Stock insuffisant");
    // La base elle-meme refuse un solde negatif (contrainte CHECK).
    await expect(
      harness.prisma.stockBalance.updateMany({ where: { itemId: cement, warehouseId: central }, data: { quantity: -1 } }),
    ).rejects.toThrow();
  });

  it("concurrence : deux sorties simultanees ne consomment jamais le meme disponible", async () => {
    const attempts = await Promise.all(
      [1, 2].map((index) =>
        api().post("/inventory/issues", {
          warehouseId: central,
          projectId: project.projectId,
          idempotencyKey: key(`race-${index}`),
          lines: [{ itemId: cement, quantity: "10" }],
        }),
      ),
    );
    expect(attempts.map((attempt) => attempt.status).sort()).toEqual([201, 400]);
    expect((await balanceOf(cement, central)).quantity).toBe("5.000");
  });

  it("idempotence : une sortie rejouee avec la meme cle ne sort rien de plus", async () => {
    const idempotencyKey = key("replay");
    const body = { warehouseId: central, projectId: project.projectId, idempotencyKey, lines: [{ itemId: cement, quantity: "1" }] };
    expect((await api().post("/inventory/issues", body)).status).toBe(201);
    const replay = await api().post("/inventory/issues", body);
    expect(replay.status).toBe(201);
    expect(replay.body.replayed).toBe(true);
    expect((await balanceOf(cement, central)).quantity).toBe("4.000");
  });

  it("transfert : valeur sortie = valeur entree, sortie totale sans residu", async () => {
    const response = await api().post("/inventory/transfers", {
      fromWarehouseId: central,
      toWarehouseId: site,
      idempotencyKey: key("transfer"),
      lines: [{ itemId: cement, quantity: "4" }],
    });
    expect(response.status).toBe(201);
    const source = await balanceOf(cement, central);
    const destination = await balanceOf(cement, site);
    expect(source.quantity).toBe("0.000");
    expect(source.value).toBe("0.00");
    expect(destination.quantity).toBe("4.000");
    expect(destination.value).toBe("460.00");
  });

  it("retour chantier : diminue la consommation du projet", async () => {
    await api().post("/inventory/issues", {
      warehouseId: site,
      projectId: project.projectId,
      idempotencyKey: key("site-issue"),
      lines: [{ itemId: cement, quantity: "3" }],
    });
    // 575 (5 t) + 1150 (course gagnante, 10 t) + 115 (1 t idempotent) + 345 (3 t chantier) = 2185.
    let consumed = (await api().get(`/projects/${project.projectId}`)).body.cockpit.consumed.amount;
    expect(consumed).toBe("2185.00");
    const returned = await api().post("/inventory/returns", {
      warehouseId: site,
      projectId: project.projectId,
      idempotencyKey: key("return"),
      lines: [{ itemId: cement, quantity: "1" }],
    });
    expect(returned.status).toBe(201);
    consumed = (await api().get(`/projects/${project.projectId}`)).body.cockpit.consumed.amount;
    expect(consumed).toBe("2070.00");
  });

  it("grand livre append-only : aucune route de modification, trigger en base", async () => {
    const ledger = await api().get(`/inventory/movements?itemId=${cement}`);
    expect(ledger.status).toBe(200);
    const types = ledger.body.map((movement: { type: string }) => movement.type);
    expect(types).toEqual(expect.arrayContaining(["ADJUSTMENT_IN", "ISSUE", "TRANSFER_OUT", "TRANSFER_IN", "RETURN"]));
    const movementId = ledger.body[0].id;
    expect((await api().patch(`/inventory/movements/${movementId}`, { quantityDelta: "0" })).status).toBe(404);
    expect((await api().delete(`/inventory/movements/${movementId}`)).status).toBe(404);
    await expect(harness.prisma.stockMovement.update({ where: { id: movementId }, data: { reason: "falsifie" } })).rejects.toThrow(/append-only/);
    await expect(harness.prisma.stockMovement.delete({ where: { id: movementId } })).rejects.toThrow(/append-only/);
  });

  it("inventaire physique : gel du magasin, ecarts transformes en ajustements traces", async () => {
    await api().post("/inventory/adjustments", { warehouseId: central, itemId: rebar, quantityDelta: "2.5", unitCost: "1000.00", reason: "Reprise" });
    const opened = await api().post("/inventory/counts", { warehouseId: central });
    expect(opened.status).toBe(201);
    expect(opened.body.code).toMatch(/^INV-/);
    expect((await api().post("/inventory/counts", { warehouseId: central })).status).toBe(409);

    // Magasin gele pendant l'inventaire.
    const frozen = await api().post("/inventory/adjustments", { warehouseId: central, itemId: rebar, quantityDelta: "1", unitCost: "1000.00", reason: "X" });
    expect(frozen.status).toBe(400);
    expect(frozen.body.message).toContain("gelé");

    expect((await api().post(`/inventory/counts/${opened.body.id}/close`)).status).toBe(400);
    await api().put(`/inventory/counts/${opened.body.id}/lines`, { itemId: rebar, countedQuantity: "2.300" });
    await api().put(`/inventory/counts/${opened.body.id}/lines`, { itemId: cement, countedQuantity: "0" });
    const closed = await api().post(`/inventory/counts/${opened.body.id}/close`);
    expect(closed.status).toBe(201);
    expect(closed.body.status).toBe("CLOSED");
    const rebarLine = closed.body.lines.find((line: { itemId: string }) => line.itemId === rebar);
    expect(rebarLine.difference).toBe("-0.200");
    const balance = await balanceOf(rebar, central);
    expect(balance.quantity).toBe("2.300");
    expect(balance.value).toBe("2300.00");
  });

  it("integration achats : un article stocke entre en stock a la reception, puis est consomme a la sortie", async () => {
    const approver = await createUserWith(harness, owner, ["procurement.request.read", "procurement.request.approve"], "valideur-stock");
    const supplier = await api().post("/procurement/suppliers", { name: `Fournisseur ${Date.now()}` });
    let request = await api().post("/procurement/requests", {
      title: "Reappro aciers",
      projectId: project.projectId,
      lines: [{ inventoryItemId: rebar, quantity: "4", estimatedUnitPrice: "1000.00", wbsItemId: project.leafId }],
    });
    expect(request.status).toBe(201);
    expect(request.body.lines[0].unitCode).toBe("t");
    await api().post(`/procurement/requests/${request.body.id}/submit`);
    await as(harness, approver).post(`/procurement/requests/${request.body.id}/approve`);
    request = await api().post(`/procurement/requests/${request.body.id}/quotes`, {
      supplierId: supplier.body.id,
      lines: [{ requestLineId: request.body.lines[0].id, unitPrice: "1050.00" }],
    });
    const order = await api().post("/procurement/orders", { requestId: request.body.id, quoteId: request.body.quotes[0].id });
    await api().post(`/procurement/orders/${order.body.id}/issue`);
    const consumedBefore = (await api().get(`/projects/${project.projectId}`)).body.cockpit.consumed.amount;

    const missingWarehouse = await api().post(`/procurement/orders/${order.body.id}/receipts`, {
      idempotencyKey: key("rcpt"),
      lines: [{ orderLineId: order.body.lines[0].id, quantity: "4" }],
    });
    expect(missingWarehouse.status).toBe(400);
    const received = await api().post(`/procurement/orders/${order.body.id}/receipts`, {
      idempotencyKey: key("rcpt"),
      warehouseId: site,
      lines: [{ orderLineId: order.body.lines[0].id, quantity: "4" }],
    });
    expect(received.status).toBe(201);
    const siteBalance = await balanceOf(rebar, site);
    expect(siteBalance.quantity).toBe("4.000");
    expect(siteBalance.value).toBe("4200.00");
    // Recu en stock : pas encore consomme par le projet.
    expect((await api().get(`/projects/${project.projectId}`)).body.cockpit.consumed.amount).toBe(consumedBefore);

    await api().post("/inventory/issues", {
      warehouseId: site,
      projectId: project.projectId,
      idempotencyKey: key("rebar-issue"),
      lines: [{ itemId: rebar, quantity: "1" }],
    });
    const consumedAfter = (await api().get(`/projects/${project.projectId}`)).body.cockpit.consumed.amount;
    expect(Number(consumedAfter) - Number(consumedBefore)).toBeCloseTo(1050, 2);
  });

  it("isolation tenant et RBAC (ajustement = permission distincte)", async () => {
    expect((await as(harness, other).get("/inventory/items")).body).toEqual([]);
    const intrusion = await as(harness, other).post("/inventory/issues", {
      warehouseId: central,
      projectId: project.projectId,
      idempotencyKey: key("intrus"),
      lines: [{ itemId: cement, quantity: "1" }],
    });
    expect(intrusion.status).toBe(404);
    const storekeeper = await createUserWith(harness, owner, ["inventory.item.read", "inventory.movement.create"], "magasinier");
    const denied = await as(harness, storekeeper).post("/inventory/adjustments", {
      warehouseId: site,
      itemId: rebar,
      quantityDelta: "-1",
      reason: "Casse",
    });
    expect(denied.status).toBe(403);
  });

  it("seuil d'alerte : article sous le minimum signale", async () => {
    const items = await api().get("/inventory/items");
    const cementView = items.body.find((item: { id: string }) => item.id === cement);
    expect(cementView.belowMinimum).toBe(true);
    const overview = await api().get("/dashboard/overview");
    const kpi = overview.body.kpis.find((entry: { key: string }) => entry.key === "inventory.belowMinimum");
    expect(Number(kpi.value)).toBeGreaterThanOrEqual(1);
  });
});
