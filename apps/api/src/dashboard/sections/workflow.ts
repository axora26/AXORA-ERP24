import { WORKFLOW_PERMISSIONS } from "@axora24/contracts";
import { countKpi, type DashboardSection } from "../section.js";

export const workflowSection: DashboardSection = {
  key: "workflow",
  permission: WORKFLOW_PERMISSIONS.READ,
  async build(prisma, scope) {
    const [definitions, pending, overdue, failed] = await Promise.all([
      prisma.workflowDefinition.count({ where: { ...scope, active: true } }),
      prisma.workflowApproval.count({ where: { ...scope, status: "PENDING" } }),
      prisma.workflowApproval.count({ where: { ...scope, status: "PENDING", dueAt: { lt: new Date() } } }),
      prisma.webhookDelivery.count({ where: { ...scope, status: "FAILED" } }),
    ]);
    if (definitions === 0 && pending === 0) return [];
    return [
      countKpi({
        key: "workflow.approvals",
        label: "Approbations de workflow",
        href: "/workflow?tab=approvals",
        tone: overdue > 0 || failed > 0 ? "amber" : "green",
        value: String(pending),
        detail: `${overdue} hors délai · ${definitions} workflow(s) actif(s)${failed > 0 ? ` · ${failed} webhook(s) en échec` : ""}`,
      }),
    ];
  },
};
