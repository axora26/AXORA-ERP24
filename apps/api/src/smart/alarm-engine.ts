import { Prisma } from "@axora24/database";

export type AlarmCondition = "ABOVE" | "BELOW" | "EQUALS";

/** Condition d'alarme evaluee en decimal exact (jamais en flottant). */
export function conditionMet(condition: AlarmCondition, value: Prisma.Decimal, threshold: Prisma.Decimal): boolean {
  if (condition === "ABOVE") return value.greaterThan(threshold);
  if (condition === "BELOW") return value.lessThan(threshold);
  return value.equals(threshold);
}

/** Une consigne est confirmee quand une relecture tombe dans la tolerance du point. */
export function withinTolerance(value: Prisma.Decimal, target: Prisma.Decimal, tolerance: Prisma.Decimal | null): boolean {
  return value.minus(target).abs().lessThanOrEqualTo(tolerance ?? new Prisma.Decimal(0));
}

const DECIMAL = /^-?\d{1,12}(\.\d{1,6})?$/;

/** Valeur transmise par une passerelle : chaine decimale (les nombres JSON sont refuses : pas d'arrondi flottant). */
export function parseReadingValue(raw: unknown, kind: "ANALOG" | "BINARY" | "MULTISTATE"): Prisma.Decimal | string {
  if (typeof raw !== "string" || !DECIMAL.test(raw.trim())) return "value must be a decimal string (max 12 integer digits, 6 decimals)";
  const value = new Prisma.Decimal(raw.trim());
  if (kind === "BINARY" && !value.equals(0) && !value.equals(1)) return "a binary point expects 0 or 1";
  if (kind === "MULTISTATE" && (!value.isInteger() || value.isNegative())) return "a multistate point expects a non-negative integer";
  return value;
}
