-- CreateEnum
CREATE TYPE "StockReservationStatus" AS ENUM ('ACTIVE', 'FULFILLED', 'RELEASED');

-- CreateEnum
CREATE TYPE "StockReservationEventType" AS ENUM ('RESERVE', 'ISSUE', 'RELEASE');

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "reservationId" TEXT;

-- CreateTable
CREATE TABLE "stock_reservations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "wbsItemId" TEXT,
    "itemId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "remainingQuantity" DECIMAL(18,3) NOT NULL,
    "status" "StockReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "neededAt" TIMESTAMP(3),
    "reason" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "releasedByUserId" TEXT,
    "releasedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_reservation_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "type" "StockReservationEventType" NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "operationKey" TEXT NOT NULL,
    "reason" TEXT,
    "movementId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_reservation_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_reservations_organizationId_companyId_projectId_statu_idx" ON "stock_reservations"("organizationId", "companyId", "projectId", "status");

-- CreateIndex
CREATE INDEX "stock_reservations_organizationId_companyId_itemId_warehous_idx" ON "stock_reservations"("organizationId", "companyId", "itemId", "warehouseId", "status");

-- CreateIndex
CREATE INDEX "stock_reservations_wbsItemId_idx" ON "stock_reservations"("wbsItemId");

-- CreateIndex
CREATE INDEX "stock_reservation_events_organizationId_companyId_reservati_idx" ON "stock_reservation_events"("organizationId", "companyId", "reservationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "stock_reservation_events_companyId_operationKey_key" ON "stock_reservation_events"("companyId", "operationKey");

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "stock_reservations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_projectId_organizationId_companyId_fkey" FOREIGN KEY ("projectId", "organizationId", "companyId") REFERENCES "projects"("id", "organizationId", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_itemId_organizationId_companyId_fkey" FOREIGN KEY ("itemId", "organizationId", "companyId") REFERENCES "inventory_items"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_warehouseId_organizationId_companyId_fkey" FOREIGN KEY ("warehouseId", "organizationId", "companyId") REFERENCES "warehouses"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_itemId_warehouseId_fkey" FOREIGN KEY ("itemId", "warehouseId") REFERENCES "stock_balances"("itemId", "warehouseId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_wbsItemId_fkey" FOREIGN KEY ("wbsItemId") REFERENCES "project_wbs_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservation_events" ADD CONSTRAINT "stock_reservation_events_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "stock_reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

