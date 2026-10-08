import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@axora24/database";
import { AccountingService } from "../src/finance/accounting.service.js";
import { as, createHarness, registerTenant, type Harness, type Tenant } from "./support/harness.js";
import { createUserWith } from "./support/fixtures.js";

const systemKeys = ["CUSTOMER_RECEIVABLE", "SUPPLIER_PAYABLE", "BANK", "CASH", "SALES_REVENUE", "PURCHASE_EXPENSE", "OUTPUT_TAX", "INPUT_TAX", "EQUITY"];
const journalCodes = ["AC", "BQ", "CA", "OD", "VE"];
const scopeOf = (tenant: Tenant) => ({ organizationId: tenant.organizationId, companyId: tenant.companyId });

describe("Accounting defaults concurrency (PostgreSQL)", () => {
  let harness: Harness;
  beforeAll(async () => {
    if (!new URL(process.env.DATABASE_URL!).pathname.endsWith("_test")) throw new Error("Qualification requires an isolated *_test database");
    harness = await createHarness();
  });
  afterAll(async () => { await harness?.close(); });

  async function expectDefaults(tenant: Tenant) {
    const scope = scopeOf(tenant);
    const accounts = await harness.prisma.accountingAccount.findMany({ where: scope });
    const journals = await harness.prisma.accountingJournal.findMany({ where: scope });
    expect(accounts).toHaveLength(9);
    expect(new Set(accounts.map((account) => account.code)).size).toBe(9);
    expect(accounts.map((account) => account.systemKey).sort()).toEqual([...systemKeys].sort());
    expect(journals.map((journal) => journal.code).sort()).toEqual(journalCodes);
  }

  it("posts every same-date concurrent invoice once from virgin defaults with balanced Decimal amounts", async () => {
    const tenant = await registerTenant(harness, "defaults-invoices");
    const scope = scopeOf(tenant);
    const api = as(harness, tenant);
    expect(await harness.prisma.accountingAccount.count({ where: scope })).toBe(0);
    expect(await harness.prisma.accountingJournal.count({ where: scope })).toBe(0);
    const drafted = await Promise.all(Array.from({ length: 8 }, (_, index) => api.post("/finance/invoices", {
      customerName: `Concurrent customer ${index}`, currency: "USD",
      lines: [{ description: "Precise service", quantity: "1.23456", unitPrice: "123.45678" }],
    })));
    expect(drafted.map((response) => response.status)).toEqual(Array(8).fill(201));
    const responses = await Promise.all(drafted.map((invoice) => api.post(`/finance/invoices/${invoice.body.id}/issue`, { issueDate: "2026-10-03", dueDays: 30 })));
    expect(responses.map((response) => response.status)).toEqual(Array(8).fill(201));
    await expectDefaults(tenant);
    const invoices = await harness.prisma.customerInvoice.findMany({ where: scope, orderBy: { code: "asc" }, include: { lines: true } });
    expect(invoices.map((invoice) => invoice.code)).toEqual(Array.from({ length: 8 }, (_, index) => `FAC-2026-${String(index + 1).padStart(4, "0")}`));
    const entries = await harness.prisma.accountingEntry.findMany({ where: { ...scope, sourceType: "CUSTOMER_INVOICE" }, include: { lines: true } });
    expect(entries).toHaveLength(8);
    expect(new Set(entries.map((entry) => entry.number)).size).toBe(8);
    for (const invoice of invoices) {
      expect(invoice.status).toBe("ISSUED");
      expect(invoice.issueDate!.toISOString().slice(0, 10)).toBe("2026-10-03");
      expect(invoice.total.toFixed(2)).toBe("152.41");
      expect(invoice.lines[0]!.quantity.toFixed(6)).toBe("1.234560");
      expect(invoice.lines[0]!.unitPrice.toFixed(6)).toBe("123.456780");
      const matches = entries.filter((entry) => entry.sourceId === invoice.id);
      expect(matches).toHaveLength(1);
      const entry = matches[0]!;
      expect(entry.status).toBe("POSTED");
      expect(entry.postedByUserId).toBe(tenant.userId);
      const debit = entry.lines.reduce((sum, line) => sum.plus(line.debit), new Prisma.Decimal(0));
      const credit = entry.lines.reduce((sum, line) => sum.plus(line.credit), new Prisma.Decimal(0));
      expect(debit.equals(credit)).toBe(true);
      expect(debit.equals(invoice.total)).toBe(true);
      expect(await harness.prisma.auditLog.count({ where: { organizationId: tenant.organizationId, resourceId: invoice.id, action: "finance.invoice.issued" } })).toBe(1);
      expect(await harness.prisma.auditLog.count({ where: { organizationId: tenant.organizationId, resourceId: entry.id, action: "finance.accounting.entry.posted" } })).toBe(1);
    }
  });

  it("serializes concurrent bootstrap callers from virgin accounts and journals", async () => {
    const tenant = await registerTenant(harness, "defaults-bootstrap");
    const responses = await Promise.all(Array.from({ length: 6 }, () => as(harness, tenant).post("/finance/accounting/bootstrap")));
    expect(responses.map((response) => response.status)).toEqual(Array(6).fill(201));
    await expectDefaults(tenant);
    expect(await harness.prisma.auditLog.count({ where: { organizationId: tenant.organizationId, resourceId: tenant.companyId, action: "finance.accounting.bootstrapped" } })).toBe(6);
  });

  it("serializes missing journals without overwriting customized system accounts or an existing journal", async () => {
    const tenant = await registerTenant(harness, "defaults-journals");
    const scope = scopeOf(tenant);
    await harness.prisma.accountingAccount.createMany({ data: systemKeys.map((systemKey, index) => ({ ...scope, systemKey, code: `CUSTOM-${index}`, name: `Customized ${systemKey}`, type: "ASSET", isActive: index !== 7 })) });
    const parent = await harness.prisma.accountingAccount.findFirstOrThrow({ where: { ...scope, systemKey: "EQUITY" } });
    await harness.prisma.accountingAccount.updateMany({ where: { ...scope, systemKey: "BANK" }, data: { parentId: parent.id } });
    const before = await harness.prisma.accountingAccount.findMany({ where: scope, orderBy: { code: "asc" } });
    const customJournal = await harness.prisma.accountingJournal.create({ data: { ...scope, code: "VE", name: "Customized sales journal", type: "GENERAL", isActive: false } });
    const responses = await Promise.all(Array.from({ length: 6 }, () => as(harness, tenant).post("/finance/accounting/bootstrap")));
    expect(responses.map((response) => response.status)).toEqual(Array(6).fill(201));
    await expectDefaults(tenant);
    expect(await harness.prisma.accountingAccount.findMany({ where: scope, orderBy: { code: "asc" } })).toEqual(before);
    expect(await harness.prisma.accountingJournal.findUniqueOrThrow({ where: { id: customJournal.id } })).toEqual(customJournal);
  });

  it("rejects an organization/company scope mismatch before reading or initializing defaults", async () => {
    const owner = await registerTenant(harness, "defaults-scope-owner");
    const other = await registerTenant(harness, "defaults-scope-other");
    await expect(harness.app.get(AccountingService).bootstrap({ organizationId: other.organizationId, companyId: owner.companyId }, other.userId)).rejects.toMatchObject({ status: 404, message: "Company not found" });
    for (const tenant of [owner, other]) {
      expect(await harness.prisma.accountingAccount.count({ where: { companyId: tenant.companyId } })).toBe(0);
      expect(await harness.prisma.accountingJournal.count({ where: { companyId: tenant.companyId } })).toBe(0);
      expect(await harness.prisma.auditLog.count({ where: { organizationId: tenant.organizationId, action: "finance.accounting.bootstrapped" } })).toBe(0);
    }
  });

  it("keeps genuine custom-code P2002 collisions visible and rolls back initialization", async () => {
    const tenant = await registerTenant(harness, "defaults-code-collision");
    const scope = scopeOf(tenant);
    const custom = await harness.prisma.accountingAccount.create({ data: { ...scope, code: "411000", name: "Custom non-system account", type: "EXPENSE" } });
    await expect(harness.app.get(AccountingService).bootstrap(scope, tenant.userId)).rejects.toMatchObject({ code: "P2002", meta: { target: ["companyId", "code"] } });
    expect(await harness.prisma.accountingAccount.findMany({ where: scope })).toEqual([custom]);
    expect(await harness.prisma.accountingJournal.count({ where: scope })).toBe(0);
    expect(await harness.prisma.auditLog.count({ where: { organizationId: tenant.organizationId, action: "finance.accounting.bootstrapped" } })).toBe(0);
  });

  it("preserves HTTP accounting RBAC and cross-tenant company isolation", async () => {
    const owner = await registerTenant(harness, "defaults-rbac-owner");
    const other = await registerTenant(harness, "defaults-rbac-other");
    const reader = await createUserWith(harness, owner, ["finance.invoice.read"], "no-accounting-manage");
    expect((await as(harness, reader).post("/finance/accounting/bootstrap")).status).toBe(403);
    expect((await as(harness, owner).post("/finance/accounting/bootstrap", { companyId: other.companyId })).status).toBe(403);
    expect((await as(harness, owner).post("/finance/accounting/bootstrap")).status).toBe(201);
    await expectDefaults(owner);
    expect(await harness.prisma.accountingAccount.count({ where: scopeOf(other) })).toBe(0);
    expect(await harness.prisma.accountingJournal.count({ where: scopeOf(other) })).toBe(0);
  });
});
