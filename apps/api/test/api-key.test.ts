import { describe, expect, it } from "vitest";
import { bearerKey, generateApiKey, hashApiKey, ipAllowed, rateWindows, validIp } from "../src/integrations/api-key.js";

describe("Clés d'API — primitives", () => {
  it("secret aléatoire, préfixe affichable, empreinte SHA-256 seule conservée", () => {
    const first = generateApiKey();
    const second = generateApiKey();
    expect(first.secret).toMatch(/^axk_[A-Za-z0-9_-]{43}$/);
    expect(first.secret).not.toBe(second.secret);
    expect(first.prefix).toBe(first.secret.slice(0, 12));
    expect(first.hash).toBe(hashApiKey(first.secret));
    expect(first.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("en-tête Authorization au format strict", () => {
    const { secret } = generateApiKey();
    expect(bearerKey(`Bearer ${secret}`)).toBe(secret);
    expect(bearerKey(secret)).toBeNull();
    expect(bearerKey(`Bearer axk_court`)).toBeNull();
    expect(bearerKey(`Bearer ${secret} extra`)).toBeNull();
    expect(bearerKey(undefined)).toBeNull();
  });

  it("liste d'adresses IP : vide = toutes, IPv4 mappée normalisée", () => {
    expect(ipAllowed("10.0.0.5", [])).toBe(true);
    expect(ipAllowed("::ffff:203.0.113.7", ["203.0.113.7"])).toBe(true);
    expect(ipAllowed("203.0.113.8", ["203.0.113.7"])).toBe(false);
    expect(validIp("2001:db8::1")).toBe(true);
    expect(validIp("300.1.1.1")).toBe(false);
  });

  it("fenêtres de débit UTC et délais de renouvellement", () => {
    const windows = rateWindows(new Date("2026-09-25T10:31:45.500Z"));
    expect(windows).toEqual({ minute: "m:2026-09-25T10:31", day: "d:2026-09-25", minuteResetSeconds: 15, dayResetSeconds: 48_495 });
  });
});
