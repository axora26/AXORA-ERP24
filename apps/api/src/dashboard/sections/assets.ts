import { ASSETS_PERMISSIONS } from "@axora24/contracts";
import { countKpi, type DashboardSection } from "../section.js";

export const assetsSection: DashboardSection = {
  key: "assets",
  permission: ASSETS_PERMISSIONS.ASSET_READ,
  async build(prisma, scope) {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const [open, overdue, tickets, outOfService] = await Promise.all([
      prisma.workOrder.count({ where: { ...scope, status: { in: ["OPEN", "IN_PROGRESS"] } } }),
      prisma.workOrder.count({ where: { ...scope, status: { in: ["OPEN", "IN_PROGRESS"] }, dueDate: { lt: today } } }),
      prisma.maintenanceTicket.count({ where: { ...scope, status: "OPEN" } }),
      prisma.asset.count({ where: { ...scope, status: "OUT_OF_SERVICE" } }),
    ]);
    return [
      countKpi({
        key: "assets.workorders",
        label: "Ordres de travail ouverts",
        href: "/assets",
        tone: overdue > 0 || outOfService > 0 ? "red" : open > 0 || tickets > 0 ? "amber" : "green",
        value: String(open),
        detail: `${overdue} en retard · ${tickets} ticket(s) à qualifier · ${outOfService} actif(s) à l'arrêt`,
      }),
    ];
  },
};
