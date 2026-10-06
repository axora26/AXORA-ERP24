import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@axora24/database";
import { AccountingService } from "../src/finance/accounting.service.js";

describe("Accounting financial statements", () => {
  it("separates revenue, expenses and balance sheet accounts from posted lines", async () => {
    const lines = [
      { accountId: "cash", debit: new Prisma.Decimal("1200"), credit: new Prisma.Decimal("0"), account: { id: "cash", code: "512000", name: "Banque", type: "ASSET" } },
      { accountId: "sales", debit: new Prisma.Decimal("0"), credit: new Prisma.Decimal("1200"), account: { id: "sales", code: "706000", name: "Ventes", type: "REVENUE" } },
      { accountId: "expense", debit: new Prisma.Decimal("300"), credit: new Prisma.Decimal("0"), account: { id: "expense", code: "607000", name: "Achats", type: "EXPENSE" } },
      { accountId: "payable", debit: new Prisma.Decimal("0"), credit: new Prisma.Decimal("300"), account: { id: "payable", code: "401000", name: "Fournisseurs", type: "LIABILITY" } },
    ];
    const prisma = {
      accountingEntryLine: { findMany: vi.fn().mockResolvedValue(lines) },
      company: { findUniqueOrThrow: vi.fn().mockResolvedValue({ currency: "USD" }) },
    };
    const service = new AccountingService(prisma as never, {} as never);
    const result = await service.financialStatements({ organizationId: "org", companyId: "company" }, {});
    expect(result).toMatchObject({ currency: "USD", totalRevenue: "1200.00", totalExpenses: "300.00", netIncome: "900.00", totalAssets: "1200.00", totalLiabilities: "300.00", totalEquity: "900.00" });
    expect(result.incomeStatement.map((row) => row.code)).toEqual(["706000", "607000"]);
    expect(result.balanceSheet.map((row) => row.code)).toEqual(["512000", "401000", "RESULTAT"]);
  });
});
