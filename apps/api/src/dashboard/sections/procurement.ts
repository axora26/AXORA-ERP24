import { PROCUREMENT_PERMISSIONS } from "@axora24/contracts";
import { amountsByCurrency, countKpi, moneyKpi, type DashboardSection } from "../section.js";

export const procurementSection: DashboardSection = {
  key: "procurement",
  permission: PROCUREMENT_PERMISSIONS.ORDER_READ,
  async build(prisma, scope) {
    const [openByCurrency, openCount] = await Promise.all([
      prisma.purchaseOrder.groupBy({
        by: ["currency"],
        where: { ...scope, status: { in: ["ISSUED", "PARTIALLY_RECEIVED"] } },
        _sum: { total: true },
      }),
      prisma.purchaseOrder.count({ where: { ...scope, status: { in: ["ISSUED", "PARTIALLY_RECEIVED"] } } }),
    ]);
    return [
      moneyKpi({
        key: "procurement.openOrders",
        label: "Commandes fournisseurs en cours",
        href: "/procurement",
        tone: "amber",
        amounts: amountsByCurrency(openByCurrency, "total"),
        detail: `${openCount} commande(s) émise(s) non soldée(s)`,
      }),
    ];
  },
};

export const procurementRequestsSection: DashboardSection = {
  key: "procurementRequests",
  permission: PROCUREMENT_PERMISSIONS.REQUEST_READ,
  async build(prisma, scope) {
    const pendingRequests = await prisma.purchaseRequest.count({ where: { ...scope, status: "SUBMITTED" } });
    return [
      countKpi({
        key: "procurement.pendingRequests",
        label: "Demandes d'achat à valider",
        href: "/procurement",
        tone: "violet",
        value: String(pendingRequests),
        detail: "Soumises, en attente d'approbation",
      }),
    ];
  },
};
