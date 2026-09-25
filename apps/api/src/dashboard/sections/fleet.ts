import { FLEET_PERMISSIONS } from "@axora24/contracts";
import { countKpi, type DashboardSection } from "../section.js";

export const fleetSection: DashboardSection = {
  key: "fleet",
  permission: FLEET_PERMISSIONS.READ,
  async build(prisma, scope) {
    const [vehicles, assigned, immobilized, incidents] = await Promise.all([
      prisma.fleetVehicle.count({ where: { ...scope, status: { not: "DISPOSED" } } }),
      prisma.fleetAssignment.count({ where: { ...scope, endAt: null } }),
      prisma.fleetVehicle.count({ where: { ...scope, status: "IMMOBILIZED" } }),
      prisma.fleetIncident.count({ where: { ...scope, status: "OPEN" } }),
    ]);
    if (vehicles === 0) return [];
    return [
      countKpi({
        key: "fleet.vehicles",
        label: "Parc affecté",
        href: "/fleet",
        tone: immobilized > 0 || incidents > 0 ? "amber" : "green",
        value: `${assigned} / ${vehicles}`,
        detail: `${immobilized} immobilisé(s) · ${incidents} incident(s) ouvert(s)`,
      }),
    ];
  },
};
