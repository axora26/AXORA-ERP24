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
): Promise<{
  committed: ProjectBudgetFigure;
  consumed: ProjectBudgetFigure;
  invoiced: ProjectBudgetFigure;
  paid: ProjectBudgetFigure;
  billed: ProjectBudgetFigure;
  collected: ProjectBudgetFigure;
}> {
  const rows = await prisma.$queryRaw<Array<{ committed: Prisma.Decimal | null; received: Prisma.Decimal | null }>>`
    SELECT
      COALESCE(SUM(l."lineTotal"), 0) AS "committed",
      COALESCE(SUM(CASE WHEN l."inventoryItemId" IS NULL THEN ROUND(l."receivedQuantity" * l."unitPrice", 2) ELSE 0 END), 0) AS "received"
    FROM "purchase_order_lines" l
    JOIN "purchase_orders" o ON o."id" = l."orderId"
    WHERE l."projectId" = ${projectId}
      AND o."organizationId" = ${scope.organizationId}
      AND o."companyId" = ${scope.companyId}
      AND o."status"::text IN ('ISSUED', 'PARTIALLY_RECEIVED', 'RECEIVED')
  `;
  const stock = await prisma.$queryRaw<Array<{ consumed: Prisma.Decimal | null }>>`
    SELECT COALESCE(-SUM("valueDelta"), 0) AS "consumed"
    FROM "stock_movements"
    WHERE "projectId" = ${projectId}
      AND "organizationId" = ${scope.organizationId}
      AND "companyId" = ${scope.companyId}
      AND "type"::text IN ('ISSUE', 'RETURN')
  `;
  // Main d'oeuvre : uniquement les heures VALIDEES, valorisees au cout fige a la validation.
  const labor = await prisma.timesheetEntry.aggregate({
    where: { ...scope, projectId, timesheet: { status: "VALIDATED" } },
    _sum: { costAmount: true },
  });
  // Factures fournisseurs approuvees du projet : facture HT, et paye ramene au HT
  // (paye x HT / TTC) pour rester comparable au budget de couts (HT).
  const payables = await prisma.supplierInvoice.findMany({
    where: { ...scope, projectId, status: { in: ["APPROVED", "PARTIALLY_PAID", "PAID"] } },
    select: { subtotal: true, total: true, paidAmount: true },
  });
  let invoiced = new Prisma.Decimal(0);
  let paid = new Prisma.Decimal(0);
  for (const invoice of payables) {
    invoiced = invoiced.plus(invoice.subtotal);
    const total = new Prisma.Decimal(invoice.total);
    if (!total.isZero()) paid = paid.plus(new Prisma.Decimal(invoice.paidAmount).mul(invoice.subtotal).div(total).toDecimalPlaces(2));
  }
  const receivables = await prisma.customerInvoice.aggregate({
    where: { ...scope, projectId, status: { in: ["ISSUED", "PARTIALLY_PAID", "PAID"] } },
    _sum: { total: true, paidAmount: true },
  });
  // Sous-traitance : situations certifiees (brut HT, retenue comprise) — la commande support n'est jamais receptionnee.
  const subcontracted = await prisma.subcontractStatement.aggregate({
    where: { ...scope, status: "APPROVED", package: { projectId } },
    _sum: { grossAmount: true },
  });
  const totals = rows[0];
  const consumed = new Prisma.Decimal(totals?.received ?? 0)
    .plus(new Prisma.Decimal(stock[0]?.consumed ?? 0))
    .plus(new Prisma.Decimal(labor._sum.costAmount ?? 0))
    .plus(new Prisma.Decimal(subcontracted._sum.grossAmount ?? 0));
  return {
    committed: {
      amount: money(totals?.committed ?? 0),
      available: true,
      source: "Commandes fournisseurs émises (Achats)",
    },
    consumed: {
      amount: money(consumed),
      available: true,
      source: "Réceptions directes chantier (Achats) + sorties de stock nettes des retours (Stock) + temps passés validés (RH) + situations de sous-traitance certifiées",
    },
    invoiced: { amount: money(invoiced), available: true, source: "Factures fournisseurs approuvées (HT)" },
    paid: { amount: money(paid), available: true, source: "Paiements fournisseurs, ramenés au HT" },
    billed: { amount: money(receivables._sum.total ?? 0), available: true, source: "Factures clients émises (TTC)" },
    collected: { amount: money(receivables._sum.paidAmount ?? 0), available: true, source: "Encaissements clients" },
  };
}
