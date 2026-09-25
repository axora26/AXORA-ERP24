import type { PortalGrantCandidate, PortalInvitationIssued, PortalPrincipalView } from "@axora24/contracts";
import { api } from "../api";

export const portalAdminApi = {
  principals: () => api.get<PortalPrincipalView[]>("/portal-admin/principals"),
  principal: (id: string) => api.get<PortalPrincipalView>(`/portal-admin/principals/${id}`),
  create: (input: Record<string, unknown>) => api.post<PortalInvitationIssued>("/portal-admin/principals", input),
  reinvite: (id: string) => api.post<PortalInvitationIssued>(`/portal-admin/principals/${id}/invitations`),
  setStatus: (id: string, status: string, reason: string) => api.post<PortalPrincipalView>(`/portal-admin/principals/${id}/status`, { status, reason }),
  candidates: (id: string) => api.get<PortalGrantCandidate[]>(`/portal-admin/principals/${id}/candidates`),
  grant: (id: string, resourceType: string, resourceId: string) => api.post<PortalPrincipalView>(`/portal-admin/principals/${id}/grants`, { resourceType, resourceId }),
  revoke: (grantId: string) => api.post<PortalPrincipalView>(`/portal-admin/grants/${grantId}/revoke`),
};

export const PRINCIPAL_STATUS_LABEL: Record<string, string> = { INVITED: "Invité", ACTIVE: "Actif", SUSPENDED: "Suspendu", REVOKED: "Révoqué" };
export const PRINCIPAL_STATUS_CHIP: Record<string, string> = { INVITED: "pending", ACTIVE: "active", SUSPENDED: "blocked", REVOKED: "archived" };
export const RESOURCE_LABEL: Record<string, string> = { PROJECT: "Projet", CUSTOMER_INVOICE: "Facture client", DOCUMENT: "Document (GED)", PURCHASE_ORDER: "Commande", SUPPLIER_INVOICE: "Facture fournisseur" };
