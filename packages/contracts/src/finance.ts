/** INC-08 — Finance. Montants : chaines decimales exactes a 2 decimales. */

export type CustomerInvoiceStatus = "DRAFT" | "ISSUED" | "PARTIALLY_PAID" | "PAID" | "CANCELLED";
export type SupplierInvoiceStatus = "RECORDED" | "APPROVED" | "PARTIALLY_PAID" | "PAID" | "REJECTED";
export type MatchStatus = "MATCHED" | "DISCREPANCY" | "NO_ORDER";
export type PaymentMethod = "TRANSFER" | "CHECK" | "CASH" | "MOBILE_MONEY" | "CARD";

export interface TaxRateView {
  id: string;
  name: string;
  rate: string;
  isActive: boolean;
}

export interface BankAccountView {
  id: string;
  code: string;
  name: string;
  kind: "BANK" | "CASH";
  currency: string;
  iban: string | null;
  openingBalance: string;
  /** Solde = ouverture + encaissements - decaissements (paiements enregistres). */
  balance: string;
  isActive: boolean;
}

export interface InvoiceLineView {
  id: string;
  position: number;
  description: string;
  quantity: string;
  unitPrice: string;
  taxRate: string;
  lineTotal: string;
  lineTax: string;
  orderLineId?: string | null;
}

export interface PaymentView {
  id: string;
  code: string;
  direction: "IN" | "OUT";
  amount: string;
  currency: string;
  paidAt: string;
  method: PaymentMethod;
  reference: string | null;
  bankAccountId: string;
  bankAccountName: string;
  invoiceId: string;
  invoiceCode: string | null;
  counterparty: string;
  createdAt: string;
}

export interface InvoiceSignatureView {
  id: string;
  invoiceId: string;
  invoiceCode: string;
  documentHash: string;
  signature: string;
  algorithm: "HMAC-SHA256";
  signerUserId: string;
  signedAt: string;
  status: "VALID" | "REVOKED";
  revokedAt: string | null;
  revokedByUserId: string | null;
  revokeReason: string | null;
}

export interface CustomerInvoiceView {
  credit?: import("./credit-notes.js").InvoiceCreditFigures;
  signatures?: InvoiceSignatureView[];
  id: string;
  code: string | null;
  customerName: string;
  customerAddress: string | null;
  contractId: string | null;
  contractCode: string | null;
  projectId: string | null;
  projectCode: string | null;
  currency: string;
  issueDate: string | null;
  dueDate: string | null;
  status: CustomerInvoiceStatus;
  subtotal: string;
  taxTotal: string;
  total: string;
  paidAmount: string;
  balanceDue: string;
  overdue: boolean;
  notes: string | null;
  cancelReason: string | null;
  createdAt: string;
  lines: InvoiceLineView[];
  payments: PaymentView[];
}

export interface SupplierInvoiceView {
  credit?: import("./credit-notes.js").InvoiceCreditFigures;
  id: string;
  code: string;
  supplierId: string;
  supplierName: string;
  orderId: string | null;
  orderCode: string | null;
  projectId: string | null;
  projectCode: string | null;
  supplierReference: string;
  currency: string;
  invoiceDate: string;
  dueDate: string;
  status: SupplierInvoiceStatus;
  matchStatus: MatchStatus;
  matchNotes: string | null;
  subtotal: string;
  taxTotal: string;
  total: string;
  paidAmount: string;
  balanceDue: string;
  overdue: boolean;
  recordedByUserId: string;
  decidedByUserId: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
  lines: InvoiceLineView[];
  payments: PaymentView[];
}

export interface FinanceSummaryView {
  customerRefundsDue?: string;
  supplierRefundsDue?: string | null;
  currency: string;
  receivables: string;
  receivablesOverdue: string;
  payables: string | null;
  payablesOverdue: string | null;
  cashPosition: string;
  toApprove: number;
}

export interface TreasuryForecastPointView {
  date: string;
  expectedIn: string;
  expectedOut: string;
  projectedBalance: string;
}

export interface TreasuryForecastView {
  currency: string;
  horizonDays: number;
  openingBalance: string;
  points: TreasuryForecastPointView[];
  assumptions: string[];
}

export interface BankStatementEntryView {
  id: string;
  bankAccountId: string;
  externalId: string;
  bookedAt: string;
  valueDate: string | null;
  description: string;
  amount: string;
  currency: string;
  status: "UNMATCHED" | "MATCHED" | "IGNORED";
  matchedPaymentId: string | null;
  matchedAt: string | null;
}
