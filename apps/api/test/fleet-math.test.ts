import { describe, expect, it } from "vitest";
import { blockingDocuments, compliance, fullToFullConsumption } from "../src/fleet/fleet-math.js";

const at = new Date("2026-09-25T10:00:00Z");
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe("Parc — noyau de calcul", () => {
  it("consommation plein a plein : pleins partiels inclus, premier plein = ancrage", () => {
    const result = fullToFullConsumption(
      [
        { filledAt: new Date("2026-09-01"), liters: "60", reading: "10000", fullTank: true },
        { filledAt: new Date("2026-09-05"), liters: "20", reading: "10250", fullTank: false },
        { filledAt: new Date("2026-09-09"), liters: "40", reading: "10600", fullTank: true },
        { filledAt: new Date("2026-09-15"), liters: "45", reading: "11100", fullTank: true },
      ],
      "KM",
    );
    // (20 + 40 + 45) L / 1 100 km = 9.55 L/100 km sur deux fenetres
    expect(result.windows).toBe(2);
    expect(result.value!.toString()).toBe("9.55");
  });

  it("aucune extrapolation sans deux pleins complets ; engins en L/h", () => {
    expect(fullToFullConsumption([{ filledAt: new Date("2026-09-01"), liters: "60", reading: "100", fullTank: true }], "HOURS").value).toBeNull();
    expect(fullToFullConsumption([{ filledAt: new Date("2026-09-01"), liters: "60", reading: "100", fullTank: false }, { filledAt: new Date("2026-09-02"), liters: "60", reading: "110", fullTank: true }], "HOURS").value).toBeNull();
    const engine = fullToFullConsumption(
      [
        { filledAt: new Date("2026-09-01"), liters: "200", reading: "1200.0", fullTank: true },
        { filledAt: new Date("2026-09-04"), liters: "180", reading: "1215.0", fullTank: true },
      ],
      "HOURS",
    );
    expect(engine.value!.toString()).toBe("12");
  });

  it("conformite : pieces obligatoires par nature, echeance a 30 jours, piece future ignoree", () => {
    const states = compliance(
      "VEHICLE",
      [
        { kind: "INSURANCE", reference: "POL-1", validFrom: d("2025-10-01"), validUntil: d("2026-10-10") },
        { kind: "REGISTRATION", reference: "CG-1", validFrom: d("2024-01-01"), validUntil: d("2034-01-01") },
        { kind: "INSPECTION", reference: "CT-OLD", validFrom: d("2025-01-01"), validUntil: d("2026-09-01") },
        { kind: "INSPECTION", reference: "CT-NEXT", validFrom: d("2026-10-01"), validUntil: d("2027-10-01") },
      ],
      at,
    );
    expect(states.find((state) => state.kind === "INSURANCE")!.state).toBe("EXPIRING");
    expect(states.find((state) => state.kind === "REGISTRATION")!.state).toBe("VALID");
    expect(states.find((state) => state.kind === "INSPECTION")).toMatchObject({ state: "EXPIRED", reference: "CT-OLD" });
    expect(blockingDocuments(states).map((state) => state.kind)).toEqual(["INSPECTION"]);
    expect(blockingDocuments(compliance("MACHINE", [], at)).map((state) => state.kind)).toEqual(["INSPECTION"]);
  });
});
