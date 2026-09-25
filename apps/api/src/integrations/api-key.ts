import { createHash, randomBytes } from "node:crypto";
import { isIP } from "node:net";

const KEY_PATTERN = /^axk_[A-Za-z0-9_-]{43}$/;

/** Secret de cle d'API : 32 octets aleatoires ; seule l'empreinte SHA-256 est stockee. */
export function generateApiKey(): { secret: string; prefix: string; hash: string } {
  const secret = `axk_${randomBytes(32).toString("base64url")}`;
  return { secret, prefix: secret.slice(0, 12), hash: hashApiKey(secret) };
}

export function hashApiKey(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/** Extrait la cle d'un en-tete « Authorization: Bearer axk_... » (format strict). */
export function bearerKey(header: string | undefined): string | null {
  const match = /^Bearer (\S+)$/.exec(header ?? "");
  return match && KEY_PATTERN.test(match[1]!) ? match[1]! : null;
}

/** Adresse normalisee (IPv4 mappee en IPv6 -> IPv4). */
export function normalizeIp(ip: string | undefined | null): string {
  const value = (ip ?? "").trim();
  return value.startsWith("::ffff:") && isIP(value.slice(7)) === 4 ? value.slice(7) : value;
}

export function ipAllowed(ip: string | undefined | null, allowed: string[]): boolean {
  if (allowed.length === 0) return true;
  const normalized = normalizeIp(ip);
  return allowed.some((entry) => normalizeIp(entry) === normalized);
}

export function validIp(value: string): boolean {
  return isIP(value.trim()) !== 0;
}

/** Fenetres de comptage (UTC) et delai avant leur renouvellement. */
export function rateWindows(now: Date): { minute: string; day: string; minuteResetSeconds: number; dayResetSeconds: number } {
  const iso = now.toISOString();
  const nextMinute = Math.ceil((now.getTime() + 1) / 60_000) * 60_000;
  const nextDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return {
    minute: `m:${iso.slice(0, 16)}`,
    day: `d:${iso.slice(0, 10)}`,
    minuteResetSeconds: Math.max(1, Math.ceil((nextMinute - now.getTime()) / 1000)),
    dayResetSeconds: Math.max(1, Math.ceil((nextDay - now.getTime()) / 1000)),
  };
}
