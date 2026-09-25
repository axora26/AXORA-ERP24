import type { ProjectBudgetFigure } from "@axora24/contracts";
import type { PrismaService } from "../core/prisma.service.js";
import type { CompanyScope } from "../common/company-scope.service.js";

/**
 * Chaine budgetaire aval du projet (engage, consomme, facture, paye).
 *
 * Chaque figure provient d'evenements sources reels d'autres modules
 * (commandes, sorties de stock et temps, factures, paiements). Tant qu'un
 * module source n'est pas livre, la figure est marquee `available: false`
 * — jamais un zero presente comme une mesure reelle.
 */
export async function projectCostFigures(
  _prisma: PrismaService,
  _scope: CompanyScope,
  _projectId: string,
): Promise<{ committed: ProjectBudgetFigure; consumed: ProjectBudgetFigure; invoiced: ProjectBudgetFigure; paid: ProjectBudgetFigure }> {
  return {
    committed: { amount: "0.00", available: false, source: "Achats — commandes fournisseurs (INC-06)" },
    consumed: { amount: "0.00", available: false, source: "Stock et temps passés (INC-07 / INC-09)" },
    invoiced: { amount: "0.00", available: false, source: "Finance — factures fournisseurs (INC-08)" },
    paid: { amount: "0.00", available: false, source: "Finance — paiements (INC-08)" },
  };
}
