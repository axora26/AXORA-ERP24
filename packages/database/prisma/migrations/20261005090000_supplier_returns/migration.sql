-- INC-06 — Retour physique fournisseur.
-- receivedQuantity devient le recu NET (receptions - retours) ; returnedQuantity
-- cumule les retours. Les bornes sont garanties en base, pas seulement par l'API.

-- AlterEnum
ALTER TYPE "StockMovementType" ADD VALUE 'SUPPLIER_RETURN';

-- AlterTable
ALTER TABLE "purchase_order_lines" ADD COLUMN "returnedQuantity" DECIMAL(18,3) NOT NULL DEFAULT 0;
ALTER TABLE "purchase_order_lines"
  ADD CONSTRAINT "purchase_order_lines_returned_non_negative" CHECK ("returnedQuantity" >= 0),
  ADD CONSTRAINT "purchase_order_lines_received_bounds" CHECK ("receivedQuantity" >= 0 AND "receivedQuantity" <= "quantity");

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN "supplierReturnLineId" TEXT;

-- CreateTable
CREATE TABLE "supplier_returns" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "warehouseId" TEXT,
    "returnedByUserId" TEXT NOT NULL,
    "returnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_returns_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "supplier_returns_reason_not_blank" CHECK (length(btrim("reason")) > 0)
);

-- CreateTable
CREATE TABLE "supplier_return_lines" (
    "id" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "value" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "supplier_return_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "supplier_return_lines_quantity_positive" CHECK ("quantity" > 0),
    CONSTRAINT "supplier_return_lines_value_non_negative" CHECK ("value" >= 0)
);

-- CreateIndex
CREATE INDEX "supplier_returns_organizationId_companyId_orderId_idx" ON "supplier_returns"("organizationId", "companyId", "orderId");
CREATE UNIQUE INDEX "supplier_returns_companyId_code_key" ON "supplier_returns"("companyId", "code");
CREATE UNIQUE INDEX "supplier_returns_companyId_idempotencyKey_key" ON "supplier_returns"("companyId", "idempotencyKey");
CREATE INDEX "supplier_return_lines_orderLineId_idx" ON "supplier_return_lines"("orderLineId");
CREATE UNIQUE INDEX "supplier_return_lines_returnId_orderLineId_key" ON "supplier_return_lines"("returnId", "orderLineId");

-- AddForeignKey
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_orderId_organizationId_companyId_fkey" FOREIGN KEY ("orderId", "organizationId", "companyId") REFERENCES "purchase_orders"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_return_lines" ADD CONSTRAINT "supplier_return_lines_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "supplier_returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_return_lines" ADD CONSTRAINT "supplier_return_lines_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "purchase_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Un retour est une piece justificative : immuable une fois enregistre.
CREATE TRIGGER "supplier_returns_append_only"
  BEFORE UPDATE OR DELETE ON "supplier_returns"
  FOR EACH ROW EXECUTE FUNCTION axora_forbid_mutation();
CREATE TRIGGER "supplier_return_lines_append_only"
  BEFORE UPDATE OR DELETE ON "supplier_return_lines"
  FOR EACH ROW EXECUTE FUNCTION axora_forbid_mutation();
