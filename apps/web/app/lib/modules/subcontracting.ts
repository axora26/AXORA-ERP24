import type { SubcontractPackageView, SubcontractRetentionView, SubcontractStatementView, SubcontractingSummaryView, SubcontractorView } from "@axora24/contracts";
import { api } from "../api";

export const subcontractingApi = {
  summary: () => api.get<SubcontractingSummaryView>("/subcontracting/summary"),
  subcontractors: () => api.get<SubcontractorView[]>("/subcontracting/subcontractors"),
  subcontractor: (id: string) => api.get<SubcontractorView>(`/subcontracting/subcontractors/${id}`),
  createSubcontractor: (input: Record<string, unknown>) => api.post<SubcontractorView>("/subcontracting/subcontractors", input),
  addDocument: (id: string, input: Record<string, unknown>) => api.post<SubcontractorView>(`/subcontracting/subcontractors/${id}/documents`, input),
  decide: (id: string, decision: string, note: string) => api.post<SubcontractorView>(`/subcontracting/subcontractors/${id}/decision`, { decision, note }),
  packages: () => api.get<SubcontractPackageView[]>("/subcontracting/packages"),
  package: (id: string) => api.get<SubcontractPackageView>(`/subcontracting/packages/${id}`),
  createPackage: (input: Record<string, unknown>) => api.post<SubcontractPackageView>("/subcontracting/packages", input),
  closePackage: (id: string, status: string, note: string) => api.post<SubcontractPackageView>(`/subcontracting/packages/${id}/close`, { status, note }),
  prepareStatement: (packageId: string, periodEnd: string) => api.post<SubcontractStatementView>(`/subcontracting/packages/${packageId}/statements`, { periodEnd }),
  statements: () => api.get<SubcontractStatementView[]>("/subcontracting/statements"),
  decideStatement: (id: string, decision: string, note?: string) => api.post<SubcontractStatementView>(`/subcontracting/statements/${id}/decision`, { decision, note }),
  invoiceStatement: (id: string, input: Record<string, unknown>) => api.post<SubcontractStatementView>(`/subcontracting/statements/${id}/invoice`, input),
  retentions: () => api.get<SubcontractRetentionView[]>("/subcontracting/retentions"),
  releaseRetention: (id: string, input: Record<string, unknown>) => api.post<SubcontractRetentionView>(`/subcontracting/retentions/${id}/release`, input),
};

export const SUBCONTRACTOR_STATUS_LABEL: Record<string, string> = { PENDING: "À qualifier", QUALIFIED: "Qualifié", SUSPENDED: "Suspendu" };
export const SUBCONTRACTOR_STATUS_CHIP: Record<string, string> = { PENDING: "pending", QUALIFIED: "verified", SUSPENDED: "blocked" };
export const SUB_DOCUMENT_LABEL: Record<string, string> = {
  RCCM: "RCCM",
  TAX_CERTIFICATE: "Attestation fiscale",
  SOCIAL_CERTIFICATE: "Attestation sociale (CNSS)",
  LIABILITY_INSURANCE: "Assurance RC",
  DECENNIAL_INSURANCE: "Assurance décennale",
  OTHER: "Autre",
};
export const STATEMENT_STATUS_LABEL: Record<string, string> = { DRAFT: "À approuver", APPROVED: "Approuvée", REJECTED: "Rejetée" };
export const STATEMENT_STATUS_CHIP: Record<string, string> = { DRAFT: "pending", APPROVED: "verified", REJECTED: "rejected" };
export const PACKAGE_STATUS_LABEL: Record<string, string> = { ACTIVE: "En cours", COMPLETED: "Terminé", TERMINATED: "Résilié" };
