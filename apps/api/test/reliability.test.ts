import { describe, expect, it } from "vitest";
import { reliability } from "../src/assets/reliability.js";

const d = (value: string) => new Date(value);
const START = d("2026-01-01T00:00:00Z");
const END = d("2026-01-31T00:00:00Z"); // 720 h

/** Jeu de donnees documente : resultats calcules a la main. */
describe("MTBF / MTTR sur historique reel", () => {
  it("deux defaillances (4 h et 6 h) sur 720 h : MTTR 5 h, MTBF 355 h, disponibilite 98,61 %", () => {
    expect(
      reliability(START, END, [
        { failureAt: d("2026-01-05T08:00:00Z"), restoredAt: d("2026-01-05T12:00:00Z") },
        { failureAt: d("2026-01-20T10:00:00Z"), restoredAt: d("2026-01-20T16:00:00Z") },
      ]),
    ).toMatchObject({ periodHours: "720.00", downtimeHours: "10.00", failures: 2, mttrHours: "5.00", mtbfHours: "355.00", availabilityPercent: "98.61" });
  });

  it("chevauchement : l'indisponibilite est une union (12 h), le MTTR reste par intervention (4,67 h)", () => {
    expect(
      reliability(START, END, [
        { failureAt: d("2026-01-05T08:00:00Z"), restoredAt: d("2026-01-05T12:00:00Z") },
        { failureAt: d("2026-01-20T10:00:00Z"), restoredAt: d("2026-01-20T16:00:00Z") },
        { failureAt: d("2026-01-20T14:00:00Z"), restoredAt: d("2026-01-20T18:00:00Z") },
      ]),
    ).toMatchObject({ downtimeHours: "12.00", failures: 3, mttrHours: "4.67", mtbfHours: "236.00", availabilityPercent: "98.33" });
  });

  it("sans defaillance : MTBF et MTTR non calculables (jamais estimes), disponibilite 100 %", () => {
    expect(reliability(START, END, [])).toMatchObject({ failures: 0, mttrHours: null, mtbfHours: null, availabilityPercent: "100.00" });
  });

  it("intervalles hors periode ou incoherents ignores ou bornes", () => {
    expect(
      reliability(START, END, [
        { failureAt: d("2025-12-31T22:00:00Z"), restoredAt: d("2026-01-01T02:00:00Z") },
        { failureAt: d("2026-01-10T10:00:00Z"), restoredAt: d("2026-01-10T09:00:00Z") },
      ]),
    ).toMatchObject({ failures: 1, downtimeHours: "2.00", mttrHours: "4.00" });
    expect(reliability(END, START, [])).toMatchObject({ periodHours: "0.00", availabilityPercent: null });
  });
});
