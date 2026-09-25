/** Vue d'ensemble (Command Center) — agregats REELS du tenant, jamais fictifs. */

export type DashboardTone = "blue" | "green" | "amber" | "violet" | "red";

export interface MoneyAmount {
  currency: string;
  /** Decimal exact, deux decimales. */
  amount: string;
}

export interface DashboardKpi {
  key: string;
  label: string;
  /** Module de rattachement (lien de navigation de l'interface). */
  href: string;
  tone: DashboardTone;
  kind: "count" | "money" | "percent";
  /** Valeur pour `count` et `percent`. */
  value: string;
  /** Montants par devise pour `money` (jamais additionnes entre devises). */
  amounts: MoneyAmount[];
  detail: string;
}

export interface DashboardActivity {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string;
  actorName: string | null;
  createdAt: string;
}

export interface DashboardOverview {
  generatedAt: string;
  kpis: DashboardKpi[];
  /** null si l'utilisateur n'a pas la permission core.audit.read. */
  activity: DashboardActivity[] | null;
}
