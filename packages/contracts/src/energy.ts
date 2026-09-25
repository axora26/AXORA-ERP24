/**
 * INC-17 — Energie. Toute valeur agregee porte sa couverture ; une autonomie
 * n'est calculee que sur des donnees reellement disponibles.
 */

export type EnergyMeterKind = "GRID_IMPORT" | "GRID_EXPORT" | "PV_PRODUCTION" | "GENSET_PRODUCTION" | "BATTERY_CHARGE" | "BATTERY_DISCHARGE" | "CONSUMPTION" | "GENSET_FUEL";

export interface EnergyTariffView {
  id: string;
  validFrom: string;
  unitPrice: string;
  note: string | null;
}

export interface EnergyMeterView {
  id: string;
  code: string;
  name: string;
  buildingId: string;
  buildingCode: string;
  kind: EnergyMeterKind;
  unit: "kWh" | "L";
  intervalMinutes: number;
  gatewayId: string | null;
  gatewayCode: string | null;
  externalRef: string | null;
  assetId: string | null;
  assetCode: string | null;
  active: boolean;
  lastPeriodStart: string | null;
  /** Part des intervalles attendus effectivement recus sur les dernieres 24 h (0-100). */
  coverage24h: string;
  simulated: boolean;
  currentTariff: string | null;
}

export interface EnergyMeterDetailView extends EnergyMeterView {
  tariffs: EnergyTariffView[];
  rules: Array<{ id: string; kind: "INTERVAL_ABOVE" | "DAILY_ABOVE"; threshold: string; message: string; active: boolean }>;
  daily: Array<{ day: string; value: string; intervals: number; expected: number }>;
  recent: Array<{ periodStart: string; value: string; source: "GATEWAY" | "IMPORT"; simulated: boolean }>;
}

export interface EnergyIngestResult {
  accepted: number;
  duplicates: number;
  conflicts: Array<{ meter: string; periodStart: string; value: string; existing: string }>;
  rejected: Array<{ index: number; reason: string }>;
  alertsRaised: number;
}

export interface EnergyKindTotal {
  kind: EnergyMeterKind;
  unit: "kWh" | "L";
  value: string;
  /** Couverture ponderee des compteurs de ce type (0-100). */
  coverage: string;
  meters: number;
  cost: string | null;
  costComplete: boolean;
}

export interface EnergyBalanceView {
  buildingId: string;
  buildingCode: string;
  from: string;
  to: string;
  days: number;
  currency: string;
  totals: EnergyKindTotal[];
  consumption: { value: string | null; method: "MEASURED" | "BALANCE" | "UNAVAILABLE"; coverage: string | null; detail: string };
  previousConsumption: { value: string | null; coverage: string | null };
  /** Variation vs periode precedente ; null si la couverture de l'une des deux periodes est insuffisante. */
  consumptionChangePercent: string | null;
  comparisonNote: string;
  renewableSharePercent: string | null;
  intensityKwhPerM2: string | null;
  intensityNote: string;
  cost: string;
  costComplete: boolean;
  simulatedData: boolean;
  series: Array<{ day: string; values: Partial<Record<EnergyMeterKind, string>> }>;
}

export interface EnergyAutonomyView {
  storageId: string;
  name: string;
  kind: "BATTERY" | "FUEL_TANK";
  state: "COMPUTED" | "NOT_COMPUTABLE" | "UNBOUNDED";
  hours: string | null;
  reason: string | null;
  inputs: Array<{ label: string; value: string }>;
  formula: string;
  assumptions: string[];
  simulatedInputs: boolean;
}

export interface EnergyAlertView {
  id: string;
  meterId: string;
  meterCode: string;
  meterName: string;
  unit: "kWh" | "L";
  kind: "INTERVAL_ABOVE" | "DAILY_ABOVE";
  threshold: string;
  message: string;
  periodStart: string;
  value: string;
  raisedAt: string;
  status: "OPEN" | "ACKNOWLEDGED";
  acknowledgedByName: string | null;
  acknowledgeNote: string | null;
}

export interface EnergySummaryView {
  meters: number;
  openAlerts: number;
  lowCoverageMeters: number;
  consumption7d: string | null;
  consumption7dCoverage: string | null;
}

export interface EnergyBuildingView {
  id: string;
  code: string;
  name: string;
  floorAreaM2: string | null;
  meters: number;
  storages: number;
}
