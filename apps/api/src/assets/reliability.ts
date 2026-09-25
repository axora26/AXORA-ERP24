import { Prisma } from "@axora24/database";

/**
 * Indicateurs de fiabilite calcules UNIQUEMENT sur l'historique reel
 * d'interventions correctives (jamais d'estimation par defaut).
 *
 * - Periode observee : de la mise en service a l'instant de calcul.
 * - Indisponibilite : union des intervalles [defaillance, remise en service]
 *   (deux interventions qui se chevauchent ne sont pas comptees deux fois).
 * - MTTR = moyenne des durees de remise en service de chaque defaillance.
 * - MTBF = (periode observee - indisponibilite) / nombre de defaillances.
 * - Disponibilite = (periode - indisponibilite) / periode.
 * Sans defaillance enregistree, MTBF et MTTR ne sont pas calculables (null).
 */
export interface FailureRecord {
  failureAt: Date;
  restoredAt: Date;
}

export interface ReliabilityResult {
  periodHours: string;
  downtimeHours: string;
  failures: number;
  mttrHours: string | null;
  mtbfHours: string | null;
  availabilityPercent: string | null;
  formula: string;
}

const HOUR = new Prisma.Decimal(3_600_000);
const hours = (ms: number) => new Prisma.Decimal(ms).div(HOUR);

export function reliability(inServiceSince: Date, until: Date, records: FailureRecord[]): ReliabilityResult {
  const start = inServiceSince.getTime();
  const end = until.getTime();
  const formula = "MTTR = Σ(remise en service − défaillance) / n ; MTBF = (période − indisponibilité) / n ; disponibilité = (période − indisponibilité) / période";
  if (end <= start) {
    return { periodHours: "0.00", downtimeHours: "0.00", failures: 0, mttrHours: null, mtbfHours: null, availabilityPercent: null, formula };
  }
  const failures = records
    .filter((record) => record.restoredAt.getTime() > record.failureAt.getTime())
    .map((record) => ({ from: Math.max(start, record.failureAt.getTime()), to: Math.min(end, record.restoredAt.getTime()), repair: record.restoredAt.getTime() - record.failureAt.getTime() }))
    .filter((record) => record.to > record.from)
    .sort((left, right) => left.from - right.from);

  let downtime = 0;
  let cursorFrom = -1;
  let cursorTo = -1;
  for (const failure of failures) {
    if (failure.from > cursorTo) {
      if (cursorTo > cursorFrom) downtime += cursorTo - cursorFrom;
      cursorFrom = failure.from;
      cursorTo = failure.to;
    } else {
      cursorTo = Math.max(cursorTo, failure.to);
    }
  }
  if (cursorTo > cursorFrom) downtime += cursorTo - cursorFrom;

  const period = hours(end - start);
  const down = hours(downtime);
  const n = failures.length;
  return {
    periodHours: period.toFixed(2),
    downtimeHours: down.toFixed(2),
    failures: n,
    mttrHours: n === 0 ? null : hours(failures.reduce((sum, failure) => sum + failure.repair, 0)).div(n).toFixed(2),
    mtbfHours: n === 0 ? null : period.minus(down).div(n).toFixed(2),
    availabilityPercent: period.minus(down).div(period).mul(100).toFixed(2),
    formula,
  };
}
