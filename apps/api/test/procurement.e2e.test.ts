import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createHarness, registerTenant, type Harness, type Tenant } from "./support/harness.js";
import { createStartedProject, createUserWith } from "./support/fixtures.js";

/** INC-06 — Achats : DA -> approbation -> consultation -> BC -> reception, engagement projet. */
describe("Achats (e2e)", () => {
  let harness: Harness;
  let owner: Tenant;
  let other: Tenant;
  let approver: Tenant;
  let project: { projectId: string; leafId: string; parentId: string };
  let supplierA = "";
  let supplierB = "";
  let requestId = "";
  let lineIds: string[] = [];
  let orderId = "";
  let orderLineIds: string[] = [];

  beforeAll(async () => {
    harness = await createHarness();
    owner = await registerTenant(harness, "procurement-a");
    other = await registerTenant(harness, "procurement-b");
    project = await createStartedProject(harness, owner);
    approver = await createUserWith(
      harness,
      owner,
      ["procurement.request.read", "procurement.request.approve"],
      "acheteur-valideur",
    );
  });

  afterAll(async () => {
    await harness.close();
  });

  const api = () => as(harness, owner);

  it("fournisseurs : numerotation automatique, unicite du nom", async () => {
    const first = await api().post("/procurement/suppliers", { name: "Béton du Katanga", city: "Lubumbashi", paymentTermsDays: 45 });
    expect(first.status).toBe(201);
    expect(first.body.code).toMatch(/^FRN-\d{4}-\d{4}$/);
    supplierA = first.body.id;
    const second = await api().post("/procurement/suppliers", { name: "Congo Matériaux" });
    supplierB = second.body.id;
    expect((await api().post("/procurement/suppliers", { name: "Béton du Katanga" })).status).toBe(409);
  });

  it("demande d'achat : lignes sur feuilles WBS du projet, devise du projet, montants exacts", async () => {
    const invalidWbs = await api().post("/procurement/requests", {
      title: "X",
      projectId: project.projectId,
      lines: [{ description: "X", unitCode: "u", quantity: "1", estimatedUnitPrice: "1.00", wbsItemId: project.parentId }],
    });
    expect(invalidWbs.status).toBe(400);
    const floatQty = await api().post("/procurement/requests", {
      title: "X",
      lines: [{ description: "X", unitCode: "u", quantity: 1.5, estimatedUnitPrice: "1.00" }],
    });
    expect(floatQty.status).toBe(400);

    const response = await api().post("/procurement/requests", {
      title: "Ciment et aciers — voiles R+0",
      projectId: project.projectId,
      neededBy: "2026-11-02",
      lines: [
        { description: "Ciment CEM II 42.5", unitCode: "t", quantity: "12.500", estimatedUnitPrice: "180.00", wbsItemId: project.leafId },
        { description: "Aciers HA 12", unitCode: "t", quantity: "3.250", estimatedUnitPrice: "1020.00", wbsItemId: project.leafId },
      ],
    });
    expect(response.status).toBe(201);
    requestId = response.body.id;
    lineIds = response.body.lines.map((line: { id: string }) => line.id);
    expect(response.body.code).toMatch(/^DA-\d{4}-\d{4}$/);
    expect(response.body.currency).toBe("USD");
    expect(response.body.estimatedTotal).toBe("5565.00");
    expect(response.body.status).toBe("DRAFT");
  });

  it("workflow : le demandeur soumet, un tiers approuve (separation des devoirs)", async () => {
    expect((await as(harness, approver).post(`/procurement/requests/${requestId}/submit`)).status).toBe(403);
    expect((await api().post(`/procurement/requests/${requestId}/submit`)).status).toBe(201);
    expect((await api().post(`/procurement/requests/${requestId}/approve`)).status).toBe(403);
    const approved = await as(harness, approver).post(`/procurement/requests/${requestId}/approve`, { note: "Conforme au budget" });
    expect(approved.status).toBe(201);
    expect(approved.body.status).toBe("APPROVED");
    expect((await as(harness, approver).post(`/procurement/requests/${requestId}/approve`)).status).toBe(400);
  });

  it("rejet motive obligatoire", async () => {
    const draft = await api().post("/procurement/requests", {
      title: "Achat non justifie",
      lines: [{ description: "Gadget", unitCode: "u", quantity: "1", estimatedUnitPrice: "999.00" }],
    });
    await api().post(`/procurement/requests/${draft.body.id}/submit`);
    expect((await as(harness, approver).post(`/procurement/requests/${draft.body.id}/reject`, {})).status).toBe(400);
    const rejected = await as(harness, approver).post(`/procurement/requests/${draft.body.id}/reject`, { note: "Hors budget" });
    expect(rejected.body.status).toBe("REJECTED");
    // Une DA rejetee ne peut pas etre consultee.
    expect(
      (await api().post(`/procurement/requests/${draft.body.id}/quotes`, { supplierId: supplierA, lines: [] })).status,
    ).toBe(400);
  });

  it("consultation : chaque ligne doit etre chiffree, un seul devis par fournisseur", async () => {
    const incomplete = await api().post(`/procurement/requests/${requestId}/quotes`, {
      supplierId: supplierA,
      lines: [{ requestLineId: lineIds[0], unitPrice: "175.00" }],
    });
    expect(incomplete.status).toBe(400);
    await api().post(`/procurement/requests/${requestId}/quotes`, {
      supplierId: supplierA,
      reference: "OFF-778",
      deliveryDays: 10,
      lines: [
        { requestLineId: lineIds[0], unitPrice: "176.40" },
        { requestLineId: lineIds[1], unitPrice: "1015.00" },
      ],
    });
    const second = await api().post(`/procurement/requests/${requestId}/quotes`, {
      supplierId: supplierB,
      deliveryDays: 21,
      lines: [
        { requestLineId: lineIds[0], unitPrice: "182.00" },
        { requestLineId: lineIds[1], unitPrice: "990.00" },
      ],
    });
    expect(second.status).toBe(201);
    // Comparatif trie par total : A = 12.5*176.40 + 3.25*1015 = 2205 + 3298.75 = 5503.75 ; B = 2275 + 3217.50 = 5492.50
    expect(second.body.quotes.map((quote: { total: string }) => quote.total)).toEqual(["5492.50", "5503.75"]);
    const duplicate = await api().post(`/procurement/requests/${requestId}/quotes`, {
      supplierId: supplierB,
      lines: [
        { requestLineId: lineIds[0], unitPrice: "1.00" },
        { requestLineId: lineIds[1], unitPrice: "1.00" },
      ],
    });
    expect(duplicate.status).toBe(409);
  });

  it("commande depuis l'offre retenue, une seule par DA ; l'emission engage le budget projet", async () => {
    const request = await api().get(`/procurement/requests/${requestId}`);
    const cheapest = request.body.quotes[0];
    const created = await api().post("/procurement/orders", { requestId, quoteId: cheapest.id });
    expect(created.status).toBe(201);
    orderId = created.body.id;
    orderLineIds = created.body.lines.map((line: { id: string }) => line.id);
    expect(created.body.code).toMatch(/^BC-\d{4}-\d{4}$/);
    expect(created.body.total).toBe("5492.50");
    expect(created.body.supplierName).toBe("Congo Matériaux");
    expect((await api().post("/procurement/orders", { requestId, quoteId: cheapest.id })).status).toBe(400);

    let cockpit = (await api().get(`/projects/${project.projectId}`)).body.cockpit;
    expect(cockpit.committed.amount).toBe("0.00");
    expect((await api().post(`/procurement/orders/${orderId}/issue`)).status).toBe(201);
    cockpit = (await api().get(`/projects/${project.projectId}`)).body.cockpit;
    expect(cockpit.committed.amount).toBe("5492.50");
    expect(cockpit.consumed.amount).toBe("0.00");
  });

  it("reception partielle, depassement refuse, idempotence", async () => {
    const tooMuch = await api().post(`/procurement/orders/${orderId}/receipts`, {
      idempotencyKey: "rcpt-over",
      lines: [{ orderLineId: orderLineIds[0], quantity: "12.501" }],
    });
    expect(tooMuch.status).toBe(400);
    const partial = await api().post(`/procurement/orders/${orderId}/receipts`, {
      idempotencyKey: "rcpt-1",
      lines: [{ orderLineId: orderLineIds[0], quantity: "5.000" }],
    });
    expect(partial.status).toBe(201);
    expect(partial.body.status).toBe("PARTIALLY_RECEIVED");
    expect(partial.body.lines[0].remainingQuantity).toBe("7.500");
    expect(partial.body.receipts[0].code).toMatch(/^BR-\d{4}-\d{4}$/);

    const replay = await api().post(`/procurement/orders/${orderId}/receipts`, {
      idempotencyKey: "rcpt-1",
      lines: [{ orderLineId: orderLineIds[0], quantity: "5.000" }],
    });
    expect(replay.status).toBe(201);
    expect(replay.body.receipts).toHaveLength(1);
    expect(replay.body.lines[0].receivedQuantity).toBe("5.000");
  });

  it("concurrence : deux receptions simultanees ne depassent jamais la quantite commandee", async () => {
    const attempts = await Promise.all(
      ["rcpt-race-1", "rcpt-race-2"].map((key) =>
        api().post(`/procurement/orders/${orderId}/receipts`, {
          idempotencyKey: key,
          lines: [{ orderLineId: orderLineIds[0], quantity: "7.500" }],
        }),
      ),
    );
    expect(attempts.map((attempt) => attempt.status).sort()).toEqual([201, 400]);
    const order = await api().get(`/procurement/orders/${orderId}`);
    expect(order.body.lines[0].receivedQuantity).toBe("12.500");
    expect(order.body.lines[0].remainingQuantity).toBe("0.000");
  });

  it("reception complete : commande RECEIVED, consomme projet = valeur recue", async () => {
    const done = await api().post(`/procurement/orders/${orderId}/receipts`, {
      idempotencyKey: "rcpt-final",
      lines: [{ orderLineId: orderLineIds[1], quantity: "3.250" }],
    });
    expect(done.body.status).toBe("RECEIVED");
    expect(done.body.receivedValue).toBe("5492.50");
    const cockpit = (await api().get(`/projects/${project.projectId}`)).body.cockpit;
    expect(cockpit.consumed.amount).toBe("5492.50");
    expect((await api().post(`/procurement/orders/${orderId}/cancel`, { reason: "Trop tard" })).status).toBe(400);
  });

  it("annulation avant reception : desengage et rend la DA a nouveau commandable", async () => {
    const draft = await api().post("/procurement/requests", {
      title: "Location nacelle",
      projectId: project.projectId,
      lines: [{ description: "Nacelle 12 m (semaine)", unitCode: "sem", quantity: "2", estimatedUnitPrice: "650.00", wbsItemId: project.leafId }],
    });
    await api().post(`/procurement/requests/${draft.body.id}/submit`);
    await as(harness, approver).post(`/procurement/requests/${draft.body.id}/approve`);
    const quoted = await api().post(`/procurement/requests/${draft.body.id}/quotes`, {
      supplierId: supplierA,
      lines: [{ requestLineId: draft.body.lines[0].id, unitPrice: "640.00" }],
    });
    const order = await api().post("/procurement/orders", { requestId: draft.body.id, quoteId: quoted.body.quotes[0].id });
    await api().post(`/procurement/orders/${order.body.id}/issue`);
    let cockpit = (await api().get(`/projects/${project.projectId}`)).body.cockpit;
    expect(cockpit.committed.amount).toBe("6772.50");
    expect((await api().post(`/procurement/orders/${order.body.id}/cancel`, {})).status).toBe(400);
    const cancelled = await api().post(`/procurement/orders/${order.body.id}/cancel`, { reason: "Chantier décalé" });
    expect(cancelled.body.status).toBe("CANCELLED");
    cockpit = (await api().get(`/projects/${project.projectId}`)).body.cockpit;
    expect(cockpit.committed.amount).toBe("5492.50");
    expect((await api().get(`/procurement/requests/${draft.body.id}`)).body.status).toBe("APPROVED");
  });

  it("isolation tenant et RBAC", async () => {
    expect((await as(harness, other).get(`/procurement/orders/${orderId}`)).status).toBe(404);
    expect(
      (
        await as(harness, other).post(`/procurement/orders/${orderId}/receipts`, {
          idempotencyKey: "intrus",
          lines: [{ orderLineId: orderLineIds[0], quantity: "1" }],
        })
      ).status,
    ).toBe(404);
    expect((await as(harness, other).get("/procurement/suppliers")).body).toEqual([]);
    expect((await as(harness, approver).get("/procurement/orders")).status).toBe(403);
    expect((await as(harness, approver).post("/procurement/suppliers", { name: "X" })).status).toBe(403);
  });

  it("evaluation fournisseur : note moyenne calculee, commande d'un autre fournisseur refusee", async () => {
    expect(
      (await api().post(`/procurement/suppliers/${supplierA}/evaluations`, { quality: 4, delivery: 4, price: 4, orderId })).status,
    ).toBe(400);
    const evaluated = await api().post(`/procurement/suppliers/${supplierB}/evaluations`, {
      quality: 5,
      delivery: 3,
      price: 4,
      orderId,
      comment: "Livraison partielle en retard de deux jours",
    });
    expect(evaluated.status).toBe(201);
    expect(evaluated.body.rating).toBe("4.0");
    expect(evaluated.body.evaluationCount).toBe(1);
  });
});
