import type { DashboardKpi, MoneyAmount } from "@axora24/contracts";
import { Prisma } from "@axora24/database";
import type { PrismaService } from "../core/prisma.service.js";
import type { CompanyScope } from "../common/company-scope.service.js";

/**
 * Section de la vue d'ensemble fournie par un module. Elle n'est calculee
 * QUE si l'utilisateur possede la permission de lecture du module : un
 * indicateur ne doit jamais contourner le RBAC du module qu'il resume.
 */
export interface DashboardSection {
  key: string;
  permission: string;
  build(prisma: PrismaService, scope: CompanyScope): Promise<DashboardKpi[]>;
}

/** Regroupe des montants par devise (jamais additionnes entre devises). */
export function amountsByCurrency(
  rows: Array<{ currency: string; _sum: { [field: string]: Prisma.Decimal | null } }>,
  field: string,
): MoneyAmount[] {
  return rows
    .map((row) => ({
      currency: row.currency.trim(),
      amount: new Prisma.Decimal(row._sum[field] ?? 0).toFixed(2),
    }))
    .sort((left, right) => left.currency.localeCompare(right.currency));
}

export function countKpi(input: Omit<DashboardKpi, "kind" | "amounts">): DashboardKpi {
  return { ...input, kind: "count", amounts: [] };
}

export function moneyKpi(input: Omit<DashboardKpi, "kind" | "value">): DashboardKpi {
  return { ...input, kind: "money", value: "" };
}
