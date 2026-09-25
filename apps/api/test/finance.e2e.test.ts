import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createHarness, registerTenant, type Harness, type Tenant } from "./support/harness.js";
import { createStartedProject, createUserWith } from "./support/fixtures.js";

/** INC-08 — Finance : facturation client, 3-way match, validation, paiements anti-doublon. */
describe("Finance (e2e)", () => {
  let harness: Harness;
  let owner: Tenant;
  let other: Tenant;
  let controller: Tenant;
  let project: { projectId: string; leafId: string };
  let contractId = "";
  let vat = "";
  let usdAccount = "";
  let cdfAccount = "";
  let firstInvoice = "";
  let orderId = "";
  let orderLineId = "";
  let supplierId = "";

  beforeAll(async () => {
    harness = await createHarness();
    owner = await registerTenant(harness, "finance-a");
    other = await registerTenant(harness, "finance-b");
    project = await createStartedProject(harness, owner);
    contractId = (await as(harness, owner).get(`/projects/${project.projectId}`)).body.contractId;
    controller = await createUserWith(
      harness,
      owner,
      ["finance.payable.read", "finance.payable.approve", "procurement.request.read", "procurement.request.approve"],
      "controleur",
    );
  });

  afterAll(async () => {
    await harness.close();
  });

  const api = () => as(harness, owner);
  const key = (label: string) => `${label}-${Date.now()}-${Math.random()}`;

  it("parametres : taux de taxe configurables (jamais presumes) et comptes de tresorerie", async () => {
    expect((await api().post("/finance/tax-rates", { name: "Hors plage", rate: "120" })).status).toBe(400);
    const rates = await api().post("/finance/tax-rates", { name: "TVA 16 %", rate: "16" });
    expect(rates.status).toBe(201);
    vat = rates.body.find((rate: { name: string }) => rate.name === "TVA 16 %").id;
    let accounts = await api().post("/finance/bank-accounts", { code: "bq-usd", name: "Banque USD", currency: "USD", openingBalance: "10000.00" });
    usdAccount = accounts.body.find((account: { code: string }) => account.code === "BQ-USD").id;
    accounts = await api().post("/finance/bank-accounts", { code: "CAISSE-CDF", name: "Caisse CDF", kind: "CASH", currency: "CDF" });
    cdfAccount = accounts.body.find((account: { code: string }) => account.code === "CAISSE-CDF").id;
    expect(accounts.body.find((account: { id: string }) => account.id === usdAccount).balance).toBe("10000.00");
  });

  it("facture de situation depuis le contrat : brouillon sans numero, taxe figee sur les lignes", async () => {
    const draft = await api().post("/finance/invoices", { contractId, percent: "30", taxRateId: vat });
    expect(draft.status).toBe(201);
    firstInvoice = draft.body.id;
    expect(draft.body.code).toBeNull();
    expect(draft.body.status).toBe("DRAFT");
    expect(draft.body.projectId).toBe(project.projectId);
    expect(draft.body.subtotal).toBe("15000.00");
    expect(draft.body.taxTotal).toBe("2400.00");
    expect(draft.body.total).toBe("17400.00");
    expect(draft.body.lines[0].taxRate).toBe("16.00");
  });

  it("emission : numero legal sequentiel attribue a l'emission, echeance calculee", async () => {
    const issued = await api().post(`/finance/invoices/${firstInvoice}/issue`, { issueDate: "2026-08-01", dueDays: 30 });
    expect(issued.status).toBe(201);
    expect(issued.body.code).toBe("FAC-2026-0001");
    expect(issued.body.dueDate.slice(0, 10)).toBe("2026-08-31");
    expect(issued.body.overdue).toBe(true);
    expect((await api().post(`/finance/invoices/${firstInvoice}/issue`)).status).toBe(400);
    // Une emission anterieure a la derniere facture emise casserait la chronologie de la sequence.
    const backdated = await api().post("/finance/invoices", { contractId, percent: "1" });
    const refused = await api().post(`/finance/invoices/${backdated.body.id}/issue`, { issueDate: "2026-07-15" });
    expect(refused.status).toBe(400);
    await api().post(`/finance/invoices/${backdated.body.id}/cancel`, { reason: "Test chronologie" });
  });

  it("cumul facture <= montant du contrat", async () => {
    const tooMuch = await api().post("/finance/invoices", { contractId, percent: "80" });
    expect((await api().post(`/finance/invoices/${tooMuch.body.id}/issue`)).status).toBe(400);
    const rest = await api().post("/finance/invoices", { contractId, percent: "70" });
    const issued = await api().post(`/finance/invoices/${rest.body.id}/issue`);
    expect(issued.status).toBe(201);
    // Sequence annuelle sans trou : deuxieme facture emise de l'exercice.
    expect(issued.body.code).toBe(`FAC-${new Date().getUTCFullYear()}-0002`);
    const extra = await api().post("/finance/invoices", { contractId, percent: "1" });
    expect((await api().post(`/finance/invoices/${extra.body.id}/issue`)).status).toBe(400);
    // Brouillon annulable ; facture emise non annulable (avoir necessaire).
    expect((await api().post(`/finance/invoices/${extra.body.id}/cancel`, { reason: "Erreur de saisie" })).body.status).toBe("CANCELLED");
    expect((await api().post(`/finance/invoices/${firstInvoice}/cancel`, { reason: "X" })).status).toBe(400);
  });

  it("encaissements : devise du compte, plafond du reste du, idempotence, concurrence", async () => {
    const wrongCurrency = await api().post("/finance/payments", {
      invoiceType: "CUSTOMER",
      invoiceId: firstInvoice,
      bankAccountId: cdfAccount,
      amount: "100.00",
      method: "CASH",
      idempotencyKey: key("cdf"),
    });
    expect(wrongCurrency.status).toBe(400);
    const tooMuch = await api().post("/finance/payments", {
      invoiceType: "CUSTOMER",
      invoiceId: firstInvoice,
      bankAccountId: usdAccount,
      amount: "17400.01",
      method: "TRANSFER",
      idempotencyKey: key("over"),
    });
    expect(tooMuch.status).toBe(400);

    const partialKey = key("partial");
    const partial = await api().post("/finance/payments", {
      invoiceType: "CUSTOMER",
      invoiceId: firstInvoice,
      bankAccountId: usdAccount,
      amount: "10000.00",
      method: "TRANSFER",
      reference: "VIR-8841",
      idempotencyKey: partialKey,
    });
    expect(partial.status).toBe(201);
    expect(partial.body.status).toBe("PARTIALLY_PAID");
    expect(partial.body.balanceDue).toBe("7400.00");
    expect(partial.body.payments[0].code).toMatch(/^ENC-/);

    const replay = await api().post("/finance/payments", {
      invoiceType: "CUSTOMER",
      invoiceId: firstInvoice,
      bankAccountId: usdAccount,
      amount: "10000.00",
      method: "TRANSFER",
      idempotencyKey: partialKey,
    });
    expect(replay.body.paidAmount).toBe("10000.00");
    expect(replay.body.payments).toHaveLength(1);

    const race = await Promise.all(
      [1, 2].map((index) =>
        api().post("/finance/payments", {
          invoiceType: "CUSTOMER",
          invoiceId: firstInvoice,
          bankAccountId: usdAccount,
          amount: "7400.00",
          method: "TRANSFER",
          idempotencyKey: key(`race-${index}`),
        }),
      ),
    );
    expect(race.map((response) => response.status).sort()).toEqual([201, 400]);
    const paid = await api().get(`/finance/invoices/${firstInvoice}`);
    expect(paid.body.status).toBe("PAID");
    expect(paid.body.paidAmount).toBe("17400.00");
    expect(paid.body.overdue).toBe(false);

    const accounts = await api().get("/finance/bank-accounts");
    expect(accounts.body.find((account: { id: string }) => account.id === usdAccount).balance).toBe("27400.00");
  });

  it("garanties en base : jamais plus paye que du, paiements append-only", async () => {
    await expect(
      harness.prisma.customerInvoice.update({ where: { id: firstInvoice }, data: { paidAmount: "99999.00" } }),
    ).rejects.toThrow();
    const payment = await harness.prisma.payment.findFirstOrThrow({ where: { customerInvoiceId: firstInvoice } });
    await expect(harness.prisma.payment.update({ where: { id: payment.id }, data: { amount: "1.00" } })).rejects.toThrow(/append-only/);
  });

  it("rapprochement 3-way : facture conforme a la reception et au prix commande", async () => {
    const supplier = await api().post("/procurement/suppliers", { name: `Fournisseur finance ${Date.now()}`, paymentTermsDays: 45 });
    supplierId = supplier.body.id;
    let request = await api().post("/procurement/requests", {
      title: "Coffrages",
      projectId: project.projectId,
      lines: [{ description: "Panneau de coffrage", unitCode: "u", quantity: "20", estimatedUnitPrice: "100.00", wbsItemId: project.leafId }],
    });
    await api().post(`/procurement/requests/${request.body.id}/submit`);
    await as(harness, controller).post(`/procurement/requests/${request.body.id}/approve`);
    request = await api().post(`/procurement/requests/${request.body.id}/quotes`, {
      supplierId,
      lines: [{ requestLineId: request.body.lines[0].id, unitPrice: "100.00" }],
    });
    const order = await api().post("/procurement/orders", { requestId: request.body.id, quoteId: request.body.quotes[0].id });
    orderId = order.body.id;
    orderLineId = order.body.lines[0].id;
    await api().post(`/procurement/orders/${orderId}/issue`);
    await api().post(`/procurement/orders/${orderId}/receipts`, { idempotencyKey: key("rcpt"), lines: [{ orderLineId, quantity: "10" }] });

    const matched = await api().post("/finance/payables", {
      supplierId,
      orderId,
      supplierReference: "F-2026-118",
      invoiceDate: "2026-09-20",
      lines: [{ orderLineId, description: "Panneaux (livraison 1)", quantity: "10", unitPrice: "100.00", taxRateId: vat }],
    });
    expect(matched.status).toBe(201);
    expect(matched.body.matchStatus).toBe("MATCHED");
    expect(matched.body.total).toBe("1160.00");
    expect(matched.body.dueDate.slice(0, 10)).toBe("2026-11-04");
    expect(matched.body.projectId).toBe(project.projectId);

    const duplicate = await api().post("/finance/payables", {
      supplierId,
      orderId,
      supplierReference: "F-2026-118",
      invoiceDate: "2026-09-20",
      lines: [{ orderLineId, description: "Doublon", quantity: "1", unitPrice: "100.00" }],
    });
    expect(duplicate.status).toBe(409);
  });

  it("ecarts detectes : quantite facturee > recue, prix different ; justification exigee", async () => {
    const discrepancy = await api().post("/finance/payables", {
      supplierId,
      orderId,
      supplierReference: "F-2026-131",
      invoiceDate: "2026-09-22",
      lines: [{ orderLineId, description: "Panneaux (livraison 2)", quantity: "5", unitPrice: "104.00" }],
    });
    expect(discrepancy.body.matchStatus).toBe("DISCREPANCY");
    expect(discrepancy.body.matchNotes).toContain("facturé 15.000 > reçu 10.000");
    expect(discrepancy.body.matchNotes).toContain("104.00");

    // Paiement impossible avant approbation.
    const early = await api().post("/finance/payments", {
      invoiceType: "SUPPLIER",
      invoiceId: discrepancy.body.id,
      bankAccountId: usdAccount,
      amount: "10.00",
      method: "TRANSFER",
      idempotencyKey: key("early"),
    });
    expect(early.status).toBe(400);
    // L'auteur de la saisie ne valide pas ; un ecart exige une justification.
    expect((await api().post(`/finance/payables/${discrepancy.body.id}/approve`, { note: "ok" })).status).toBe(403);
    expect((await as(harness, controller).post(`/finance/payables/${discrepancy.body.id}/approve`, {})).status).toBe(400);
    const rejected = await as(harness, controller).post(`/finance/payables/${discrepancy.body.id}/reject`, { note: "Quantite non livree" });
    expect(rejected.body.status).toBe("REJECTED");
  });

  it("validation puis paiement fournisseur : cockpit projet facture et paye (HT)", async () => {
    const list = await as(harness, controller).get("/finance/payables");
    const matched = list.body.find((invoice: { supplierReference: string }) => invoice.supplierReference === "F-2026-118");
    const approved = await as(harness, controller).post(`/finance/payables/${matched.id}/approve`);
    expect(approved.body.status).toBe("APPROVED");
    const paid = await api().post("/finance/payments", {
      invoiceType: "SUPPLIER",
      invoiceId: matched.id,
      bankAccountId: usdAccount,
      amount: "580.00",
      method: "TRANSFER",
      idempotencyKey: key("supplier"),
    });
    expect(paid.body.status).toBe("PARTIALLY_PAID");
    expect(paid.body.payments[0].code).toMatch(/^DEC-/);
    const cockpit = (await api().get(`/projects/${project.projectId}`)).body.cockpit;
    expect(cockpit.invoiced).toMatchObject({ available: true, amount: "1000.00" });
    expect(cockpit.paid.amount).toBe("500.00");
    // 17 400 (30 % + TVA 16 %) + 35 000 (70 %, sans taxe) = 52 400 TTC emis.
    expect(cockpit.billed.amount).toBe("52400.00");
    expect(cockpit.collected.amount).toBe("17400.00");
  });

  it("synthese de tresorerie et RBAC / isolation", async () => {
    const summary = await api().get("/finance/summary");
    expect(summary.body.currency).toBe("USD");
    expect(summary.body.receivables).toBe("35000.00");
    expect(summary.body.payables).toBe("580.00");
    expect(summary.body.cashPosition).toBe("26820.00");

    const reader = await createUserWith(harness, owner, ["finance.invoice.read"], "lecteur-finance");
    const readerSummary = await as(harness, reader).get("/finance/summary");
    expect(readerSummary.body.payables).toBeNull();
    expect((await as(harness, reader).post("/finance/payments", {})).status).toBe(403);
    expect((await as(harness, reader).get("/finance/payables")).status).toBe(403);
    expect((await as(harness, other).get(`/finance/invoices/${firstInvoice}`)).status).toBe(404);
    expect(
      (
        await as(harness, other).post("/finance/payments", {
          invoiceType: "CUSTOMER",
          invoiceId: firstInvoice,
          bankAccountId: usdAccount,
          amount: "1.00",
          method: "CASH",
          idempotencyKey: key("intrus"),
        })
      ).status,
    ).toBe(404);
  });
});
