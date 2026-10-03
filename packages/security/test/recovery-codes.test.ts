import { describe, expect, it } from "vitest";
import { generateRecoveryCodes, normalizeRecoveryCode, recoveryCodeIndex } from "../src/recovery-codes.js";

describe("MFA recovery codes", () => {
  it("generates ten independent codes and stores only digests", () => {
    const batch = generateRecoveryCodes();
    expect(new Set(batch.codes).size).toBe(10);
    expect(new Set(batch.hashes).size).toBe(10);
    expect(batch.hashes.every((hash) => /^[a-f0-9]{64}$/.test(hash))).toBe(true);
    expect(batch.hashes.join("")).not.toContain(batch.codes[0]);
  });
  it("accepts display separators and case while rejecting unexpected characters", () => {
    const batch = generateRecoveryCodes();
    expect(recoveryCodeIndex(batch.codes[0]!.toLowerCase().replaceAll("-", " "), batch.hashes)).toBe(0);
    expect(normalizeRecoveryCode("A".repeat(31) + "0")).toBeNull();
    expect(recoveryCodeIndex("not-a-code", batch.hashes)).toBe(-1);
    expect(recoveryCodeIndex(batch.codes[0]!, batch.hashes.slice(1))).toBe(-1);
  });
  it("a regenerated batch cannot validate an earlier code", () => {
    expect(recoveryCodeIndex(generateRecoveryCodes().codes[0]!, generateRecoveryCodes().hashes)).toBe(-1);
  });
});
