CREATE TYPE "BankStatementMatchStatus" AS ENUM ('UNMATCHED', 'MATCHED', 'IGNORED');

CREATE TABLE "bank_statement_entries" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "bankAccountId" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "bookedAt" TIMESTAMP(3) NOT NULL,
  "valueDate" TIMESTAMP(3),
  "description" TEXT NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "status" "BankStatementMatchStatus" NOT NULL DEFAULT 'UNMATCHED',
  "matchedPaymentId" TEXT,
  "matchedAt" TIMESTAMP(3),
  "matchedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bank_statement_entries_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "bank_statement_entries_company_account_external_key" ON "bank_statement_entries"("companyId", "bankAccountId", "externalId");
CREATE INDEX "bank_statement_entries_scope_status_date_idx" ON "bank_statement_entries"("organizationId", "companyId", "bankAccountId", "status", "bookedAt");
ALTER TABLE "bank_statement_entries" ADD CONSTRAINT "bank_statement_entries_amount_check" CHECK ("amount" <> 0);
ALTER TABLE "bank_statement_entries" ADD CONSTRAINT "bank_statement_entries_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$');
CREATE OR REPLACE FUNCTION axora_bank_statement_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'bank statement entries are append-only' USING ERRCODE = 'P0001'; END IF;
  IF NEW."organizationId" <> OLD."organizationId" OR NEW."companyId" <> OLD."companyId" OR NEW."bankAccountId" <> OLD."bankAccountId" OR NEW."externalId" <> OLD."externalId" OR NEW."bookedAt" <> OLD."bookedAt" OR NEW."valueDate" IS DISTINCT FROM OLD."valueDate" OR NEW."description" <> OLD."description" OR NEW."amount" <> OLD."amount" OR NEW."currency" <> OLD."currency" THEN
    RAISE EXCEPTION 'bank statement source is immutable' USING ERRCODE = 'P0001';
  END IF;
  IF OLD."status" = 'MATCHED' THEN RAISE EXCEPTION 'matched bank statement entries are immutable' USING ERRCODE = 'P0001'; END IF;
  IF NEW."status" = 'MATCHED' AND (NEW."matchedPaymentId" IS NULL OR NEW."matchedAt" IS NULL OR NEW."matchedByUserId" IS NULL) THEN RAISE EXCEPTION 'matched entries require payment and actor' USING ERRCODE = 'P0001'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER bank_statement_guard BEFORE UPDATE OR DELETE ON "bank_statement_entries" FOR EACH ROW EXECUTE FUNCTION axora_bank_statement_guard();
