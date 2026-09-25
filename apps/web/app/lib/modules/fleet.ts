import type { FleetAssignmentView, FleetFuelLogView, FleetIncidentView, FleetProjectCostView, FleetSummaryView, FleetVehicleDetailView, FleetVehicleView } from "@axora24/contracts";
import { api } from "../api";

export const fleetApi = {
  summary: () => api.get<FleetSummaryView>("/fleet/summary"),
  vehicles: () => api.get<FleetVehicleView[]>("/fleet/vehicles"),
  vehicle: (id: string) => api.get<FleetVehicleDetailView>(`/fleet/vehicles/${id}`),
  createVehicle: (input: Record<string, unknown>) => api.post<FleetVehicleDetailView>("/fleet/vehicles", input),
  setStatus: (id: string, status: string, reason: string) => api.post<FleetVehicleDetailView>(`/fleet/vehicles/${id}/status`, { status, reason }),
  addReading: (id: string, value: string) => api.post<FleetVehicleDetailView>(`/fleet/vehicles/${id}/readings`, { value }),
  addDocument: (id: string, input: Record<string, unknown>) => api.post<FleetVehicleDetailView>(`/fleet/vehicles/${id}/documents`, input),
  assignments: (all = false) => api.get<FleetAssignmentView[]>(`/fleet/assignments${all ? "?all=true" : ""}`),
  assign: (input: Record<string, unknown>) => api.post<FleetAssignmentView>("/fleet/assignments", input),
  closeAssignment: (id: string, input: { endReading: string; note?: string }) => api.post<FleetAssignmentView>(`/fleet/assignments/${id}/close`, input),
  fuel: () => api.get<FleetFuelLogView[]>("/fleet/fuel"),
  recordFuel: (input: Record<string, unknown>) => api.post<FleetFuelLogView[]>("/fleet/fuel", input),
  projectCosts: () => api.get<FleetProjectCostView[]>("/fleet/project-costs"),
  incidents: (status = "OPEN") => api.get<FleetIncidentView[]>(`/fleet/incidents?status=${status}`),
  reportIncident: (input: Record<string, unknown>) => api.post<FleetIncidentView>("/fleet/incidents", input),
  closeIncident: (id: string, input: { note: string; cost?: string }) => api.post<FleetIncidentView>(`/fleet/incidents/${id}/close`, input),
};

export const VEHICLE_KIND_LABEL: Record<string, string> = { VEHICLE: "Véhicule routier", ENGINE: "Engin de chantier", MACHINE: "Machine / équipement" };
export const VEHICLE_STATUS_LABEL: Record<string, string> = { ACTIVE: "En service", IMMOBILIZED: "Immobilisé", DISPOSED: "Cédé" };
export const VEHICLE_STATUS_CHIP: Record<string, string> = { ACTIVE: "operational", IMMOBILIZED: "out_of_service", DISPOSED: "archived" };
export const DOCUMENT_KIND_LABEL: Record<string, string> = { INSURANCE: "Assurance", REGISTRATION: "Carte grise", INSPECTION: "Contrôle / VGP", PERMIT: "Autorisation", OTHER: "Autre" };
export const COMPLIANCE_LABEL: Record<string, string> = { VALID: "À jour", EXPIRING: "Échéance < 30 j", EXPIRED: "Échu", MISSING: "Absent" };
export const COMPLIANCE_CHIP: Record<string, string> = { VALID: "passed", EXPIRING: "warning", EXPIRED: "failed", MISSING: "failed" };
export const INCIDENT_KIND_LABEL: Record<string, string> = { ACCIDENT: "Accident", BREAKDOWN: "Panne", DAMAGE: "Dommage", THEFT: "Vol", FINE: "Amende" };
export const FUEL_LABEL: Record<string, string> = { DIESEL: "Gasoil", PETROL: "Essence", ELECTRIC: "Électrique", NONE: "Sans carburant" };

export function usageUnitLabel(unit: string): string {
  return unit === "KM" ? "km" : "h";
}
