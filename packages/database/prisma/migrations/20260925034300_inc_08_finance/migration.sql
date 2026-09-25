-- CreateEnum
CREATE TYPE "CustomerInvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SupplierInvoiceStatus" AS ENUM ('RECORDED', 'APPROVED', 'PARTIALLY_PAID', 'PAID', 'REJECTED');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('MATCHED', 'DISCREPANCY', 'NO_ORDER');

-- CreateEnum
CREATE TYPE "PaymentDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('TRANSFER', 'CHECK', 'CASH', 'MOBILE_MONEY', 'CARD');

-- CreateEnum
CREATE TYPE "BankAccountKind" AS ENUM ('BANK', 'CASH');

-- CreateTable
CREATE TABLE "tax_rates" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rate" DECIMAL(5,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "BankAccountKind" NOT NULL DEFAULT 'BANK',
    "currency" CHAR(3) NOT NULL,
    "iban" TEXT,
    "openingBalance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_invoices" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT,
    "customerName" TEXT NOT NULL,
    "customerAddress" TEXT,
    "contractId" TEXT,
    "projectId" TEXT,
    "currency" CHAR(3) NOT NULL,
    "issueDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "status" "CustomerInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "subtotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "taxTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "paidAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "issuedByUserId" TEXT,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_invoice_lines" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "unitPrice" DECIMAL(18,2) NOT NULL,
    "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(18,2) NOT NULL,
    "lineTax" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "customer_invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_invoices" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "orderId" TEXT,
    "projectId" TEXT,
    "supplierReference" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" "SupplierInvoiceStatus" NOT NULL DEFAULT 'RECORDED',
    "matchStatus" "MatchStatus" NOT NULL,
    "matchNotes" TEXT,
    "subtotal" DECIMAL(18,2) NOT NULL,
    "taxTotal" DECIMAL(18,2) NOT NULL,
    "total" DECIMAL(18,2) NOT NULL,
    "paidAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "recordedByUserId" TEXT NOT NULL,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_invoice_lines" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "orderLineId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "unitPrice" DECIMAL(18,2) NOT NULL,
    "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(18,2) NOT NULL,
    "lineTax" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "supplier_invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "direction" "PaymentDirection" NOT NULL,
    "customerInvoiceId" TEXT,
    "supplierInvoiceId" TEXT,
    "bankAccountId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tax_rates_organizationId_companyId_idx" ON "tax_rates"("organizationId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "tax_rates_companyId_name_key" ON "tax_rates"("companyId", "name");

-- CreateIndex
CREATE INDEX "bank_accounts_organizationId_companyId_idx" ON "bank_accounts"("organizationId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "bank_accounts_companyId_code_key" ON "bank_accounts"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "bank_accounts_id_organizationId_companyId_key" ON "bank_accounts"("id", "organizationId", "companyId");

-- CreateIndex
CREATE INDEX "customer_invoices_organizationId_companyId_status_idx" ON "customer_invoices"("organizationId", "companyId", "status");

-- CreateIndex
CREATE INDEX "customer_invoices_contractId_idx" ON "customer_invoices"("contractId");

-- CreateIndex
CREATE INDEX "customer_invoices_projectId_idx" ON "customer_invoices"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_invoices_companyId_code_key" ON "customer_invoices"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "customer_invoices_id_organizationId_companyId_key" ON "customer_invoices"("id", "organizationId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_invoice_lines_invoiceId_position_key" ON "customer_invoice_lines"("invoiceId", "position");

-- CreateIndex
CREATE INDEX "supplier_invoices_organizationId_companyId_status_idx" ON "supplier_invoices"("organizationId", "companyId", "status");

-- CreateIndex
CREATE INDEX "supplier_invoices_orderId_idx" ON "supplier_invoices"("orderId");

-- CreateIndex
CREATE INDEX "supplier_invoices_projectId_idx" ON "supplier_invoices"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_invoices_companyId_code_key" ON "supplier_invoices"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_invoices_supplierId_supplierReference_key" ON "supplier_invoices"("supplierId", "supplierReference");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_invoices_id_organizationId_companyId_key" ON "supplier_invoices"("id", "organizationId", "companyId");

-- CreateIndex
CREATE INDEX "supplier_invoice_lines_orderLineId_idx" ON "supplier_invoice_lines"("orderLineId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_invoice_lines_invoiceId_position_key" ON "supplier_invoice_lines"("invoiceId", "position");

-- CreateIndex
CREATE INDEX "payments_organizationId_companyId_paidAt_idx" ON "payments"("organizationId", "companyId", "paidAt");

-- CreateIndex
CREATE UNIQUE INDEX "payments_companyId_code_key" ON "payments"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "payments_companyId_idempotencyKey_key" ON "payments"("companyId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "customer_invoice_lines" ADD CONSTRAINT "customer_invoice_lines_invoiceId_organizationId_companyId_fkey" FOREIGN KEY ("invoiceId", "organizationId", "companyId") REFERENCES "customer_invoices"("id", "organizationId", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_invoiceId_organizationId_companyId_fkey" FOREIGN KEY ("invoiceId", "organizationId", "companyId") REFERENCES "supplier_invoices"("id", "organizationId", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_bankAccountId_organizationId_companyId_fkey" FOREIGN KEY ("bankAccountId", "organizationId", "companyId") REFERENCES "bank_accounts"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_customerInvoiceId_organizationId_companyId_fkey" FOREIGN KEY ("customerInvoiceId", "organizationId", "companyId") REFERENCES "customer_invoices"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_supplierInvoiceId_organizationId_companyId_fkey" FOREIGN KEY ("supplierInvoiceId", "organizationId", "companyId") REFERENCES "supplier_invoices"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Garanties en base (INC-08)
-- ---------------------------------------------------------------------------
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amount_positive" CHECK ("amount" > 0),
  ADD CONSTRAINT "payments_single_invoice" CHECK (
    ("direction" = 'IN' AND "customerInvoiceId" IS NOT NULL AND "supplierInvoiceId" IS NULL)
    OR ("direction" = 'OUT' AND "supplierInvoiceId" IS NOT NULL AND "customerInvoiceId" IS NULL)
  );
-- Jamais plus paye que du : garanti en base, en plus du controle applicatif sous verrou.
ALTER TABLE "customer_invoices" ADD CONSTRAINT "customer_invoices_not_overpaid" CHECK ("paidAmount" >= 0 AND "paidAmount" <= "total");
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_not_overpaid" CHECK ("paidAmount" >= 0 AND "paidAmount" <= "total");
-- Les paiements sont des faits comptables : append-only.
CREATE TRIGGER "payments_append_only"
  BEFORE UPDATE OR DELETE ON "payments"
  FOR EACH ROW EXECUTE FUNCTION axora_forbid_mutation();
