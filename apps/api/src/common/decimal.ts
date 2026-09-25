import { Prisma } from "@axora24/database";

/**
 * Arithmetique decimale exacte (jamais de flottant sur un montant).
 * Les vues API transportent les montants en chaines.
 */

export type DecimalInput = Prisma.Decimal | string | number;

export function dec(value: DecimalInput | null | undefined): Prisma.Decimal {
  if (value === null || value === undefined) return new Prisma.Decimal(0);
  return new Prisma.Decimal(value);
}

export function sumDecimals(values: Array<DecimalInput | null | undefined>): Prisma.Decimal {
  return values.reduce<Prisma.Decimal>((total, value) => total.plus(dec(value)), new Prisma.Decimal(0));
}

/** Montant monetaire serialise a 2 decimales. */
export function money(value: DecimalInput | null | undefined): string {
  return dec(value).toFixed(2);
}

/** Quantite serialisee a 3 decimales (unites physiques). */
export function qty(value: DecimalInput | null | undefined): string {
  return dec(value).toFixed(3);
}

export function moneyOrNull(value: DecimalInput | null | undefined): string | null {
  return value === null || value === undefined ? null : money(value);
}

/** Ratio en pourcentage (0-100) arrondi a 1 decimale ; 0 si denominateur nul. */
export function percent(numerator: DecimalInput, denominator: DecimalInput): string {
  const den = dec(denominator);
  if (den.isZero()) return "0.0";
  return dec(numerator).div(den).mul(100).toFixed(1);
}
