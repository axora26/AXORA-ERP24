import type { PaymentMethod } from "./finance.js";

export type CreditNoteKind = "CUSTOMER" | "SUPPLIER";
export type CreditNoteStatus = "DRAFT" | "ISSUED" | "CANCELLED";
export interface CreditNoteLineView {
  id: string;
  sourceInvoiceLineId: string;
  position: number;
  description: string;
  quantity: string;
  unitPrice: string;
  taxRate: string;
  lineTotal: string;
  lineTax: string;
}
export interface CreditRefundView {
  id: string;
  code: string;
  creditNoteId: string;
  direction: "IN" | "OUT";
  bankAccountId: string;
  amount: string;
  currency: string;
  refundedAt: string;
  method: PaymentMethod;
  reference: string | null;
  createdAt: string;
}
export interface InvoiceCreditFigures {
  creditedSubtotal: string;
  creditedTaxTotal: string;
  creditedAmount: string;
  refundedAmount: string;
  netTotal: string;
  netPaidAmount: string;
  balanceDue: string;
  /** Paid funds exceeding the net invoice: customer payable / supplier receivable. */
  refundDue: string;
}
export interface CreditNoteView {
  id: string;
  companyId: string;
  kind: CreditNoteKind;
  code: string | null;
  sourceInvoiceId: string;
  sourceInvoiceCode: string | null;
  sourceInvoiceName: string;
  currency: string;
  reason: string;
  status: CreditNoteStatus;
  version: number;
  issueDate: string | null;
  subtotal: string;
  taxTotal: string;
  total: string;
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
  lines: CreditNoteLineView[];
  refunds: CreditRefundView[];
  invoice: InvoiceCreditFigures;
}
export interface CreditNoteCreateInput {
  companyId?: string;
  invoiceId: string;
  reason: string;
  lines: Array<{ sourceInvoiceLineId: string; quantity: string }>;
}
export interface CreditNoteUpdateInput {
  companyId?: string;
  expectedVersion: number;
  reason?: string;
  lines?: Array<{ sourceInvoiceLineId: string; quantity: string }>;
}
export interface CreditNoteIssueInput {
  companyId?: string;
  expectedVersion: number;
  issueDate: string;
}
export interface CreditNoteCancelInput {
  companyId?: string;
  expectedVersion: number;
  reason: string;
}
export interface CreditRefundInput {
  companyId?: string;
  amount: string;
  bankAccountId: string;
  refundedAt: string;
  method: PaymentMethod;
  reference?: string;
  idempotencyKey: string;
}
