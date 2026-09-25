import { describe, expect, it } from "vitest";
import { Prisma } from "@axora24/database";
import { computeAutonomy, coverage, expectedIntervals, isAligned, tariffAt } from "../src/energy/energy-math.js";

const d = (value: string) => new Prisma.Decimal(value);
const now = new Date("2026-09-25T12:00:00Z");

describe("Energie — noyau de calcul", () => {
  it("alignement des intervalles et couverture", () => {
    expect(isAligned(new Date("2026-09-25T10:15:00Z"), 15)).toBe(true);
    expect(isAligned(new Date("2026-09-25T10:20:00Z"), 15)).toBe(false);
    expect(isAligned(new Date("2026-09-25T10:15:30Z"), 15)).toBe(false);
    expect(expectedIntervals(new Date("2026-09-24T12:00:00Z"), now, 15)).toBe(96);
    expect(coverage(90, 96).toString()).toBe("93.8");
    expect(coverage(120, 96).toString()).toBe("100");
    expect(coverage(0, 0).toString()).toBe("0");
  });

  it("tarif historise : le plus recent en vigueur a la date", () => {
    const tariffs = [
      { validFrom: new Date("2026-01-01"), unitPrice: "0.120000" },
      { validFrom: new Date("2026-07-01"), unitPrice: "0.145000" },
    ];
    expect(tariffAt(tariffs, new Date("2025-12-31"))).toBeNull();
    expect(tariffAt(tariffs, new Date("2026-06-30"))!.toString()).toBe("0.12");
    expect(tariffAt(tariffs, new Date("2026-07-01"))!.toString()).toBe("0.145");
  });

  it("autonomie batterie : (capacite x (SoC - reserve)) / rythme mesure", () => {
    // 200 kWh utiles, SoC 80 %, reserve 20 % -> 120 kWh ; 96 intervalles de 15 min totalisant 480 kWh -> 20 kWh/h -> 6 h.
    const result = computeAutonomy({
      kind: "BATTERY",
      usableCapacity: d("200"),
      levelIsPercent: true,
      reserve: d("20"),
      level: d("80"),
      levelAt: new Date(now.getTime() - 5 * 60_000),
      now,
      drainSum: d("480"),
      drainIntervals: 96,
      expectedIntervals: 96,
      intervalMinutes: 15,
      unit: "kWh",
    });
    expect(result).toMatchObject({ state: "COMPUTED" });
    expect(result.hours!.toString()).toBe("6");
    expect(result.available!.toString()).toBe("120");
    expect(result.ratePerHour!.toString()).toBe("20");
  });

  it("jamais d'extrapolation : niveau perime, couverture insuffisante, consommation nulle", () => {
    const base = { kind: "FUEL_TANK" as const, usableCapacity: d("1000"), levelIsPercent: false, reserve: d("50"), level: d("650"), now, drainSum: d("48"), expectedIntervals: 96, intervalMinutes: 15, unit: "L" as const };
    expect(computeAutonomy({ ...base, levelAt: new Date(now.getTime() - 3 * 3_600_000), drainIntervals: 96 }).reason).toMatch(/180 min/);
    expect(computeAutonomy({ ...base, level: null, levelAt: null, drainIntervals: 96 }).state).toBe("NOT_COMPUTABLE");
    const partial = computeAutonomy({ ...base, levelAt: now, drainIntervals: 80 });
    expect(partial).toMatchObject({ state: "NOT_COMPUTABLE", hours: null });
    expect(partial.reason).toMatch(/83.3 %/);
    expect(computeAutonomy({ ...base, levelAt: now, drainIntervals: 96, drainSum: d("0") }).state).toBe("UNBOUNDED");
    // 600 L au-dessus de la reserve, 48 L sur 24 h -> 2 L/h -> 300 h.
    expect(computeAutonomy({ ...base, levelAt: now, drainIntervals: 96 }).hours!.toString()).toBe("300");
  });
});
