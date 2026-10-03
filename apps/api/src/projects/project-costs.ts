import { FINANCE_PERMISSIONS, HR_PERMISSIONS, INVENTORY_PERMISSIONS, PROCUREMENT_PERMISSIONS, SUBCONTRACTING_PERMISSIONS, type ProjectBudgetFigure } from "@axora24/contracts";
import { Prisma } from "@axora24/database";
import type { PrismaService } from "../core/prisma.service.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import { money, sumDecimals } from "../common/decimal.js";
import { invoiceCreditTotals, netInvoiceFigures, zeroCredits, type CreditTotals } from "../finance/credit-ledger.js";

export const COMMITTING_ORDER_STATUSES = ["ISSUED", "PARTIALLY_RECEIVED", "RECEIVED"] as const;
const hidden = (source: string): ProjectBudgetFigure => ({ amount: "0.00", available: false, source });
const figure = (amount: Prisma.Decimal, source: string): ProjectBudgetFigure => ({ amount: money(amount), available: true, source });

/** A complete cost measure is withheld when any constituent source is forbidden or incompatible. */
export async function projectCostFigures(
  prisma: PrismaService,
  scope: CompanyScope,
  projectId: string,
  currency: string,
  permissions: Set<string>,
): Promise<{ committed: ProjectBudgetFigure; consumed: ProjectBudgetFigure; invoiced: ProjectBudgetFigure; paid: ProjectBudgetFigure; billed: ProjectBudgetFigure; collected: ProjectBudgetFigure }> {
  const orderRead = permissions.has(PROCUREMENT_PERMISSIONS.ORDER_READ);
  const stockRead = permissions.has(INVENTORY_PERMISSIONS.ITEM_READ);
  const payrollRead = permissions.has(HR_PERMISSIONS.PAYROLL_READ);
  const subcontractRead = permissions.has(SUBCONTRACTING_PERMISSIONS.READ);
  const payableRead = permissions.has(FINANCE_PERMISSIONS.PAYABLE_READ);
  const invoiceRead = permissions.has(FINANCE_PERMISSIONS.INVOICE_READ);
  const [orders, stock, labor, subcontracted, payables, receivables] = await Promise.all([
    orderRead ? prisma.purchaseOrderLine.findMany({
      where: { ...scope, projectId, order: { ...scope, status: { in: [...COMMITTING_ORDER_STATUSES] } } },
      select: { lineTotal: true, receivedQuantity: true, unitPrice: true, inventoryItemId: true, order: { select: { currency: true } } },
    }) : null,
    stockRead ? prisma.stockMovement.aggregate({ where: { ...scope, projectId, type: { in: ["ISSUE", "RETURN"] } }, _sum: { valueDelta: true } }) : null,
    payrollRead ? prisma.timesheetEntry.findMany({
      where: { ...scope, projectId, timesheet: { ...scope, status: "VALIDATED" } },
      select: { costAmount: true, timesheet: { select: { employee: { select: { currency: true } } } } },
    }) : null,
    subcontractRead ? prisma.subcontractStatement.findMany({
      where: { ...scope, status: "APPROVED", package: { ...scope, projectId } },
      select: { grossAmount: true, package: { select: { purchaseOrder: { select: { currency: true } } } } },
    }) : null,
    payableRead ? prisma.supplierInvoice.findMany({
      where: { ...scope, projectId, status: { in: ["APPROVED", "PARTIALLY_PAID", "PAID"] } },
      select: { id: true, currency: true, subtotal: true, total: true, paidAmount: true },
    }) : null,
    invoiceRead ? prisma.customerInvoice.findMany({
      where: { ...scope, projectId, status: { in: ["ISSUED", "PARTIALLY_PAID", "PAID"] } },
      select: { id: true, currency: true, total: true, paidAmount: true },
    }) : null,
  ]);
  const compatible = (value: string) => value.trim() === currency.trim();
  const ordersMixed = orders?.some((row) => !compatible(row.order.currency)) ?? false;
  const directMixed = orders?.some((row) => row.inventoryItemId === null && !row.receivedQuantity.isZero() && !compatible(row.order.currency)) ?? false;
  const laborMixed = labor?.some((row) => !compatible(row.timesheet.employee.currency)) ?? false;
  const laborMissing = labor?.some((row) => row.costAmount === null) ?? false;
  const subcontractMixed = subcontracted?.some((row) => !compatible(row.package.purchaseOrder.currency)) ?? false;
  const payablesMixed = payables?.some((row) => !compatible(row.currency)) ?? false;
  const receivablesMixed = receivables?.some((row) => !compatible(row.currency)) ?? false;

  const supplierCredits = payableRead && !payablesMixed ? await invoiceCreditTotals(prisma, scope, "SUPPLIER", (payables ?? []).map((row) => row.id)) : new Map<string, CreditTotals>();
  let invoiced = new Prisma.Decimal(0); let paid = new Prisma.Decimal(0);
  if (!payablesMixed) for (const invoice of payables ?? []) {
    const credits = supplierCredits.get(invoice.id) ?? zeroCredits();
    const figures = netInvoiceFigures(invoice, credits);
    const subtotal = invoice.subtotal.minus(credits.subtotal);
    invoiced = invoiced.plus(subtotal);
    const total = new Prisma.Decimal(figures.netTotal);
    const paidAmount = Prisma.Decimal.min(figures.netPaidAmount, total);
    if (!total.isZero()) paid = paid.plus(paidAmount.mul(subtotal).div(total).toDecimalPlaces(2));
  }
  const customerCredits = invoiceRead && !receivablesMixed ? await invoiceCreditTotals(prisma, scope, "CUSTOMER", (receivables ?? []).map((row) => row.id)) : new Map<string, CreditTotals>();
  const billed = sumDecimals((receivablesMixed ? [] : receivables ?? []).map((invoice) => netInvoiceFigures(invoice, customerCredits.get(invoice.id)).netTotal));
  const collected = sumDecimals((receivablesMixed ? [] : receivables ?? []).map((invoice) => netInvoiceFigures(invoice, customerCredits.get(invoice.id)).netPaidAmount));
  const consumed = sumDecimals((orders ?? []).filter((row) => row.inventoryItemId === null).map((row) => row.receivedQuantity.mul(row.unitPrice).toDecimalPlaces(2)))
    .minus(stock?._sum.valueDelta ?? 0).plus(sumDecimals((labor ?? []).map((row) => row.costAmount))).plus(sumDecimals((subcontracted ?? []).map((row) => row.grossAmount)));
  const consumedSource = "Réceptions directes chantier (Achats) + sorties de stock nettes des retours (Stock) + temps passés validés (RH) + situations de sous-traitance certifiées";
  const consumedVisible = orderRead && stockRead && payrollRead && subcontractRead;
  const consumedCompatible = !directMixed && !laborMixed && !subcontractMixed;
  return {
    committed: !orderRead ? hidden("Permission Commandes requise") : ordersMixed ? hidden("Commandes : devises différentes, conversion non configurée") : figure(sumDecimals((orders ?? []).map((row) => row.lineTotal)), "Commandes fournisseurs émises (Achats)"),
    consumed: !consumedVisible ? hidden("Coût consommé protégé : permissions Commandes, Stock, Paie et Sous-traitance requises") : !consumedCompatible ? hidden("Coût consommé : devises différentes, conversion non configurée") : laborMissing ? hidden("Coût consommé : temps validés sans valorisation figée") : figure(consumed, consumedSource),
    invoiced: !payableRead ? hidden("Permission Factures fournisseurs requise") : payablesMixed ? hidden("Factures fournisseurs : devises différentes, conversion non configurée") : figure(invoiced, "Factures fournisseurs approuvées nettes des avoirs (HT)"),
    paid: !payableRead ? hidden("Permission Factures fournisseurs requise") : payablesMixed ? hidden("Paiements fournisseurs : devises différentes, conversion non configurée") : figure(paid, "Paiements fournisseurs nets des remboursements, ramenés au HT"),
    billed: !invoiceRead ? hidden("Permission Factures clients requise") : receivablesMixed ? hidden("Factures clients : devises différentes, conversion non configurée") : figure(billed, "Factures clients nettes des avoirs (TTC)"),
    collected: !invoiceRead ? hidden("Permission Factures clients requise") : receivablesMixed ? hidden("Encaissements clients : devises différentes, conversion non configurée") : figure(collected, "Encaissements clients nets des remboursements"),
  };
}
