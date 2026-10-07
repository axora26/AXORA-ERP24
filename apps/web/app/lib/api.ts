import type {
  ContractSummaryView,
  ContractView,
  CrmActivityView,
  CrmDashboardView,
  CrmLeadView,
  CrmOpportunityView,
  CrmPipelineStageView,
  DqeLineView,
  DqeSummaryView,
  DqeView,
  EstimationRequirementView,
  EstimationStudySummaryView,
  EstimationStudyView,
  QuoteSummaryView,
  QuoteView,
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
/**
 * Par defaut, l'interface appelle l'API sur la MEME origine (`/api/v1`),
 * relayee vers le serveur NestJS par la reecriture de next.config.js : le
 * cookie de session reste first-party et une seule URL suffit pour ouvrir
 * l'application (local, conteneur ou tunnel).
 */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "/api/v1";

export class StepUpCancelledError extends Error {
  constructor() {
    super("Vérification MFA annulée");
    this.name = "StepUpCancelledError";
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type MfaStepUpHandler = () => Promise<boolean>;
let mfaStepUpHandler: MfaStepUpHandler | null = null;

/** Enregistré par le shell authentifié ; aucun code MFA n'est stocké ici. */
export function setMfaStepUpHandler(handler: MfaStepUpHandler | null): void {
  mfaStepUpHandler = handler;
}

/**
 * Entreprise active choisie dans le shell (utilisateur multi-entreprises).
 * Ce n'est qu'une PREFERENCE d'affichage : le serveur revalide toujours cet
 * identifiant contre les appartenances de la session (CompanyScopeService).
 */
let activeCompanyId: string | null = null;

export function setActiveCompanyId(companyId: string | null): void {
  activeCompanyId = companyId;
}

function withCompany(path: string): string {
  if (!isCompanyScoped(path) || !activeCompanyId || /[?&]companyId=/.test(path)) return path;
  return `${path}${path.includes("?") ? "&" : "?"}companyId=${encodeURIComponent(activeCompanyId)}`;
}

/** URL d'un contenu servi par l'API (fichier, photo) dans l'entreprise active. */
export function assetUrl(url: string): string {
  if (!activeCompanyId || /[?&]companyId=/.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}companyId=${encodeURIComponent(activeCompanyId)}`;
}

function isCompanyScoped(path: string): boolean {
  return !path.startsWith("/auth/") && !path.startsWith("/admin/") && !path.startsWith("/organizations/");
}

function bodyWithCompany(path: string, body: unknown): unknown {
  if (!isCompanyScoped(path) || !activeCompanyId || body === null || typeof body !== "object" || Array.isArray(body)) return body;
  return "companyId" in body ? body : { ...body, companyId: activeCompanyId };
}

async function call<T>(path: string, init?: RequestInit, retriedAfterStepUp = false): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${withCompany(path)}`, {
      ...init,
      credentials: "include",
      // FormData : le navigateur fixe lui-meme le Content-Type multipart (avec sa frontiere).
      headers: init?.body instanceof FormData ? { ...(init?.headers ?? {}) } : { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError(0, "L'API AXORA est momentanément injoignable (réseau indisponible ?).");
  }

  if (!response.ok) {
    // Le code machine distingue un step-up d'un refus RBAC ordinaire.
    const body = (await response.json().catch(() => null)) as { code?: string; message?: string | string[] } | null;
    const message = Array.isArray(body?.message) ? body.message.join(" · ") : body?.message;
    if (response.status === 403 && body?.code === "MFA_STEP_UP_REQUIRED" && mfaStepUpHandler && !retriedAfterStepUp) {
      const verified = await mfaStepUpHandler();
      if (verified) return call<T>(path, init, true);
      throw new StepUpCancelledError();
    }
    throw new ApiError(response.status, message ?? `Erreur ${response.status}`, body?.code);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const api = {
  downloadUrl: (path: string) => `${API_URL}${withCompany(path)}`,
  download: async (path: string): Promise<{ blob: Blob; filename: string | null }> => {
    let response: Response;
    try { response = await fetch(`${API_URL}${withCompany(path)}`, { credentials: "include" }); }
    catch { throw new ApiError(0, "Le téléchargement est momentanément indisponible. Réessayez."); }
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { message?: string | string[] } | null;
      throw new ApiError(response.status, Array.isArray(body?.message) ? body.message.join(" · ") : body?.message ?? "Le téléchargement a échoué.");
    }
    const disposition = response.headers.get("content-disposition") ?? "";
    const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
    let filename = /filename="?([^";]+)"?/i.exec(disposition)?.[1]?.trim() ?? null;
    if (encoded) { try { filename = decodeURIComponent(encoded); } catch { /* conserver le nom simple */ } }
    return { blob: await response.blob(), filename: filename ? Array.from(filename, character => character === "/" || character === "\\" || character.charCodeAt(0) < 32 ? "_" : character).join("") : null };
  },
  get: <T>(path: string) => call<T>(path),
  post: <T>(path: string, body: unknown = {}) =>
    call<T>(path, { method: "POST", body: JSON.stringify(bodyWithCompany(path, body)) }),
  patch: <T>(path: string, body: unknown = {}) =>
    call<T>(path, { method: "PATCH", body: JSON.stringify(bodyWithCompany(path, body)) }),
  put: <T>(path: string, body: unknown = {}) =>
    call<T>(path, { method: "PUT", body: JSON.stringify(bodyWithCompany(path, body)) }),
  delete: <T>(path: string, body?: unknown) => call<T>(path, { method: "DELETE", ...(body !== undefined ? { body: JSON.stringify(bodyWithCompany(path, body)) } : {}) }),
  upload: <T>(path: string, file: Blob, filename: string) => {
    const form = new FormData();
    form.append("file", file, filename);
    return call<T>(path, { method: "POST", body: form });
  },
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

export const estimationApi = {
  studies: () => api.get<EstimationStudySummaryView[]>("/estimation/studies"),
  study: (studyId: string) => api.get<EstimationStudyView>(`/estimation/studies/${studyId}`),
  createStudy: (input: {
    opportunityId: string;
    code: string;
    title: string;
    objective: string;
    sourceReference?: string;
  }) => api.post<EstimationStudyView>("/estimation/studies", input),
  addRequirement: (
    studyId: string,
    input: {
      position: number;
      category: string;
      statement: string;
      sourceReference?: string;
      expectedVersion?: number;
    },
  ) => api.post<EstimationRequirementView>(`/estimation/studies/${studyId}/requirements`, input),
  markStudyReady: (studyId: string, expectedVersion?: number) =>
    api.post<EstimationStudyView>(`/estimation/studies/${studyId}/ready`, { expectedVersion }),
  dqes: () => api.get<DqeSummaryView[]>("/estimation/dqes"),
  dqe: (dqeId: string) => api.get<DqeView>(`/estimation/dqes/${dqeId}`),
  createDqe: (input: { studyId: string; code: string; title: string; currency: string }) =>
    api.post<DqeView>("/estimation/dqes", input),
  addDqeLine: (
    dqeId: string,
    input: {
      position: number;
      reference?: string;
      designation: string;
      unitCode: string;
      costCategory?: string;
      quantity: string;
      unitPrice: string;
      expectedVersion?: number;
    },
  ) => api.post<DqeLineView>(`/estimation/dqes/${dqeId}/lines`, input),
  updateDqePricing: (dqeId: string, input: { expectedVersion: number; overheadRate?: string; marginRate?: string; taxRate?: string }) =>
    api.patch<DqeView>(`/estimation/dqes/${dqeId}/pricing`, input),
  dqeVariants: (dqeId: string) => api.get<import("@axora24/contracts").DqeVariantView[]>(`/estimation/dqes/${dqeId}/variants`),
  createDqeVariant: (dqeId: string, input: { code: string; title: string }) =>
    api.post<import("@axora24/contracts").DqeVariantView>(`/estimation/dqes/${dqeId}/variants`, input),
  dqeLibrary: () => api.get<import("@axora24/contracts").DqeLibraryItemView[]>("/estimation/library"),
  finalizeDqe: (dqeId: string, expectedVersion?: number) => api.post<DqeView>(`/estimation/dqes/${dqeId}/finalize`, { expectedVersion }),
};

export const salesApi = {
  quotes: () => api.get<QuoteSummaryView[]>("/sales/quotes"),
  quote: (quoteId: string) => api.get<QuoteView>(`/sales/quotes/${quoteId}`),
  createQuote: (input: { dqeId: string; code: string; title: string }) =>
    api.post<QuoteView>("/sales/quotes", input),
  submitQuote: (quoteId: string) => api.post<QuoteView>(`/sales/quotes/${quoteId}/submit`, {}),
  acceptQuote: (quoteId: string) => api.post<QuoteView>(`/sales/quotes/${quoteId}/accept`, {}),
  rejectQuote: (quoteId: string, reason: string) =>
    api.post<QuoteView>(`/sales/quotes/${quoteId}/reject`, { reason }),
  contracts: () => api.get<ContractSummaryView[]>("/sales/contracts"),
  contract: (contractId: string) => api.get<ContractView>(`/sales/contracts/${contractId}`),
  createContract: (input: { quoteId: string; code: string; title: string }) =>
    api.post<ContractView>("/sales/contracts", input),
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
