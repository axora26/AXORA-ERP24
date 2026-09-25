import { Prisma } from "@axora24/database";

type D = Prisma.Decimal;
const ZERO = new Prisma.Decimal(0);
export const EXPIRING_DAYS = 30;

export type DocumentKind = "INSURANCE" | "REGISTRATION" | "INSPECTION" | "PERMIT" | "OTHER";

/** Pieces obligatoires par nature d'equipement (routier : assurance, carte grise, controle technique ; engin : assurance + verification periodique). */
export const REQUIRED_DOCUMENTS: Record<"VEHICLE" | "ENGINE" | "MACHINE", DocumentKind[]> = {
  VEHICLE: ["INSURANCE", "REGISTRATION", "INSPECTION"],
  ENGINE: ["INSURANCE", "INSPECTION"],
  MACHINE: ["INSPECTION"],
};

export interface ComplianceState {
  kind: DocumentKind;
  state: "VALID" | "EXPIRING" | "EXPIRED" | "MISSING";
  validUntil: Date | null;
  reference: string | null;
  required: boolean;
}

/** Etat de conformite a une date : piece en vigueur la plus lointaine, sinon la derniere echue, sinon manquante. */
export function compliance(
  vehicleKind: "VEHICLE" | "ENGINE" | "MACHINE",
  documents: Array<{ kind: DocumentKind; reference: string; validFrom: Date; validUntil: Date }>,
  at: Date,
): ComplianceState[] {
  const day = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const required = REQUIRED_DOCUMENTS[vehicleKind];
  const kinds = [...new Set<DocumentKind>([...required, ...documents.map((document) => document.kind)])];
  return kinds.map((kind) => {
    const mine = documents.filter((document) => document.kind === kind && document.validFrom <= day).sort((a, b) => b.validUntil.getTime() - a.validUntil.getTime());
    const best = mine[0];
    if (!best) return { kind, state: "MISSING", validUntil: null, reference: null, required: required.includes(kind) };
    const days = (best.validUntil.getTime() - day.getTime()) / 86_400_000;
    return { kind, state: days < 0 ? "EXPIRED" : days <= EXPIRING_DAYS ? "EXPIRING" : "VALID", validUntil: best.validUntil, reference: best.reference, required: required.includes(kind) };
  });
}

/** Pieces obligatoires qui bloquent une affectation (echues ou absentes). */
export function blockingDocuments(states: ComplianceState[]): ComplianceState[] {
  return states.filter((state) => state.required && (state.state === "EXPIRED" || state.state === "MISSING"));
}

/**
 * Consommation « plein a plein » : entre deux pleins complets, les litres
 * remis (pleins partiels intermediaires compris) rapportes a l'usage mesure.
 * Aucune valeur tant que deux pleins complets n'encadrent pas un usage > 0.
 */
export function fullToFullConsumption(
  fills: Array<{ filledAt: Date; liters: D | string; reading: D | string; fullTank: boolean }>,
  unit: "KM" | "HOURS",
): { value: D | null; windows: number; liters: D; usage: D } {
  const sorted = [...fills].sort((a, b) => a.filledAt.getTime() - b.filledAt.getTime());
  let anchor: { reading: D } | null = null;
  let pending = ZERO;
  let liters = ZERO;
  let usage = ZERO;
  let windows = 0;
  for (const fill of sorted) {
    const reading = new Prisma.Decimal(fill.reading);
    if (anchor) pending = pending.plus(fill.liters);
    if (!fill.fullTank) continue;
    if (anchor && reading.greaterThan(anchor.reading)) {
      liters = liters.plus(pending);
      usage = usage.plus(reading.minus(anchor.reading));
      windows += 1;
    }
    anchor = { reading };
    pending = ZERO;
  }
  if (windows === 0 || usage.isZero()) return { value: null, windows, liters, usage };
  const value = unit === "KM" ? liters.div(usage).mul(100) : liters.div(usage);
  return { value: value.toDecimalPlaces(2), windows, liters, usage };
}
