import { describe, expect, it } from "vitest";
import {
  boundedInteger,
  currencyCode,
  decimalAmount,
  enumValue,
  optionalDate,
  optionalString,
  requiredString,
} from "../src/crm/crm.dto.js";

/**
 * Tests unitaires des validateurs CRM — aucune base de donnees requise.
 *
 * Ils verrouillent l'invariant financier du projet : un montant ne doit
 * JAMAIS transiter par un flottant IEEE-754 (schema.prisma : Decimal(18,2)).
 */
describe("decimalAmount", () => {
  it("rejects a JavaScript number even when it looks exact", () => {
    expect(() => decimalAmount(1234.56, "amount")).toThrowError(/decimal string/i);
    expect(() => decimalAmount(0.1, "amount")).toThrowError(/decimal string/i);
  });

  it("rejects more than two decimals", () => {
    expect(() => decimalAmount("10.005", "amount")).toThrowError();
    expect(() => decimalAmount("10.999", "amount")).toThrowError();
  });

  it("rejects negative amounts and non-numeric strings", () => {
    expect(() => decimalAmount("-1.00", "amount")).toThrowError();
    expect(() => decimalAmount("1e5", "amount")).toThrowError();
    expect(() => decimalAmount("12,50", "amount")).toThrowError();
  });

  it("accepts valid decimal strings and defaults to zero", () => {
    expect(decimalAmount("0", "amount")).toBe("0");
    expect(decimalAmount("125000.50", "amount")).toBe("125000.50");
    expect(decimalAmount("  99.90  ", "amount")).toBe("99.90");
    expect(decimalAmount(undefined, "amount")).toBe("0");
    expect(decimalAmount("", "amount")).toBe("0");
  });
});

describe("currencyCode", () => {
  it("normalizes to upper case and rejects anything but 3 letters", () => {
    expect(currencyCode("usd")).toBe("USD");
    expect(currencyCode(undefined)).toBe("USD");
    expect(() => currencyCode("US")).toThrowError();
    expect(() => currencyCode("DOLLAR")).toThrowError();
    expect(() => currencyCode("US1")).toThrowError();
  });
});

describe("requiredString / optionalString", () => {
  it("rejects blank values and enforces the maximum length", () => {
    expect(() => requiredString("   ", "name")).toThrowError(/required/i);
    expect(() => requiredString(undefined, "name")).toThrowError(/required/i);
    expect(() => requiredString("a".repeat(301), "name")).toThrowError(/exceeds/i);
    expect(requiredString("  AXORA  ", "name")).toBe("AXORA");
  });

  it("maps empty optional values to null", () => {
    expect(optionalString("", "city")).toBeNull();
    expect(optionalString(undefined, "city")).toBeNull();
    expect(optionalString(" Goma ", "city")).toBe("Goma");
  });
});

describe("enumValue", () => {
  it("accepts a case-insensitive member and rejects anything else", () => {
    expect(enumValue("new", ["NEW", "CONTACTED"] as const, "status")).toBe("NEW");
    expect(() => enumValue("UNKNOWN", ["NEW"] as const, "status")).toThrowError(/must be one of/i);
  });
});

describe("boundedInteger", () => {
  it("enforces integer bounds and the fallback", () => {
    expect(boundedInteger(50, "probability", 0, 100)).toBe(50);
    expect(boundedInteger(undefined, "probability", 0, 100, 0)).toBe(0);
    expect(() => boundedInteger(101, "probability", 0, 100)).toThrowError();
    expect(() => boundedInteger(12.5, "position", 1, 999)).toThrowError();
    expect(() => boundedInteger(undefined, "position", 1, 999)).toThrowError(/required/i);
  });
});

describe("optionalDate", () => {
  it("parses ISO dates and rejects invalid ones", () => {
    expect(optionalDate(undefined, "expectedCloseDate")).toBeNull();
    expect(optionalDate("2026-12-31", "expectedCloseDate")?.getUTCFullYear()).toBe(2026);
    expect(() => optionalDate("pas-une-date", "expectedCloseDate")).toThrowError();
  });
});
