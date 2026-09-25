"use client";

import { createContext, useContext } from "react";

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  organizationId: string;
}

export interface SessionContextValue {
  user: SessionUser;
  organization: { id: string; name: string; slug: string; isDemo: boolean } | null;
  companies: Array<{ id: string; name: string; currency: string }>;
  activeCompanyId: string | null;
  roles: string[];
  permissions: string[];
}

export interface SessionApi extends SessionContextValue {
  /** Indication d'interface uniquement : le serveur reste seul juge (deny-by-default). */
  can: (permission: string) => boolean;
  switchCompany: (companyId: string) => void;
  logout: () => Promise<void>;
}

export const SessionContext = createContext<SessionApi | null>(null);

export function useSession(): SessionApi {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside the application shell");
  return value;
}
