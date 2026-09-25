import { HR_PERMISSIONS } from "@axora24/contracts";
import { countKpi, type DashboardSection } from "../section.js";

export const hrSection: DashboardSection = {
  key: "hr",
  permission: HR_PERMISSIONS.EMPLOYEE_READ,
  async build(prisma, scope) {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const [active, submitted, leaves, onSite] = await Promise.all([
      prisma.employee.count({ where: { ...scope, status: "ACTIVE" } }),
      prisma.timesheet.count({ where: { ...scope, status: "SUBMITTED" } }),
      prisma.leaveRequest.count({ where: { ...scope, status: "REQUESTED" } }),
      prisma.attendanceEvent.findMany({
        where: { ...scope, occurredAt: { gte: today } },
        orderBy: { occurredAt: "asc" },
        select: { employeeId: true, type: true },
      }),
    ]);
    const present = new Map<string, boolean>();
    for (const event of onSite) present.set(event.employeeId, event.type === "IN");
    const presentCount = [...present.values()].filter(Boolean).length;
    return [
      countKpi({
        key: "hr.present",
        label: "Présents aujourd'hui",
        href: "/hr",
        tone: "blue",
        value: String(presentCount),
        detail: `${active} employé(s) actif(s) · pointages du jour`,
      }),
      countKpi({
        key: "hr.toValidate",
        label: "Temps & congés à valider",
        href: "/hr",
        tone: submitted + leaves > 0 ? "amber" : "green",
        value: String(submitted + leaves),
        detail: `${submitted} feuille(s) de temps · ${leaves} demande(s) de congé`,
      }),
    ];
  },
};
