import { BadRequestException } from "@nestjs/common";

export class CreateStudyDto {
  companyId?: string;
  opportunityId!: string;
  code!: string;
  title!: string;
  objective!: string;
  sourceReference?: string;
}

export class CreateStudyRequirementDto {
  companyId?: string;
  position!: number;
  category!: string;
  statement!: string;
  sourceReference?: string;
}

export class CreateDqeDto {
  companyId?: string;
  studyId!: string;
  code!: string;
  title!: string;
  currency?: string;
}

export class CreateDqeLineDto {
  companyId?: string;
  position!: number;
  reference?: string;
  designation!: string;
  unitCode!: string;
  quantity!: string;
  unitPrice!: string;
}

export const STUDY_REQUIREMENT_CATEGORIES = [
  "FACT",
  "ASSUMPTION",
  "CONSTRAINT",
  "RISK",
  "NOTE",
] as const;

export function requiredText(value: unknown, field: string, maxLength = 500): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException(`${field} is required`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new BadRequestException(`${field} exceeds ${maxLength} characters`);
  }
  return trimmed;
}

export function optionalText(value: unknown, field: string, maxLength = 500): string | null {
  if (value === undefined || value === null || value === "") return null;
  return requiredText(value, field, maxLength);
}

export function positiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 1_000_000) {
    throw new BadRequestException(`${field} must be a positive integer`);
  }
  return value;
}

export function requirementCategory(value: unknown): (typeof STUDY_REQUIREMENT_CATEGORIES)[number] {
  const candidate = String(value ?? "").trim().toUpperCase();
  if (!STUDY_REQUIREMENT_CATEGORIES.includes(candidate as (typeof STUDY_REQUIREMENT_CATEGORIES)[number])) {
    throw new BadRequestException(
      `category must be one of: ${STUDY_REQUIREMENT_CATEGORIES.join(", ")}`,
    );
  }
  return candidate as (typeof STUDY_REQUIREMENT_CATEGORIES)[number];
}

/**
 * Decimal metier strict transporte en chaine. Aucun `number` IEEE-754 n'est
 * accepte a l'entree. La precision persistante est DECIMAL(24,6).
 */
export function decimal6(value: unknown, field: string, allowZero: boolean): string {
  if (typeof value !== "string") {
    throw new BadRequestException(`${field} must be a decimal string, never a number`);
  }
  const trimmed = value.trim();
  if (!/^\d{1,18}(\.\d{1,6})?$/.test(trimmed)) {
    throw new BadRequestException(
      `${field} must be a non-negative decimal string with at most 6 decimals`,
    );
  }
  if (!allowZero && /^0+(\.0+)?$/.test(trimmed)) {
    throw new BadRequestException(`${field} must be greater than zero`);
  }
  return trimmed;
}

export function currencyCode(value: unknown): string {
  const candidate = value === undefined || value === null || value === ""
    ? "USD"
    : String(value).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(candidate)) {
    throw new BadRequestException("currency must be a 3-letter ISO-4217 code");
  }
  return candidate;
}
