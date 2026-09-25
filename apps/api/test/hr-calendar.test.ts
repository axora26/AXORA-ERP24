import { describe, expect, it } from "vitest";
import { businessDays, mondayOf } from "../src/hr/hr.service.js";

/** Calendrier RH : semaines ISO (lundi) et jours ouvres, calcules en UTC sans flottant. */
describe("HR calendar helpers", () => {
  it("normalise n'importe quel jour au lundi de sa semaine", () => {
    expect(mondayOf(new Date("2026-09-14T00:00:00Z")).toISOString().slice(0, 10)).toBe("2026-09-14");
    expect(mondayOf(new Date("2026-09-16T18:30:00Z")).toISOString().slice(0, 10)).toBe("2026-09-14");
    expect(mondayOf(new Date("2026-09-20T23:59:00Z")).toISOString().slice(0, 10)).toBe("2026-09-14");
    expect(mondayOf(new Date("2027-01-01T00:00:00Z")).toISOString().slice(0, 10)).toBe("2026-12-28");
  });

  it("compte les jours ouvres (lundi-vendredi) bornes inclus", () => {
    expect(businessDays(new Date("2026-10-01"), new Date("2026-10-07"))).toBe(5);
    expect(businessDays(new Date("2026-10-03"), new Date("2026-10-04"))).toBe(0);
    expect(businessDays(new Date("2026-10-05"), new Date("2026-10-05"))).toBe(1);
    expect(businessDays(new Date("2026-12-21"), new Date("2027-01-08"))).toBe(15);
  });
});
