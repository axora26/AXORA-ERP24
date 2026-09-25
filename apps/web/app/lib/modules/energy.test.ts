import { describe, expect, it } from "vitest";
import { parseIntervalLines } from "./energy";

describe("parseIntervalLines", () => {
  it("accepte point-virgule, tabulation et virgule ; virgule decimale ; ignore l'entete", () => {
    const { intervals, errors } = parseIntervalLines("debut;valeur\n2026-09-24T00:00:00Z;12.5\n2026-09-24T00:15:00Z\t13,25\n2026-09-24T00:30:00Z,14,5\n");
    expect(errors).toEqual([]);
    expect(intervals).toEqual([
      { start: "2026-09-24T00:00:00.000Z", value: "12.5" },
      { start: "2026-09-24T00:15:00.000Z", value: "13.25" },
      { start: "2026-09-24T00:30:00.000Z", value: "14.5" },
    ]);
  });

  it("signale les lignes illisibles sans les corriger", () => {
    const { intervals, errors } = parseIntervalLines("2026-09-24T00:00:00Z;abc\nhier;3\n2026-09-24T00:15:00Z;-2\n2026-09-24T00:30:00Z;4");
    expect(intervals).toHaveLength(1);
    expect(errors).toHaveLength(3);
    expect(errors[0]).toMatch(/Ligne 1/);
  });
});
