CREATE TABLE "dqe_variants" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "dqeId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "revision" INTEGER NOT NULL,
  "overheadRate" DECIMAL(9,6) NOT NULL,
  "marginRate" DECIMAL(9,6) NOT NULL,
  "taxRate" DECIMAL(9,6) NOT NULL,
  "subtotal" DECIMAL(24,6) NOT NULL,
  "total" DECIMAL(24,6) NOT NULL,
  "snapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "dqe_variants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "dqe_variants_dqeId_code_key" ON "dqe_variants"("dqeId", "code");
CREATE INDEX "dqe_variants_organizationId_companyId_dqeId_createdAt_idx" ON "dqe_variants"("organizationId", "companyId", "dqeId", "createdAt");

ALTER TABLE "dqe_variants"
  ADD CONSTRAINT "dqe_variants_dqeId_organizationId_companyId_fkey"
  FOREIGN KEY ("dqeId", "organizationId", "companyId")
  REFERENCES "dqe_documents"("id", "organizationId", "companyId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
