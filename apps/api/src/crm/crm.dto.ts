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

export class CreateContactDto {
  companyId?: string;
  accountId?: string;
  fullName!: string;
  email?: string;
  phone?: string;
  jobTitle?: string;
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
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(`${field} is not a valid date`);
  }
  return date;
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
