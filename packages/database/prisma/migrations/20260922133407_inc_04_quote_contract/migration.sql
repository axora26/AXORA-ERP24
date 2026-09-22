-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateTable
CREATE TABLE "sales_quotes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "dqeId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "subtotal" DECIMAL(24,6) NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_quote_lines" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "reference" TEXT,
    "designation" TEXT NOT NULL,
    "unitCode" TEXT NOT NULL,
    "quantity" DECIMAL(24,6) NOT NULL,
    "unitPrice" DECIMAL(24,6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_quote_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_contracts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "subtotal" DECIMAL(24,6) NOT NULL,
    "status" "ContractStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_contract_lines" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "reference" TEXT,
    "designation" TEXT NOT NULL,
    "unitCode" TEXT NOT NULL,
    "quantity" DECIMAL(24,6) NOT NULL,
    "unitPrice" DECIMAL(24,6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_contract_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sales_quotes_organizationId_companyId_status_createdAt_idx" ON "sales_quotes"("organizationId", "companyId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "sales_quotes_opportunityId_idx" ON "sales_quotes"("opportunityId");

-- CreateIndex
CREATE INDEX "sales_quotes_dqeId_idx" ON "sales_quotes"("dqeId");

-- CreateIndex
CREATE UNIQUE INDEX "sales_quotes_companyId_code_key" ON "sales_quotes"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "sales_quotes_id_organizationId_companyId_key" ON "sales_quotes"("id", "organizationId", "companyId");

-- CreateIndex
CREATE INDEX "sales_quote_lines_organizationId_companyId_quoteId_position_idx" ON "sales_quote_lines"("organizationId", "companyId", "quoteId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "sales_quote_lines_quoteId_position_key" ON "sales_quote_lines"("quoteId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "sales_contracts_quoteId_key" ON "sales_contracts"("quoteId");

-- CreateIndex
CREATE INDEX "sales_contracts_organizationId_companyId_status_createdAt_idx" ON "sales_contracts"("organizationId", "companyId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "sales_contracts_opportunityId_idx" ON "sales_contracts"("opportunityId");

-- CreateIndex
CREATE UNIQUE INDEX "sales_contracts_companyId_code_key" ON "sales_contracts"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "sales_contracts_id_organizationId_companyId_key" ON "sales_contracts"("id", "organizationId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "sales_contracts_quoteId_organizationId_companyId_key" ON "sales_contracts"("quoteId", "organizationId", "companyId");

-- CreateIndex
CREATE INDEX "sales_contract_lines_organizationId_companyId_contractId_po_idx" ON "sales_contract_lines"("organizationId", "companyId", "contractId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "sales_contract_lines_contractId_position_key" ON "sales_contract_lines"("contractId", "position");

-- AddForeignKey
ALTER TABLE "sales_quote_lines" ADD CONSTRAINT "sales_quote_lines_quoteId_organizationId_companyId_fkey" FOREIGN KEY ("quoteId", "organizationId", "companyId") REFERENCES "sales_quotes"("id", "organizationId", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_contracts" ADD CONSTRAINT "sales_contracts_quoteId_organizationId_companyId_fkey" FOREIGN KEY ("quoteId", "organizationId", "companyId") REFERENCES "sales_quotes"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_contract_lines" ADD CONSTRAINT "sales_contract_lines_contractId_organizationId_companyId_fkey" FOREIGN KEY ("contractId", "organizationId", "companyId") REFERENCES "sales_contracts"("id", "organizationId", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;
