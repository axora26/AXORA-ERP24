import { describe, it, expect } from "vitest";
import { createSessionToken, hashSessionToken } from "../src/session.js";

describe("session", () => {
  it("creates a token whose hash matches hashSessionToken", () => {
    const { plainToken, tokenHash } = createSessionToken();
    expect(hashSessionToken(plainToken)).toBe(tokenHash);
  });

  it("generates unique tokens on each call", () => {
    const a = createSessionToken();
    const b = createSessionToken();
    expect(a.plainToken).not.toBe(b.plainToken);
    expect(a.tokenHash).not.toBe(b.tokenHash);
  });
});
