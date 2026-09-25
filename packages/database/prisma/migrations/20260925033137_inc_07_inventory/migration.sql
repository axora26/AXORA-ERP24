-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('RECEIPT', 'ISSUE', 'RETURN', 'TRANSFER_OUT', 'TRANSFER_IN', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT');

-- CreateEnum
CREATE TYPE "WarehouseKind" AS ENUM ('WAREHOUSE', 'SITE');

-- CreateEnum
CREATE TYPE "StockCountStatus" AS ENUM ('OPEN', 'CLOSED');

-- AlterTable
ALTER TABLE "goods_receipts" ADD COLUMN     "warehouseId" TEXT;

-- AlterTable
ALTER TABLE "purchase_order_lines" ADD COLUMN     "inventoryItemId" TEXT;

-- AlterTable
ALTER TABLE "purchase_request_lines" ADD COLUMN     "inventoryItemId" TEXT;

-- CreateTable
CREATE TABLE "inventory_items" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unitCode" TEXT NOT NULL,
    "category" TEXT,
    "barcode" TEXT,
    "minStock" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouses" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "WarehouseKind" NOT NULL DEFAULT 'WAREHOUSE',
    "projectId" TEXT,
    "location" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_balances" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "value" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "quantityDelta" DECIMAL(18,3) NOT NULL,
    "unitCost" DECIMAL(18,4) NOT NULL,
    "valueDelta" DECIMAL(18,2) NOT NULL,
    "projectId" TEXT,
    "wbsItemId" TEXT,
    "goodsReceiptLineId" TEXT,
    "transferGroupId" TEXT,
    "countId" TEXT,
    "reference" TEXT,
    "reason" TEXT,
    "idempotencyKey" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_counts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "status" "StockCountStatus" NOT NULL DEFAULT 'OPEN',
    "createdByUserId" TEXT NOT NULL,
    "closedByUserId" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_count_lines" (
    "id" TEXT NOT NULL,
    "countId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "systemQuantity" DECIMAL(18,3) NOT NULL,
    "countedQuantity" DECIMAL(18,3),

    CONSTRAINT "stock_count_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inventory_items_organizationId_companyId_isActive_idx" ON "inventory_items"("organizationId", "companyId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_items_companyId_code_key" ON "inventory_items"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_items_id_organizationId_companyId_key" ON "inventory_items"("id", "organizationId", "companyId");

-- CreateIndex
CREATE INDEX "warehouses_organizationId_companyId_idx" ON "warehouses"("organizationId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_companyId_code_key" ON "warehouses"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_id_organizationId_companyId_key" ON "warehouses"("id", "organizationId", "companyId");

-- CreateIndex
CREATE INDEX "stock_balances_organizationId_companyId_warehouseId_idx" ON "stock_balances"("organizationId", "companyId", "warehouseId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_balances_itemId_warehouseId_key" ON "stock_balances"("itemId", "warehouseId");

-- CreateIndex
CREATE INDEX "stock_movements_organizationId_companyId_itemId_createdAt_idx" ON "stock_movements"("organizationId", "companyId", "itemId", "createdAt");

-- CreateIndex
CREATE INDEX "stock_movements_organizationId_companyId_warehouseId_create_idx" ON "stock_movements"("organizationId", "companyId", "warehouseId", "createdAt");

-- CreateIndex
CREATE INDEX "stock_movements_projectId_idx" ON "stock_movements"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_movements_companyId_idempotencyKey_itemId_warehouseId_key" ON "stock_movements"("companyId", "idempotencyKey", "itemId", "warehouseId", "type");

-- CreateIndex
CREATE INDEX "stock_counts_organizationId_companyId_status_idx" ON "stock_counts"("organizationId", "companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "stock_counts_companyId_code_key" ON "stock_counts"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "stock_count_lines_countId_itemId_key" ON "stock_count_lines"("countId", "itemId");

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_itemId_organizationId_companyId_fkey" FOREIGN KEY ("itemId", "organizationId", "companyId") REFERENCES "inventory_items"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_warehouseId_organizationId_companyId_fkey" FOREIGN KEY ("warehouseId", "organizationId", "companyId") REFERENCES "warehouses"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_itemId_organizationId_companyId_fkey" FOREIGN KEY ("itemId", "organizationId", "companyId") REFERENCES "inventory_items"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_warehouseId_organizationId_companyId_fkey" FOREIGN KEY ("warehouseId", "organizationId", "companyId") REFERENCES "warehouses"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_warehouseId_organizationId_companyId_fkey" FOREIGN KEY ("warehouseId", "organizationId", "companyId") REFERENCES "warehouses"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_countId_fkey" FOREIGN KEY ("countId") REFERENCES "stock_counts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Garanties en base (INC-07) — non contournables par le code applicatif.
-- ---------------------------------------------------------------------------

-- Un solde de stock n'est jamais negatif (ni en quantite ni en valeur).
ALTER TABLE "stock_balances"
  ADD CONSTRAINT "stock_balances_quantity_non_negative" CHECK ("quantity" >= 0),
  ADD CONSTRAINT "stock_balances_value_non_negative" CHECK ("value" >= 0);

-- Grand livre des mouvements de stock : append-only.
CREATE OR REPLACE FUNCTION axora_forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Table % is append-only: % is forbidden', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "stock_movements_append_only"
  BEFORE UPDATE OR DELETE ON "stock_movements"
  FOR EACH ROW EXECUTE FUNCTION axora_forbid_mutation();

-- Journal d'audit : append-only en base egalement (docs/foundation/03-security.md).
CREATE TRIGGER "audit_logs_append_only"
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION axora_forbid_mutation();
