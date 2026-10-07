-- Conservation de la hiérarchie DQE lors des conversions Devis -> Contrat.

CREATE TABLE "sales_quote_lots" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "quoteId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "code" TEXT NOT NULL,
  "designation" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sales_quote_lots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sales_quote_lots_position_check" CHECK ("position" > 0),
  CONSTRAINT "sales_quote_lots_code_not_blank_check" CHECK (length(btrim("code")) > 0),
  CONSTRAINT "sales_quote_lots_designation_not_blank_check" CHECK (length(btrim("designation")) > 0)
);

CREATE TABLE "sales_contract_lots" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "contractId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "code" TEXT NOT NULL,
  "designation" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sales_contract_lots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sales_contract_lots_position_check" CHECK ("position" > 0),
  CONSTRAINT "sales_contract_lots_code_not_blank_check" CHECK (length(btrim("code")) > 0),
  CONSTRAINT "sales_contract_lots_designation_not_blank_check" CHECK (length(btrim("designation")) > 0)
);

ALTER TABLE "sales_quote_lines" ADD COLUMN "lotId" TEXT;
ALTER TABLE "sales_contract_lines" ADD COLUMN "lotId" TEXT;

CREATE UNIQUE INDEX "sales_quote_lots_quoteId_position_key" ON "sales_quote_lots"("quoteId", "position");
CREATE UNIQUE INDEX "sales_quote_lots_quoteId_code_key" ON "sales_quote_lots"("quoteId", "code");
CREATE UNIQUE INDEX "sales_quote_lots_id_organizationId_companyId_key" ON "sales_quote_lots"("id", "organizationId", "companyId");
CREATE INDEX "sales_quote_lots_organizationId_companyId_quoteId_position_idx" ON "sales_quote_lots"("organizationId", "companyId", "quoteId", "position");
CREATE INDEX "sales_quote_lines_organizationId_companyId_lotId_position_idx" ON "sales_quote_lines"("organizationId", "companyId", "lotId", "position");

CREATE UNIQUE INDEX "sales_contract_lots_contractId_position_key" ON "sales_contract_lots"("contractId", "position");
CREATE UNIQUE INDEX "sales_contract_lots_contractId_code_key" ON "sales_contract_lots"("contractId", "code");
CREATE UNIQUE INDEX "sales_contract_lots_id_organizationId_companyId_key" ON "sales_contract_lots"("id", "organizationId", "companyId");
CREATE INDEX "sales_contract_lots_organizationId_companyId_contractId_position_idx" ON "sales_contract_lots"("organizationId", "companyId", "contractId", "position");
CREATE INDEX "sales_contract_lines_organizationId_companyId_lotId_position_idx" ON "sales_contract_lines"("organizationId", "companyId", "lotId", "position");

ALTER TABLE "sales_quote_lots"
  ADD CONSTRAINT "sales_quote_lots_quoteId_organizationId_companyId_fkey"
  FOREIGN KEY ("quoteId", "organizationId", "companyId")
  REFERENCES "sales_quotes"("id", "organizationId", "companyId")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sales_quote_lines"
  ADD CONSTRAINT "sales_quote_lines_lotId_organizationId_companyId_fkey"
  FOREIGN KEY ("lotId", "organizationId", "companyId")
  REFERENCES "sales_quote_lots"("id", "organizationId", "companyId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sales_contract_lots"
  ADD CONSTRAINT "sales_contract_lots_contractId_organizationId_companyId_fkey"
  FOREIGN KEY ("contractId", "organizationId", "companyId")
  REFERENCES "sales_contracts"("id", "organizationId", "companyId")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sales_contract_lines"
  ADD CONSTRAINT "sales_contract_lines_lotId_organizationId_companyId_fkey"
  FOREIGN KEY ("lotId", "organizationId", "companyId")
  REFERENCES "sales_contract_lots"("id", "organizationId", "companyId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
