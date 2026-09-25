import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import {
  base32Decode,
  base32Encode,
  decryptSecret,
  encryptSecret,
  generateTotpSecret,
  hotp,
  otpauthUri,
  parseEncryptionKey,
  totpCode,
  totpCounter,
  verifyTotp,
} from "../src/index.js";

// Secret de reference de la RFC 6238 (annexe B) : "12345678901234567890" en ASCII.
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890", "ascii"));

describe("TOTP RFC 6238", () => {
  it("reproduit les vecteurs officiels (SHA-1, 6 derniers chiffres)", () => {
    // Valeurs 8 chiffres de la RFC : 94287082, 07081804, 14050471, 89005924.
    expect(totpCode(RFC_SECRET, 59_000)).toBe("287082");
    expect(totpCode(RFC_SECRET, 1_111_111_109_000)).toBe("081804");
    expect(totpCode(RFC_SECRET, 1_111_111_111_000)).toBe("050471");
    expect(totpCode(RFC_SECRET, 1_234_567_890_000)).toBe("005924");
  });

  it("HOTP RFC 4226 compteur 0 et 1", () => {
    const secret = Buffer.from("12345678901234567890", "ascii");
    expect(hotp(secret, 0)).toBe("755224");
    expect(hotp(secret, 1)).toBe("287082");
  });

  it("base32 aller-retour", () => {
    const bytes = randomBytes(20);
    expect(base32Decode(base32Encode(bytes)).equals(bytes)).toBe(true);
    expect(generateTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });

  it("accepte le pas courant et adjacent, refuse hors fenetre et les codes mal formes", () => {
    const now = 1_700_000_000_000;
    const code = totpCode(RFC_SECRET, now);
    expect(verifyTotp(RFC_SECRET, code, { timeMs: now })).toBe(totpCounter(now));
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, now - 30_000), { timeMs: now })).toBe(totpCounter(now) - 1);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, now - 120_000), { timeMs: now })).toBeNull();
    expect(verifyTotp(RFC_SECRET, "12ab56", { timeMs: now })).toBeNull();
  });

  it("anti-rejeu : un code deja accepte est refuse", () => {
    const now = 1_700_000_000_000;
    const code = totpCode(RFC_SECRET, now);
    const accepted = verifyTotp(RFC_SECRET, code, { timeMs: now });
    expect(accepted).not.toBeNull();
    expect(verifyTotp(RFC_SECRET, code, { timeMs: now, lastAcceptedCounter: accepted })).toBeNull();
  });

  it("URI otpauth standard", () => {
    const uri = otpauthUri("AXORA-ERP24", "user@test.com", "ABC");
    expect(uri).toContain("otpauth://totp/AXORA-ERP24%3Auser%40test.com?");
    expect(uri).toContain("secret=ABC");
    expect(uri).toContain("digits=6");
  });
});

describe("secret-box AES-256-GCM", () => {
  const key = randomBytes(32);

  it("chiffre et dechiffre, IV different a chaque appel", () => {
    const first = encryptSecret("JBSWY3DPEHPK3PXP", key);
    const second = encryptSecret("JBSWY3DPEHPK3PXP", key);
    expect(first).not.toBe(second);
    expect(first.startsWith("aes-256-gcm-v1$")).toBe(true);
    expect(decryptSecret(first, key)).toBe("JBSWY3DPEHPK3PXP");
  });

  it("detecte toute alteration (tag d'authentification)", () => {
    const payload = encryptSecret("secret", key);
    const parts = payload.split("$");
    const tampered = [parts[0], parts[1], parts[2], Buffer.from("autre").toString("base64url")].join("$");
    expect(() => decryptSecret(tampered, key)).toThrow();
    expect(() => decryptSecret(payload, randomBytes(32))).toThrow();
  });

  it("valide la cle (32 octets base64)", () => {
    expect(parseEncryptionKey(randomBytes(32).toString("base64"))).not.toBeNull();
    expect(parseEncryptionKey(randomBytes(16).toString("base64"))).toBeNull();
    expect(parseEncryptionKey("")).toBeNull();
  });
});
