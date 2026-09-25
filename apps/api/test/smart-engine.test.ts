import { describe, expect, it } from "vitest";
import { Prisma } from "@axora24/database";
import { conditionMet, parseReadingValue, withinTolerance } from "../src/smart/alarm-engine.js";
import { connectivityLevels } from "../src/smart/connectivity.js";

const d = (value: string) => new Prisma.Decimal(value);

describe("Smart Building — moteur d'alarmes et niveaux de connectivite", () => {
  it("conditions evaluees en decimal exact (pas d'erreur flottante)", () => {
    expect(conditionMet("ABOVE", d("26.000001"), d("26"))).toBe(true);
    expect(conditionMet("ABOVE", d("26"), d("26"))).toBe(false);
    expect(conditionMet("BELOW", d("0.1").plus(d("0.2")), d("0.3"))).toBe(false);
    expect(conditionMet("EQUALS", d("1"), d("1.000"))).toBe(true);
    expect(withinTolerance(d("21.4"), d("21"), d("0.5"))).toBe(true);
    expect(withinTolerance(d("21.6"), d("21"), d("0.5"))).toBe(false);
    expect(withinTolerance(d("21"), d("21"), null)).toBe(true);
  });

  it("valeurs de passerelle : chaines decimales uniquement, types de points respectes", () => {
    expect(parseReadingValue(21.5, "ANALOG")).toMatch(/decimal string/);
    expect(parseReadingValue("1e3", "ANALOG")).toMatch(/decimal string/);
    expect((parseReadingValue(" -12.250 ", "ANALOG") as Prisma.Decimal).toString()).toBe("-12.25");
    expect(parseReadingValue("2", "BINARY")).toMatch(/0 or 1/);
    expect(parseReadingValue("2.5", "MULTISTATE")).toMatch(/integer/);
    expect((parseReadingValue("3", "MULTISTATE") as Prisma.Decimal).toString()).toBe("3");
  });

  it("cinq niveaux distincts ; pilote natif absent pour BACnet ; preuves datees", () => {
    const fresh = connectivityLevels({ protocol: "BACNET_IP", simulated: false, lastSeenAt: null, readPass: null, writePass: null });
    expect(fresh.map((level) => level.key)).toEqual(["protocol", "connector", "network", "read", "write"]);
    expect(fresh.map((level) => level.state)).toEqual(["YES", "NO", "NOT_TESTED", "NOT_TESTED", "NOT_TESTED"]);
    const seen = new Date("2026-09-25T06:00:00Z");
    const tested = connectivityLevels({ protocol: "HTTP_API", simulated: false, lastSeenAt: seen, readPass: { at: seen, by: "A. Test" }, writePass: null });
    expect(tested.map((level) => level.state)).toEqual(["YES", "YES", "YES", "YES", "NOT_TESTED"]);
    expect(tested[3]!.evidenceAt).toBe(seen.toISOString());
  });

  it("un simulateur n'est jamais une preuve, meme avec contacts et attestations", () => {
    const now = new Date();
    const levels = connectivityLevels({ protocol: "HTTP_API", simulated: true, lastSeenAt: now, readPass: { at: now, by: "x" }, writePass: { at: now, by: "x" } });
    expect(levels.slice(2).map((level) => level.state)).toEqual(["SIMULATED", "SIMULATED", "SIMULATED"]);
  });
});
