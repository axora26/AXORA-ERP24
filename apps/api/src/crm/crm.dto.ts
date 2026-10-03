import { BadRequestException } from "@nestjs/common";

/**
 * DTO CRM (INC-02) et validation explicite.
 *
 * Le projet n'utilise pas de ValidationPipe global : la validation est faite
 * ici, de maniere lisible et testable. Regle : toute entree client est
 * consideree hostile jusqu'a validation, et aucune valeur de scope
 * (organizationId) n'est acceptee depuis le corps de la requete.
 */

export class CreateAccountDto {
  companyId?: string;
  name!: string;
  industry?: string;
  city?: string;
  country?: string;
  website?: string;
  phone?: string;
  email?: string;
}

export class UpdateAccountDto {
  companyId?: string;
  expectedVersion!: number;
  name?: string;
  industry?: string | null;
  city?: string | null;
  country?: string | null;
  website?: string | null;
  phone?: string | null;
  email?: string | null;
}

export class VersionDto {
  companyId?: string;
  expectedVersion!: number;
}

export class DirectoryQueryDto {
  companyId?: string;
  q?: string;
  archived?: string;
  accountId?: string;
  page?: string;
  pageSize?: string;
}

export class ActivityQueryDto {
  companyId?: string;
  q?: string;
  relatedType?: string;
  relatedId?: string;
  type?: string;
  page?: string;
  pageSize?: string;
}

export class CreateContactDto {
  companyId?: string;
  accountId?: string;
  fullName!: string;
  email?: string;
  phone?: string;
  jobTitle?: string;
  isPrimary?: boolean;
}

export class UpdateContactDto {
  companyId?: string;
  expectedVersion!: number;
  accountId?: string | null;
  fullName?: string;
  email?: string | null;
  phone?: string | null;
  jobTitle?: string | null;
  isPrimary?: boolean;
}

export class CreateLeadDto {
  companyId?: string;
  contactName!: string;
  companyName!: string;
  email?: string;
  phone?: string;
  source?: string;
}

export class UpdateLeadStatusDto {
  companyId?: string;
  status!: string;
}

export class ConvertLeadDto {
  companyId?: string;
  accountId?: string;
  contactId?: string;
  opportunityName?: string;
  /** Montant decimal EN CHAINE (jamais un number : pas de flottant sur un prix). */
  amount?: string;
  currency?: string;
  stageId?: string;
  expectedCloseDate?: string;
}

export class CreateOpportunityDto {
  companyId?: string;
  name!: string;
  amount?: string;
  currency?: string;
  stageId?: string;
  accountId?: string;
  contactId?: string;
  expectedCloseDate?: string;
}

export class MoveOpportunityStageDto {
  companyId?: string;
  stageId!: string;
}

export class CreateActivityDto {
  companyId?: string;
  type!: string;
  subject!: string;
  body?: string;
  relatedType!: string;
  relatedId!: string;
}

export class CreatePipelineStageDto {
  companyId?: string;
  name!: string;
  position!: number;
  probability?: number;
  isWon?: boolean;
  isLost?: boolean;
}

// ---------------------------------------------------------------------------
// Validateurs
// ---------------------------------------------------------------------------

const MAX_TEXT_LENGTH = 300;

export function requiredString(value: unknown, field: string, maxLength = MAX_TEXT_LENGTH): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException(`${field} is required`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new BadRequestException(`${field} exceeds ${maxLength} characters`);
  }
  return trimmed;
}

export function optionalString(
  value: unknown,
  field: string,
  maxLength = MAX_TEXT_LENGTH,
): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return requiredString(value, field, maxLength);
}

/**
 * Montant decimal strict : chaine uniquement, au plus 2 decimales, positif.
 * Refuser un `number` est deliberé — accepter un flottant IEEE-754 ouvrirait
 * la porte aux erreurs d'arrondi sur des montants commerciaux
 * (invariant schema.prisma : Decimal(18,2)).
 */
export function decimalAmount(value: unknown, field: string): string {
  if (value === undefined || value === null || value === "") {
    return "0";
  }
  if (typeof value !== "string") {
    throw new BadRequestException(`${field} must be a decimal string, never a number`);
  }
  const trimmed = value.trim();
  if (!/^\d{1,16}(\.\d{1,2})?$/.test(trimmed)) {
    throw new BadRequestException(
      `${field} must be a positive decimal with at most 2 decimals (e.g. "12500.00")`,
    );
  }
  return trimmed;
}

/** Code devise ISO-4217 sur 3 lettres majuscules (contrainte @db.Char(3)). */
export function currencyCode(value: unknown, fallback = "USD"): string {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const code = String(value).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) {
    throw new BadRequestException("currency must be a 3-letter ISO-4217 code");
  }
  return code;
}

export function optionalDate(value: unknown, field: string): Date | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) {
    throw new BadRequestException(`${field} must be an ISO date`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(`${field} is not a valid date`);
  }
  const calendar = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  if (calendar.toISOString().slice(0, 10) !== value.slice(0, 10)) {
    throw new BadRequestException(`${field} is not a valid calendar date`);
  }
  return date;
}

export function assertFields(input: object, allowed: readonly string[]): void {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new BadRequestException("A JSON object is required");
  const unknown = Object.keys(input).find((key) => !allowed.includes(key));
  if (unknown) throw new BadRequestException(`Unknown field: ${unknown}`);
}

export function expectedVersion(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new BadRequestException("expectedVersion must be a positive integer");
  }
  return value;
}

export function strictBoolean(value: unknown, field: string, fallback = false): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new BadRequestException(`${field} must be a boolean`);
  return value;
}

export function optionalEmail(value: unknown): string | null {
  const email = optionalString(value, "email", 180);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestException("email is not valid");
  return email;
}

export function optionalWebsite(value: unknown): string | null {
  const website = optionalString(value, "website", 300);
  if (!website) return null;
  try {
    const url = new URL(website);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error();
  } catch { throw new BadRequestException("website must be an HTTP or HTTPS URL without credentials"); }
  return website;
}

export function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): T {
  const candidate = String(value ?? "").trim().toUpperCase();
  if (!allowed.includes(candidate as T)) {
    throw new BadRequestException(`${field} must be one of: ${allowed.join(", ")}`);
  }
  return candidate as T;
}

export function boundedInteger(
  value: unknown,
  field: string,
  min: number,
  max: number,
  fallback?: number,
): number {
  if (value === undefined || value === null || value === "") {
    if (fallback !== undefined) {
      return fallback;
    }
    throw new BadRequestException(`${field} is required`);
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new BadRequestException(`${field} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}
