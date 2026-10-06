import { timingSafeEqual } from "node:crypto";
import { generateTotpSecret } from "./totp.js";
import { hashSessionToken } from "./session.js";

export function normalizeRecoveryCode(value: string): string | null {
  if (typeof value !== "string" || value.length > 128) return null;
  const normalized = value.toUpperCase().replace(/[\s-]/g, "");
  return /^[A-Z2-7]{32}$/.test(normalized) ? normalized : null;
}

/** 160 random bits per code; only normalized SHA-256 hashes are persisted. */
export function generateRecoveryCodes(count = 10): { codes: string[]; hashes: string[] } {
  if (!Number.isInteger(count) || count < 5 || count > 20) throw new Error("Invalid recovery code count");
  const normalized = Array.from({ length: count }, () => generateTotpSecret(20));
  return {
    codes: normalized.map((code) => code.match(/.{4}/g)!.join("-")),
    hashes: normalized.map(hashSessionToken),
  };
}

/** Scan every stored digest with a constant-time comparison. */
export function recoveryCodeIndex(value: string, hashes: string[]): number {
  const normalized = normalizeRecoveryCode(value);
  const digest = Buffer.from(hashSessionToken(normalized ?? "invalid-recovery-code"), "hex");
  let found = -1;
  hashes.forEach((hash, index) => {
    if (/^[a-f0-9]{64}$/.test(hash) && timingSafeEqual(digest, Buffer.from(hash, "hex")) && normalized) found = index;
  });
  return found;
}
