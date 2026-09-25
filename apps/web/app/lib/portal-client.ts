import type { PortalHomeView, PortalMeView } from "@axora24/contracts";

/**
 * Client HTTP du PORTAIL EXTERNE : n'utilise que les routes /portal/* et le
 * cookie portail (httpOnly). Aucun identifiant d'entreprise interne ni
 * aucune route interne n'est appelee d'ici.
 */
export class PortalError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/v1/portal${path}`, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!response.ok) throw new PortalError(response.status, Array.isArray(data?.message) ? data.message.join(", ") : (data?.message ?? response.statusText));
  return data as T;
}

export const portalClient = {
  activate: (token: string, password: string) => call<PortalMeView>("POST", "/auth/activate", { token, password }),
  login: (companyId: string, email: string, password: string) => call<PortalMeView>("POST", "/auth/login", { companyId, email, password }),
  logout: () => call<{ ok: boolean }>("POST", "/auth/logout"),
  home: () => call<PortalHomeView>("GET", "/home"),
  acknowledge: (orderId: string, confirmedDate: string, note?: string) => call<PortalHomeView>("POST", `/orders/${orderId}/acknowledge`, { confirmedDate, note }),
};
