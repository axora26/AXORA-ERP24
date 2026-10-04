-- CreateEnum
CREATE TYPE "CollectionReminderStatus" AS ENUM ('DRAFT', 'SENT', 'CANCELLED');

-- CreateTable
CREATE TABLE "customer_invoice_reminders" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" "CollectionReminderStatus" NOT NULL DEFAULT 'DRAFT',
    "sentAt" TIMESTAMP(3),
    "sentByUserId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_invoice_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_invoice_reminders_organizationId_companyId_status__idx" ON "customer_invoice_reminders"("organizationId", "companyId", "status", "scheduledFor");

-- CreateIndex
CREATE INDEX "customer_invoice_reminders_invoiceId_idx" ON "customer_invoice_reminders"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_invoice_reminders_companyId_invoiceId_level_key" ON "customer_invoice_reminders"("companyId", "invoiceId", "level");

-- RenameForeignKey
ALTER TABLE "accounting_accounts" RENAME CONSTRAINT "accounting_accounts_parent_fkey" TO "accounting_accounts_parentId_fkey";

-- RenameForeignKey
ALTER TABLE "accounting_entries" RENAME CONSTRAINT "accounting_entries_journal_fkey" TO "accounting_entries_journalId_fkey";

-- RenameForeignKey
ALTER TABLE "accounting_entry_lines" RENAME CONSTRAINT "accounting_entry_lines_account_fkey" TO "accounting_entry_lines_accountId_fkey";

-- RenameForeignKey
ALTER TABLE "accounting_entry_lines" RENAME CONSTRAINT "accounting_entry_lines_entry_fkey" TO "accounting_entry_lines_entryId_fkey";

-- RenameForeignKey
ALTER TABLE "project_forecast_lines" RENAME CONSTRAINT "project_forecast_lines_revision_fkey" TO "project_forecast_lines_revisionId_fkey";

-- RenameForeignKey
ALTER TABLE "project_forecast_lines" RENAME CONSTRAINT "project_forecast_lines_wbs_fkey" TO "project_forecast_lines_wbsItemId_fkey";

-- RenameForeignKey
ALTER TABLE "project_forecast_revisions" RENAME CONSTRAINT "project_forecast_revisions_project_fkey" TO "project_forecast_revisions_projectId_organizationId_compan_fkey";

-- RenameForeignKey
ALTER TABLE "project_resource_plans" RENAME CONSTRAINT "project_resource_plans_project_fkey" TO "project_resource_plans_projectId_organizationId_companyId_fkey";

-- RenameForeignKey
ALTER TABLE "project_resource_plans" RENAME CONSTRAINT "project_resource_plans_wbs_fkey" TO "project_resource_plans_wbsItemId_fkey";

-- AddForeignKey
ALTER TABLE "customer_invoice_reminders" ADD CONSTRAINT "customer_invoice_reminders_invoiceId_organizationId_compan_fkey" FOREIGN KEY ("invoiceId", "organizationId", "companyId") REFERENCES "customer_invoices"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "accounting_accounts_company_code_key" RENAME TO "accounting_accounts_companyId_code_key";

-- RenameIndex
ALTER INDEX "accounting_accounts_company_system_key_key" RENAME TO "accounting_accounts_companyId_systemKey_key";

-- RenameIndex
ALTER INDEX "accounting_accounts_org_company_type_idx" RENAME TO "accounting_accounts_organizationId_companyId_type_idx";

-- RenameIndex
ALTER INDEX "accounting_entries_company_journal_date_idx" RENAME TO "accounting_entries_companyId_journalId_entryDate_idx";

-- RenameIndex
ALTER INDEX "accounting_entries_company_number_key" RENAME TO "accounting_entries_companyId_number_key";

-- RenameIndex
ALTER INDEX "accounting_entries_company_source_key" RENAME TO "accounting_entries_companyId_sourceType_sourceId_key";

-- RenameIndex
ALTER INDEX "accounting_entries_org_company_date_idx" RENAME TO "accounting_entries_organizationId_companyId_entryDate_idx";

-- RenameIndex
ALTER INDEX "accounting_entry_lines_entry_idx" RENAME TO "accounting_entry_lines_entryId_idx";

-- RenameIndex
ALTER INDEX "accounting_entry_lines_org_company_account_idx" RENAME TO "accounting_entry_lines_organizationId_companyId_accountId_idx";

-- RenameIndex
ALTER INDEX "accounting_journals_company_code_key" RENAME TO "accounting_journals_companyId_code_key";

-- RenameIndex
ALTER INDEX "accounting_journals_org_company_idx" RENAME TO "accounting_journals_organizationId_companyId_idx";

-- RenameIndex
ALTER INDEX "bank_statement_entries_company_account_external_key" RENAME TO "bank_statement_entries_companyId_bankAccountId_externalId_key";

-- RenameIndex
ALTER INDEX "bank_statement_entries_scope_status_date_idx" RENAME TO "bank_statement_entries_organizationId_companyId_bankAccount_idx";

-- RenameIndex
ALTER INDEX "invoice_signatures_org_company_invoice_status_idx" RENAME TO "invoice_signatures_organizationId_companyId_invoiceId_statu_idx";

-- RenameIndex
ALTER INDEX "project_forecast_lines_scope_revision_idx" RENAME TO "project_forecast_lines_organizationId_companyId_revisionId_idx";

-- RenameIndex
ALTER INDEX "project_forecast_revisions_scope_project_status_idx" RENAME TO "project_forecast_revisions_organizationId_companyId_project_idx";

-- RenameIndex
ALTER INDEX "project_resource_plans_scope_project_status_start_idx" RENAME TO "project_resource_plans_organizationId_companyId_projectId_s_idx";

-- RenameIndex
ALTER INDEX "project_resource_plans_scope_resource_status_start_idx" RENAME TO "project_resource_plans_organizationId_companyId_kind_resour_idx";
