/**
 * Contrats CRM partages api <-> web (INC-02).
 * Aucune logique metier ici — uniquement la forme des donnees echangees.
 *
 * NOTE MONTANTS : `amount` est transporte en CHAINE decimale, jamais en
 * number. Un montant commercial ne doit jamais transiter par un flottant
 * IEEE-754 (invariant schema.prisma : Decimal(18,2)).
 */

export type CrmLeadStatus = "NEW" | "CONTACTED" | "QUALIFIED" | "CONVERTED" | "DISQUALIFIED";

export type CrmOpportunityStatus = "OPEN" | "WON" | "LOST";

export type CrmActivityType =
  | "NOTE"
  | "CALL"
  | "MEETING"
  | "EMAIL"
  | "TASK"
  | "STAGE_CHANGE"
  | "CONVERSION";

export type CrmRelatedType = "Lead" | "Opportunity" | "Account" | "Contact";

export interface CrmAccountView {
  id: string;
  companyId: string;
  name: string;
  industry: string | null;
  city: string | null;
  country: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  archivedAt: string | null;
  version: number;
  updatedAt: string;
  createdAt: string;
}

export interface CrmContactView {
  id: string;
  companyId: string;
  accountId: string | null;
  fullName: string;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  isPrimary: boolean;
  archivedAt: string | null;
  version: number;
  updatedAt: string;
  createdAt: string;
}

/** Explicit paged routes preserve the existing array list contracts. */
export interface CrmPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface CrmPageQuery {
  companyId?: string;
  q?: string;
  page?: number | string;
  pageSize?: number | string;
}

export interface CrmDirectoryQuery extends CrmPageQuery {
  archived?: "false" | "true" | "all";
  accountId?: string;
}

export interface CrmActivityQuery extends CrmPageQuery {
  relatedType?: CrmRelatedType;
  relatedId?: string;
  type?: CrmActivityType;
}

export interface CrmVersionInput {
  companyId?: string;
  expectedVersion: number;
}

export interface CrmAccountInput {
  companyId?: string;
  name: string;
  industry?: string | null;
  city?: string | null;
  country?: string | null;
  website?: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface CrmContactInput {
  companyId?: string;
  accountId?: string | null;
  fullName: string;
  email?: string | null;
  phone?: string | null;
  jobTitle?: string | null;
  isPrimary?: boolean;
}

export type CrmAccountUpdateInput = Partial<CrmAccountInput> & CrmVersionInput;
export type CrmContactUpdateInput = Partial<CrmContactInput> & CrmVersionInput;

export interface CrmLeadView {
  id: string;
  companyId: string;
  contactName: string;
  companyName: string;
  email: string | null;
  phone: string | null;
  source: string | null;
  status: CrmLeadStatus;
  accountId: string | null;
  convertedAt: string | null;
  createdAt: string;
}

export interface CrmPipelineStageView {
  id: string;
  companyId: string;
  name: string;
  position: number;
  probability: number;
  isWon: boolean;
  isLost: boolean;
}

export interface CrmOpportunityView {
  id: string;
  companyId: string;
  name: string;
  /** Decimal exact serialise en chaine — jamais un number. */
  amount: string;
  currency: string;
  status: CrmOpportunityStatus;
  stageId: string;
  stageName: string;
  accountId: string | null;
  accountName: string | null;
  contactId: string | null;
  sourceLeadId: string | null;
  expectedCloseDate: string | null;
  closedAt: string | null;
  createdAt: string;
}

export interface CrmActivityView {
  id: string;
  companyId: string;
  type: CrmActivityType;
  subject: string;
  body: string | null;
  relatedType: string;
  relatedId: string;
  actorUserId: string | null;
  occurredAt: string;
}

/** Agregats calcules cote serveur a partir des donnees reelles du tenant. */
export interface CrmDashboardView {
  companyId: string;
  leads: { available: boolean; total: number | null; open: number | null; converted: number | null };
  opportunities: { total: number; open: number; won: number; lost: number };
  /** Somme decimale exacte, serialisee en chaine. */
  pipelineValue: string | null;
  wonValue: string | null;
  /** Valeur ponderee par la probabilite de l'etape (arrondie au centime). */
  weightedPipelineValue: string | null;
  /** Financial totals are never summed across currencies. */
  currencyBreakdown: CrmCurrencySummary[];
  currency: string;
  stages: Array<{
    stageId: string;
    stageName: string;
    position: number;
    probability: number;
    opportunityCount: number;
    value: string | null;
  }>;
}

export interface CrmCurrencySummary {
  currency: string;
  pipelineValue: string;
  wonValue: string;
  weightedPipelineValue: string;
  stages: Array<{
    stageId: string;
    stageName: string;
    position: number;
    probability: number;
    opportunityCount: number;
    value: string;
  }>;
}
