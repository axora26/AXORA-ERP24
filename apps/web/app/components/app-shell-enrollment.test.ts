import { describe, expect, it } from "vitest";
import { mfaEnrollmentDestination } from "./app-shell";

describe("MFA enrollment routing", () => {
  it("redirige un compte soumis à la politique vers Mon compte sans boucle", () => {
    expect(mfaEnrollmentDestination("/admin/users", true)).toBe("/account");
    expect(mfaEnrollmentDestination("/account", true)).toBeNull();
    expect(mfaEnrollmentDestination("/projects", false)).toBeNull();
  });
});
