import { describe, expect, it } from "vitest";
import { DOCUMENT_SAMPLES, generateDocumentSample, recipientForSampleKind } from "../src/common/document-catalog.js";

describe("catalogue documentaire AXORA", () => {
  it("déclare quatorze documents uniques couvrant les flux de gestion demandés", () => {
    expect(DOCUMENT_SAMPLES).toHaveLength(14);
    expect(new Set(DOCUMENT_SAMPLES.map((sample) => sample.filename)).size).toBe(14);
    expect(DOCUMENT_SAMPLES.map((sample) => sample.kind)).toEqual([
      "QUOTE",
      "CUSTOMER_INVOICE",
      "PROGRESS_INVOICE",
      "CUSTOMER_CREDIT_NOTE",
      "PURCHASE_ORDER",
      "GOODS_RECEIPT",
      "SUPPLIER_RETURN",
      "SUPPLIER_CREDIT_NOTE",
      "STOCK_ISSUE",
      "MONTHLY_ATTENDANCE",
      "WEEKLY_TIMESHEET",
      "PAYSLIP",
      "SITE_DAILY_REPORT",
      "WORKS_ACCEPTANCE",
    ]);
  });

  it("conserve des totaux arithmétiquement cohérents sans conversion implicite", () => {
    for (const sample of DOCUMENT_SAMPLES) {
      if (!sample.financial) continue;
      const linesTotal = sample.financial.lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
      expect(linesTotal).toBeCloseTo(sample.financial.subtotal, 6);
      expect(sample.financial.total).toBeCloseTo(
        sample.financial.subtotal + sample.financial.tax - sample.financial.deductions,
        6,
      );
      expect(["USD", "CDF"]).toContain(sample.financial.currency);
    }
  });

  it("affecte explicitement le destinataire métier des quatorze documents", () => {
    const expectedNames = {
      QUOTE: "CLIENT DÉMONSTRATION SARL",
      CUSTOMER_INVOICE: "CLIENT DÉMONSTRATION SARL",
      PROGRESS_INVOICE: "CLIENT DÉMONSTRATION SARL",
      CUSTOMER_CREDIT_NOTE: "CLIENT DÉMONSTRATION SARL",
      PURCHASE_ORDER: "FOURNISSEUR DÉMONSTRATION SARL",
      GOODS_RECEIPT: "FOURNISSEUR DÉMONSTRATION SARL",
      SUPPLIER_RETURN: "FOURNISSEUR DÉMONSTRATION SARL",
      SUPPLIER_CREDIT_NOTE: "FOURNISSEUR DÉMONSTRATION SARL",
      STOCK_ISSUE: "CHANTIER IMMEUBLE DÉMONSTRATION",
      MONTHLY_ATTENDANCE: "KABILA Jean — MAT-DEMO-0042",
      WEEKLY_TIMESHEET: "KABILA Jean — MAT-DEMO-0042",
      PAYSLIP: "KABILA Jean — MAT-DEMO-0042",
      SITE_DAILY_REPORT: "CLIENT DÉMONSTRATION SARL",
      WORKS_ACCEPTANCE: "CLIENT DÉMONSTRATION SARL",
    } as const;

    for (const sample of DOCUMENT_SAMPLES) {
      expect(recipientForSampleKind(sample.kind).name, sample.kind).toBe(expectedNames[sample.kind]);
    }
  });

  it("génère chaque exemple comme un vrai PDF ouvrable", async () => {
    for (const sample of DOCUMENT_SAMPLES) {
      const buffer = await generateDocumentSample(sample);
      expect(buffer.subarray(0, 5).toString(), sample.filename).toBe("%PDF-");
      expect(buffer.byteLength, sample.filename).toBeGreaterThan(3_500);
    }
  }, 30_000);
});
