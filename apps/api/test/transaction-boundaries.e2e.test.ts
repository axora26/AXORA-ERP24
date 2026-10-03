import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module.js";
import { PrismaService } from "../src/core/prisma.service.js";

describe("Immutable source and physical stock-count boundaries (PostgreSQL)", () => {
  let app: INestApplication; let db: PrismaService; let cookie: string[];
  let organizationId: string; let companyId: string;
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  let sequence = 0;
  beforeAll(async () => {
    if (!new URL(process.env.DATABASE_URL!).pathname.endsWith("_test")) throw new Error("Qualification requires an isolated *_test database");
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication(); db = app.get(PrismaService);
    app.use(cookieParser()); app.setGlobalPrefix("api/v1", { exclude: ["health"] }); await app.init();
    const registered = await request(app.getHttpServer()).post("/api/v1/auth/register-organization").set("Origin", "http://localhost:3100").send({
      organizationName: `Boundary qualification ${suffix}`, organizationSlug: `boundary-${suffix}`, companyName: "Qualification boundaries",
      ownerEmail: `boundary-${suffix}@test.example`, ownerPassword: "StrongPass123!", ownerFullName: "Qualification Owner",
    });
    expect(registered.status).toBe(201); cookie = registered.headers["set-cookie"] as unknown as string[];
    organizationId = registered.body.user.organizationId;
    companyId = (await db.company.findFirstOrThrow({ where: { organizationId } })).id;
    await db.organization.update({ where: { id: organizationId }, data: { isDemo: true } });
  });
  afterAll(async () => { await app?.close(); });
  function post(path: string, body: object = {}) {
    return request(app.getHttpServer()).post(`/api/v1${path}`).set("Cookie", cookie).set("Origin", "http://localhost:3100").send(body);
  }
  function put(path: string, body: object) {
    return request(app.getHttpServer()).put(`/api/v1${path}`).set("Cookie", cookie).set("Origin", "http://localhost:3100").send(body);
  }
  async function stock() {
    const number = ++sequence;
    const item = await post("/inventory/items", { code: `BOUND-${number}`, name: "Qualification material", unitCode: "u" }); expect(item.status).toBe(201);
    const warehouse = await post("/inventory/warehouses", { code: `BOUND-WH-${number}`, name: "Qualification warehouse" }); expect(warehouse.status).toBe(201);
    expect((await post("/inventory/adjustments", { itemId: item.body.id, warehouseId: warehouse.body.id, quantityDelta: "10", unitCost: "1", reason: "Qualification opening" })).status).toBe(201);
    return { itemId: item.body.id as string, warehouseId: warehouse.body.id as string };
  }
  it("admits exactly one simultaneous physical count per warehouse", async () => {
    const data = await stock();
    const responses = await Promise.all(Array.from({ length: 8 }, () => post("/inventory/counts", { warehouseId: data.warehouseId })));
    expect(responses.filter((response) => response.status === 201)).toHaveLength(1);
    expect(responses.filter((response) => response.status === 409)).toHaveLength(7);
    expect(await db.stockCount.count({ where: { organizationId, companyId, warehouseId: data.warehouseId, status: "OPEN" } })).toBe(1);
  });
  it("freezes stock movements at the same boundary as the physical-count snapshot", async () => {
    const data = await stock();
    const responses = await Promise.all([
      post("/inventory/counts", { warehouseId: data.warehouseId }),
      ...Array.from({ length: 6 }, () => post("/inventory/adjustments", { ...data, quantityDelta: "1", unitCost: "1", reason: "Concurrent freeze" })),
    ]);
    expect(responses[0]!.status).toBe(201);
    expect(responses.slice(1).every((response) => [201, 400].includes(response.status))).toBe(true);
    const balance = await db.stockBalance.findFirstOrThrow({ where: { ...data, organizationId, companyId } });
    const line = await db.stockCountLine.findFirstOrThrow({ where: { countId: responses[0]!.body.id, itemId: data.itemId } });
    expect(line.systemQuantity.toFixed(3)).toBe(balance.quantity.toFixed(3));
  });
  it("applies an inventory correction once despite eight simultaneous closes", async () => {
    const data = await stock(); const opened = await post("/inventory/counts", { warehouseId: data.warehouseId });
    expect((await put(`/inventory/counts/${opened.body.id}/lines`, { itemId: data.itemId, countedQuantity: "9" })).status).toBe(200);
    const responses = await Promise.all(Array.from({ length: 8 }, () => post(`/inventory/counts/${opened.body.id}/close`)));
    expect(responses.filter((response) => response.status === 201)).toHaveLength(1);
    expect(responses.filter((response) => response.status === 400)).toHaveLength(7);
    const balance = await db.stockBalance.findFirstOrThrow({ where: { ...data, organizationId, companyId } });
    expect(balance.quantity.toFixed(3)).toBe("9.000");
    expect(await db.stockMovement.count({ where: { organizationId, companyId, countId: opened.body.id } })).toBe(1);
  });
  it("keeps counted quantity and stock equal when counting edits race with closure", async () => {
    const data = await stock(); const opened = await post("/inventory/counts", { warehouseId: data.warehouseId });
    await put(`/inventory/counts/${opened.body.id}/lines`, { itemId: data.itemId, countedQuantity: "9" });
    const responses = await Promise.all([
      post(`/inventory/counts/${opened.body.id}/close`),
      ...Array.from({ length: 5 }, (_, index) => put(`/inventory/counts/${opened.body.id}/lines`, { itemId: data.itemId, countedQuantity: String(index + 2) })),
    ]);
    expect(responses[0]!.status).toBe(201);
    const line = await db.stockCountLine.findFirstOrThrow({ where: { countId: opened.body.id, itemId: data.itemId } });
    const balance = await db.stockBalance.findFirstOrThrow({ where: { ...data, organizationId, companyId } });
    expect(balance.quantity.toFixed(3)).toBe(line.countedQuantity!.toFixed(3));
  });
  it("allows opposite concurrent transfers without a deadlock or value loss", async () => {
    const data = await stock();
    const warehouse = await post("/inventory/warehouses", { code: `REVERSE-${sequence}`, name: "Reverse transfer warehouse" });
    expect((await post("/inventory/adjustments", { itemId: data.itemId, warehouseId: warehouse.body.id, quantityDelta: "10", unitCost: "1", reason: "Reverse opening" })).status).toBe(201);
    const responses = await Promise.all([
      post("/inventory/transfers", { fromWarehouseId: data.warehouseId, toWarehouseId: warehouse.body.id, idempotencyKey: `forward-${suffix}`, lines: [{ itemId: data.itemId, quantity: "2" }] }),
      post("/inventory/transfers", { fromWarehouseId: warehouse.body.id, toWarehouseId: data.warehouseId, idempotencyKey: `reverse-${suffix}`, lines: [{ itemId: data.itemId, quantity: "3" }] }),
    ]);
    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    const totals = await db.stockBalance.aggregate({ where: { organizationId, companyId, itemId: data.itemId }, _sum: { quantity: true, value: true } });
    expect(totals._sum.quantity!.toFixed(3)).toBe("20.000"); expect(totals._sum.value!.toFixed(2)).toBe("20.00");
  });
  async function study() {
    const code = `BOUND-ST-${++sequence}`;
    const opportunity = await post("/crm/opportunities", { name: "Qualification study", amount: "1", currency: "USD" }); expect(opportunity.status).toBe(201);
    const created = await post("/estimation/studies", { opportunityId: opportunity.body.id, code, title: "Qualification study", objective: "Immutable source" }); expect(created.status).toBe(201);
    expect((await post(`/estimation/studies/${created.body.id}/requirements`, { position: 1, category: "FACT", statement: "Verified source" })).status).toBe(201);
    return created.body.id as string;
  }
  it("freezes study requirements exactly at the audited ready transition", async () => {
    const id = await study();
    const responses = await Promise.all([
      post(`/estimation/studies/${id}/ready`),
      ...Array.from({ length: 6 }, (_, index) => post(`/estimation/studies/${id}/requirements`, { position: index + 2, category: "FACT", statement: "Concurrent requirement" })),
    ]);
    expect(responses[0]!.status).toBe(201); expect(responses.slice(1).every((response) => [201, 400].includes(response.status))).toBe(true);
    const audit = await db.auditLog.findFirstOrThrow({ where: { organizationId, resourceId: id, action: "estimation.study.ready" } });
    const metadata = audit.metadata as { requirementCount: number };
    expect(await db.estimationStudyRequirement.count({ where: { studyId: id } })).toBe(metadata.requirementCount);
  });
  it("freezes DQE lines exactly at finalization so copied commercial sources cannot drift", async () => {
    const id = await study(); await post(`/estimation/studies/${id}/ready`);
    const dqe = await post("/estimation/dqes", { studyId: id, code: `BOUND-DQE-${sequence}`, title: "Concurrent DQE", currency: "USD" }); expect(dqe.status).toBe(201);
    expect((await post(`/estimation/dqes/${dqe.body.id}/lines`, { position: 1, designation: "Initial line", unitCode: "u", quantity: "1", unitPrice: "1" })).status).toBe(201);
    const responses = await Promise.all([
      post(`/estimation/dqes/${dqe.body.id}/finalize`),
      ...Array.from({ length: 6 }, (_, index) => post(`/estimation/dqes/${dqe.body.id}/lines`, { position: index + 2, designation: "Concurrent line", unitCode: "u", quantity: "1", unitPrice: "1" })),
    ]);
    expect(responses[0]!.status).toBe(201); expect(responses.slice(1).every((response) => [201, 400].includes(response.status))).toBe(true);
    const audit = await db.auditLog.findFirstOrThrow({ where: { organizationId, resourceId: dqe.body.id, action: "estimation.dqe.finalized" } });
    const metadata = audit.metadata as { lineCount: number };
    expect(await db.dqeLine.count({ where: { dqeId: dqe.body.id } })).toBe(metadata.lineCount);
    const quote = await post("/sales/quotes", { dqeId: dqe.body.id, code: `BOUND-QUOTE-${sequence}`, title: "Immutable quote" }); expect(quote.status).toBe(201);
    expect(quote.body.lines).toHaveLength(metadata.lineCount);
  });
  it("keeps invoice number dates chronological under concurrent standalone issuance", async () => {
    const drafted = await Promise.all(Array.from({ length: 6 }, (_, index) => post("/finance/invoices", {
      customerName: `Chronology customer ${index}`, currency: "USD",
      lines: [{ description: "Verified service", quantity: "1", unitPrice: "100" }],
    })));
    expect(drafted.every((response) => response.status === 201)).toBe(true);
    const responses = await Promise.all(drafted.map((invoice, index) => post(`/finance/invoices/${invoice.body.id}/issue`, {
      issueDate: index === 0 ? "2026-10-03" : "2026-10-01", dueDays: 30,
    })));
    expect(responses[0]!.status).toBe(201);
    expect(responses.every((response) => [201, 400].includes(response.status))).toBe(true);
    const issued = await db.customerInvoice.findMany({ where: { organizationId, companyId, code: { not: null } }, orderBy: { code: "asc" },
      select: { code: true, issueDate: true } });
    for (let index = 1; index < issued.length; index++) {
      expect(issued[index]!.issueDate!.getTime()).toBeGreaterThanOrEqual(issued[index - 1]!.issueDate!.getTime());
    }
    expect(new Set(issued.map((invoice) => invoice.code)).size).toBe(issued.length);
  });
  it("invoices a high-precision contract in full without increasing its price through early rounding", async () => {
    const id = await study(); await post(`/estimation/studies/${id}/ready`);
    const dqe = await post("/estimation/dqes", { studyId: id, code: `PRECISE-DQE-${sequence}`, title: "Precise contractual quantities", currency: "USD" });
    expect((await post(`/estimation/dqes/${dqe.body.id}/lines`, { position: 1, designation: "Precise measured work", unitCode: "u", quantity: "1.23456", unitPrice: "123.45678" })).status).toBe(201);
    expect((await post(`/estimation/dqes/${dqe.body.id}/finalize`)).status).toBe(201);
    const quote = await post("/sales/quotes", { dqeId: dqe.body.id, code: `PRECISE-QUOTE-${sequence}`, title: "Precise quote" }); expect(quote.status).toBe(201);
    expect((await post(`/sales/quotes/${quote.body.id}/submit`)).status).toBe(201);
    expect((await post(`/sales/quotes/${quote.body.id}/accept`)).status).toBe(201);
    const contract = await post("/sales/contracts", { quoteId: quote.body.id, code: `PRECISE-CONTRACT-${sequence}`, title: "Precise contract" }); expect(contract.status).toBe(201);
    const invoice = await post("/finance/invoices", { contractId: contract.body.id, percent: "100", customerName: "Precise customer" }); expect(invoice.status).toBe(201);
    expect(invoice.body.subtotal).toBe("152.41");
    expect(invoice.body.lines[0].quantity).toBe("1.234560");
    expect(invoice.body.lines[0].unitPrice).toBe("123.456780");
    const sourceLine = await db.customerInvoiceLine.findFirstOrThrow({ where: { invoiceId: invoice.body.id } });
    expect(sourceLine.quantity.toFixed(6)).toBe("1.234560");
    expect(sourceLine.unitPrice.toFixed(6)).toBe("123.456780");
    const issued = await post(`/finance/invoices/${invoice.body.id}/issue`, { issueDate: "2026-10-03" });
    expect(issued.status).toBe(201); expect(issued.body.total).toBe("152.41");
  });
});
