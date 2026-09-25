import { QHSE_PERMISSIONS } from "@axora24/contracts";
import { countKpi, type DashboardSection } from "../section.js";

export const qhseSection: DashboardSection = {
  key: "qhse",
  permission: QHSE_PERMISSIONS.READ,
  async build(prisma, scope) {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const since30 = new Date(Date.now() - 30 * 86_400_000);
    const [open, overdue, incidents] = await Promise.all([
      prisma.qhseFinding.count({ where: { ...scope, status: { not: "CLOSED" } } }),
      prisma.qhseCorrectiveAction.count({ where: { ...scope, status: "OPEN", dueDate: { lt: today } } }),
      prisma.safetyIncident.count({ where: { ...scope, occurredAt: { gte: since30 } } }),
    ]);
    return [
      countKpi({
        key: "qhse.findings",
        label: "Non-conformités ouvertes",
        href: "/qhse",
        tone: overdue > 0 ? "red" : open > 0 ? "amber" : "green",
        value: String(open),
        detail: `${overdue} action(s) en retard · ${incidents} incident(s) sur 30 j`,
      }),
    ];
  },
};
