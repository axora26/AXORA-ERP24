import type { AnalyticsCatalogEntry, AnalyticsDashboardView, AnalyticsSeriesView, AnalyticsSnapshotView } from "@axora24/contracts";
import { API_URL, api, assetUrl } from "../api";

export const analyticsApi = {
  catalog: () => api.get<AnalyticsCatalogEntry[]>("/analytics/catalog"),
  series: (key: string, months: number) => api.get<AnalyticsSeriesView>(`/analytics/series/${key}?months=${months}`),
  snapshots: () => api.get<AnalyticsSnapshotView[]>("/analytics/snapshots"),
  capture: (period: string) => api.post<AnalyticsSnapshotView>("/analytics/snapshots", { period }),
  dashboards: () => api.get<AnalyticsDashboardView[]>("/analytics/dashboards"),
  createDashboard: (input: { name: string; metrics: string[]; shared: boolean }) => api.post<AnalyticsDashboardView>("/analytics/dashboards", input),
  updateDashboard: (id: string, input: { name: string; metrics: string[]; shared: boolean }) => api.put<AnalyticsDashboardView>(`/analytics/dashboards/${id}`, input),
  deleteDashboard: (id: string) => api.delete<{ deleted: true }>(`/analytics/dashboards/${id}`),
};

export function exportUrl(key: string, months: number): string {
  return assetUrl(`${API_URL}/analytics/export/${key}?months=${months}`);
}

/** Unite affichee : la devise pour un montant (jamais additionnee a une autre). */
export function unitLabel(unit: string, seriesKey: string): string {
  if (unit === "money") return seriesKey;
  return { count: "", hours: "h", kwh: "kWh", liters: "L" }[unit] ?? "";
}

/**
 * Groupes de graphiques : un par devise pour les montants (un seul axe par
 * graphique, jamais deux devises ensemble), un seul pour les autres unites.
 */
export function chartGroups(view: Pick<AnalyticsSeriesView, "metric" | "series">): Array<{ unit: string; series: AnalyticsSeriesView["series"] }> {
  if (view.metric.unit === "money") return view.series.map((serie) => ({ unit: serie.key, series: [serie] }));
  return [{ unit: unitLabel(view.metric.unit, ""), series: view.series }];
}

/** Total exact d'une serie (centimes entiers pour eviter les erreurs d'arrondi flottant). */
export function seriesTotal(values: string[]): string {
  const cents = values.reduce((sum, value) => sum + BigInt(Math.round(Number(value) * 100)), 0n);
  const negative = cents < 0n;
  const absolute = negative ? -cents : cents;
  return `${negative ? "-" : ""}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, "0")}`;
}
