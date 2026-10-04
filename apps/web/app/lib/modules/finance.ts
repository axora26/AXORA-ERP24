import type {
  AccountingAccountView,
  AccountingEntryView,
  AccountingJournalView,
  AccountingTrialBalanceView,
  BankAccountView,
  CustomerInvoiceView,
  InvoiceSignatureView,
  TreasuryForecastView,
  BankStatementEntryView,
  FinanceSummaryView,
  PaymentView,
  SupplierInvoiceView,
  TaxRateView,
} from "@axora24/contracts";
import { api } from "../api";

export const financeApi = {
  accountingConfiguration: () => api.get<{ accounts: AccountingAccountView[]; journals: AccountingJournalView[] }>("/finance/accounting/configuration"),
  accountingBootstrap: () => api.post<{ accounts: AccountingAccountView[]; journals: AccountingJournalView[] }>("/finance/accounting/bootstrap", {}),
  accountingAccounts: () => api.get<AccountingAccountView[]>("/finance/accounting/accounts"),
  createAccountingAccount: (input: Record<string, unknown>) => api.post<AccountingAccountView[]>("/finance/accounting/accounts", input),
  accountingJournals: () => api.get<AccountingJournalView[]>("/finance/accounting/journals"),
  createAccountingJournal: (input: Record<string, unknown>) => api.post<AccountingJournalView[]>("/finance/accounting/journals", input),
  accountingEntries: (query?: { from?: string; to?: string; journalId?: string }) => api.get<AccountingEntryView[]>(`/finance/accounting/entries${query ? `?${new URLSearchParams(query).toString()}` : ""}`),
  accountingTrialBalance: (query?: { from?: string; to?: string }) => api.get<AccountingTrialBalanceView>(`/finance/accounting/trial-balance${query ? `?${new URLSearchParams(query).toString()}` : ""}`),
  accountingStatements: (query?: { from?: string; to?: string }) => api.get<import("@axora24/contracts").AccountingFinancialStatementsView>(`/finance/accounting/statements${query ? `?${new URLSearchParams(query).toString()}` : ""}`),
  createAccountingEntry: (input: Record<string, unknown>) => api.post<AccountingEntryView>("/finance/accounting/entries", input),
  summary: () => api.get<FinanceSummaryView>("/finance/summary"),
  collectionReminders: () => api.get<import("@axora24/contracts").CollectionReminderView[]>("/finance/collection-reminders"),
  generateCollectionReminders: () => api.post<import("@axora24/contracts").CollectionReminderView[]>("/finance/collection-reminders/generate", {}),
  markCollectionReminderSent: (id: string) => api.post<import("@axora24/contracts").CollectionReminderView>(`/finance/collection-reminders/${id}/mark-sent`, {}),
  taxRates: () => api.get<TaxRateView[]>("/finance/tax-rates"),
  createTaxRate: (input: { name: string; rate: string }) => api.post<TaxRateView[]>("/finance/tax-rates", input),
  bankAccounts: () => api.get<BankAccountView[]>("/finance/bank-accounts"),
  createBankAccount: (input: Record<string, unknown>) => api.post<BankAccountView[]>("/finance/bank-accounts", input),
  invoices: () => api.get<CustomerInvoiceView[]>("/finance/invoices"),
  invoice: (id: string) => api.get<CustomerInvoiceView>(`/finance/invoices/${id}`),
  invoiceSignatures: (id: string) => api.get<InvoiceSignatureView[]>(`/finance/invoices/${id}/signatures`),
  signInvoice: (id: string, documentHash?: string) => api.post<InvoiceSignatureView>(`/finance/invoices/${id}/sign`, documentHash ? { documentHash } : {}),
  revokeInvoiceSignature: (id: string, signatureId: string, reason: string) => api.post<InvoiceSignatureView>(`/finance/invoices/${id}/signatures/${signatureId}/revoke`, { reason }),
  verifyInvoiceSignature: (id: string, signatureId: string) => api.get<{ valid: boolean; documentHash: string; invoiceCode: string; algorithm: string; signedAt: string; status: string }>(`/finance/invoices/${id}/signatures/${signatureId}/verify`),
  treasuryForecast: (days = 30) => api.get<TreasuryForecastView>(`/finance/treasury-forecast?days=${days}`),
  bankStatements: (bankAccountId?: string) => api.get<BankStatementEntryView[]>(`/finance/bank-statements${bankAccountId ? `?bankAccountId=${encodeURIComponent(bankAccountId)}` : ""}`),
  importBankStatement: (input: { bankAccountId: string; entries: Array<Record<string, unknown>> }) => api.post<{ imported: number; skipped: number; entries: BankStatementEntryView[] }>("/finance/bank-statements/import", input),
  matchBankStatement: (id: string, paymentId: string) => api.post<BankStatementEntryView>(`/finance/bank-statements/${id}/match`, { paymentId }),
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
