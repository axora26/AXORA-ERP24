import { Prisma } from "@axora24/database";

/** Mois calendaire UTC « AAAA-MM ». */
export function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

export function monthStart(period: string): Date {
  const [year, month] = period.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, 1));
}

export function addMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

/** Les `count` mois se terminant par le mois de `now` (inclus), du plus ancien au plus recent. */
export function lastMonths(now: Date, count: number): string[] {
  const current = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return Array.from({ length: count }, (_, index) => monthKey(addMonths(current, index - count + 1)));
}

export interface BucketRow {
  at: Date;
  series: string;
  value: Prisma.Decimal | number | string;
}

/**
 * Agregation mensuelle exacte (decimal) : une serie par cle (devise ou nom),
 * jamais d'addition entre series ; les lignes hors fenetre sont ignorees.
 */
export function bucketize(rows: BucketRow[], months: string[], order: string[] = [], money = false): Array<{ key: string; values: string[] }> {
  const index = new Map(months.map((month, position) => [month, position]));
  const totals = new Map<string, Prisma.Decimal[]>();
  for (const row of rows) {
    const position = index.get(monthKey(row.at));
    if (position === undefined) continue;
    if (!totals.has(row.series)) totals.set(row.series, months.map(() => new Prisma.Decimal(0)));
    const values = totals.get(row.series)!;
    values[position] = values[position]!.plus(row.value);
  }
  for (const key of order) if (!totals.has(key)) totals.set(key, months.map(() => new Prisma.Decimal(0)));
  const keys = [...totals.keys()].sort((left, right) => {
    const a = order.indexOf(left);
    const b = order.indexOf(right);
    return a === -1 && b === -1 ? left.localeCompare(right) : a === -1 ? 1 : b === -1 ? -1 : a - b;
  });
  // Montants : toujours 2 decimales ; quantites : entier si exact, sinon 2 decimales.
  return keys.map((key) => ({ key, values: totals.get(key)!.map((value) => (money || !value.isInteger() ? value.toFixed(2) : value.toFixed(0))) }));
}

/** CSV RFC 4180 (separateur virgule, point decimal) avec echappement des guillemets. */
export function toCsv(header: string[], rows: string[][]): string {
  const cell = (value: string) => (/[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  return [header, ...rows].map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}
