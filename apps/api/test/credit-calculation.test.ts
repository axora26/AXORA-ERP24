import { describe, expect, it } from "vitest";
import { Prisma } from "@axora24/database";
import { creditAllocation } from "../src/finance/credit-calculation.js";
const d = (value: string) => new Prisma.Decimal(value);
describe("Immutable source credit allocation", () => {
  it("allocates repeated partial credits without monetary or tax drift", () => {
    const source = { quantity: d("3"), lineTotal: d("1.00"), lineTax: d("0.20") };
    let already = { quantity: d("0"), lineTotal: d("0"), lineTax: d("0") };
    const amounts: string[] = []; const taxes: string[] = [];
    for (let index = 0; index < 3; index++) {
      const allocation = creditAllocation(source, already, d("1"));
      amounts.push(allocation.lineTotal.toFixed(2)); taxes.push(allocation.lineTax.toFixed(2));
      already = { quantity: already.quantity.plus(1), lineTotal: already.lineTotal.plus(allocation.lineTotal), lineTax: already.lineTax.plus(allocation.lineTax) };
    }
    expect(amounts).toEqual(["0.33", "0.34", "0.33"]);
    expect(taxes).toEqual(["0.07", "0.06", "0.07"]);
    expect(already.lineTotal.equals(source.lineTotal)).toBe(true);
    expect(already.lineTax.equals(source.lineTax)).toBe(true);
  });
  it("credits stored source money exactly despite high precision unit arithmetic", () => {
    const allocation = creditAllocation({ quantity: d("1.23456"), lineTotal: d("152.41"), lineTax: d("30.48") },
      { quantity: d("0"), lineTotal: d("0"), lineTax: d("0") }, d("1.23456"));
    expect(allocation.lineTotal.toFixed(2)).toBe("152.41"); expect(allocation.lineTax.toFixed(2)).toBe("30.48");
  });
  it("rejects cap violations and nonpositive quantities", () => {
    const source = { quantity: d("3"), lineTotal: d("1"), lineTax: d("0") };
    const already = { quantity: d("2"), lineTotal: d("0.67"), lineTax: d("0") };
    expect(() => creditAllocation(source, already, d("1.000001"))).toThrow();
    expect(() => creditAllocation(source, already, d("0"))).toThrow();
  });
});
