import { Prisma } from "@axora24/database";

type D = Prisma.Decimal;
const ZERO = new Prisma.Decimal(0);

export const MIN_AUTONOMY_COVERAGE = 90;
export const MAX_LEVEL_AGE_MINUTES = 60;
export const AUTONOMY_WINDOW_HOURS = 24;

export function meterUnit(kind: string): "kWh" | "L" {
  return kind === "GENSET_FUEL" ? "L" : "kWh";
}

/** Debut d'intervalle valide : minute pleine, multiple du pas du compteur depuis l'epoque (UTC). */
export function isAligned(start: Date, intervalMinutes: number): boolean {
  const ms = start.getTime();
  return ms % 60_000 === 0 && (ms / 60_000) % intervalMinutes === 0;
}

export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function expectedIntervals(from: Date, to: Date, intervalMinutes: number): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / (intervalMinutes * 60_000)));
}

/** Couverture (0-100, 1 decimale) : part des intervalles attendus effectivement recus. */
export function coverage(received: number, expected: number): D {
  if (expected <= 0) return ZERO;
  return new Prisma.Decimal(Math.min(received, expected)).mul(100).div(expected).toDecimalPlaces(1);
}

/** Tarif en vigueur a une date : le plus recent dont validFrom <= jour (tarifs tries par date croissante). */
export function tariffAt(tariffs: Array<{ validFrom: Date; unitPrice: D | string }>, day: Date): D | null {
  let current: D | null = null;
  for (const tariff of tariffs) {
    if (tariff.validFrom.getTime() <= day.getTime()) current = new Prisma.Decimal(tariff.unitPrice);
    else break;
  }
  return current;
}

export interface AutonomyInput {
  kind: "BATTERY" | "FUEL_TANK";
  usableCapacity: D;
  levelIsPercent: boolean;
  reserve: D;
  level: D | null;
  levelAt: Date | null;
  now: Date;
  drainSum: D;
  drainIntervals: number;
  expectedIntervals: number;
  intervalMinutes: number;
  unit: "kWh" | "L";
}

export interface AutonomyResult {
  state: "COMPUTED" | "NOT_COMPUTABLE" | "UNBOUNDED";
  hours: D | null;
  reason: string | null;
  available: D | null;
  ratePerHour: D | null;
  coverage: D;
}

/**
 * Autonomie = energie (ou gasoil) disponible au-dessus de la reserve, divisee
 * par le rythme moyen mesure sur les intervalles recus de la fenetre.
 * Refuse de conclure si le niveau est absent/perime ou si la couverture de la
 * fenetre est insuffisante : aucune extrapolation.
 */
export function computeAutonomy(input: AutonomyInput): AutonomyResult {
  const cover = coverage(input.drainIntervals, input.expectedIntervals);
  const fail = (reason: string): AutonomyResult => ({ state: "NOT_COMPUTABLE", hours: null, reason, available: null, ratePerHour: null, coverage: cover });
  if (input.level === null || input.levelAt === null) return fail("Aucun niveau reçu pour ce stockage.");
  const ageMinutes = (input.now.getTime() - input.levelAt.getTime()) / 60_000;
  if (ageMinutes > MAX_LEVEL_AGE_MINUTES) return fail(`Dernier niveau reçu il y a ${Math.floor(ageMinutes)} min (maximum ${MAX_LEVEL_AGE_MINUTES} min).`);
  if (cover.lessThan(MIN_AUTONOMY_COVERAGE)) return fail(`Couverture des relevés de consommation ${cover.toString()} % sur ${AUTONOMY_WINDOW_HOURS} h (minimum ${MIN_AUTONOMY_COVERAGE} %).`);
  const aboveReserve = Prisma.Decimal.max(ZERO, input.level.minus(input.reserve));
  const available = input.levelIsPercent ? input.usableCapacity.mul(aboveReserve).div(100) : aboveReserve;
  const measuredHours = new Prisma.Decimal(input.drainIntervals * input.intervalMinutes).div(60);
  const rate = input.drainSum.div(measuredHours);
  if (rate.isZero()) return { state: "UNBOUNDED", hours: null, reason: "Aucune consommation mesurée sur la fenêtre : autonomie non bornée par les données.", available, ratePerHour: rate, coverage: cover };
  return { state: "COMPUTED", hours: available.div(rate).toDecimalPlaces(1), reason: null, available: available.toDecimalPlaces(3), ratePerHour: rate.toDecimalPlaces(3), coverage: cover };
}
