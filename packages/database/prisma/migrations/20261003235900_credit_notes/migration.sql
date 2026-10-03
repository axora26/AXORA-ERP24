-- CreateEnum
CREATE TYPE "CreditNoteStatus" AS ENUM ('DRAFT', 'ISSUED', 'CANCELLED');

-- CreateTable
CREATE TABLE "customer_credit_notes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "sourceInvoiceId" TEXT NOT NULL,
    "code" TEXT,
    "currency" CHAR(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "CreditNoteStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "issueDate" TIMESTAMP(3),
    "subtotal" DECIMAL(18,2) NOT NULL,
    "taxTotal" DECIMAL(18,2) NOT NULL,
    "total" DECIMAL(18,2) NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "issuedByUserId" TEXT,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_credit_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_credit_note_lines" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "creditNoteId" TEXT NOT NULL,
    "sourceInvoiceId" TEXT NOT NULL,
    "sourceInvoiceLineId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(24,6) NOT NULL,
    "unitPrice" DECIMAL(24,6) NOT NULL,
    "taxRate" DECIMAL(5,2) NOT NULL,
    "lineTotal" DECIMAL(18,2) NOT NULL,
    "lineTax" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "customer_credit_note_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_credit_notes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "sourceInvoiceId" TEXT NOT NULL,
    "code" TEXT,
    "currency" CHAR(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "CreditNoteStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "issueDate" TIMESTAMP(3),
    "subtotal" DECIMAL(18,2) NOT NULL,
    "taxTotal" DECIMAL(18,2) NOT NULL,
    "total" DECIMAL(18,2) NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "issuedByUserId" TEXT,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_credit_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_credit_note_lines" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "creditNoteId" TEXT NOT NULL,
    "sourceInvoiceId" TEXT NOT NULL,
    "sourceInvoiceLineId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "unitPrice" DECIMAL(18,2) NOT NULL,
    "taxRate" DECIMAL(5,2) NOT NULL,
    "lineTotal" DECIMAL(18,2) NOT NULL,
    "lineTax" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "supplier_credit_note_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_refunds" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "direction" "PaymentDirection" NOT NULL,
    "customerCreditNoteId" TEXT,
    "supplierCreditNoteId" TEXT,
    "bankAccountId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "refundedAt" TIMESTAMP(3) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_refunds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_credit_notes_organizationId_companyId_status_creat_idx" ON "customer_credit_notes"("organizationId", "companyId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "customer_credit_notes_sourceInvoiceId_idx" ON "customer_credit_notes"("sourceInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_credit_notes_companyId_code_key" ON "customer_credit_notes"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "customer_credit_notes_id_organizationId_companyId_key" ON "customer_credit_notes"("id", "organizationId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_credit_notes_id_sourceInvoiceId_organizationId_com_key" ON "customer_credit_notes"("id", "sourceInvoiceId", "organizationId", "companyId");

-- CreateIndex
CREATE INDEX "customer_credit_note_lines_sourceInvoiceLineId_idx" ON "customer_credit_note_lines"("sourceInvoiceLineId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_credit_note_lines_creditNoteId_sourceInvoiceLineId_key" ON "customer_credit_note_lines"("creditNoteId", "sourceInvoiceLineId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_credit_note_lines_creditNoteId_position_key" ON "customer_credit_note_lines"("creditNoteId", "position");

-- CreateIndex
CREATE INDEX "supplier_credit_notes_organizationId_companyId_status_creat_idx" ON "supplier_credit_notes"("organizationId", "companyId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "supplier_credit_notes_sourceInvoiceId_idx" ON "supplier_credit_notes"("sourceInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_credit_notes_companyId_code_key" ON "supplier_credit_notes"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_credit_notes_id_organizationId_companyId_key" ON "supplier_credit_notes"("id", "organizationId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_credit_notes_id_sourceInvoiceId_organizationId_com_key" ON "supplier_credit_notes"("id", "sourceInvoiceId", "organizationId", "companyId");

-- CreateIndex
CREATE INDEX "supplier_credit_note_lines_sourceInvoiceLineId_idx" ON "supplier_credit_note_lines"("sourceInvoiceLineId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_credit_note_lines_creditNoteId_sourceInvoiceLineId_key" ON "supplier_credit_note_lines"("creditNoteId", "sourceInvoiceLineId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_credit_note_lines_creditNoteId_position_key" ON "supplier_credit_note_lines"("creditNoteId", "position");

-- CreateIndex
CREATE INDEX "credit_refunds_organizationId_companyId_refundedAt_idx" ON "credit_refunds"("organizationId", "companyId", "refundedAt");

-- CreateIndex
CREATE UNIQUE INDEX "credit_refunds_companyId_code_key" ON "credit_refunds"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "credit_refunds_companyId_idempotencyKey_key" ON "credit_refunds"("companyId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "customer_invoice_lines_id_invoiceId_organizationId_companyI_key" ON "customer_invoice_lines"("id", "invoiceId", "organizationId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_invoice_lines_id_invoiceId_organizationId_companyI_key" ON "supplier_invoice_lines"("id", "invoiceId", "organizationId", "companyId");

-- AddForeignKey
ALTER TABLE "customer_credit_notes" ADD CONSTRAINT "customer_credit_notes_sourceInvoiceId_organizationId_compa_fkey" FOREIGN KEY ("sourceInvoiceId", "organizationId", "companyId") REFERENCES "customer_invoices"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_credit_note_lines" ADD CONSTRAINT "customer_credit_note_lines_creditNoteId_sourceInvoiceId_or_fkey" FOREIGN KEY ("creditNoteId", "sourceInvoiceId", "organizationId", "companyId") REFERENCES "customer_credit_notes"("id", "sourceInvoiceId", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_credit_note_lines" ADD CONSTRAINT "customer_credit_note_lines_sourceInvoiceLineId_sourceInvoi_fkey" FOREIGN KEY ("sourceInvoiceLineId", "sourceInvoiceId", "organizationId", "companyId") REFERENCES "customer_invoice_lines"("id", "invoiceId", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_credit_notes" ADD CONSTRAINT "supplier_credit_notes_sourceInvoiceId_organizationId_compa_fkey" FOREIGN KEY ("sourceInvoiceId", "organizationId", "companyId") REFERENCES "supplier_invoices"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_credit_note_lines" ADD CONSTRAINT "supplier_credit_note_lines_creditNoteId_sourceInvoiceId_or_fkey" FOREIGN KEY ("creditNoteId", "sourceInvoiceId", "organizationId", "companyId") REFERENCES "supplier_credit_notes"("id", "sourceInvoiceId", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_credit_note_lines" ADD CONSTRAINT "supplier_credit_note_lines_sourceInvoiceLineId_sourceInvoi_fkey" FOREIGN KEY ("sourceInvoiceLineId", "sourceInvoiceId", "organizationId", "companyId") REFERENCES "supplier_invoice_lines"("id", "invoiceId", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_refunds" ADD CONSTRAINT "credit_refunds_customerCreditNoteId_organizationId_company_fkey" FOREIGN KEY ("customerCreditNoteId", "organizationId", "companyId") REFERENCES "customer_credit_notes"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_refunds" ADD CONSTRAINT "credit_refunds_supplierCreditNoteId_organizationId_company_fkey" FOREIGN KEY ("supplierCreditNoteId", "organizationId", "companyId") REFERENCES "supplier_credit_notes"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_refunds" ADD CONSTRAINT "credit_refunds_bankAccountId_organizationId_companyId_fkey" FOREIGN KEY ("bankAccountId", "organizationId", "companyId") REFERENCES "bank_accounts"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

