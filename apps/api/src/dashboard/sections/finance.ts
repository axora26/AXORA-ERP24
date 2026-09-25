import { FINANCE_PERMISSIONS } from "@axora24/contracts";
import { Prisma } from "@axora24/database";
import { countKpi, moneyKpi, type DashboardSection } from "../section.js";

export const financeSection: DashboardSection = {
  key: "finance",
  permission: FINANCE_PERMISSIONS.INVOICE_READ,
  async build(prisma, scope) {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const company = await prisma.company.findUniqueOrThrow({ where: { id: scope.companyId }, select: { currency: true } });
    const currency = company.currency.trim();
    const open = await prisma.customerInvoice.findMany({
      where: { ...scope, currency, status: { in: ["ISSUED", "PARTIALLY_PAID"] } },
      select: { total: true, paidAmount: true, dueDate: true },
    });
    let receivable = new Prisma.Decimal(0);
    let overdueCount = 0;
    for (const invoice of open) {
      receivable = receivable.plus(new Prisma.Decimal(invoice.total).minus(invoice.paidAmount));
      if (invoice.dueDate && invoice.dueDate < today) overdueCount += 1;
    }
    return [
      moneyKpi({
        key: "finance.receivables",
        label: "Créances clients",
        href: "/finance",
        tone: overdueCount > 0 ? "red" : "green",
        amounts: [{ currency, amount: receivable.toFixed(2) }],
        detail: `${open.length} facture(s) ouverte(s) · ${overdueCount} en retard`,
      }),
      countKpi({
        key: "finance.toApprove",
        label: "Factures fournisseurs à valider",
        href: "/finance",
        tone: "amber",
        value: String(await prisma.supplierInvoice.count({ where: { ...scope, status: "RECORDED" } })),
        detail: "Rapprochement 3-way puis validation",
      }),
    ];
  },
};
