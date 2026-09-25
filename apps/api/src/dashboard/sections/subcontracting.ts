import { SUBCONTRACTING_PERMISSIONS } from "@axora24/contracts";
import { countKpi, type DashboardSection } from "../section.js";

export const subcontractingSection: DashboardSection = {
  key: "subcontracting",
  permission: SUBCONTRACTING_PERMISSIONS.READ,
  async build(prisma, scope) {
    const [active, drafts, due] = await Promise.all([
      prisma.subcontractPackage.count({ where: { ...scope, status: "ACTIVE" } }),
      prisma.subcontractStatement.count({ where: { ...scope, status: "DRAFT" } }),
      prisma.subcontractRetention.count({ where: { ...scope, status: "HELD", releaseDueDate: { lte: new Date() } } }),
    ]);
    if (active === 0 && drafts === 0) return [];
    return [
      countKpi({
        key: "subcontracting.statements",
        label: "Situations à approuver",
        href: "/subcontracting",
        tone: drafts > 0 ? "amber" : "green",
        value: String(drafts),
        detail: `${active} lot(s) actif(s) · ${due} retenue(s) libérable(s)`,
      }),
    ];
  },
};
