import { Prisma } from "@axora24/database";
import type { CreditNoteKind, InvoiceCreditFigures } from "@axora24/contracts";
import type { CompanyScope } from "../common/company-scope.service.js";
import { dec, money } from "../common/decimal.js";

export interface CreditTotals {
  subtotal: Prisma.Decimal;
  taxTotal: Prisma.Decimal;
  total: Prisma.Decimal;
  refunded: Prisma.Decimal;
}
export const zeroCredits = (): CreditTotals => ({ subtotal: dec(0), taxTotal: dec(0), total: dec(0), refunded: dec(0) });

/** Batch reads keep invoice lists and summaries independent of their row count. */
export async function invoiceCreditTotals(tx: Prisma.TransactionClient, scope: CompanyScope, kind: CreditNoteKind, ids: string[]): Promise<Map<string, CreditTotals>> {
  const result = new Map<string, CreditTotals>();
  if (!ids.length) return result;
  const where = { ...scope, sourceInvoiceId: { in: ids }, status: "ISSUED" as const };
  const credits = kind === "CUSTOMER"
    ? await tx.customerCreditNote.groupBy({ by: ["sourceInvoiceId"], where, _sum: { subtotal: true, taxTotal: true, total: true } })
    : await tx.supplierCreditNote.groupBy({ by: ["sourceInvoiceId"], where, _sum: { subtotal: true, taxTotal: true, total: true } });
  for (const entry of credits) result.set(entry.sourceInvoiceId, { subtotal: dec(entry._sum.subtotal), taxTotal: dec(entry._sum.taxTotal), total: dec(entry._sum.total), refunded: dec(0) });
  const refunds = await tx.creditRefund.findMany({
    where: { ...scope, ...(kind === "CUSTOMER" ? { customerCreditNote: where } : { supplierCreditNote: where }) },
    select: { amount: true, customerCreditNote: { select: { sourceInvoiceId: true } }, supplierCreditNote: { select: { sourceInvoiceId: true } } },
  });
  for (const refund of refunds) {
    const id = (kind === "CUSTOMER" ? refund.customerCreditNote : refund.supplierCreditNote)?.sourceInvoiceId;
    if (!id) continue;
    const entry = result.get(id) ?? zeroCredits(); entry.refunded = entry.refunded.plus(refund.amount); result.set(id, entry);
  }
  return result;
}

export function netInvoiceFigures(invoice: { total: Prisma.Decimal; paidAmount: Prisma.Decimal }, credits: CreditTotals = zeroCredits()): InvoiceCreditFigures {
  const netTotal = dec(invoice.total).minus(credits.total);
  const netPaid = dec(invoice.paidAmount).minus(credits.refunded);
  return { creditedSubtotal: money(credits.subtotal), creditedTaxTotal: money(credits.taxTotal), creditedAmount: money(credits.total), refundedAmount: money(credits.refunded),
    netTotal: money(netTotal), netPaidAmount: money(netPaid), balanceDue: money(Prisma.Decimal.max(netTotal.minus(netPaid), 0)), refundDue: money(Prisma.Decimal.max(netPaid.minus(netTotal), 0)) };
}
