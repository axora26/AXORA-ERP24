import { describe, expect, it } from "vitest";
import { definitionPayload, describeConditions, operatorsFor } from "./workflow";

describe("workflow — constructeur de définitions", () => {
  it("opérateurs selon le type du champ", () => {
    expect(operatorsFor("procurement.request.submitted", "estimatedTotal")).toContain("gt");
    expect(operatorsFor("procurement.request.submitted", "title")).toEqual(["eq", "neq", "contains"]);
  });

  it("résumé lisible des conditions", () => {
    expect(describeConditions([])).toBe("Toujours");
    expect(describeConditions([{ field: "estimatedTotal", operator: "gt", value: "10000" }, { field: "currency", operator: "eq", value: "USD" }])).toBe("Montant estimé > 10000 et Devise = USD");
  });

  it("corps envoyé à l'API : conditions vides ignorées, SLA numérique, escalade facultative", () => {
    const payload = definitionPayload({
      code: " PR-10K ",
      name: "Achats",
      description: " ",
      eventType: "procurement.request.submitted",
      conditions: [{ field: "estimatedTotal", operator: "gt", value: " 10000 " }, { field: "title", operator: "contains", value: "" }],
      actions: [{ type: "REQUIRE_APPROVAL", approverRoleId: "r1", escalationRoleId: "", slaHours: "48", title: "Visa" }],
    });
    expect(payload).toEqual({
      code: "PR-10K",
      name: "Achats",
      description: undefined,
      eventType: "procurement.request.submitted",
      conditions: [{ field: "estimatedTotal", operator: "gt", value: "10000" }],
      actions: [{ type: "REQUIRE_APPROVAL", approverRoleId: "r1", escalationRoleId: undefined, slaHours: 48, title: "Visa" }],
    });
  });
});
