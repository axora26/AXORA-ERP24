/**
 * Chiffrement au repos des secrets applicatifs (ex. secret TOTP) :
 * AES-256-GCM, IV aleatoire de 12 octets, tag de 16 octets, format versionne
 * `aes-256-gcm-v1$<iv>$<tag>$<ciphertext>` (base64url).
 * La cle (32 octets, base64) est un secret d'infrastructure, jamais committe.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "aes-256-gcm-v1";

export function parseEncryptionKey(base64Key: string | undefined): Buffer | null {
  if (!base64Key) return null;
  const key = Buffer.from(base64Key, "base64");
  return key.length === 32 ? key : null;
}

export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join("$");
}

export function decryptSecret(payload: string, key: Buffer): string {
  const [version, iv, tag, ciphertext] = payload.split("$");
  if (version !== VERSION || !iv || !tag || !ciphertext) throw new Error("Unsupported secret format");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}
