import { describe, expect, it } from "vitest";
import { chartGroups, seriesTotal, unitLabel } from "./analytics";

const metric = (unit: "money" | "count" | "kwh") => ({ key: "m", label: "M", domain: "d", domainLabel: "D", unit, description: "", permission: "p" });

describe("analytique — présentation", () => {
  it("un graphique par devise, jamais deux devises sur un même axe", () => {
    const groups = chartGroups({ metric: metric("money"), series: [{ key: "CDF", label: "CDF", values: ["1"] }, { key: "USD", label: "USD", values: ["2"] }] });
    expect(groups.map((group) => [group.unit, group.series.length])).toEqual([["CDF", 1], ["USD", 1]]);
    expect(chartGroups({ metric: metric("count"), series: [{ key: "a", label: "a", values: [] }, { key: "b", label: "b", values: [] }] })).toHaveLength(1);
  });

  it("unités", () => {
    expect(unitLabel("money", "USD")).toBe("USD");
    expect(unitLabel("kwh", "Consommation")).toBe("kWh");
    expect(unitLabel("count", "Ouvertes")).toBe("");
  });

  it("totaux exacts au centime", () => {
    expect(seriesTotal(["0.10", "0.20", "1000.00"])).toBe("1000.30");
    expect(seriesTotal(["0", "0"])).toBe("0.00");
    expect(seriesTotal(["-5.50", "2"])).toBe("-3.50");
  });
});
