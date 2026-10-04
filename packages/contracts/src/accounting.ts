/** Comptabilité générale : montants transmis comme chaînes décimales exactes. */
export type AccountingAccountType = "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
export type AccountingJournalType = "SALES" | "PURCHASES" | "BANK" | "CASH" | "GENERAL";
export type AccountingEntryStatus = "POSTED" | "REVERSED";

export interface AccountingAccountView {
  id: string;
  code: string;
  name: string;
  type: AccountingAccountType;
  systemKey: string | null;
  parentId: string | null;
  isActive: boolean;
  debit: string;
  credit: string;
  balance: string;
}

export interface AccountingJournalView {
  id: string;
  code: string;
  name: string;
  type: AccountingJournalType;
  isActive: boolean;
}

export interface AccountingEntryLineView {
  id: string;
  accountId: string;
  accountCode: string;
  accountName: string;
  label: string;
  debit: string;
  credit: string;
  projectId: string | null;
}

export interface AccountingEntryView {
  id: string;
  number: string;
  journalId: string;
  journalCode: string;
  journalName: string;
  entryDate: string;
  description: string;
  currency: string;
  status: AccountingEntryStatus;
  sourceType: string | null;
  sourceId: string | null;
  postedByUserId: string;
  postedAt: string;
  totalDebit: string;
  totalCredit: string;
  lines: AccountingEntryLineView[];
}

export interface AccountingTrialBalanceRow {
  accountId: string;
  code: string;
  name: string;
  type: AccountingAccountType;
  debit: string;
  credit: string;
  balance: string;
}

export interface AccountingTrialBalanceView {
  currency: string;
  from: string | null;
  to: string | null;
  totalDebit: string;
  totalCredit: string;
  rows: AccountingTrialBalanceRow[];
}
