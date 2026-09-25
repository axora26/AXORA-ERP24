/**
 * INC-23 — Analytique / BI. Chaque indicateur est calcule sur les donnees
 * reelles de son module, dans le perimetre entreprise, et reste soumis a la
 * permission de lecture de ce module.
 */

export type AnalyticsUnit = "money" | "count" | "hours" | "kwh" | "liters";

export interface AnalyticsMetricDescriptor {
  key: string;
  label: string;
  domain: string;
  domainLabel: string;
  unit: AnalyticsUnit;
  description: string;
  permission: string;
}

export interface AnalyticsCatalogEntry extends AnalyticsMetricDescriptor {
  granted: boolean;
}

export interface AnalyticsSeries {
  /** Devise (montants) ou nom de serie. Les devises ne sont jamais additionnees entre elles. */
  key: string;
  label: string;
  values: string[];
}

export interface AnalyticsSeriesView {
  metric: AnalyticsMetricDescriptor;
  months: string[];
  series: AnalyticsSeries[];
  /** Nombre d'enregistrements sources lus (tracabilite). */
  sourceRows: number;
  window: { from: string; to: string };
  companyId: string;
  computedAt: string;
}

export interface AnalyticsSnapshotMetric {
  metric: string;
  label: string;
  unit: AnalyticsUnit;
  series: Array<{ key: string; label: string; value: string }>;
  sourceRows: number;
}

export interface AnalyticsSnapshotView {
  id: string;
  period: string;
  periodStart: string;
  periodEnd: string;
  version: number;
  isDemo: boolean;
  capturedByName: string;
  capturedAt: string;
  metrics: AnalyticsSnapshotMetric[];
  /** Indicateurs figes que le lecteur n'a pas le droit de voir (masques). */
  hiddenMetrics: number;
  /** Domaines non figes faute de droits du capteur au moment de la capture. */
  excludedMetrics: string[];
}

export interface AnalyticsDashboardView {
  id: string;
  name: string;
  metrics: string[];
  shared: boolean;
  ownerName: string;
  mine: boolean;
  updatedAt: string;
}
