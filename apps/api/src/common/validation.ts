import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@axora24/database";

/**
 * Validateurs d'entree partages par tous les modules metier.
 *
 * Chaque fonction rejette une valeur invalide par une 400 au message
 * exploitable, et renvoie une valeur normalisee (texte rogne, Decimal exact,
 * Date). Aucun module ne doit faire confiance a un champ client sans passer
 * par l'un de ces validateurs.
 */

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
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new BadRequestException(`${field} must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > maxLength) {
    throw new BadRequestException(`${field} exceeds ${maxLength} characters`);
  }
  return trimmed;
}

export function requiredId(value: unknown, field: string): string {
  return requiredText(value, field, 120);
}

export function optionalId(value: unknown, field: string): string | null {
  return optionalText(value, field, 120);
}

export function requiredEnum<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== "string") {
    throw new BadRequestException(`${field} is required`);
  }
  const normalized = value.trim().toUpperCase();
  const match = allowed.find((candidate) => candidate === normalized);
  if (!match) {
    throw new BadRequestException(`${field} must be one of: ${allowed.join(", ")}`);
  }
  return match;
}

export function optionalEnum<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
): T | null {
  if (value === undefined || value === null || value === "") return null;
  return requiredEnum(value, field, allowed);
}

const DECIMAL_PATTERN = /^-?\d{1,14}(\.\d{1,6})?$/;

/**
 * Montant ou quantite en Decimal exact. Les nombres JSON sont refuses :
 * un flottant a deja perdu sa precision avant d'arriver ici.
 */
export function requiredDecimal(
  value: unknown,
  field: string,
  options: { min?: string; allowNegative?: boolean; positive?: boolean } = {},
): Prisma.Decimal {
  if (typeof value !== "string" || !DECIMAL_PATTERN.test(value.trim())) {
    throw new BadRequestException(`${field} must be a decimal string (e.g. "1250.50")`);
  }
  const decimal = new Prisma.Decimal(value.trim());
  if (!options.allowNegative && decimal.isNegative()) {
    throw new BadRequestException(`${field} must not be negative`);
  }
  if (options.positive && !decimal.greaterThan(0)) {
    throw new BadRequestException(`${field} must be greater than zero`);
  }
  if (options.min !== undefined && decimal.lessThan(options.min)) {
    throw new BadRequestException(`${field} must be >= ${options.min}`);
  }
  return decimal;
}

export function optionalDecimal(
  value: unknown,
  field: string,
  options: { allowNegative?: boolean; positive?: boolean } = {},
): Prisma.Decimal | null {
  if (value === undefined || value === null || value === "") return null;
  return requiredDecimal(value, field, options);
}

export function requiredInt(
  value: unknown,
  field: string,
  options: { min?: number; max?: number } = {},
): number {
  const numeric = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof numeric !== "number" || !Number.isInteger(numeric)) {
    throw new BadRequestException(`${field} must be an integer`);
  }
  if (options.min !== undefined && numeric < options.min) {
    throw new BadRequestException(`${field} must be >= ${options.min}`);
  }
  if (options.max !== undefined && numeric > options.max) {
    throw new BadRequestException(`${field} must be <= ${options.max}`);
  }
  return numeric;
}

export function optionalInt(
  value: unknown,
  field: string,
  options: { min?: number; max?: number } = {},
): number | null {
  if (value === undefined || value === null || value === "") return null;
  return requiredInt(value, field, options);
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:\d{2})?)?$/;

export function requiredDate(value: unknown, field: string): Date {
  if (typeof value !== "string" || !DATE_PATTERN.test(value.trim())) {
    throw new BadRequestException(`${field} must be an ISO date (YYYY-MM-DD)`);
  }
  const date = new Date(value.trim());
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(`${field} is not a valid date`);
  }
  return date;
}

export function optionalDate(value: unknown, field: string): Date | null {
  if (value === undefined || value === null || value === "") return null;
  return requiredDate(value, field);
}

export function optionalBoolean(value: unknown, field: string): boolean | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "boolean") {
    throw new BadRequestException(`${field} must be a boolean`);
  }
  return value;
}

export function requiredEmail(value: unknown, field: string): string {
  const email = requiredText(value, field, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new BadRequestException(`${field} must be a valid e-mail address`);
  }
  return email;
}

export function currencyCode(value: unknown, field = "currency"): string {
  const code = requiredText(value, field, 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) {
    throw new BadRequestException(`${field} must be an ISO 4217 code (e.g. USD, EUR, CDF)`);
  }
  return code;
}

export function assertBody(body: unknown): Record<string, unknown> {
  if (body === null || body === undefined || typeof body !== "object" || Array.isArray(body)) {
    throw new BadRequestException("Request body must be a JSON object");
  }
  return body as Record<string, unknown>;
}
