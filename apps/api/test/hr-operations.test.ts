import { describe, expect, it } from "vitest";
import { Prisma } from "@axora24/database";
import { attendanceIntervals, splitIntervalUtc, type AttendanceFact } from "../src/hr/attendance-intervals.js";
import { calculateAutomaticPay, calculateStatutoryDeductions } from "../src/hr/payroll-calculation.js";
import { cardPayload, createCardCredential, normalizeCardToken } from "../src/hr/service-card-credentials.js";
import { hashSessionToken } from "@axora24/security";

describe("HR evidence and explicit payroll calculations", () => {
  it("clips overnight presence at both range bounds and retains the IN project", () => {
    const facts: AttendanceFact[] = [{ id: "in", employeeId: "e", type: "IN", occurredAt: new Date("2026-10-01T23:00:00Z"), projectId: "p" }, { id: "out", employeeId: "e", type: "OUT", occurredAt: new Date("2026-10-03T01:00:00Z"), projectId: null }];
    const intervals = attendanceIntervals(facts, new Date("2026-10-02T00:00:00Z"), new Date("2026-10-03T00:00:00Z"));
    expect(splitIntervalUtc(intervals[0]!)).toMatchObject([{ projectId: "p", date: "2026-10-02", minutes: 1440, attendanceInId: "in", attendanceOutId: "out" }]);
  });
  it("keeps open intervals visible with zero invented worked minutes", () => {
    const intervals = attendanceIntervals([{ id: "in", employeeId: "e", type: "IN", occurredAt: new Date("2026-10-02T08:00:00Z"), projectId: "p" }], new Date("2026-10-02"), new Date("2026-10-03"));
    expect(splitIntervalUtc(intervals[0]!)[0]).toMatchObject({ minutes: 0, to: null, anomalies: ["MISSING_OUT"] });
  });
  it("calculates configured overtime and preserves monthly base mode", () => {
    const base = new Prisma.Decimal("3000");
    const hourly = calculateAutomaticPay(base, new Prisma.Decimal("180"), { mode: "VALIDATED_HOURS", standardMonthlyHours: "160", overtimeCoefficient: "1.5", version: 1, configured: true });
    expect(hourly.automaticAmount.toFixed(2)).toBe("3562.50");
    expect(hourly.regularHours.toFixed(2)).toBe("160.00");
    expect(hourly.overtimeHours.toFixed(2)).toBe("20.00");
    expect(calculateAutomaticPay(base, new Prisma.Decimal("8"), { mode: "MONTHLY_BASE", standardMonthlyHours: null, overtimeCoefficient: null, version: 0, configured: false }).automaticAmount.toFixed(2)).toBe("3000.00");
  });
  it("rejects an hourly calculation without configured assumptions", () => {
    expect(() => calculateAutomaticPay(new Prisma.Decimal(100), new Prisma.Decimal(8), { mode: "VALIDATED_HOURS", standardMonthlyHours: null, overtimeCoefficient: null, version: 1, configured: true })).toThrow(/explicit/);
  });
  it("uses random opaque QR credentials with authenticated encryption and no employee identifier", () => {
    const previous = process.env.SERVICE_CARD_ENCRYPTION_KEY;
    process.env.SERVICE_CARD_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    try {
      const first = createCardCredential();
      const second = createCardCredential();
      expect(first.qrPayload).not.toBe(second.qrPayload);
      expect(hashSessionToken(normalizeCardToken(first.qrPayload))).toBe(first.tokenHash);
      expect(cardPayload(first.tokenCiphertext)).toBe(first.qrPayload);
      expect(() => normalizeCardToken("BADGE-001")).toThrow(/Invalid/);
      expect(() => cardPayload(first.tokenCiphertext.slice(0, -5))).toThrow(/decrypt/);
    } finally { if (previous === undefined) delete process.env.SERVICE_CARD_ENCRYPTION_KEY; else process.env.SERVICE_CARD_ENCRYPTION_KEY = previous; }
  });
});

describe("Retenues légales de paie", () => {
  it("calcule le net à partir d'une politique complète", () => {
    const result = calculateStatutoryDeductions(new Prisma.Decimal("3500"), {
      version: 2,
      mode: "MONTHLY_BASE",
      standardMonthlyHours: null,
      overtimeCoefficient: null,
      countryCode: "CD",
      employeeSocialRate: "3.00",
      employeeHealthRate: "1.50",
      incomeTaxRate: "10.00",
      taxFreeAllowance: "500.00",
      statutoryConfigured: true,
      configured: true,
    });
    expect(result?.incomeTax.toFixed(2)).toBe("300.00");
    expect(result?.totalDeductions.toFixed(2)).toBe("457.50");
    expect(result?.netAmount.toFixed(2)).toBe("3042.50");
  });
});
