import type {
  BankAccountView,
  CustomerInvoiceView,
  FinanceSummaryView,
  PaymentView,
  SupplierInvoiceView,
  TaxRateView,
} from "@axora24/contracts";
import { api } from "../api";

export const financeApi = {
  summary: () => api.get<FinanceSummaryView>("/finance/summary"),
  taxRates: () => api.get<TaxRateView[]>("/finance/tax-rates"),
  createTaxRate: (input: { name: string; rate: string }) => api.post<TaxRateView[]>("/finance/tax-rates", input),
  bankAccounts: () => api.get<BankAccountView[]>("/finance/bank-accounts"),
  createBankAccount: (input: Record<string, unknown>) => api.post<BankAccountView[]>("/finance/bank-accounts", input),
  invoices: () => api.get<CustomerInvoiceView[]>("/finance/invoices"),
  invoice: (id: string) => api.get<CustomerInvoiceView>(`/finance/invoices/${id}`),
  createInvoice: (input: Record<string, unknown>) => api.post<CustomerInvoiceView>("/finance/invoices", input),
  issueInvoice: (id: string, input: { issueDate?: string; dueDays?: number }) => api.post<CustomerInvoiceView>(`/finance/invoices/${id}/issue`, input),
  cancelInvoice: (id: string, reason: string) => api.post<CustomerInvoiceView>(`/finance/invoices/${id}/cancel`, { reason }),
  payables: () => api.get<SupplierInvoiceView[]>("/finance/payables"),
  payable: (id: string) => api.get<SupplierInvoiceView>(`/finance/payables/${id}`),
  recordPayable: (input: Record<string, unknown>) => api.post<SupplierInvoiceView>("/finance/payables", input),
  approvePayable: (id: string, note?: string) => api.post<SupplierInvoiceView>(`/finance/payables/${id}/approve`, { note }),
  rejectPayable: (id: string, note: string) => api.post<SupplierInvoiceView>(`/finance/payables/${id}/reject`, { note }),
  payments: () => api.get<PaymentView[]>("/finance/payments"),
  pay: <T,>(input: {
    invoiceType: "CUSTOMER" | "SUPPLIER";
    invoiceId: string;
    bankAccountId: string;
    amount: string;
    method: string;
    paidAt?: string;
    reference?: string;
    idempotencyKey: string;
  }) => api.post<T>("/finance/payments", input),
};

export const CUSTOMER_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Brouillon",
  ISSUED: "Émise",
  PARTIALLY_PAID: "Payée partiellement",
  PAID: "Payée",
  CANCELLED: "Annulée",
};

export const SUPPLIER_STATUS_LABEL: Record<string, string> = {
  RECORDED: "À valider",
  APPROVED: "Validée",
  PARTIALLY_PAID: "Payée partiellement",
  PAID: "Payée",
  REJECTED: "Rejetée",
};

export const MATCH_LABEL: Record<string, string> = {
  MATCHED: "Rapprochée",
  DISCREPANCY: "Écart",
  NO_ORDER: "Sans commande",
};

export const METHOD_LABEL: Record<string, string> = {
  TRANSFER: "Virement",
  CHECK: "Chèque",
  CASH: "Espèces",
  MOBILE_MONEY: "Mobile money",
  CARD: "Carte",
};
