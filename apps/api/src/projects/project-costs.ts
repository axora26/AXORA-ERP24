import type { ProjectBudgetFigure } from "@axora24/contracts";
import { Prisma } from "@axora24/database";
import type { PrismaService } from "../core/prisma.service.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import { money } from "../common/decimal.js";

/** Statuts de commande qui engagent le budget (emise, en reception, recue). */
export const COMMITTING_ORDER_STATUSES = ["ISSUED", "PARTIALLY_RECEIVED", "RECEIVED"] as const;

/**
 * Chaine budgetaire aval du projet (engage, consomme, facture, paye).
 *
 * Chaque figure provient d'evenements sources reels d'autres modules. Tant
 * qu'un module source n'est pas livre, la figure est marquee
 * `available: false` — jamais un zero presente comme une mesure reelle.
 */
export async function projectCostFigures(
  prisma: PrismaService,
  scope: CompanyScope,
  projectId: string,
): Promise<{ committed: ProjectBudgetFigure; consumed: ProjectBudgetFigure; invoiced: ProjectBudgetFigure; paid: ProjectBudgetFigure }> {
  const rows = await prisma.$queryRaw<Array<{ committed: Prisma.Decimal | null; received: Prisma.Decimal | null }>>`
    SELECT
      COALESCE(SUM(l."lineTotal"), 0) AS "committed",
      COALESCE(SUM(ROUND(l."receivedQuantity" * l."unitPrice", 2)), 0) AS "received"
    FROM "purchase_order_lines" l
    JOIN "purchase_orders" o ON o."id" = l."orderId"
    WHERE l."projectId" = ${projectId}
      AND o."organizationId" = ${scope.organizationId}
      AND o."companyId" = ${scope.companyId}
      AND o."status"::text IN ('ISSUED', 'PARTIALLY_RECEIVED', 'RECEIVED')
  `;
  const totals = rows[0];
  return {
    committed: {
      amount: money(totals?.committed ?? 0),
      available: true,
      source: "Commandes fournisseurs émises (Achats)",
    },
    consumed: {
      amount: money(totals?.received ?? 0),
      available: true,
      source: "Réceptions de commandes affectées au projet (Achats)",
    },
    invoiced: { amount: "0.00", available: false, source: "Finance — factures fournisseurs (INC-08)" },
    paid: { amount: "0.00", available: false, source: "Finance — paiements (INC-08)" },
  };
}
