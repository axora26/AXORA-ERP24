import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createHarness, registerTenant, type Harness, type Tenant } from "./support/harness.js";
import { createStartedProject, createUserWith } from "./support/fixtures.js";

/**
 * INC-06 / INC-08 — Avoir fournisseur prepare depuis un retour.
 * Le retour physique reduit le recu net ; l'avoir corrige la facture
 * fournisseur deja approuvee pour les quantites retournees, par le meme
 * calcul que les avoirs saisis en Finance. L'avoir reste un BROUILLON :
 * son emission suit le circuit Finance habituel (finance.credit.issue).
 */
describe("Achats — avoir fournisseur depuis un retour (e2e)", () => {
  let harness: Harness;
  let owner: Tenant;
  let other: Tenant;
  let controller: Tenant;
  let orderId = "";
  let orderLineId = "";
  let invoiceId = "";
  let returnId = "";
  let vat = "";
  const key = (label: string) => `${label}-${Date.now()}-${Math.random()}`;
  const api = () => as(harness, owner);

  beforeAll(async () => {
    harness = await createHarness();
    owner = await registerTenant(harness, "return-credit-a");
    other = await registerTenant(harness, "return-credit-b");
    const project = await createStartedProject(harness, owner);
    controller = await createUserWith(
      harness,
      owner,
      ["finance.payable.read", "finance.payable.approve", "procurement.request.read", "procurement.request.approve"],
      "controleur-retour",
    );
    vat = (await api().post("/finance/tax-rates", { name: `TVA retour ${Date.now()}`, rate: "16" })).body.find((rate: { rate: string; name: string }) => rate.name.startsWith("TVA retour")).id;
    const supplier = await api().post("/procurement/suppliers", { name: `Fournisseur avoir ${Date.now()}` });
    let request = await api().post("/procurement/requests", {
      title: "Carrelage",
      projectId: project.projectId,
      lines: [{ description: "Carreaux 60x60", unitCode: "m2", quantity: "100", estimatedUnitPrice: "20.00", wbsItemId: project.leafId }],
    });
    await api().post(`/procurement/requests/${request.body.id}/submit`);
    await as(harness, controller).post(`/procurement/requests/${request.body.id}/approve`);
    request = await api().post(`/procurement/requests/${request.body.id}/quotes`, {
      supplierId: supplier.body.id,
      lines: [{ requestLineId: request.body.lines[0].id, unitPrice: "20.00" }],
    });
    const order = await api().post("/procurement/orders", { requestId: request.body.id, quoteId: request.body.quotes[0].id });
    orderId = order.body.id;
    orderLineId = order.body.lines[0].id;
    await api().post(`/procurement/orders/${orderId}/issue`);
    await api().post(`/procurement/orders/${orderId}/receipts`, { idempotencyKey: key("rcpt"), lines: [{ orderLineId, quantity: "100" }] });
    const invoice = await api().post("/finance/payables", {
      supplierId: supplier.body.id,
      orderId,
      supplierReference: `FC-${Date.now()}`,
      invoiceDate: "2026-10-01",
      lines: [{ orderLineId, description: "Carreaux 60x60", quantity: "100", unitPrice: "20.00", taxRateId: vat }],
    });
    expect(invoice.status).toBe(201);
    invoiceId = invoice.body.id;
    const returned = await api().post(`/procurement/orders/${orderId}/returns`, {
      idempotencyKey: key("ret"),
      reason: "Carreaux ébréchés",
      lines: [{ orderLineId, quantity: "12.5" }],
    });
    expect(returned.status).toBe(201);
    returnId = returned.body.returns[0].id;
  }, 120_000);

  afterAll(async () => {
    await harness.close();
  });

  it("refuse tant que la facture fournisseur n'est pas approuvee", async () => {
    const early = await api().post(`/procurement/orders/${orderId}/returns/${returnId}/credit-note`);
    expect(early.status).toBe(400);
  });

  it("prepare un brouillon d'avoir sur la facture approuvee, au prix et a la TVA d'origine", async () => {
    expect((await as(harness, controller).post(`/finance/payables/${invoiceId}/approve`)).status).toBe(201);
    const response = await api().post(`/procurement/orders/${orderId}/returns/${returnId}/credit-note`);
    expect(response.status).toBe(201);
    expect(response.body.status).toBe("DRAFT");
    expect(response.body.sourceInvoiceId).toBe(invoiceId);
    expect(response.body.reason).toContain("Carreaux ébréchés");
    expect(response.body.lines).toHaveLength(1);
    expect(response.body.lines[0].quantity).toMatch(/^12\.5/);
    expect(response.body.subtotal).toBe("250.00");
    expect(response.body.taxTotal).toBe("40.00");
    expect(response.body.total).toBe("290.00");

    const order = await api().get(`/procurement/orders/${orderId}`);
    expect(order.body.returns[0].creditNoteId).toBe(response.body.id);
  });

  it("idempotent : une seconde demande renvoie le meme avoir", async () => {
    const first = (await api().get(`/procurement/orders/${orderId}`)).body.returns[0].creditNoteId;
    const again = await api().post(`/procurement/orders/${orderId}/returns/${returnId}/credit-note`);
    expect(again.status).toBe(201);
    expect(again.body.id).toBe(first);
    expect(await harness.prisma.supplierCreditNote.count({ where: { sourceInvoiceId: invoiceId } })).toBe(1);
  });

  it("l'avoir emis par Finance diminue le solde de la facture fournisseur", async () => {
    const creditId = (await api().get(`/procurement/orders/${orderId}`)).body.returns[0].creditNoteId;
    const issued = await api().post(`/finance/supplier-credit-notes/${creditId}/issue`, { expectedVersion: 1, issueDate: "2026-10-05" });
    expect(issued.status).toBe(201);
    expect(issued.body.status).toBe("ISSUED");
    expect(issued.body.invoice.netTotal).toBe("2030.00");
  });

  it("RBAC et isolation tenant", async () => {
    const buyer = await createUserWith(harness, owner, ["procurement.order.read", "procurement.return.create"], "acheteur-sans-finance");
    expect((await as(harness, buyer).post(`/procurement/orders/${orderId}/returns/${returnId}/credit-note`)).status).toBe(403);
    expect((await as(harness, other).post(`/procurement/orders/${orderId}/returns/${returnId}/credit-note`)).status).toBe(404);
  });
});
