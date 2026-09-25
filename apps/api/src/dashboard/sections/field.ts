import { DOCUMENTS_PERMISSIONS, FIELD_PERMISSIONS } from "@axora24/contracts";
import { countKpi, type DashboardSection } from "../section.js";

export const fieldSection: DashboardSection = {
  key: "field",
  permission: FIELD_PERMISSIONS.SITE_READ,
  async build(prisma, scope) {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const [open, overdue, toVerify] = await Promise.all([
      prisma.siteIssue.count({ where: { ...scope, status: { not: "CLOSED" } } }),
      prisma.siteIssue.count({ where: { ...scope, status: "OPEN", dueDate: { lt: today } } }),
      prisma.siteIssue.count({ where: { ...scope, status: "CORRECTION_SUBMITTED" } }),
    ]);
    return [
      countKpi({
        key: "field.openIssues",
        label: "Réserves ouvertes",
        href: "/field",
        tone: overdue > 0 ? "red" : open > 0 ? "amber" : "green",
        value: String(open),
        detail: `${overdue} en retard · ${toVerify} correction(s) à vérifier`,
      }),
    ];
  },
};

export const documentsSection: DashboardSection = {
  key: "documents",
  permission: DOCUMENTS_PERMISSIONS.DOCUMENT_READ,
  async build(prisma, scope) {
    const [submitted, approved] = await Promise.all([
      prisma.managedDocument.count({ where: { ...scope, status: "SUBMITTED" } }),
      prisma.managedDocument.count({ where: { ...scope, status: "APPROVED" } }),
    ]);
    return [
      countKpi({
        key: "documents.toApprove",
        label: "Documents en visa",
        href: "/documents",
        tone: submitted > 0 ? "amber" : "green",
        value: String(submitted),
        detail: `${approved} document(s) approuvé(s) applicables`,
      }),
    ];
  },
};
