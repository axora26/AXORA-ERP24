ALTER TABLE "users" ADD COLUMN "mfaRecoveryCodeHashes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "crm_accounts" ADD COLUMN "archivedAt" TIMESTAMP(3), ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "crm_contacts" ADD COLUMN "archivedAt" TIMESTAMP(3), ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "crm_accounts" ADD CONSTRAINT "crm_account_version_positive" CHECK ("version" >= 1);
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contact_version_positive" CHECK ("version" >= 1);
CREATE INDEX "crm_accounts_organizationId_companyId_archivedAt_idx" ON "crm_accounts"("organizationId", "companyId", "archivedAt");
CREATE INDEX "crm_contacts_organizationId_companyId_archivedAt_idx" ON "crm_contacts"("organizationId", "companyId", "archivedAt");
