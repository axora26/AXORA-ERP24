import { describe, expect, it } from "vitest";
import { formatCompactMoney, formatDecimal, formatMoney, sumMoney } from "./format";

const NBSP = "\u202f";

describe("formatDecimal (exact, sans flottant)", () => {
  it("groupe les milliers et arrondit demi vers le haut", () => {
    expect(formatDecimal("387875.000000", 2)).toBe(`387${NBSP}875,00`);
    expect(formatDecimal("1.005", 2)).toBe("1,01");
    expect(formatDecimal("0.994", 2)).toBe("0,99");
    expect(formatDecimal("9.995", 2)).toBe("10,00");
  });

  it("ne perd aucune precision au-dela de 2^53", () => {
    expect(formatDecimal("999999999999999999.123456", 2)).toBe(
      `999${NBSP}999${NBSP}999${NBSP}999${NBSP}999${NBSP}999,12`,
    );
  });

  it("gere les negatifs et le zero negatif", () => {
    expect(formatDecimal("-1250.5", 2)).toBe(`-1${NBSP}250,50`);
    expect(formatDecimal("-0.001", 2)).toBe("0,00");
  });

  it("laisse intacte une valeur non decimale", () => {
    expect(formatDecimal("abc", 2)).toBe("abc");
  });
});

describe("formatMoney / formatCompactMoney", () => {
  it("ajoute la devise et signale les devises mixtes", () => {
    expect(formatMoney("10", "USD")).toBe("10,00 USD");
    expect(formatMoney("10", "MIXED")).toBe("10,00 (devises mixtes)");
    expect(formatMoney(null, "USD")).toBe("—");
  });

  it("abrege en millions et milliers", () => {
    expect(formatCompactMoney("5990000.00", "USD")).toBe("5,99 M USD");
    expect(formatCompactMoney("387875.00", "USD")).toBe("387,9 k USD");
    expect(formatCompactMoney("9500.00", "USD")).toBe(`9${NBSP}500,00 USD`);
  });
});

describe("sumMoney", () => {
  it("additionne au centime pres sans flottant", () => {
    expect(sumMoney(["0.10", "0.20"])).toBe("0.30");
    expect(sumMoney(["999999999999999.99", "0.01"])).toBe("1000000000000000.00");
    expect(sumMoney(["-5.50", "2.25"])).toBe("-3.25");
    expect(sumMoney([])).toBe("0.00");
  });
});
