import type { CrmAccountInput, CrmAccountUpdateInput, CrmAccountView, CrmContactInput, CrmContactUpdateInput, CrmContactView, CrmPage, CrmActivityView, CrmRelatedType, CrmLeadStatus, CrmOpportunityView } from "@axora24/contracts";
import { api } from "../api";

export const crmDirectoryApi = {
  accounts: () => api.get<CrmAccountView[]>("/crm/accounts"),
  contacts: () => api.get<CrmContactView[]>("/crm/contacts"),
  accountPage: (query: string) => api.get<CrmPage<CrmAccountView>>(`/crm/accounts/page?${query}`),
  contactPage: (query: string) => api.get<CrmPage<CrmContactView>>(`/crm/contacts/page?${query}`),
  createAccount: (input: CrmAccountInput) => api.post<CrmAccountView>("/crm/accounts", input),
  updateAccount: (id: string, input: CrmAccountUpdateInput) => api.patch<CrmAccountView>(`/crm/accounts/${id}`, input),
  archiveAccount: (id: string, version: number, restore: boolean) => api.post<CrmAccountView>(`/crm/accounts/${id}/${restore ? "restore" : "archive"}`, { expectedVersion: version }),
  createContact: (input: CrmContactInput) => api.post<CrmContactView>("/crm/contacts", input),
  updateContact: (id: string, input: CrmContactUpdateInput) => api.patch<CrmContactView>(`/crm/contacts/${id}`, input),
  archiveContact: (id: string, version: number, restore: boolean) => api.post<CrmContactView>(`/crm/contacts/${id}/${restore ? "restore" : "archive"}`, { expectedVersion: version }),
  activityPage: (query: string) => api.get<CrmPage<CrmActivityView>>(`/crm/activities/page?${query}`),
  createActivity: (input: { type: "NOTE" | "CALL" | "MEETING" | "EMAIL" | "TASK"; subject: string; body?: string; relatedType: CrmRelatedType; relatedId: string }) => api.post<CrmActivityView>("/crm/activities", input),
  leadStatus: (id: string, status: CrmLeadStatus) => api.patch(`/crm/leads/${id}/status`, { status }),
  convert: (id: string, input: { opportunityName?: string; amount: string; currency: string; stageId?: string; expectedCloseDate?: string; accountId?: string; contactId?: string }) => api.post<CrmOpportunityView>(`/crm/leads/${id}/convert`, input),
};
