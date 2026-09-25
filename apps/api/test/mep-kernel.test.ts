import { describe, expect, it } from "vitest";
import { CALCULATIONS, NOT_COVERED, runCalculation } from "../src/mep/calculation-kernel.js";

/**
 * Cas de reference calcules independamment (Python decimal, 40 chiffres) :
 * chaque formule du noyau est verifiee sur un cas documente.
 */
const out = (type: string, inputs: Record<string, string>) =>
  Object.fromEntries(runCalculation(type, inputs).outputs.map((output) => [output.name, output.value]));

describe("noyau de calcul MEP", () => {
  it("CVC : debit d'air sensible (10 kW, ρ 1,2, cp 1006, ΔT 10 K) = 2982,107 m³/h", () => {
    expect(out("hvac.air_flow_sensible", { power: "10000", density: "1.2", heatCapacity: "1006", deltaT: "10" })).toEqual({ flow: "2982.1", flowPerSecond: "0.8284" });
  });

  it("hydraulique : debit d'eau (50 kW, ρ 1000, cp 4180, ΔT 5 K) = 8,6124 m³/h", () => {
    expect(out("hvac.water_flow", { power: "50000", density: "1000", heatCapacity: "4180", deltaT: "5" })).toEqual({ flow: "8.612" });
  });

  it("electricite : courants mono et triphase", () => {
    expect(out("elec.current_single_phase", { power: "2300", voltage: "230", powerFactor: "1" })).toEqual({ current: "10.00" });
    expect(out("elec.current_three_phase", { power: "10000", voltage: "400", powerFactor: "0.8" })).toEqual({ current: "18.04" });
  });

  it("electricite : chutes de tension resistives", () => {
    expect(out("elec.voltage_drop_single_phase", { current: "16", length: "25", section: "2.5", resistivity: "0.0225", voltage: "230" })).toEqual({ drop: "7.20", dropPercent: "3.13" });
    expect(out("elec.voltage_drop_three_phase", { current: "32", length: "50", section: "6", resistivity: "0.0225", voltage: "400" })).toEqual({ drop: "10.39", dropPercent: "2.60" });
  });

  it("fluides : vitesse (3,6 m³/h, DN 26 mm) = 1,8835 m/s et diametre pour 5 m/s = 459,28 mm", () => {
    expect(out("fluid.velocity_round_section", { flow: "3.6", diameter: "26" })).toEqual({ velocity: "1.88" });
    expect(out("fluid.diameter_for_velocity", { flow: "2982.1", velocity: "5" })).toEqual({ diameter: "459.3" });
  });

  it("transparence : entrees, formule symbolique et formule substituee toujours exposees", () => {
    const result = runCalculation("elec.current_three_phase", { power: "10000", voltage: "400", powerFactor: "0.8" });
    expect(result.formula).toBe("I = P / (√3 × U × cos φ)");
    expect(result.substitution).toBe("I = 10000 / (√3 × 400 × 0.8)");
    expect(result.inputs.map((input) => `${input.symbol}=${input.value} ${input.unit}`)).toEqual(["P=10000 W", "U=400 V", "cos φ=0.8 —"]);
    expect(result.kernelVersion).toMatch(/^mep-kernel\//);
    for (const definition of CALCULATIONS) {
      expect(definition.formula.length).toBeGreaterThan(5);
      expect(definition.assumptions.length).toBeGreaterThan(0);
    }
    expect(NOT_COVERED.length).toBeGreaterThan(0);
  });

  it("refuse les nombres JSON, les valeurs hors domaine et les types inconnus", () => {
    expect(() => runCalculation("elec.current_single_phase", { power: 2300, voltage: "230", powerFactor: "1" })).toThrow(/decimal string/);
    expect(() => runCalculation("elec.current_single_phase", { power: "2300", voltage: "230", powerFactor: "1.2" })).toThrow(/<= 1/);
    expect(() => runCalculation("elec.current_single_phase", { power: "0", voltage: "230", powerFactor: "1" })).toThrow(/> 0/);
    expect(() => runCalculation("hvac.load_en12831", {})).toThrow(/Unknown calculation type/);
  });
});
