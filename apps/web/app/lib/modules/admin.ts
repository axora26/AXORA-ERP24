import type {
  AdminCompanyView,
  AdminRoleView,
  AdminUserView,
  AuditLogPage,
  PermissionGroupView,
} from "@axora24/contracts";
import { api } from "../api";

export const adminApi = {
  permissions: () => api.get<PermissionGroupView[]>("/admin/permissions"),
  users: () => api.get<AdminUserView[]>("/admin/users"),
  createUser: (input: { email: string; fullName: string; password: string; roleIds: string[]; companyIds: string[] }) =>
    api.post<AdminUserView>("/admin/users", input),
  updateUser: (
    id: string,
    input: Partial<{ fullName: string; isActive: boolean; roleIds: string[]; companyIds: string[] }>,
  ) => api.patch<AdminUserView>(`/admin/users/${id}`, input),
  roles: () => api.get<AdminRoleView[]>("/admin/roles"),
  createRole: (input: { name: string; permissions: string[] }) => api.post<AdminRoleView>("/admin/roles", input),
  setRolePermissions: (id: string, permissions: string[]) =>
    api.put<AdminRoleView>(`/admin/roles/${id}/permissions`, { permissions }),
  deleteRole: (id: string) => api.delete<{ success: true }>(`/admin/roles/${id}`),
  companies: () => api.get<AdminCompanyView[]>("/admin/companies"),
  createCompany: (input: { name: string; legalName?: string }) => api.post<AdminCompanyView>("/admin/companies", input),
  audit: (params: Record<string, string>) => {
    const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== "")).toString();
    return api.get<AuditLogPage>(`/admin/audit${query ? `?${query}` : ""}`);
  },
};

export const accountApi = {
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post<{ success: true }>("/auth/password", { currentPassword, newPassword }),
  mfaStatus: () => api.get<{ enabled: boolean; pendingSetup: boolean; available: boolean }>("/auth/mfa"),
  startMfaSetup: () => api.post<{ secret: string; otpauthUri: string }>("/auth/mfa/setup"),
  enableMfa: (code: string) => api.post<{ enabled: boolean }>("/auth/mfa/enable", { code }),
  disableMfa: (password: string, code: string) =>
    api.post<{ enabled: boolean }>("/auth/mfa/disable", { password, code }),
};
