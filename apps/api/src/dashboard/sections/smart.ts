import { SMART_PERMISSIONS } from "@axora24/contracts";
import { countKpi, type DashboardSection } from "../section.js";

export const smartSection: DashboardSection = {
  key: "smart",
  permission: SMART_PERMISSIONS.READ,
  async build(prisma, scope) {
    const [active, critical, points, stale] = await Promise.all([
      prisma.smartAlarm.count({ where: { ...scope, status: { in: ["ACTIVE", "ACKNOWLEDGED"] } } }),
      prisma.smartAlarm.count({ where: { ...scope, status: "ACTIVE", severity: "CRITICAL" } }),
      prisma.smartPoint.count({ where: { ...scope, active: true } }),
      prisma.smartPoint.count({ where: { ...scope, active: true, OR: [{ lastReadingAt: null }, { lastReadingAt: { lt: new Date(Date.now() - 3_600_000) } }] } }),
    ]);
    if (points === 0) return [];
    return [
      countKpi({
        key: "smart.alarms",
        label: "Alarmes techniques (GTB)",
        href: "/smart",
        tone: critical > 0 ? "red" : active > 0 || stale > 0 ? "amber" : "green",
        value: String(active),
        detail: `${critical} critique(s) non acquittée(s) · ${stale}/${points} point(s) sans donnée depuis 1 h`,
      }),
    ];
  },
};
