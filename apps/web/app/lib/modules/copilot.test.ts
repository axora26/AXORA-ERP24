import { describe, expect, it } from "vitest";
import { accessSummary } from "./copilot";

describe("copilote — résumé du contrôle d'accès", () => {
  it("compte les sources autorisées et refusées", () => {
    expect(accessSummary([])).toBe("Aucune source consultée");
    expect(accessSummary([{ granted: true }, { granted: true }])).toBe("2 source(s) autorisée(s)");
    expect(accessSummary([{ granted: true }, { granted: false }, { granted: false }])).toBe("1 source(s) autorisée(s), 2 refusée(s)");
  });
});
