import { randomBytes } from "node:crypto";
import { BadRequestException, ServiceUnavailableException } from "@nestjs/common";
import { decryptSecret, encryptSecret, hashSessionToken, parseEncryptionKey } from "@axora24/security";

const PREFIX = "AXORA-CARD:v1:";
export function serviceCardKey(): Buffer {
  const key = parseEncryptionKey(process.env.SERVICE_CARD_ENCRYPTION_KEY);
  if (!key) throw new ServiceUnavailableException("Service card encryption is not configured");
  return key;
}
export function normalizeCardToken(input: unknown): string {
  if (typeof input !== "string") throw new BadRequestException("A service card QR token is required");
  const value = input.trim();
  const token = value.startsWith(PREFIX) ? value.slice(PREFIX.length) : value;
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new BadRequestException("Invalid service card QR token");
  return token;
}
export function createCardCredential(): { tokenHash: string; tokenCiphertext: string; qrPayload: string } {
  const token = randomBytes(32).toString("base64url");
  return { tokenHash: hashSessionToken(token), tokenCiphertext: encryptSecret(token, serviceCardKey()), qrPayload: PREFIX + token };
}
export function cardPayload(tokenCiphertext: string): string {
  let token: string;
  try { token = decryptSecret(tokenCiphertext, serviceCardKey()); }
  catch (error) {
    if (error instanceof ServiceUnavailableException) throw error;
    throw new ServiceUnavailableException("The service card cannot be decrypted; reissue it using the configured key");
  }
  return PREFIX + normalizeCardToken(token);
}
