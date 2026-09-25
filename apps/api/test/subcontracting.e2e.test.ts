import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createHarness, registerTenant, type Harness, type Tenant } from "./support/harness.js";
import { createStartedProject, createUserWith } from "./support/fixtures.js";

const DAY = 86_400_000;
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);

/**
 * INC-19 — Sous-traitants (BC-19). Reutilise Achats (fournisseur, commande),
 * Projets (taches du lot WBS) et Finance (factures fournisseurs) ; situation
 * derivee des taches reelles ; retenue de garantie tracee a part.
 */
describe("Sous-traitants (e2e)", () => {
  let harness: Harness;
  let owner: Tenant;
  let other: Tenant;
  let buyer: Tenant;
  let qualifier: Tenant;
  let approver: Tenant;
  let projectId = "";
  let leafId = "";
  let supplierId = "";
  let orderId = "";
  let profileId = "";
  let packageId = "";
  let statementId = "";
  const tasks: string[] = [];

  beforeAll(async () => {
    harness = await createHarness();
    owner = await registerTenant(harness, "sst-a");
    other = await registerTenant(harness, "sst-b");
    buyer = await createUserWith(harness, owner, ["procurement.request.read", "procurement.request.approve"], "valideur-achats");
    qualifier = await createUserWith(harness, owner, ["subcontracting.package.read", "subcontracting.subcontractor.qualify"], "qualiticien");
    approver = await createUserWith(harness, owner, ["subcontracting.package.read", "subcontracting.statement.approve"], "conducteur-travaux");
    const api = as(harness, owner);
    ({ projectId, leafId } = await createStartedProject(harness, owner));
    for (const [name, weight] of [["Chemins de câbles", "2"], ["Tirage des câbles", "1"], ["Raccordements TGBT", "1"]] as const) {
      const project = await api.post(`/projects/${projectId}/tasks`, { wbsItemId: leafId, name, weight });
      tasks.push(project.body.tasks.find((task: { name: string }) => task.name === name).id);
    }
    supplierId = (await api.post("/procurement/suppliers", { name: "Elec Katanga SARL", city: "Lubumbashi", paymentTermsDays: 30 })).body.id;
    const request = await api.post("/procurement/requests", {
      title: "Sous-traitance lot électricité",
      projectId,
      lines: [{ description: "Lot électricité courants forts — forfait", unitCode: "FT", quantity: "1", estimatedUnitPrice: "48000.00", wbsItemId: leafId }],
    });
    await api.post(`/procurement/requests/${request.body.id}/submit`);
    await as(harness, buyer).post(`/procurement/requests/${request.body.id}/approve`, { note: "Budget lot A1" });
    await api.post(`/procurement/requests/${request.body.id}/quotes`, { supplierId, reference: "DEV-ELEC-12", lines: [{ requestLineId: request.body.lines[0].id, unitPrice: "48000.00" }] });
    const quotes = (await api.get(`/procurement/requests/${request.body.id}`)).body.quotes;
    orderId = (await api.post("/procurement/orders", { requestId: request.body.id, quoteId: quotes[0].id })).body.id;
    expect((await api.post(`/procurement/orders/${orderId}/issue`)).status).toBe(201);
  });

  afterAll(async () => {
    await harness.close();
  });

  const api = () => as(harness, owner);

  it("qualification : fournisseur Achats existant, pieces de vigilance, decision par une autre personne", async () => {
    expect((await api().post("/subcontracting/packages", { purchaseOrderId: orderId, wbsItemId: leafId, title: "Lot électricité", scope: "CFO" })).body.message).toMatch(/pas enregistré comme sous-traitant/);
    const created = await api().post("/subcontracting/subcontractors", { supplierId, trades: "Électricité CFO/CFA", workforce: 18 });
    expect(created.status).toBe(201);
    profileId = created.body.id;
    expect(created.body).toMatchObject({ status: "PENDING", supplierName: "Elec Katanga SARL", compliant: false });
    expect((await api().post("/subcontracting/subcontractors", { supplierId, trades: "x" })).status).toBe(409);
    expect((await api().post(`/subcontracting/subcontractors/${profileId}/decision`, { decision: "QUALIFIED", note: "ok" })).body.message).toMatch(/autre personne que celle qui a créé la fiche/);
    const missing = await as(harness, qualifier).post(`/subcontracting/subcontractors/${profileId}/decision`, { decision: "QUALIFIED", note: "ok" });
    expect(missing.body.message).toMatch(/RCCM absente, attestation fiscale absente/);
    for (const kind of ["RCCM", "TAX_CERTIFICATE", "SOCIAL_CERTIFICATE", "LIABILITY_INSURANCE"]) {
      await api().post(`/subcontracting/subcontractors/${profileId}/documents`, { kind, reference: `${kind}-2026`, validFrom: iso(-30), validUntil: iso(kind === "TAX_CERTIFICATE" ? 20 : 300) });
    }
    const qualified = await as(harness, qualifier).post(`/subcontracting/subcontractors/${profileId}/decision`, { decision: "QUALIFIED", note: "Références chantier vérifiées" });
    expect(qualified.body).toMatchObject({ status: "QUALIFIED", compliant: true });
    expect(qualified.body.compliance.find((item: { kind: string }) => item.kind === "TAX_CERTIFICATE").state).toBe("EXPIRING");
    await expect(harness.prisma.subcontractorProfile.update({ where: { id: profileId }, data: { decidedByUserId: owner.userId } })).rejects.toThrow(/subcontractor_profiles_four_eyes/);
  });

  it("lot confie : commande emise du sous-traitant, montant fige, commande ni receptionnable ni annulable", async () => {
    const created = await api().post("/subcontracting/packages", { purchaseOrderId: orderId, wbsItemId: leafId, title: "Lot électricité bâtiment A", scope: "Courants forts : chemins de câbles, tirage, raccordements TGBT", retentionRate: "5", retentionReleaseDays: 365 });
    expect(created.status).toBe(201);
    packageId = created.body.id;
    expect(created.body).toMatchObject({ amount: "48000.00", retentionRate: "5.00", livePercent: "0.00", liveTotalTasks: 3, certifiedPercent: "0.00" });
    expect(created.body.code).toMatch(/^SST-\d{4}-\d{4}$/);
    expect((await api().post("/subcontracting/packages", { purchaseOrderId: orderId, wbsItemId: leafId, title: "x", scope: "x" })).status).toBe(409);
    const order = await api().get(`/procurement/orders/${orderId}`);
    expect((await api().post(`/procurement/orders/${orderId}/receipts`, { idempotencyKey: "rcpt-sst", lines: [{ orderLineId: order.body.lines[0].id, quantity: "1" }] })).body.message).toMatch(/certifié par situations/);
    expect((await api().post(`/procurement/orders/${orderId}/cancel`, { reason: "x" })).body.message).toMatch(/résiliez plutôt le lot/);
  });

  it("situation : avancement derive des taches terminees (jamais saisi), montants figes, approbation a 4 yeux", async () => {
    expect((await api().post(`/subcontracting/packages/${packageId}/statements`, { periodEnd: iso(0) })).body.message).toMatch(/Aucun nouvel avancement/);
    await api().patch(`/projects/${projectId}/tasks/${tasks[0]}/status`, { status: "DONE" });
    const prepared = await api().post(`/subcontracting/packages/${packageId}/statements`, { periodEnd: iso(0), cumulativePercent: "90" });
    expect(prepared.status).toBe(201);
    statementId = prepared.body.id;
    // Poids 2 / 4 : 50 % — la valeur saisie par le client est ignoree.
    expect(prepared.body).toMatchObject({ number: 1, cumulativePercent: "50.00", previousPercent: "0.00", doneTasks: 1, totalTasks: 3, grossAmount: "24000.00", retentionAmount: "1200.00", netAmount: "22800.00", status: "DRAFT" });
    expect((await api().post(`/subcontracting/packages/${packageId}/statements`, { periodEnd: iso(0) })).status).toBe(409);
    expect((await api().post(`/subcontracting/statements/${statementId}/decision`, { decision: "APPROVED" })).body.message).toMatch(/autre personne que celle qui l'a préparée/);
    expect((await as(harness, qualifier).post(`/subcontracting/statements/${statementId}/decision`, { decision: "APPROVED" })).status).toBe(403);
    await expect(harness.prisma.subcontractStatement.update({ where: { id: statementId }, data: { grossAmount: "30000.00", netAmount: "28800.00" } })).rejects.toThrow(/frozen/);
    const approved = await as(harness, approver).post(`/subcontracting/statements/${statementId}/decision`, { decision: "APPROVED", note: "Constat contradictoire du 25/09" });
    expect(approved.body).toMatchObject({ status: "APPROVED", decidedByName: expect.stringMatching(/^conducteur-travaux/) });

    const pack = await api().get(`/subcontracting/packages/${packageId}`);
    expect(pack.body).toMatchObject({ certifiedPercent: "50.00", certifiedGross: "24000.00", retentionHeld: "1200.00" });
    expect(pack.body.retentions[0]).toMatchObject({ amount: "1200.00", status: "HELD", due: false, releaseDueDate: iso(365) });
    const project = await api().get(`/projects/${projectId}`);
    expect(project.body.cockpit.consumed.source).toMatch(/sous-traitance/);
    expect(Number(project.body.cockpit.consumed.amount)).toBeGreaterThanOrEqual(24000);
  });

  it("facture de situation : facture fournisseur Finance du net certifie, une seule fois", async () => {
    expect((await as(harness, approver).post(`/subcontracting/statements/${statementId}/invoice`, { supplierReference: "FAC-ELEC-001", invoiceDate: iso(0) })).status).toBe(403);
    const invoiced = await api().post(`/subcontracting/statements/${statementId}/invoice`, { supplierReference: "FAC-ELEC-001", invoiceDate: iso(0), taxRate: "16" });
    expect(invoiced.status).toBe(201);
    expect(invoiced.body.supplierInvoiceCode).toMatch(/^FF-/);
    const payable = await api().get(`/finance/payables/${invoiced.body.supplierInvoiceId}`);
    expect(payable.body).toMatchObject({ subtotal: "22800.00", taxTotal: "3648.00", total: "26448.00", matchStatus: "MATCHED", status: "RECORDED" });
    expect((await api().post(`/subcontracting/statements/${statementId}/invoice`, { supplierReference: "FAC-ELEC-002", invoiceDate: iso(0) })).status).toBe(409);
  });

  it("situation suivante : seul l'avancement nouveau est facture ; retenue liberee contre caution uniquement avant echeance", async () => {
    await api().patch(`/projects/${projectId}/tasks/${tasks[1]}/status`, { status: "DONE" });
    const second = await api().post(`/subcontracting/packages/${packageId}/statements`, { periodEnd: iso(0) });
    expect(second.body).toMatchObject({ number: 2, cumulativePercent: "75.00", previousPercent: "50.00", grossAmount: "12000.00", retentionAmount: "600.00", netAmount: "11400.00" });
    await as(harness, approver).post(`/subcontracting/statements/${second.body.id}/decision`, { decision: "APPROVED" });

    const retention = (await api().get(`/subcontracting/retentions?packageId=${packageId}`)).body.find((row: { amount: string }) => row.amount === "1200.00");
    expect((await api().post(`/subcontracting/retentions/${retention.id}/release`, { note: "Anticipation", supplierReference: "FAC-RG-01", invoiceDate: iso(0) })).body.message).toMatch(/caution bancaire/);
    const released = await api().post(`/subcontracting/retentions/${retention.id}/release`, { note: "Caution bancaire reçue", guaranteeReference: "CAUT-RAW-2026-0091", supplierReference: "FAC-RG-01", invoiceDate: iso(0) });
    expect(released.body).toMatchObject({ status: "RELEASED", guaranteeReference: "CAUT-RAW-2026-0091", releaseInvoiceCode: expect.stringMatching(/^FF-/) });
    await expect(harness.prisma.subcontractRetention.update({ where: { id: retention.id }, data: { releaseNote: "x" } })).rejects.toThrow(/already released/);
    const summary = await api().get("/subcontracting/summary");
    expect(summary.body).toMatchObject({ activePackages: 1, contracted: "48000.00", certified: "36000.00", retentionHeld: "600.00", qualified: 1 });
  });

  it("isolation et audit", async () => {
    expect((await as(harness, other).get(`/subcontracting/packages/${packageId}`)).status).toBe(404);
    expect((await as(harness, other).get("/subcontracting/subcontractors")).body).toHaveLength(0);
    expect((await as(harness, other).post(`/subcontracting/packages/${packageId}/statements`, { periodEnd: iso(0) })).status).toBe(404);
    const audit = await harness.prisma.auditLog.findMany({ where: { organizationId: owner.organizationId, action: { startsWith: "subcontracting." } } });
    const actions = new Set(audit.map((entry) => entry.action));
    for (const action of ["subcontracting.subcontractor.created", "subcontracting.subcontractor.qualified", "subcontracting.package.created", "subcontracting.statement.prepared", "subcontracting.statement.approved", "subcontracting.statement.invoiced", "subcontracting.retention.released"]) {
      expect(actions.has(action)).toBe(true);
    }
  });
});
