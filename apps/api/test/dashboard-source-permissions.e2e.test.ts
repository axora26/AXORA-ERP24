import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createHarness, registerTenant, type Harness, type Tenant } from "./support/harness.js";
import { createUserWith } from "./support/fixtures.js";

describe("Dashboard source permissions (real scoped sessions)", () => {
  let harness: Harness; let owner: Tenant;
  const readers = new Map<string, Tenant>();
  const keys = (response: { body: { kpis: Array<{ key: string }> } }) => response.body.kpis.map((row) => row.key);
  beforeAll(async () => {
    if (!new URL(process.env.DATABASE_URL!).pathname.endsWith("_test")) throw new Error("Dashboard tests require isolated _test database");
    harness = await createHarness(); owner = await registerTenant(harness, "dashboard-sources");
    for (const permission of ["finance.invoice.read", "finance.payable.read", "procurement.order.read", "procurement.request.read", "sales.contract.read", "sales.quote.read", "crm.opportunity.read"]) {
      readers.set(permission, await createUserWith(harness, owner, ["dashboard.overview.read", permission], `reader-${permission.replaceAll(".", "-")}`));
    }
    expect((await as(harness, owner).post("/crm/leads", { contactName: "Prospect Protégé", companyName: "Confidential" })).status).toBe(201);
  });
  afterAll(async () => { await harness?.close(); });

  it("client invoice read never grants supplier invoice aggregates, and vice versa", async () => {
    const clients = await as(harness, readers.get("finance.invoice.read")!).get("/dashboard/overview"); expect(clients.status).toBe(200);
    expect(keys(clients)).toEqual(["finance.receivables", "finance.refundsDue"]);
    const suppliers = await as(harness, readers.get("finance.payable.read")!).get("/dashboard/overview"); expect(suppliers.status).toBe(200);
    expect(keys(suppliers)).toEqual(["finance.toApprove"]);
  });

  it("order read and request read protect distinct purchasing sources", async () => {
    const orders = await as(harness, readers.get("procurement.order.read")!).get("/dashboard/overview"); expect(orders.status).toBe(200);
    expect(keys(orders)).toEqual(["procurement.openOrders"]);
    const requests = await as(harness, readers.get("procurement.request.read")!).get("/dashboard/overview"); expect(requests.status).toBe(200);
    expect(keys(requests)).toEqual(["procurement.pendingRequests"]);
  });

  it("contract read does not grant quote counts, while quote readers retain their KPI", async () => {
    const contracts = await as(harness, readers.get("sales.contract.read")!).get("/dashboard/overview"); expect(contracts.status).toBe(200);
    expect(keys(contracts)).toEqual(["sales.contracts"]);
    const quotes = await as(harness, readers.get("sales.quote.read")!).get("/dashboard/overview"); expect(quotes.status).toBe(200);
    expect(keys(quotes)).toEqual(["sales.pendingQuotes"]);
  });

  it("CRM opportunity dashboard does not disclose inaccessible leads", async () => {
    const opportunityReader = readers.get("crm.opportunity.read")!;
    const response = await as(harness, opportunityReader).get("/crm/dashboard"); expect(response.status).toBe(200);
    expect(response.body.leads).toEqual({ available: false, total: null, open: null, converted: null });
    expect(response.body.opportunities.total).toBe(0);
    const allowed = await as(harness, owner).get("/crm/dashboard"); expect(allowed.status).toBe(200);
    expect(allowed.body.leads).toMatchObject({ available: true, total: 1, open: 1, converted: 0 });
    expect((await as(harness, opportunityReader).get("/crm/leads")).status).toBe(403);
  });

  it("keeps every authorized financial currency explicit on the overview", async () => {
    await harness.prisma.organization.update({ where: { id: owner.organizationId }, data: { isDemo: true } });
    for (const currency of ["USD", "EUR"]) {
      const invoice = await as(harness, owner).post("/finance/invoices", { currency, customerName: "Client multi-devises", lines: [{ description: "Service réel", quantity: "1", unitPrice: "10" }] }); expect(invoice.status).toBe(201);
      expect((await as(harness, owner).post(`/finance/invoices/${invoice.body.id}/issue`, { issueDate: new Date().toISOString().slice(0, 10) })).status).toBe(201);
    }
    const response = await as(harness, readers.get("finance.invoice.read")!).get("/dashboard/overview"); expect(response.status).toBe(200);
    expect(response.body.kpis.find((row: { key: string }) => row.key === "finance.receivables").amounts).toEqual([{ currency: "EUR", amount: "10.00" }, { currency: "USD", amount: "10.00" }]);
  });
});
