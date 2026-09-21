import { createHash } from "node:crypto";

/**
 * Cle anonyme de limitation des connexions. Ni l'adresse e-mail ni l'adresse IP
 * ne sont persistees en clair dans la table de securite.
 */
export function loginThrottleKey(normalizedEmail: string, ipAddress: string): string {
  return createHash("sha256")
    .update(`${normalizedEmail}\u0000${ipAddress}`, "utf8")
    .digest("hex");
}
