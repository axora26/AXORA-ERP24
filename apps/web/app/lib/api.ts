import type {
  CrmActivityView,
  CrmDashboardView,
  CrmLeadView,
  CrmOpportunityView,
  CrmPipelineStageView,
} from "@axora24/contracts";

/**
 * Client HTTP de l'API AXORA-ERP24.
 *
 * INVARIANTS :
 * - `credentials: "include"` systematique : la session est un cookie opaque
 *   httpOnly, jamais un token lu ou stocke par le JavaScript de la page.
 * - Aucun identifiant de tenant n'est envoye depuis le client : le serveur
 *   resout organisation et entreprise depuis la session.
 * - Les montants restent des chaines decimales de bout en bout.
 */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError(0, "L'API AXORA est momentanement injoignable.");
  }

  if (!response.ok) {
    // Le message serveur est affiche tel quel : il est deja redige pour
    // l'utilisateur et ne contient aucun secret (docs/foundation/03-security.md).
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new ApiError(response.status, body?.message ?? `Erreur ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export const api = {
  get: <T>(path: string) => call<T>(path),
  post: <T>(path: string, body: unknown) =>
    call<T>(path, { method: "POST", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    call<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
};

export const crmApi = {
  dashboard: () => api.get<CrmDashboardView>("/crm/dashboard"),
  stages: () => api.get<CrmPipelineStageView[]>("/crm/pipeline/stages"),
  leads: () => api.get<CrmLeadView[]>("/crm/leads"),
  opportunities: () => api.get<CrmOpportunityView[]>("/crm/opportunities"),
  activities: () => api.get<CrmActivityView[]>("/crm/activities"),
  createLead: (input: {
    contactName: string;
    companyName: string;
    email?: string;
    phone?: string;
    source?: string;
  }) => api.post<CrmLeadView>("/crm/leads", input),
  convertLead: (leadId: string, input: { amount: string; opportunityName?: string }) =>
    api.post<CrmOpportunityView>(`/crm/leads/${leadId}/convert`, input),
  moveOpportunity: (opportunityId: string, stageId: string) =>
    api.patch<CrmOpportunityView>(`/crm/opportunities/${opportunityId}/stage`, { stageId }),
};

/**
 * Formate un montant decimal transmis en chaine.
 * La conversion en nombre n'intervient QUE pour l'affichage final, jamais
 * pour un calcul : tous les totaux sont calcules par le serveur en Decimal.
 */
export function formatAmount(amount: string, currency: string): string {
  const value = Number(amount);
  const formatted = Number.isFinite(value)
    ? new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
        value,
      )
    : amount;
  return currency === "MIXED" ? `${formatted} (devises mixtes)` : `${formatted} ${currency}`;
}
