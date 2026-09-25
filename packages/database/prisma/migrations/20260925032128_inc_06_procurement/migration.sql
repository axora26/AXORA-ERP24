-- CreateEnum
CREATE TYPE "PurchaseRequestStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'ORDERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'ISSUED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED');

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "taxId" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "country" TEXT,
    "category" TEXT,
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 30,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_requests" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "justification" TEXT,
    "projectId" TEXT,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "neededBy" TIMESTAMP(3),
    "status" "PurchaseRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "requestedByUserId" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_request_lines" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "unitCode" TEXT NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "estimatedUnitPrice" DECIMAL(18,2) NOT NULL,
    "wbsItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_request_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_quotes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "reference" TEXT,
    "validUntil" TIMESTAMP(3),
    "deliveryDays" INTEGER,
    "note" TEXT,
    "total" DECIMAL(18,2) NOT NULL,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_quote_lines" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "requestLineId" TEXT NOT NULL,
    "unitPrice" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "supplier_quote_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "requestId" TEXT,
    "quoteId" TEXT,
    "projectId" TEXT,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "total" DECIMAL(18,2) NOT NULL,
    "expectedDate" TIMESTAMP(3),
    "issuedAt" TIMESTAMP(3),
    "issuedByUserId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_lines" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "unitCode" TEXT NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "unitPrice" DECIMAL(18,2) NOT NULL,
    "lineTotal" DECIMAL(18,2) NOT NULL,
    "receivedQuantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "projectId" TEXT,
    "wbsItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "note" TEXT,
    "receivedByUserId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipt_lines" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,

    CONSTRAINT "goods_receipt_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_evaluations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "orderId" TEXT,
    "quality" INTEGER NOT NULL,
    "delivery" INTEGER NOT NULL,
    "price" INTEGER NOT NULL,
    "comment" TEXT,
    "evaluatedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "suppliers_organizationId_companyId_isActive_idx" ON "suppliers"("organizationId", "companyId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_companyId_code_key" ON "suppliers"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_companyId_name_key" ON "suppliers"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_id_organizationId_companyId_key" ON "suppliers"("id", "organizationId", "companyId");

-- CreateIndex
CREATE INDEX "purchase_requests_organizationId_companyId_status_idx" ON "purchase_requests"("organizationId", "companyId", "status");

-- CreateIndex
CREATE INDEX "purchase_requests_projectId_idx" ON "purchase_requests"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_requests_companyId_code_key" ON "purchase_requests"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_requests_id_organizationId_companyId_key" ON "purchase_requests"("id", "organizationId", "companyId");

-- CreateIndex
CREATE INDEX "purchase_request_lines_organizationId_companyId_requestId_idx" ON "purchase_request_lines"("organizationId", "companyId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_request_lines_requestId_position_key" ON "purchase_request_lines"("requestId", "position");

-- CreateIndex
CREATE INDEX "supplier_quotes_organizationId_companyId_requestId_idx" ON "supplier_quotes"("organizationId", "companyId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_quotes_requestId_supplierId_key" ON "supplier_quotes"("requestId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_quote_lines_quoteId_requestLineId_key" ON "supplier_quote_lines"("quoteId", "requestLineId");

-- CreateIndex
CREATE INDEX "purchase_orders_organizationId_companyId_status_idx" ON "purchase_orders"("organizationId", "companyId", "status");

-- CreateIndex
CREATE INDEX "purchase_orders_projectId_idx" ON "purchase_orders"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_companyId_code_key" ON "purchase_orders"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_id_organizationId_companyId_key" ON "purchase_orders"("id", "organizationId", "companyId");

-- CreateIndex
CREATE INDEX "purchase_order_lines_organizationId_companyId_orderId_idx" ON "purchase_order_lines"("organizationId", "companyId", "orderId");

-- CreateIndex
CREATE INDEX "purchase_order_lines_projectId_idx" ON "purchase_order_lines"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_lines_orderId_position_key" ON "purchase_order_lines"("orderId", "position");

-- CreateIndex
CREATE INDEX "goods_receipts_organizationId_companyId_orderId_idx" ON "goods_receipts"("organizationId", "companyId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipts_companyId_code_key" ON "goods_receipts"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipts_companyId_idempotencyKey_key" ON "goods_receipts"("companyId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "goods_receipt_lines_orderLineId_idx" ON "goods_receipt_lines"("orderLineId");

-- CreateIndex
CREATE INDEX "supplier_evaluations_organizationId_companyId_supplierId_idx" ON "supplier_evaluations"("organizationId", "companyId", "supplierId");

-- AddForeignKey
ALTER TABLE "purchase_request_lines" ADD CONSTRAINT "purchase_request_lines_requestId_organizationId_companyId_fkey" FOREIGN KEY ("requestId", "organizationId", "companyId") REFERENCES "purchase_requests"("id", "organizationId", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_quotes" ADD CONSTRAINT "supplier_quotes_requestId_organizationId_companyId_fkey" FOREIGN KEY ("requestId", "organizationId", "companyId") REFERENCES "purchase_requests"("id", "organizationId", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_quotes" ADD CONSTRAINT "supplier_quotes_supplierId_organizationId_companyId_fkey" FOREIGN KEY ("supplierId", "organizationId", "companyId") REFERENCES "suppliers"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_quote_lines" ADD CONSTRAINT "supplier_quote_lines_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "supplier_quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_quote_lines" ADD CONSTRAINT "supplier_quote_lines_requestLineId_fkey" FOREIGN KEY ("requestLineId") REFERENCES "purchase_request_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplierId_organizationId_companyId_fkey" FOREIGN KEY ("supplierId", "organizationId", "companyId") REFERENCES "suppliers"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_requestId_organizationId_companyId_fkey" FOREIGN KEY ("requestId", "organizationId", "companyId") REFERENCES "purchase_requests"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_orderId_organizationId_companyId_fkey" FOREIGN KEY ("orderId", "organizationId", "companyId") REFERENCES "purchase_orders"("id", "organizationId", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_orderId_organizationId_companyId_fkey" FOREIGN KEY ("orderId", "organizationId", "companyId") REFERENCES "purchase_orders"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "goods_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "purchase_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_evaluations" ADD CONSTRAINT "supplier_evaluations_supplierId_organizationId_companyId_fkey" FOREIGN KEY ("supplierId", "organizationId", "companyId") REFERENCES "suppliers"("id", "organizationId", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;
