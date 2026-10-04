import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { InvoiceSignatureService } from "../src/finance/invoice-signature.service.js";
import { TreasuryForecastService } from "../src/finance/treasury-forecast.service.js";

const scope = { organizationId: "org-a", companyId: "company-a" };

describe("finance controls", () => {
  it("verifies an invoice signature and rejects a revoked proof", async () => {
    const previous = process.env.AXORA_INVOICE_SIGNING_SECRET;
    process.env.AXORA_INVOICE_SIGNING_SECRET = "test-invoice-secret";
    const hash = "a".repeat(64);
    const signature = createHmac("sha256", "test-invoice-secret").update(hash).digest("hex");
    const row = { id: "sig-1", organizationId: scope.organizationId, companyId: scope.companyId, invoiceId: "inv-1", invoiceCode: "FAC-1", documentHash: hash, signature, algorithm: "HMAC-SHA256", signerUserId: "user-1", signedAt: new Date("2026-10-04T10:00:00Z"), status: "VALID", revokedAt: null, revokedByUserId: null, revokeReason: null, createdAt: new Date("2026-10-04T10:00:00Z") };
    const prisma = { invoiceSignature: { findFirst: vi.fn().mockResolvedValue(row) } };
    try {
      const service = new InvoiceSignatureService(prisma as never);
      await expect(service.verify(scope, "inv-1", "sig-1")).resolves.toMatchObject({ valid: true, documentHash: hash });
      row.status = "REVOKED";
      await expect(service.verify(scope, "inv-1", "sig-1")).resolves.toMatchObject({ valid: false, status: "REVOKED" });
    } finally {
      if (previous === undefined) delete process.env.AXORA_INVOICE_SIGNING_SECRET;
      else process.env.AXORA_INVOICE_SIGNING_SECRET = previous;
    }
  });

  it("projects cash from actual balances and due invoices", async () => {
    const today = new Date();
    today.setUTCHours(12, 0, 0, 0);
    const prisma = {
      bankAccount: { findMany: vi.fn().mockResolvedValue([{ openingBalance: "100.00", currency: "USD" }]) },
      payment: { findMany: vi.fn().mockResolvedValue([{ direction: "IN", amount: "25.00" }, { direction: "OUT", amount: "5.00" }]) },
      customerInvoice: { findMany: vi.fn().mockResolvedValue([{ dueDate: new Date(today.getTime() + 86_400_000), total: "80.00", paidAmount: "0.00" }]) },
      supplierInvoice: { findMany: vi.fn().mockResolvedValue([{ dueDate: new Date(today.getTime() + 86_400_000), total: "20.00", paidAmount: "0.00" }]) },
    };
    const result = await new TreasuryForecastService(prisma as never).forecast(scope, 7);
    expect(result.openingBalance).toBe("120.00");
    expect(result.points).toHaveLength(7);
    expect(result.points.some((point) => point.expectedIn === "80.00" && point.expectedOut === "20.00")).toBe(true);
  });
});
