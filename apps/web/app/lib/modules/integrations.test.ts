import { describe, expect, it } from "vitest";
import { parseIps, truthCell } from "./integrations";

describe("intégrations — saisie et grille de vérité", () => {
  it("adresses IP : séparateurs tolérés, sans doublon", () => {
    expect(parseIps("203.0.113.7, 203.0.113.8\n203.0.113.7  2001:db8::1")).toEqual(["203.0.113.7", "203.0.113.8", "2001:db8::1"]);
    expect(parseIps("  ")).toEqual([]);
  });

  it("grille de vérité : « sans objet » distinct de « non »", () => {
    expect([truthCell(true), truthCell(false), truthCell(null)]).toEqual(["oui", "non", "sans objet"]);
  });
});
