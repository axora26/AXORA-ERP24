import { describe, it, expect } from "vitest";
import { expectedVersion, optionalDate, optionalEmail, optionalWebsite, strictBoolean } from "../src/crm/crm.dto.js";

describe("CRM editable field validation", () => {
  it("requires numeric positive optimistic versions", () => {
    expect(expectedVersion(1)).toBe(1);
    for (const value of [undefined, null, "1", 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) expect(() => expectedVersion(value)).toThrowError();
  });
  it("requires booleans and accepts only valid optional contact channels", () => {
    expect(strictBoolean(undefined, "isPrimary")).toBe(false);
    expect(strictBoolean(true, "isPrimary")).toBe(true);
    expect(() => strictBoolean("true", "isPrimary")).toThrowError();
    expect(optionalEmail(" person@test.example ")).toBe("person@test.example");
    expect(optionalEmail(null)).toBeNull();
    expect(() => optionalEmail("person")).toThrowError();
    expect(optionalWebsite("https://example.com")).toBe("https://example.com");
    for (const value of ["javascript:alert(1)", "file:///secret", "https://user:pass@example.com", "example.com"]) expect(() => optionalWebsite(value)).toThrowError();
  });
  it("rejects calendar normalization and non-ISO input", () => {
    for (const value of ["2026-02-30", "2026-13-01", "12/31/2026", 1798761600000]) expect(() => optionalDate(value, "expectedCloseDate")).toThrowError();
    expect(optionalDate("2026-01-01T08:30:00+01:00", "expectedCloseDate")?.toISOString()).toBe("2026-01-01T07:30:00.000Z");
  });
});
