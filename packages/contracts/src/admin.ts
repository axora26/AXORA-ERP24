/** INC-01 — Administration : utilisateurs, roles, entreprises, journal d'audit. */

export interface NamedRef {
  id: string;
  name: string;
}

export interface AdminUserView {
  id: string;
  email: string;
  fullName: string;
  isActive: boolean;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  roles: NamedRef[];
  companies: NamedRef[];
}

export interface AdminRoleView {
  id: string;
  name: string;
  isSystem: boolean;
  permissions: string[];
  memberCount: number;
  createdAt: string;
}

export interface AdminCompanyView {
  id: string;
  name: string;
  legalName: string | null;
  currency: string;
  memberCount: number;
  createdAt: string;
}

export interface AuditLogView {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string;
  actorName: string | null;
  actorEmail: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface AuditLogPage {
  items: AuditLogView[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PermissionEntryView {
  key: string;
  label: string;
}

export interface PermissionGroupView {
  module: string;
  label: string;
  permissions: PermissionEntryView[];
}
