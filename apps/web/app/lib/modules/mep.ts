import type { CalculationCatalogView, EngineeringCalculationView, MepEquipmentView, MepSystemView } from "@axora24/contracts";
import { api } from "../api";

export const mepApi = {
  catalog: () => api.get<CalculationCatalogView>("/mep/calculation-types"),
  systems: (projectId: string) => api.get<MepSystemView[]>(`/mep/systems?projectId=${projectId}`),
  createSystem: (input: { projectId: string; code: string; name: string; discipline: string; description?: string }) => api.post<MepSystemView[]>("/mep/systems", input),
  equipment: (projectId: string) => api.get<MepEquipmentView[]>(`/mep/equipment?projectId=${projectId}`),
  oneEquipment: (id: string) => api.get<MepEquipmentView>(`/mep/equipment/${id}`),
  createEquipment: (input: Record<string, unknown>) => api.post<MepEquipmentView>("/mep/equipment", input),
  updateEquipment: (id: string, input: Record<string, unknown>) => api.patch<MepEquipmentView>(`/mep/equipment/${id}`, input),
  quantities: (projectId: string) =>
    api.get<Array<{ systemId: string; systemCode: string; systemName: string; discipline: string; status: string; references: number; quantity: number }>>(`/mep/quantities?projectId=${projectId}`),
  calculations: (projectId: string) => api.get<EngineeringCalculationView[]>(`/mep/calculations?projectId=${projectId}`),
  calculation: (id: string) => api.get<EngineeringCalculationView>(`/mep/calculations/${id}`),
  createCalculation: (input: Record<string, unknown>) => api.post<EngineeringCalculationView>("/mep/calculations", input),
  revise: (id: string, input: { inputs: Record<string, string>; sources?: string; notes: string }) => api.post<EngineeringCalculationView>(`/mep/calculations/${id}/revise`, input),
  validate: (id: string, note?: string) => api.post<EngineeringCalculationView>(`/mep/calculations/${id}/validate`, { note }),
};

export const DISCIPLINE_LABEL: Record<string, string> = {
  HVAC: "CVC",
  ELECTRICAL: "Électricité (CFO)",
  LOW_CURRENT: "Courants faibles (CFA)",
  PLUMBING: "Plomberie",
  FIRE_PROTECTION: "Protection incendie",
};

export const EQUIPMENT_STATUS_LABEL: Record<string, string> = { SPECIFIED: "Spécifié", SELECTED: "Sélectionné", INSTALLED: "Installé", COMMISSIONED: "Mis en service" };
export const EQUIPMENT_STATUS_CHIP: Record<string, string> = { SPECIFIED: "draft", SELECTED: "planned", INSTALLED: "in_progress", COMMISSIONED: "done" };
export const CALC_STATUS_LABEL: Record<string, string> = { DRAFT: "À valider", VALIDATED: "Validée", SUPERSEDED: "Remplacée" };
export const CALC_STATUS_CHIP: Record<string, string> = { DRAFT: "pending", VALIDATED: "verified", SUPERSEDED: "closed" };
