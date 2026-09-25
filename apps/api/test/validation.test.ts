import { describe, expect, it } from "vitest";
import { BadRequestException } from "@nestjs/common";
import {
  currencyCode,
  optionalText,
  requiredDate,
  requiredDecimal,
  requiredEnum,
  requiredInt,
  requiredText,
} from "../src/common/validation.js";
import { money, percent, sumDecimals } from "../src/common/decimal.js";

describe("validateurs communs", () => {
  it("requiredText rogne et refuse le vide ou le trop long", () => {
    expect(requiredText("  Tour Horizon ", "name")).toBe("Tour Horizon");
    expect(() => requiredText("   ", "name")).toThrow(BadRequestException);
    expect(() => requiredText("x".repeat(11), "name", 10)).toThrow(/exceeds 10/);
    expect(optionalText("  ", "note")).toBeNull();
  });

  it("requiredDecimal refuse les nombres JSON (flottants deja imprecis) et les negatifs", () => {
    expect(requiredDecimal("1250.50", "amount").toFixed(2)).toBe("1250.50");
    expect(() => requiredDecimal(1250.5, "amount")).toThrow(/decimal string/);
    expect(() => requiredDecimal("-1", "amount")).toThrow(/negative/);
    expect(requiredDecimal("-1", "delta", { allowNegative: true }).toFixed(0)).toBe("-1");
    expect(() => requiredDecimal("0", "qty", { positive: true })).toThrow(/greater than zero/);
    expect(() => requiredDecimal("1e5", "amount")).toThrow(BadRequestException);
  });

  it("requiredEnum normalise la casse et liste les valeurs admises", () => {
    expect(requiredEnum("planned", "status", ["PLANNED", "DONE"] as const)).toBe("PLANNED");
    expect(() => requiredEnum("other", "status", ["PLANNED", "DONE"] as const)).toThrow(/PLANNED, DONE/);
  });

  it("requiredInt, requiredDate et currencyCode", () => {
    expect(requiredInt("3", "position", { min: 1 })).toBe(3);
    expect(() => requiredInt(1.5, "position")).toThrow(/integer/);
    expect(requiredDate("2026-09-25", "date").toISOString()).toBe("2026-09-25T00:00:00.000Z");
    expect(() => requiredDate("25/09/2026", "date")).toThrow(/ISO date/);
    expect(currencyCode("usd")).toBe("USD");
    expect(() => currencyCode("US")).toThrow(/ISO 4217/);
  });

  it("arithmetique decimale exacte", () => {
    expect(money(sumDecimals(["0.1", "0.2"]))).toBe("0.30");
    expect(percent("1", "3")).toBe("33.3");
    expect(percent("5", "0")).toBe("0.0");
  });
});
