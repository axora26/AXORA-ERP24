import { describe, it, expect } from "vitest";
import { isAuthorized, assertAuthorized, type ResolvedGrant } from "../src/authorization.js";

const ORG_A = "org-a";
const ORG_B = "org-b";

describe("authorization (deny-by-default)", () => {
  it("denies by default when no grant matches", () => {
    const grants: ResolvedGrant[] = [];
    expect(isAuthorized({ key: "core.user.manage", organizationId: ORG_A }, grants)).toBe(false);
  });

  it("allows when an exact grant exists in the same tenant scope", () => {
    const grants: ResolvedGrant[] = [
      { permissionKey: "core.user.manage", organizationId: ORG_A },
    ];
    expect(isAuthorized({ key: "core.user.manage", organizationId: ORG_A }, grants)).toBe(true);
  });

  it("denies cross-tenant access even with a matching permission key", () => {
    const grants: ResolvedGrant[] = [
      { permissionKey: "core.user.manage", organizationId: ORG_A },
    ];
    expect(isAuthorized({ key: "core.user.manage", organizationId: ORG_B }, grants)).toBe(false);
  });

  it("denies when companyId scope is required but not granted", () => {
    const grants: ResolvedGrant[] = [
      { permissionKey: "core.user.manage", organizationId: ORG_A, companyId: "company-1" },
    ];
    expect(
      isAuthorized(
        { key: "core.user.manage", organizationId: ORG_A, companyId: "company-2" },
        grants,
      ),
    ).toBe(false);
  });

  it("assertAuthorized throws FORBIDDEN when denied", () => {
    expect(() => assertAuthorized({ key: "core.user.manage", organizationId: ORG_A }, [])).toThrow(
      /FORBIDDEN/,
    );
  });
});
