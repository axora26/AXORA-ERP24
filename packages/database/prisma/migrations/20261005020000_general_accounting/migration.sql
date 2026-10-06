CREATE TYPE "AccountingAccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');
CREATE TYPE "AccountingJournalType" AS ENUM ('SALES', 'PURCHASES', 'BANK', 'CASH', 'GENERAL');
CREATE TYPE "AccountingEntryStatus" AS ENUM ('POSTED', 'REVERSED');

CREATE TABLE "accounting_accounts" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "AccountingAccountType" NOT NULL,
  "systemKey" TEXT,
  "parentId" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "accounting_accounts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "accounting_accounts_company_code_key" ON "accounting_accounts"("companyId", "code");
CREATE UNIQUE INDEX "accounting_accounts_company_system_key_key" ON "accounting_accounts"("companyId", "systemKey");
CREATE INDEX "accounting_accounts_org_company_type_idx" ON "accounting_accounts"("organizationId", "companyId", "type");
ALTER TABLE "accounting_accounts" ADD CONSTRAINT "accounting_accounts_parent_fkey" FOREIGN KEY ("parentId") REFERENCES "accounting_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "accounting_journals" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "AccountingJournalType" NOT NULL DEFAULT 'GENERAL',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "accounting_journals_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "accounting_journals_company_code_key" ON "accounting_journals"("companyId", "code");
CREATE INDEX "accounting_journals_org_company_idx" ON "accounting_journals"("organizationId", "companyId");

CREATE TABLE "accounting_entries" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "journalId" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "entryDate" TIMESTAMP(3) NOT NULL,
  "description" TEXT NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "sourceType" TEXT,
  "sourceId" TEXT,
  "status" "AccountingEntryStatus" NOT NULL DEFAULT 'POSTED',
  "postedByUserId" TEXT NOT NULL,
  "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "accounting_entries_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "accounting_entries_company_number_key" ON "accounting_entries"("companyId", "number");
CREATE UNIQUE INDEX "accounting_entries_company_source_key" ON "accounting_entries"("companyId", "sourceType", "sourceId");
CREATE INDEX "accounting_entries_org_company_date_idx" ON "accounting_entries"("organizationId", "companyId", "entryDate");
CREATE INDEX "accounting_entries_company_journal_date_idx" ON "accounting_entries"("companyId", "journalId", "entryDate");
ALTER TABLE "accounting_entries" ADD CONSTRAINT "accounting_entries_journal_fkey" FOREIGN KEY ("journalId") REFERENCES "accounting_journals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "accounting_entry_lines" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "entryId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "debit" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "credit" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "projectId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "accounting_entry_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "accounting_entry_lines_amount_check" CHECK ("debit" >= 0 AND "credit" >= 0 AND NOT ("debit" > 0 AND "credit" > 0) AND ("debit" + "credit") > 0)
);
CREATE INDEX "accounting_entry_lines_org_company_account_idx" ON "accounting_entry_lines"("organizationId", "companyId", "accountId");
CREATE INDEX "accounting_entry_lines_entry_idx" ON "accounting_entry_lines"("entryId");
ALTER TABLE "accounting_entry_lines" ADD CONSTRAINT "accounting_entry_lines_entry_fkey" FOREIGN KEY ("entryId") REFERENCES "accounting_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accounting_entry_lines" ADD CONSTRAINT "accounting_entry_lines_account_fkey" FOREIGN KEY ("accountId") REFERENCES "accounting_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "prevent_accounting_entry_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Accounting entries are append-only' USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "accounting_entries_append_only" BEFORE UPDATE OR DELETE ON "accounting_entries" FOR EACH ROW EXECUTE FUNCTION "prevent_accounting_entry_mutation"();
CREATE TRIGGER "accounting_entry_lines_append_only" BEFORE UPDATE OR DELETE ON "accounting_entry_lines" FOR EACH ROW EXECUTE FUNCTION "prevent_accounting_entry_mutation"();
