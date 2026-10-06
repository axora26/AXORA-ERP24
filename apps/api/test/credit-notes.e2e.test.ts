import { beforeAll, afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import { Prisma } from "@axora24/database";
import { AppModule } from "../src/app.module.js";
import { PrismaService } from "../src/core/prisma.service.js";

describe("Customer and supplier credits and refund ledger (PostgreSQL)", () => {
  let app: INestApplication; let prisma: PrismaService; let cookie: string;
  let organizationId: string; let companyId: string; let userId: string; let bankId: string; let taxId: string; let sequence = 0;
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const today = new Date().toISOString().slice(0, 10);
  beforeAll(async () => {
    if (!new URL(process.env.DATABASE_URL!).pathname.endsWith("_test")) throw new Error("Credit tests require an isolated _test database");
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile(); app = module.createNestApplication(); prisma = app.get(PrismaService);
    app.use(cookieParser()); app.setGlobalPrefix("api/v1"); await app.init();
    const registered = await request(app.getHttpServer()).post("/api/v1/auth/register-organization").set("Origin", "http://localhost:3100")
      .send({ organizationName: `Credit ${suffix}`, organizationSlug: `credit-${suffix}`, companyName: "Credit qualification", ownerEmail: `credit-${suffix}@test.example`, ownerPassword: "StrongPass123!", ownerFullName: "Credit qualification" });
    expect(registered.status).toBe(201); cookie = registered.headers["set-cookie"] as unknown as string;
    organizationId = registered.body.user.organizationId; userId = registered.body.user.id;
    companyId = (await prisma.company.findFirstOrThrow({ where: { organizationId } })).id;
    await prisma.organization.update({ where: { id: organizationId }, data: { isDemo: true } });
    const bank = await post("bank-accounts", { code: "CREDIT-BANK", name: "Refund bank", currency: "USD", openingBalance: "1000.00" });
    expect(bank.status).toBe(201); bankId = bank.body.find((item: { code: string }) => item.code === "CREDIT-BANK").id;
    const tax = await post("tax-rates", { name: "Source tax", rate: "20" }); expect(tax.status).toBe(201); taxId = tax.body.find((item: { name: string }) => item.name === "Source tax").id;
  }, 30_000);
  afterAll(async () => { await app?.close(); });
  const get = (path: string) => request(app.getHttpServer()).get(`/api/v1/finance/${path}`).set("Cookie", cookie);
  const post = (path: string, body: object = {}) => request(app.getHttpServer()).post(`/api/v1/finance/${path}`).set("Cookie", cookie).set("Origin", "http://localhost:3100").send(body);
  const patch = (path: string, body: object) => request(app.getHttpServer()).patch(`/api/v1/finance/${path}`).set("Cookie", cookie).set("Origin", "http://localhost:3100").send(body);
  async function invoice(quantity = "1", unitPrice = "100", tax = false, projectId?: string) {
    const draft = await post("invoices", { customerName: "Credit customer", currency: "USD", ...(projectId ? { projectId } : {}), lines: [{ description: "Original line", quantity, unitPrice, ...(tax ? { taxRateId: taxId } : {}) }] });
    expect(draft.status).toBe(201);
    const issued = await post(`invoices/${draft.body.id}/issue`, { issueDate: today }); expect(issued.status).toBe(201); return issued.body;
  }
  async function credit(source: { id: string; lines: Array<{ id: string }> }, quantity = "1", kind = "customer") {
    const created = await post(`${kind}-credit-notes`, { invoiceId: source.id, reason: "Correction documented", lines: [{ sourceInvoiceLineId: source.lines[0]!.id, quantity }] });
    expect(created.status).toBe(201); return created.body;
  }
  async function issue(note: { id: string; version: number }, kind = "customer") {
    return post(`${kind}-credit-notes/${note.id}/issue`, { expectedVersion: note.version, issueDate: today });
  }
  const pay = (source: { id: string }, amount: string, kind = "CUSTOMER") => post("payments", { invoiceType: kind, invoiceId: source.id, bankAccountId: bankId, amount, method: "TRANSFER", paidAt: today, idempotencyKey: `PAY-${++sequence}` });
  const refund = (note: { id: string }, amount: string, key: string, kind = "customer", bankAccountId = bankId) => post(`${kind}-credit-notes/${note.id}/refunds`, { amount, bankAccountId, method: "TRANSFER", refundedAt: today, reference: "Refund qualification", idempotencyKey: key });

  it("freezes source prices and tax while issuing exact full high-precision credit", async () => {
    const source = await invoice("1.234560", "123.456780", true);
    const note = await credit(source, "1.234560");
    expect(note).toMatchObject({ status: "DRAFT", code: null, version: 1, subtotal: "152.41", taxTotal: "30.48", total: "182.89" });
    expect(note.lines[0]).toMatchObject({ unitPrice: "123.456780", taxRate: "20.00" });
    const issued = await issue(note); expect(issued.status).toBe(201); expect(issued.body.code).toMatch(/^AVC-/);
    expect(issued.body.invoice).toMatchObject({ creditedAmount: "182.89", netTotal: "0.00", balanceDue: "0.00", refundDue: "0.00" });
    const original = (await get(`invoices/${source.id}`)).body;
    expect(original.total).toBe("182.89"); expect(original.paidAmount).toBe("0.00"); expect(original.balanceDue).toBe("0.00"); expect(original.lines[0].unitPrice).toBe("123.456780");
    expect((await patch(`customer-credit-notes/${note.id}`, { expectedVersion: 2, reason: "Rewrite issued" })).status).toBe(400);
    expect((await post(`customer-credit-notes/${note.id}/cancel`, { expectedVersion: 2, reason: "Delete issued" })).status).toBe(400);
  });

  it("preserves exact source rounding across three partial credits", async () => {
    const source = await invoice("3", "0.333333", true); const totals: string[] = []; const taxes: string[] = [];
    for (let index = 0; index < 3; index++) { const result = await issue(await credit(source)); expect(result.status).toBe(201); totals.push(result.body.subtotal); taxes.push(result.body.taxTotal); }
    expect(totals).toEqual(["0.33", "0.34", "0.33"]); expect(taxes).toEqual(["0.07", "0.06", "0.07"]);
    expect((await get(`invoices/${source.id}`)).body.credit).toMatchObject({ creditedAmount: "1.20", netTotal: "0.00" });
    expect((await post("customer-credit-notes", { invoiceId: source.id, reason: "Beyond source", lines: [{ sourceInvoiceLineId: source.lines[0].id, quantity: "0.000001" }] })).status).toBe(400);
  });

  it("accepts only one competing issue that would otherwise exceed the source quantity", async () => {
    const source = await invoice(); const a = await credit(source, "0.7"); const b = await credit(source, "0.7");
    const results = await Promise.all([issue(a), issue(b)]);
    expect(results.filter((response) => response.status === 201)).toHaveLength(1);
    expect(results.filter((response) => [400, 409].includes(response.status))).toHaveLength(1);
    expect(await prisma.customerCreditNote.count({ where: { sourceInvoiceId: source.id, status: "ISSUED" } })).toBe(1);
    expect((await get(`invoices/${source.id}`)).body.balanceDue).toBe("30.00");
  });

  it("requires refresh when another partial credit changes the draft rounding allocation", async () => {
    const source = await invoice("3", "0.333333"); const a = await credit(source); const b = await credit(source);
    expect((await issue(a)).status).toBe(201);
    expect((await issue(b)).status).toBe(409);
    const refreshed = await patch(`customer-credit-notes/${b.id}`, { expectedVersion: 1, reason: "Reviewed updated allocation" });
    expect(refreshed.status).toBe(200); expect(refreshed.body.subtotal).toBe("0.34");
    expect((await issue(refreshed.body)).status).toBe(201);
  });

  it("creates explicit refund due after payment, with one idempotent outgoing refund and bank impact", async () => {
    const source = await invoice(); expect((await pay(source, "100.00")).status).toBe(201);
    const before = (await get("bank-accounts")).body.find((bank: { id: string }) => bank.id === bankId).balance;
    const issued = (await issue(await credit(source, "0.4"))).body;
    expect(issued.invoice).toMatchObject({ netTotal: "60.00", netPaidAmount: "100.00", balanceDue: "0.00", refundDue: "40.00" });
    const results = await Promise.all(Array.from({ length: 6 }, () => refund(issued, "40.00", `R-${source.id}`)));
    expect(results.every((response) => response.status === 201)).toBe(true);
    expect(results[0]!.body.invoice).toMatchObject({ netPaidAmount: "60.00", refundedAmount: "40.00", refundDue: "0.00" });
    expect(await prisma.creditRefund.count({ where: { customerCreditNoteId: issued.id } })).toBe(1);
    const ledger = await prisma.creditRefund.findFirstOrThrow({ where: { customerCreditNoteId: issued.id } }); expect(ledger.direction).toBe("OUT");
    const after = (await get("bank-accounts")).body.find((bank: { id: string }) => bank.id === bankId).balance;
    expect(Number(before) - Number(after)).toBe(40);
    expect((await refund(issued, "39.00", `R-${source.id}`)).status).toBe(409);
    expect((await refund(issued, "1.00", `R-extra-${source.id}`)).status).toBe(400);
    expect((await get(`invoices/${source.id}`)).body.paidAmount).toBe("100.00");
  });

  it("validates payment against net balance and serializes payment versus credit issue", async () => {
    const source = await invoice(); const note = await credit(source, "0.8");
    const [payment, issued] = await Promise.all([pay(source, "100.00"), issue(note)]);
    expect(issued.status).toBe(201); expect([201, 400]).toContain(payment.status);
    const current = (await get(`invoices/${source.id}`)).body;
    expect(current.credit.netTotal).toBe("20.00");
    if (payment.status === 201) expect(current.credit.refundDue).toBe("80.00");
    else { expect(current.balanceDue).toBe("20.00"); expect((await pay(source, "20.00")).status).toBe(201); }
    expect((await pay(source, "1.00")).status).toBe(400);
  });

  it("cancels a draft without affecting receivables or permitting further changes", async () => {
    const source = await invoice(); const note = await credit(source, "0.5");
    const cancelled = await post(`customer-credit-notes/${note.id}/cancel`, { expectedVersion: 1, reason: "Abandoned correction" });
    expect(cancelled.status).toBe(201); expect(cancelled.body.status).toBe("CANCELLED");
    expect((await get(`invoices/${source.id}`)).body.balanceDue).toBe("100.00");
    expect((await issue({ id: note.id, version: 2 })).status).toBe(400);
    expect((await refund(note, "1.00", "Cancelled-refund")).status).toBe(400);
  });

  it("credits approved supplier invoices and posts incoming refunds without rewriting original paid facts", async () => {
    const supplier = await prisma.supplier.create({ data: { organizationId, companyId, code: `SUP-${++sequence}`, name: "Credit supplier" } });
    const original = await prisma.supplierInvoice.create({ data: { organizationId, companyId, code: `FRA-${++sequence}`, supplierId: supplier.id, supplierReference: `REF-${sequence}`,
      currency: "USD", invoiceDate: new Date(today), dueDate: new Date(today), matchStatus: "NO_ORDER", subtotal: "100", taxTotal: "20", total: "120", recordedByUserId: userId } });
    await prisma.supplierInvoiceLine.create({ data: { organizationId, companyId, invoiceId: original.id, position: 1, description: "Supplier source", quantity: "2", unitPrice: "50", taxRate: "20", lineTotal: "100", lineTax: "20" } });
    await prisma.supplierInvoice.update({ where: { id: original.id }, data: { status: "APPROVED" } });
    const source = (await get(`payables/${original.id}`)).body;
    expect((await pay(source, "120.00", "SUPPLIER")).status).toBe(201);
    const before = (await get("bank-accounts")).body.find((bank: { id: string }) => bank.id === bankId).balance;
    const note = await credit(source, "1", "supplier"); const issued = await issue(note, "supplier");
    expect(issued.status).toBe(201); expect(issued.body.total).toBe("60.00"); expect(issued.body.invoice.refundDue).toBe("60.00");
    const returned = await refund(issued.body, "60.00", `SUP-R-${source.id}`, "supplier");
    expect(returned.status).toBe(201); expect(returned.body.refunds[0].direction).toBe("IN"); expect(returned.body.invoice.refundDue).toBe("0.00");
    const after = (await get("bank-accounts")).body.find((bank: { id: string }) => bank.id === bankId).balance;
    expect(Number(after) - Number(before)).toBe(60);
    expect((await get(`payables/${source.id}`)).body.paidAmount).toBe("120.00");
  });

  it("rejects source state, foreign line/scope, currency and optimistic-version violations", async () => {
    const draft = await post("invoices", { customerName: "Unissued", currency: "USD", lines: [{ description: "Draft", quantity: "1", unitPrice: "10" }] });
    expect((await post("customer-credit-notes", { invoiceId: draft.body.id, reason: "Not issued", lines: [{ sourceInvoiceLineId: draft.body.lines[0].id, quantity: "1" }] })).status).toBe(400);
    const a = await invoice(); const b = await invoice();
    expect((await post("customer-credit-notes", { invoiceId: a.id, reason: "Foreign line", lines: [{ sourceInvoiceLineId: b.lines[0].id, quantity: "1" }] })).status).toBe(400);
    const note = await credit(a, "0.5");
    expect((await patch(`customer-credit-notes/${note.id}`, { expectedVersion: 2, reason: "Stale" })).status).toBe(409);
    expect((await post("customer-credit-notes", { invoiceId: a.id, reason: "", lines: [{ sourceInvoiceLineId: a.lines[0].id, quantity: "1" }] })).status).toBe(400);
    expect((await patch(`customer-credit-notes/${note.id}`, { expectedVersion: 1, currency: "EUR" })).status).toBe(400);
    const foreignCompany = await prisma.company.create({ data: { organizationId, name: "Foreign credit" } });
    const foreign = await prisma.customerInvoice.create({ data: { organizationId, companyId: foreignCompany.id, customerName: "Foreign", currency: "USD", createdByUserId: userId } });
    expect((await post("customer-credit-notes", { invoiceId: foreign.id, reason: "Foreign", lines: [{ sourceInvoiceLineId: a.lines[0].id, quantity: "1" }] })).status).toBe(404);
    const otherBank = await post("bank-accounts", { code: "EUR-REFUND", name: "Euro refund", currency: "EUR" });
    expect(otherBank.status).toBe(201); expect((await pay(a, "100.00")).status).toBe(201); expect((await issue(note)).status).toBe(201);
    expect((await refund(note, "10.00", `FX-${note.id}`, "customer", otherBank.body.find((bank: { code: string }) => bank.code === "EUR-REFUND").id)).status).toBe(400);
  });

  it("includes refund liabilities in summary and preserves issued documents and append-only refunds in SQL", async () => {
    const source = await invoice(); expect((await pay(source, "100.00")).status).toBe(201);
    const issued = (await issue(await credit(source, "0.25"))).body;
    const summary = await get("summary"); expect(summary.status).toBe(200); expect(Number(summary.body.customerRefundsDue)).toBeGreaterThanOrEqual(25);
    await expect(prisma.customerCreditNote.update({ where: { id: issued.id }, data: { reason: "SQL issued rewrite" } })).rejects.toThrow();
    await expect(prisma.customerCreditNoteLine.update({ where: { id: issued.lines[0].id }, data: { unitPrice: "0" } })).rejects.toThrow();
    const refunded = await refund(issued, "25.00", `SQL-R-${issued.id}`); expect(refunded.status).toBe(201);
    await expect(prisma.creditRefund.delete({ where: { id: refunded.body.refunds[0].id } })).rejects.toThrow();
    await expect(prisma.creditRefund.update({ where: { id: refunded.body.refunds[0].id }, data: { amount: "1" } })).rejects.toThrow();
  });

  it("enforces source credit and refund caps for direct SQL issuance and inserts", async () => {
    const source = await invoice(); expect((await pay(source, "100.00")).status).toBe(201);
    const a = await credit(source, "0.7"); const b = await credit(source, "0.7"); expect((await issue(a)).status).toBe(201);
    await expect(prisma.customerCreditNote.update({ where: { id: b.id }, data: { status: "ISSUED", code: `AVC-DIRECT-${++sequence}`, issueDate: new Date(today), issuedByUserId: userId, version: { increment: 1 } } })).rejects.toThrow();
    await expect(prisma.creditRefund.create({ data: { organizationId, companyId, code: `RMC-DIRECT-${++sequence}`, direction: "OUT", customerCreditNoteId: a.id,
      bankAccountId: bankId, amount: "70.01", currency: "USD", refundedAt: new Date(today), method: "TRANSFER", idempotencyKey: `SQL-CAP-${a.id}`, createdByUserId: userId } })).rejects.toThrow();
    expect(await prisma.creditRefund.count({ where: { customerCreditNoteId: a.id } })).toBe(0);
  });

  it("applies net credits and refunds to project cockpit and analytics", async () => {
    const project = await prisma.project.create({ data: { organizationId, companyId, code: `PRJ-CREDIT-${++sequence}`, name: "Credit project", currency: "USD", createdByUserId: userId } });
    const source = await invoice("1", "100", false, project.id); expect((await pay(source, "100.00")).status).toBe(201);
    const issued = (await issue(await credit(source, "0.4"))).body;
    expect((await refund(issued, "40.00", `PROJECT-R-${issued.id}`)).status).toBe(201);
    const projectView = await request(app.getHttpServer()).get(`/api/v1/projects/${project.id}`).set("Cookie", cookie);
    expect(projectView.status).toBe(200);
    expect(projectView.body.cockpit.billed.amount).toBe("60.00"); expect(projectView.body.cockpit.collected.amount).toBe("60.00");
    const expected = await prisma.customerInvoice.aggregate({ where: { organizationId, companyId, status: { in: ["ISSUED", "PARTIALLY_PAID", "PAID"] } }, _sum: { total: true } });
    const credits = await prisma.customerCreditNote.aggregate({ where: { organizationId, companyId, status: "ISSUED" }, _sum: { total: true } });
    const analytics = await request(app.getHttpServer()).get("/api/v1/analytics/series/finance.invoiced").set("Cookie", cookie);
    expect(analytics.status).toBe(200);
    const net = analytics.body.series.find((series: { key: string }) => series.key === "USD");
    const total = net.values.reduce((sum: Prisma.Decimal, value: string) => sum.plus(value), new Prisma.Decimal(0));
    expect(total.toFixed(2)).toBe(expected._sum.total!.minus(credits._sum.total ?? 0).toFixed(2));
  });
});
