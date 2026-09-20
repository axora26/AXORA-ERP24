/**
 * Sessions opaques (pas de JWT auto-porteur pour les sessions utilisateur).
 * Reference : docs/foundation/01-architecture.md §3, §5.2.
 */
import { randomBytes, createHash } from "node:crypto";

export interface SessionToken {
  /** Token opaque a transmettre au client (cookie HttpOnly). Jamais stocke tel quel en base. */
  plainToken: string;
  /** Hash SHA-256 du token — c'est cette valeur qui est persistee en base. */
  tokenHash: string;
}

export function createSessionToken(): SessionToken {
  const plainToken = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(plainToken).digest("hex");
  return { plainToken, tokenHash };
}

export function hashSessionToken(plainToken: string): string {
  return createHash("sha256").update(plainToken).digest("hex");
}
