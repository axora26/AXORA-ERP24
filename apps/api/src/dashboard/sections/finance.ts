import { FINANCE_PERMISSIONS } from "@axora24/contracts";
import { Prisma } from "@axora24/database";
import { countKpi, moneyKpi, type DashboardSection } from "../section.js";
import { invoiceCreditTotals, netInvoiceFigures } from "../../finance/credit-ledger.js";

export const financeSection: DashboardSection = {
  key: "finance",
  permission: FINANCE_PERMISSIONS.INVOICE_READ,
  async build(prisma, scope) {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const company = await prisma.company.findUniqueOrThrow({ where: { id: scope.companyId }, select: { currency: true } });
    const currency = company.currency.trim();
    const open = await prisma.customerInvoice.findMany({
      where: { ...scope, status: { in: ["ISSUED", "PARTIALLY_PAID", "PAID"] } },
      select: { id: true, currency: true, total: true, paidAmount: true, dueDate: true },
    });
    const credits = await invoiceCreditTotals(prisma, scope, "CUSTOMER", open.map((invoice) => invoice.id));
    const receivableByCurrency = new Map<string, Prisma.Decimal>();
    let overdueCount = 0;
    let openCount = 0;
    const refundByCurrency = new Map<string, Prisma.Decimal>();
    for (const invoice of open) {
      const figures = netInvoiceFigures(invoice, credits.get(invoice.id));
      const balance = new Prisma.Decimal(figures.balanceDue);
      const invoiceCurrency = invoice.currency.trim();
      receivableByCurrency.set(invoiceCurrency, (receivableByCurrency.get(invoiceCurrency) ?? new Prisma.Decimal(0)).plus(balance));
      refundByCurrency.set(invoiceCurrency, (refundByCurrency.get(invoiceCurrency) ?? new Prisma.Decimal(0)).plus(figures.refundDue));
      if (balance.greaterThan(0)) {
        openCount += 1;
        if (invoice.dueDate && invoice.dueDate < today) overdueCount += 1;
      }
    }
    const amounts = (values: Map<string, Prisma.Decimal>) => values.size ? [...values].sort(([a], [b]) => a.localeCompare(b)).map(([currency, amount]) => ({ currency, amount: amount.toFixed(2) })) : [{ currency, amount: "0.00" }];
    return [
      moneyKpi({
        key: "finance.receivables",
        label: "Créances clients",
        href: "/finance",
        tone: overdueCount > 0 ? "red" : "green",
        amounts: amounts(receivableByCurrency),
        detail: `${openCount} facture(s) ouverte(s) · ${overdueCount} en retard`,
      }),
      moneyKpi({ key: "finance.refundsDue", label: "Remboursements clients dus", href: "/finance", tone: [...refundByCurrency.values()].some((amount) => amount.greaterThan(0)) ? "amber" : "green",
        amounts: amounts(refundByCurrency), detail: "Avoirs émis sur factures déjà encaissées" }),
    ];
  },
};

export const payablesSection: DashboardSection = {
  key: "payables",
  permission: FINANCE_PERMISSIONS.PAYABLE_READ,
  async build(prisma, scope) {
    return [
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
