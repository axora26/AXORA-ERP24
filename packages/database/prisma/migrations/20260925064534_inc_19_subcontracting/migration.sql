-- CreateEnum
CREATE TYPE "SubcontractorStatus" AS ENUM ('PENDING', 'QUALIFIED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "SubcontractorDocumentKind" AS ENUM ('RCCM', 'TAX_CERTIFICATE', 'SOCIAL_CERTIFICATE', 'LIABILITY_INSURANCE', 'DECENNIAL_INSURANCE', 'OTHER');

-- CreateEnum
CREATE TYPE "SubcontractPackageStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "SubcontractStatementStatus" AS ENUM ('DRAFT', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SubcontractRetentionStatus" AS ENUM ('HELD', 'RELEASED');

-- CreateTable
CREATE TABLE "subcontractor_profiles" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "trades" TEXT NOT NULL,
    "workforce" INTEGER,
    "status" "SubcontractorStatus" NOT NULL DEFAULT 'PENDING',
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subcontractor_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subcontractor_documents" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "kind" "SubcontractorDocumentKind" NOT NULL,
    "reference" TEXT NOT NULL,
    "issuer" TEXT,
    "validFrom" DATE NOT NULL,
    "validUntil" DATE NOT NULL,
    "fileId" TEXT,
    "recordedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subcontractor_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subcontract_packages" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "wbsItemId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "retentionRate" DECIMAL(5,2) NOT NULL,
    "retentionReleaseDays" INTEGER NOT NULL,
    "status" "SubcontractPackageStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdByUserId" TEXT NOT NULL,
    "closedByUserId" TEXT,
    "closedAt" TIMESTAMP(3),
    "closureNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subcontract_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subcontract_statements" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "periodEnd" DATE NOT NULL,
    "cumulativePercent" DECIMAL(7,4) NOT NULL,
    "previousPercent" DECIMAL(7,4) NOT NULL,
    "doneTasks" INTEGER NOT NULL,
    "totalTasks" INTEGER NOT NULL,
    "grossAmount" DECIMAL(18,2) NOT NULL,
    "retentionAmount" DECIMAL(18,2) NOT NULL,
    "netAmount" DECIMAL(18,2) NOT NULL,
    "status" "SubcontractStatementStatus" NOT NULL DEFAULT 'DRAFT',
    "preparedByUserId" TEXT NOT NULL,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "supplierInvoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subcontract_statements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subcontract_retentions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "statementId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "releaseCondition" TEXT NOT NULL,
    "releaseDueDate" DATE NOT NULL,
    "status" "SubcontractRetentionStatus" NOT NULL DEFAULT 'HELD',
    "guaranteeReference" TEXT,
    "releasedByUserId" TEXT,
    "releasedAt" TIMESTAMP(3),
    "releaseNote" TEXT,
    "releaseInvoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subcontract_retentions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "subcontractor_profiles_supplierId_organizationId_companyId_key" ON "subcontractor_profiles"("supplierId", "organizationId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "subcontractor_profiles_id_organizationId_companyId_key" ON "subcontractor_profiles"("id", "organizationId", "companyId");

-- CreateIndex
CREATE INDEX "subcontractor_documents_profileId_kind_validUntil_idx" ON "subcontractor_documents"("profileId", "kind", "validUntil");

-- CreateIndex
CREATE INDEX "subcontract_packages_organizationId_companyId_projectId_idx" ON "subcontract_packages"("organizationId", "companyId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "subcontract_packages_companyId_code_key" ON "subcontract_packages"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "subcontract_packages_purchaseOrderId_organizationId_company_key" ON "subcontract_packages"("purchaseOrderId", "organizationId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "subcontract_packages_id_organizationId_companyId_key" ON "subcontract_packages"("id", "organizationId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "subcontract_statements_supplierInvoiceId_key" ON "subcontract_statements"("supplierInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "subcontract_statements_companyId_code_key" ON "subcontract_statements"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "subcontract_statements_packageId_number_key" ON "subcontract_statements"("packageId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "subcontract_statements_id_organizationId_companyId_key" ON "subcontract_statements"("id", "organizationId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "subcontract_retentions_releaseInvoiceId_key" ON "subcontract_retentions"("releaseInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "subcontract_retentions_statementId_organizationId_companyId_key" ON "subcontract_retentions"("statementId", "organizationId", "companyId");

-- AddForeignKey
ALTER TABLE "subcontractor_profiles" ADD CONSTRAINT "subcontractor_profiles_supplierId_organizationId_companyId_fkey" FOREIGN KEY ("supplierId", "organizationId", "companyId") REFERENCES "suppliers"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontractor_documents" ADD CONSTRAINT "subcontractor_documents_profileId_organizationId_companyId_fkey" FOREIGN KEY ("profileId", "organizationId", "companyId") REFERENCES "subcontractor_profiles"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontract_packages" ADD CONSTRAINT "subcontract_packages_purchaseOrderId_organizationId_compan_fkey" FOREIGN KEY ("purchaseOrderId", "organizationId", "companyId") REFERENCES "purchase_orders"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontract_statements" ADD CONSTRAINT "subcontract_statements_packageId_organizationId_companyId_fkey" FOREIGN KEY ("packageId", "organizationId", "companyId") REFERENCES "subcontract_packages"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontract_retentions" ADD CONSTRAINT "subcontract_retentions_packageId_organizationId_companyId_fkey" FOREIGN KEY ("packageId", "organizationId", "companyId") REFERENCES "subcontract_packages"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontract_retentions" ADD CONSTRAINT "subcontract_retentions_statementId_organizationId_companyI_fkey" FOREIGN KEY ("statementId", "organizationId", "companyId") REFERENCES "subcontract_statements"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Garanties en base (INC-19)
-- ---------------------------------------------------------------------------

ALTER TABLE "subcontractor_profiles" ADD CONSTRAINT "subcontractor_profiles_decision" CHECK ("status" = 'PENDING' OR ("decidedByUserId" IS NOT NULL AND "decidedAt" IS NOT NULL));
ALTER TABLE "subcontractor_profiles" ADD CONSTRAINT "subcontractor_profiles_four_eyes" CHECK ("decidedByUserId" IS NULL OR "decidedByUserId" <> "createdByUserId");

ALTER TABLE "subcontractor_documents" ADD CONSTRAINT "subcontractor_documents_validity" CHECK ("validUntil" >= "validFrom");
CREATE TRIGGER "subcontractor_documents_append_only" BEFORE UPDATE OR DELETE ON "subcontractor_documents" FOR EACH ROW EXECUTE FUNCTION axora_forbid_mutation();

ALTER TABLE "subcontract_packages" ADD CONSTRAINT "subcontract_packages_terms" CHECK ("amount" > 0 AND "retentionRate" >= 0 AND "retentionRate" <= 10 AND "retentionReleaseDays" BETWEEN 0 AND 730);
CREATE TRIGGER "subcontract_packages_no_delete" BEFORE DELETE ON "subcontract_packages" FOR EACH ROW EXECUTE FUNCTION axora_forbid_delete();

-- Situation : montants coherents et figes ; approbation par une autre personne que le preparateur.
ALTER TABLE "subcontract_statements" ADD CONSTRAINT "subcontract_statements_amounts" CHECK (
  "cumulativePercent" > "previousPercent" AND "cumulativePercent" <= 100 AND "previousPercent" >= 0
  AND "grossAmount" > 0 AND "retentionAmount" >= 0 AND "netAmount" = "grossAmount" - "retentionAmount"
);
ALTER TABLE "subcontract_statements" ADD CONSTRAINT "subcontract_statements_four_eyes" CHECK (
  "status" = 'DRAFT' OR ("decidedByUserId" IS NOT NULL AND "decidedAt" IS NOT NULL AND "decidedByUserId" <> "preparedByUserId")
);
CREATE OR REPLACE FUNCTION axora_subcontract_statement_guard() RETURNS trigger AS $$
BEGIN
  IF NEW."cumulativePercent" <> OLD."cumulativePercent" OR NEW."previousPercent" <> OLD."previousPercent" OR NEW."grossAmount" <> OLD."grossAmount"
     OR NEW."retentionAmount" <> OLD."retentionAmount" OR NEW."netAmount" <> OLD."netAmount" OR NEW."packageId" <> OLD."packageId" OR NEW."number" <> OLD."number" THEN
    RAISE EXCEPTION 'Statement % figures are frozen', OLD."code" USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD."status" <> 'DRAFT' AND (NEW."status" <> OLD."status" OR NEW."decidedByUserId" IS DISTINCT FROM OLD."decidedByUserId") THEN
    RAISE EXCEPTION 'Statement % is decided', OLD."code" USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD."supplierInvoiceId" IS NOT NULL AND NEW."supplierInvoiceId" IS DISTINCT FROM OLD."supplierInvoiceId" THEN
    RAISE EXCEPTION 'Statement % is already invoiced', OLD."code" USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "subcontract_statements_guard" BEFORE UPDATE ON "subcontract_statements" FOR EACH ROW EXECUTE FUNCTION axora_subcontract_statement_guard();
CREATE TRIGGER "subcontract_statements_no_delete" BEFORE DELETE ON "subcontract_statements" FOR EACH ROW EXECUTE FUNCTION axora_forbid_delete();

-- Retenue de garantie : montant fige ; liberation tracee, a echeance ou contre caution.
ALTER TABLE "subcontract_retentions" ADD CONSTRAINT "subcontract_retentions_release" CHECK (
  "amount" > 0 AND length(btrim("releaseCondition")) > 0
  AND ("status" = 'HELD' OR ("releasedByUserId" IS NOT NULL AND "releasedAt" IS NOT NULL
       AND ("releasedAt"::date >= "releaseDueDate" OR length(btrim(coalesce("guaranteeReference", ''))) > 0)))
);
CREATE OR REPLACE FUNCTION axora_subcontract_retention_guard() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'RELEASED' AND NEW."releaseInvoiceId" IS NOT DISTINCT FROM OLD."releaseInvoiceId" THEN
    RAISE EXCEPTION 'Retention is already released' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD."status" = 'RELEASED' AND OLD."releaseInvoiceId" IS NOT NULL THEN
    RAISE EXCEPTION 'Retention is already released and invoiced' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW."amount" <> OLD."amount" OR NEW."releaseDueDate" <> OLD."releaseDueDate" OR NEW."statementId" <> OLD."statementId" THEN
    RAISE EXCEPTION 'Retention terms are frozen' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "subcontract_retentions_guard" BEFORE UPDATE ON "subcontract_retentions" FOR EACH ROW EXECUTE FUNCTION axora_subcontract_retention_guard();
CREATE TRIGGER "subcontract_retentions_no_delete" BEFORE DELETE ON "subcontract_retentions" FOR EACH ROW EXECUTE FUNCTION axora_forbid_delete();
