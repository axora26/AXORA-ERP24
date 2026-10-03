import { CRM_PERMISSIONS, SALES_PERMISSIONS } from "@axora24/contracts";
import { amountsByCurrency, countKpi, moneyKpi, type DashboardSection } from "../section.js";

export const crmSection: DashboardSection = {
  key: "crm",
  permission: CRM_PERMISSIONS.OPPORTUNITY_READ,
  async build(prisma, scope) {
    const [openByCurrency, openCount, wonCount] = await Promise.all([
      prisma.crmOpportunity.groupBy({
        by: ["currency"],
        where: { ...scope, status: "OPEN" },
        _sum: { amount: true },
      }),
      prisma.crmOpportunity.count({ where: { ...scope, status: "OPEN" } }),
      prisma.crmOpportunity.count({ where: { ...scope, status: "WON" } }),
    ]);
    return [
      moneyKpi({
        key: "crm.pipeline",
        label: "Pipeline commercial ouvert",
        href: "/crm",
        tone: "blue",
        amounts: amountsByCurrency(openByCurrency, "amount"),
        detail: `${openCount} opportunité(s) ouverte(s) · ${wonCount} gagnée(s)`,
      }),
    ];
  },
};

export const salesSection: DashboardSection = {
  key: "sales",
  permission: SALES_PERMISSIONS.CONTRACT_READ,
  async build(prisma, scope) {
    const [contractsByCurrency, activeContracts] = await Promise.all([
      prisma.contract.groupBy({
        by: ["currency"],
        where: { ...scope, status: "ACTIVE" },
        _sum: { subtotal: true },
      }),
      prisma.contract.count({ where: { ...scope, status: "ACTIVE" } }),
    ]);
    return [
      moneyKpi({
        key: "sales.contracts",
        label: "Carnet de commandes (contrats actifs)",
        href: "/sales",
        tone: "green",
        amounts: amountsByCurrency(contractsByCurrency, "subtotal"),
        detail: `${activeContracts} contrat(s) actif(s)`,
      }),
    ];
  },
};

export const quotesSection: DashboardSection = {
  key: "quotes",
  permission: SALES_PERMISSIONS.QUOTE_READ,
  async build(prisma, scope) {
    const pendingQuotes = await prisma.quote.count({ where: { ...scope, status: "SUBMITTED" } });
    return [
      countKpi({
        key: "sales.pendingQuotes",
        label: "Devis en attente de réponse",
        href: "/sales",
        tone: "amber",
        value: String(pendingQuotes),
        detail: "Soumis au client, ni acceptés ni rejetés",
      }),
    ];
  },
};
