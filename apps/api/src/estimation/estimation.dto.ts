import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@axora24/database";

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
  expectedVersion?: number;
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
  expectedVersion?: number;
  lotId?: string;
  position!: number;
  reference?: string;
  designation!: string;
  unitCode!: string;
  costCategory?: string;
  quantity!: string;
  unitPrice!: string;
}

export class DraftVersionDto {
  companyId?: string;
  expectedVersion?: number;
}
export class UpdateStudyRequirementDto {
  companyId?: string;
  expectedVersion!: number;
  position?: number;
  category?: string;
  statement?: string;
  sourceReference?: string | null;
}
export class UpdateDqeLineDto {
  companyId?: string;
  expectedVersion!: number;
  lotId?: string | null;
  position?: number;
  reference?: string | null;
  designation?: string;
  unitCode?: string;
  costCategory?: string;
  quantity?: string;
  unitPrice?: string;
}
export class CreateDqeLotDto {
  companyId?: string;
  expectedVersion!: number;
  position!: number;
  code!: string;
  designation!: string;
}
export class UpdateDqePricingDto {
  companyId?: string;
  expectedVersion!: number;
  overheadRate?: string;
  marginRate?: string;
  taxRate?: string;
}
export class CreateDqeVariantDto {
  companyId?: string;
  expectedVersion!: number;
  code!: string;
  title!: string;
}
export class CreateDqeLibraryItemDto {
  companyId?: string;
  code!: string;
  designation!: string;
  unitCode!: string;
  costCategory?: string;
  unitPrice!: string;
}
export class UpdateDqeLibraryItemDto {
  companyId?: string;
  designation?: string;
  unitCode?: string;
  costCategory?: string;
  unitPrice?: string;
  isActive?: boolean;
}

export function assertDraftFields(input: object, allowed: readonly string[]): void {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new BadRequestException("A JSON object is required");
  const unknown = Object.keys(input).find((key) => !allowed.includes(key));
  if (unknown) throw new BadRequestException(`Unknown field: ${unknown}`);
}
export function draftVersion(value: unknown, required = true): number | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new BadRequestException("expectedVersion must be a positive integer");
  return value;
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

export const DQE_COST_CATEGORIES = ["MATERIAL", "LABOR", "EQUIPMENT", "SUBCONTRACTING", "OTHER"] as const;

export function costCategory(value: unknown): (typeof DQE_COST_CATEGORIES)[number] {
  const candidate = String(value ?? "MATERIAL").trim().toUpperCase();
  if (!DQE_COST_CATEGORIES.includes(candidate as (typeof DQE_COST_CATEGORIES)[number])) {
    throw new BadRequestException(`costCategory must be one of: ${DQE_COST_CATEGORIES.join(", ")}`);
  }
  return candidate as (typeof DQE_COST_CATEGORIES)[number];
}

/** Taux de chiffrage strict, exprimé en pourcentage et borné à 100. */
export function rate6(value: unknown, field: string): string {
  const normalized = value === undefined || value === null || value === "" ? "0" : value;
  const parsed = decimal6(normalized, field, true);
  if (new Prisma.Decimal(parsed).gt(100)) throw new BadRequestException(`${field} must be between 0 and 100`);
  return parsed;
}
