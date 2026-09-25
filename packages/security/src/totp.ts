/**
 * TOTP (RFC 6238, HMAC-SHA1, 6 chiffres, pas de 30 s) — docs/foundation/03-security.md §3.1.
 * Compatible avec les applications d'authentification standard.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input: string): Buffer {
  const cleaned = input.toUpperCase().replace(/=+$/g, "").replace(/\s+/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of cleaned) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error("Invalid base32 character");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Secret aleatoire genere cote serveur (20 octets = 160 bits, recommande par la RFC 4226). */
export function generateTotpSecret(byteLength = 20): string {
  return base32Encode(randomBytes(byteLength));
}

export function totpCounter(timeMs: number = Date.now()): number {
  return Math.floor(timeMs / 1000 / TOTP_PERIOD_SECONDS);
}

export function hotp(secret: Buffer, counter: number, digits = TOTP_DIGITS): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", secret).update(message).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  return String(binary % 10 ** digits).padStart(digits, "0");
}

export function totpCode(base32Secret: string, timeMs: number = Date.now()): string {
  return hotp(base32Decode(base32Secret), totpCounter(timeMs));
}

/**
 * Verifie un code TOTP dans une fenetre de +/- `window` pas. Retourne le
 * compteur accepte, ou null. Anti-rejeu : un compteur <= `lastAcceptedCounter`
 * est refuse (un meme code ne peut jamais etre utilise deux fois).
 */
export function verifyTotp(
  base32Secret: string,
  code: string,
  options: { timeMs?: number; window?: number; lastAcceptedCounter?: number | null } = {},
): number | null {
  const normalized = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(normalized)) return null;
  const secret = base32Decode(base32Secret);
  const current = totpCounter(options.timeMs ?? Date.now());
  const window = options.window ?? 1;
  for (let delta = -window; delta <= window; delta += 1) {
    const counter = current + delta;
    if (options.lastAcceptedCounter !== undefined && options.lastAcceptedCounter !== null && counter <= options.lastAcceptedCounter) {
      continue;
    }
    const expected = Buffer.from(hotp(secret, counter));
    if (timingSafeEqual(expected, Buffer.from(normalized))) return counter;
  }
  return null;
}

export function otpauthUri(issuer: string, account: string, base32Secret: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: base32Secret,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
