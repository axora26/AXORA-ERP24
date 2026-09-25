import { Injectable } from "@nestjs/common";
import { CORE_PERMISSIONS, type DashboardOverview } from "@axora24/contracts";
import { PrismaService } from "../core/prisma.service.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import type { DashboardSection } from "./section.js";
import { DASHBOARD_SECTIONS } from "./sections/index.js";

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(
    scope: CompanyScope,
    permissions: Set<string>,
    sections: DashboardSection[] = DASHBOARD_SECTIONS,
  ): Promise<DashboardOverview> {
    const allowed = sections.filter((section) => permissions.has(section.permission));
    const kpiGroups = await Promise.all(allowed.map((section) => section.build(this.prisma, scope)));

    let activity: DashboardOverview["activity"] = null;
    if (permissions.has(CORE_PERMISSIONS.AUDIT_READ)) {
      const logs = await this.prisma.auditLog.findMany({
        where: {
          organizationId: scope.organizationId,
          action: { notIn: ["auth.login.succeeded", "auth.logout.succeeded"] },
        },
        include: { actor: { select: { fullName: true } } },
        orderBy: { createdAt: "desc" },
        take: 8,
      });
      activity = logs.map((log) => ({
        id: log.id,
        action: log.action,
        resourceType: log.resourceType,
        resourceId: log.resourceId,
        actorName: log.actor?.fullName ?? null,
        createdAt: log.createdAt.toISOString(),
      }));
    }

    return { generatedAt: new Date().toISOString(), kpis: kpiGroups.flat(), activity };
  }
}
