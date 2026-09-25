import type { EnergyAlertView, EnergyAutonomyView, EnergyBalanceView, EnergyBuildingView, EnergyIngestResult, EnergyMeterDetailView, EnergyMeterView, EnergySummaryView } from "@axora24/contracts";
import { api } from "../api";

export const energyApi = {
  summary: () => api.get<EnergySummaryView>("/energy/summary"),
  buildings: () => api.get<EnergyBuildingView[]>("/energy/buildings"),
  balance: (buildingId: string, days: number) => api.get<EnergyBalanceView>(`/energy/balance?buildingId=${buildingId}&days=${days}`),
  autonomy: (buildingId: string) => api.get<EnergyAutonomyView[]>(`/energy/autonomy?buildingId=${buildingId}`),
  meters: (buildingId?: string) => api.get<EnergyMeterView[]>(`/energy/meters${buildingId ? `?buildingId=${buildingId}` : ""}`),
  meter: (id: string) => api.get<EnergyMeterDetailView>(`/energy/meters/${id}`),
  createMeter: (input: Record<string, unknown>) => api.post<EnergyMeterDetailView>("/energy/meters", input),
  updateMeter: (id: string, input: Record<string, unknown>) => api.patch<EnergyMeterDetailView>(`/energy/meters/${id}`, input),
  addTariff: (id: string, input: Record<string, unknown>) => api.post<EnergyMeterDetailView>(`/energy/meters/${id}/tariffs`, input),
  addRule: (id: string, input: Record<string, unknown>) => api.post<EnergyMeterDetailView>(`/energy/meters/${id}/rules`, input),
  setRuleActive: (id: string, active: boolean) => api.patch<EnergyMeterDetailView>(`/energy/rules/${id}`, { active }),
  importIntervals: (id: string, intervals: Array<{ start: string; value: string }>) => api.post<EnergyIngestResult>(`/energy/meters/${id}/intervals`, { intervals }),
  createStorage: (input: Record<string, unknown>) => api.post<EnergyAutonomyView[]>("/energy/storages", input),
  alerts: (status = "OPEN") => api.get<EnergyAlertView[]>(`/energy/alerts?status=${status}`),
  acknowledge: (id: string, note: string) => api.post<EnergyAlertView[]>(`/energy/alerts/${id}/acknowledge`, { note }),
};

export const METER_KIND_LABEL: Record<string, string> = {
  GRID_IMPORT: "Réseau (soutirage)",
  GRID_EXPORT: "Réseau (injection)",
  PV_PRODUCTION: "Production PV",
  GENSET_PRODUCTION: "Groupe électrogène",
  BATTERY_CHARGE: "Batterie (charge)",
  BATTERY_DISCHARGE: "Batterie (décharge)",
  CONSUMPTION: "Consommation",
  GENSET_FUEL: "Gasoil groupe",
};

export const SOURCE_SERIES = [
  { key: "GRID_IMPORT", label: "Réseau", color: "#1849a9" },
  { key: "PV_PRODUCTION", label: "Photovoltaïque", color: "#f5b100" },
  { key: "GENSET_PRODUCTION", label: "Groupe électrogène", color: "#7a5af8" },
  { key: "BATTERY_DISCHARGE", label: "Batterie", color: "#12b76a" },
];

/**
 * Releves colles depuis un export (CSV, tableur) : une ligne « debut;valeur »,
 * « debut<TAB>valeur » ou « debut,valeur » (la date ISO ne contient pas de
 * virgule ; la valeur peut utiliser la virgule decimale). Les lignes
 * illisibles sont signalees, jamais corrigees en silence.
 */
export function parseIntervalLines(text: string): { intervals: Array<{ start: string; value: string }>; errors: string[] } {
  const intervals: Array<{ start: string; value: string }> = [];
  const errors: string[] = [];
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  lines.forEach((line, index) => {
    if (!line || /^(debut|début|start|date)\b/i.test(line)) return;
    const separator = line.includes(";") ? ";" : line.includes("\t") ? "\t" : ",";
    const at = line.indexOf(separator);
    const start = at > 0 ? line.slice(0, at).trim() : "";
    const value = at > 0 ? line.slice(at + 1).trim().replace(",", ".") : "";
    const date = new Date(start);
    if (!start || Number.isNaN(date.getTime()) || !/^\d+(\.\d+)?$/.test(value)) {
      errors.push(`Ligne ${index + 1} illisible : « ${line} »`);
      return;
    }
    intervals.push({ start: date.toISOString(), value });
  });
  return { intervals, errors };
}
