import { describe, expect, it } from "vitest";
import { nextActionFilter, nextActionPriority, nextActionDueAt } from "../src/crm/crm.dto.js";

describe("CRM next action validation", () => {
  it("accepts the supported priorities and date filters only", () => {
    expect(nextActionPriority(undefined)).toBe("MEDIUM");
    expect(nextActionPriority("urgent")).toBe("URGENT");
    expect(nextActionFilter(undefined)).toBe("all");
    expect(nextActionFilter("next7days")).toBe("next7days");
    for (const value of ["BLOCKER", 1, null]) expect(() => nextActionPriority(value)).toThrowError();
    for (const value of ["tomorrow", "week", 1]) expect(() => nextActionFilter(value)).toThrowError();
  });

  it("requires a full ISO timestamp with timezone for dueAt", () => {
    expect(nextActionDueAt("2026-10-08T12:30:00.000Z").toISOString()).toBe("2026-10-08T12:30:00.000Z");
    expect(nextActionDueAt("2026-10-08T12:30:00+01:00").toISOString()).toBe("2026-10-08T11:30:00.000Z");
    for (const value of [undefined, null, "2026-10-08", "2026-02-30T12:00:00Z", "08/10/2026 12:00", 1791462600000]) {
      expect(() => nextActionDueAt(value)).toThrowError();
    }
  });
});
