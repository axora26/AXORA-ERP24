import { createHmac, timingSafeEqual } from "node:crypto";
import { Prisma } from "@axora24/database";
import type { AutomationFieldType, WorkflowCondition } from "@axora24/contracts";

const DECIMAL = /^-?\d+(\.\d+)?$/;

/**
 * Evaluation d'une condition sur la charge utile d'un evenement. Les champs
 * decimaux se comparent en decimal exact ; un champ absent ne satisfait
 * aucune condition (jamais d'interpretation par defaut).
 */
export function conditionHolds(condition: WorkflowCondition, payload: Record<string, unknown>, type: AutomationFieldType | undefined): boolean {
  const raw = payload[condition.field];
  if (raw === undefined || raw === null) return false;
  const text = String(raw);
  if (type === "decimal") {
    if (!DECIMAL.test(text) || !DECIMAL.test(condition.value)) return false;
    const left = new Prisma.Decimal(text);
    const right = new Prisma.Decimal(condition.value);
    switch (condition.operator) {
      case "eq":
        return left.equals(right);
      case "neq":
        return !left.equals(right);
      case "gt":
        return left.greaterThan(right);
      case "gte":
        return left.greaterThanOrEqualTo(right);
      case "lt":
        return left.lessThan(right);
      case "lte":
        return left.lessThanOrEqualTo(right);
      default:
        return false;
    }
  }
  switch (condition.operator) {
    case "eq":
      return text === condition.value;
    case "neq":
      return text !== condition.value;
    case "contains":
      return text.toLowerCase().includes(condition.value.toLowerCase());
    default:
      return false;
  }
}

export function allConditionsHold(conditions: WorkflowCondition[], payload: Record<string, unknown>, fields: Record<string, AutomationFieldType>): boolean {
  return conditions.every((condition) => conditionHolds(condition, payload, fields[condition.field]));
}

/** Gabarit « {{champ}} » : texte brut, champ absent laisse vide (visible dans le message). */
export function render(template: string, payload: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => (payload[key] === undefined || payload[key] === null ? "" : String(payload[key])));
}

/**
 * Signature d'un webhook sortant : HMAC-SHA256 de « horodatage.corps ».
 * Le destinataire recalcule et rejette un horodatage trop ancien (anti-rejeu).
 */
export function signWebhook(secret: string, timestamp: string, body: string): string {
  return `v1=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

export function verifyWebhook(secret: string, timestamp: string, body: string, signature: string, now = Date.now(), toleranceMs = 5 * 60_000): boolean {
  const age = Math.abs(now - Number(timestamp) * 1000);
  if (!Number.isFinite(age) || age > toleranceMs) return false;
  const expected = Buffer.from(signWebhook(secret, timestamp, body));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Delai avant nouvelle tentative de livraison (1 min, 5 min, 30 min, 2 h) ; au-dela : echec definitif. */
export function nextRetryDelayMs(attempts: number): number | null {
  const schedule = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000];
  return attempts <= schedule.length ? schedule[attempts - 1]! : null;
}

const PRIVATE_V4 = [/^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./];

/**
 * Politique de cible d'un webhook sortant (anti-SSRF) : HTTPS obligatoire,
 * aucune adresse locale ou privee, sans identifiants dans l'URL. Les cibles
 * locales ne sont admises que si l'environnement l'autorise explicitement
 * (developpement, tests). Renvoie un motif de refus, ou null si la cible est admise.
 */
export function webhookTargetRefusal(raw: string, allowPrivateTargets: boolean): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "URL invalide";
  }
  if (url.username || url.password) return "identifiants interdits dans l'URL";
  if (url.protocol !== "https:" && !(allowPrivateTargets && url.protocol === "http:")) return "HTTPS obligatoire";
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const local = host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local") || PRIVATE_V4.some((pattern) => pattern.test(host)) || host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80") || host === "::" || host.startsWith("::ffff:");
  if (local && !allowPrivateTargets) return "adresse locale ou privée interdite";
  return null;
}
