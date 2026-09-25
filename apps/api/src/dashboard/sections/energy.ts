import { ENERGY_PERMISSIONS } from "@axora24/contracts";
import { countKpi, type DashboardSection } from "../section.js";

export const energySection: DashboardSection = {
  key: "energy",
  permission: ENERGY_PERMISSIONS.READ,
  async build(prisma, scope) {
    const [meters, open] = await Promise.all([
      prisma.energyMeter.count({ where: { ...scope, active: true } }),
      prisma.energyAlert.count({ where: { ...scope, status: "OPEN" } }),
    ]);
    if (meters === 0) return [];
    return [
      countKpi({
        key: "energy.alerts",
        label: "Alertes énergie",
        href: "/energy",
        tone: open > 0 ? "amber" : "green",
        value: String(open),
        detail: `${meters} compteur(s) suivi(s)`,
      }),
    ];
  },
};
