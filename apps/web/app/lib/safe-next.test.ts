import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-next";

describe("post-login destinations", () => {
  it("keeps valid internal destinations and their query/hash", () => {
    expect(safeNext("/projects?status=active#list")).toBe("/projects?status=active#list");
    expect(safeNext("/documents/fichier%20partage")).toBe("/documents/fichier%20partage");
  });
  it.each([null, "https://example.com", "//example.com", "/\\example.com", "/\t/example.com", "/\n/example.com"])("rejects an external or ambiguously normalized destination: %s", value => {
    expect(safeNext(value)).toBe("/");
  });
});
