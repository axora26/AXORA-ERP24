import { describe, expect, it } from "vitest";
import { Prisma } from "@axora24/database";
import { bucketize, lastMonths, monthStart, toCsv } from "../src/analytics/buckets.js";

describe("Analytique — agrégation mensuelle", () => {
  it("fenêtre glissante de 12 mois terminée par le mois courant (UTC)", () => {
    const months = lastMonths(new Date("2026-09-25T23:30:00Z"), 12);
    expect(months).toHaveLength(12);
    expect(months[0]).toBe("2025-10");
    expect(months[11]).toBe("2026-09");
    expect(lastMonths(new Date("2026-01-01T00:00:00Z"), 3)).toEqual(["2025-11", "2025-12", "2026-01"]);
    expect(monthStart("2026-02").toISOString()).toBe("2026-02-01T00:00:00.000Z");
  });

  it("décimal exact, une série par devise, jamais additionnées, hors fenêtre ignoré", () => {
    const months = ["2026-08", "2026-09"];
    const series = bucketize(
      [
        { at: new Date("2026-08-31T23:59:59Z"), series: "USD", value: new Prisma.Decimal("0.10") },
        { at: new Date("2026-08-01T00:00:00Z"), series: "USD", value: "0.20" },
        { at: new Date("2026-09-15T00:00:00Z"), series: "CDF", value: "1000" },
        { at: new Date("2026-07-31T23:59:59Z"), series: "USD", value: "999" },
      ],
      months,
      [],
      true,
    );
    expect(series).toEqual([
      { key: "CDF", values: ["0.00", "1000.00"] },
      { key: "USD", values: ["0.30", "0.00"] },
    ]);
  });

  it("quantités : entier si exact, sinon 2 décimales", () => {
    expect(bucketize([{ at: new Date("2026-09-02T00:00:00Z"), series: "h", value: "7.5" }, { at: new Date("2026-08-02T00:00:00Z"), series: "h", value: "8" }], ["2026-08", "2026-09"])).toEqual([{ key: "h", values: ["8", "7.50"] }]);
  });

  it("séries nommées dans l'ordre imposé, même vides", () => {
    expect(bucketize([{ at: new Date("2026-09-02T00:00:00Z"), series: "Clôturées", value: 1 }], ["2026-09"], ["Ouvertes", "Clôturées"])).toEqual([
      { key: "Ouvertes", values: ["0"] },
      { key: "Clôturées", values: ["1"] },
    ]);
  });

  it("CSV : échappement des guillemets, virgules et retours à la ligne", () => {
    expect(toCsv(["mois", "serie", "valeur"], [["2026-09", 'Lot "A", nord', "12.50"]])).toBe('mois,serie,valeur\r\n2026-09,"Lot ""A"", nord",12.50\r\n');
  });
});
