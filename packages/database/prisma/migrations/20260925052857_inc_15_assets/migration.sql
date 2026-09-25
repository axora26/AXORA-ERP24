-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('IN_SERVICE', 'OUT_OF_SERVICE', 'RETIRED');

-- CreateEnum
CREATE TYPE "AssetCriticality" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AssetOrigin" AS ENUM ('COMMISSIONING', 'MANUAL');

-- CreateEnum
CREATE TYPE "MaintenanceTicketStatus" AS ENUM ('OPEN', 'CONVERTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "MaintenancePriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "WorkOrderType" AS ENUM ('PREVENTIVE', 'CORRECTIVE');

-- CreateEnum
CREATE TYPE "WorkOrderStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "StockMovementType" ADD VALUE 'MAINTENANCE_ISSUE';

-- CreateTable
CREATE TABLE "assets" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "projectId" TEXT,
    "equipmentId" TEXT,
    "commissioningActivityId" TEXT,
    "origin" "AssetOrigin" NOT NULL,
    "originJustification" TEXT,
    "serialNumber" TEXT,
    "manufacturer" TEXT,
    "model" TEXT,
    "location" TEXT NOT NULL,
    "installedAt" TIMESTAMP(3) NOT NULL,
    "warrantyEndsAt" TIMESTAMP(3),
    "criticality" "AssetCriticality" NOT NULL DEFAULT 'MEDIUM',
    "status" "AssetStatus" NOT NULL DEFAULT 'IN_SERVICE',
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_plans" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "intervalDays" INTEGER NOT NULL,
    "nextDueDate" DATE NOT NULL,
    "estimatedHours" DECIMAL(6,2),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "maintenance_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_tickets" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priority" "MaintenancePriority" NOT NULL DEFAULT 'NORMAL',
    "failureAt" TIMESTAMP(3),
    "status" "MaintenanceTicketStatus" NOT NULL DEFAULT 'OPEN',
    "reportedByUserId" TEXT NOT NULL,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "maintenance_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_orders" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "type" "WorkOrderType" NOT NULL,
    "ticketId" TEXT,
    "planId" TEXT,
    "plannedFor" DATE,
    "title" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "priority" "MaintenancePriority" NOT NULL DEFAULT 'NORMAL',
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" "WorkOrderStatus" NOT NULL DEFAULT 'OPEN',
    "assignedEmployeeId" TEXT,
    "failureAt" TIMESTAMP(3),
    "restoredAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "completionReport" TEXT,
    "completedByUserId" TEXT,
    "laborCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "partsCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_order_labor" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "workDate" DATE NOT NULL,
    "hours" DECIMAL(5,2) NOT NULL,
    "hourlyCost" DECIMAL(18,2) NOT NULL,
    "cost" DECIMAL(18,2) NOT NULL,
    "recordedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_order_labor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_order_parts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "stockMovementId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "cost" DECIMAL(18,2) NOT NULL,
    "recordedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_order_parts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assets_organizationId_companyId_status_idx" ON "assets"("organizationId", "companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "assets_companyId_code_key" ON "assets"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "assets_equipmentId_organizationId_companyId_key" ON "assets"("equipmentId", "organizationId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "assets_id_organizationId_companyId_key" ON "assets"("id", "organizationId", "companyId");

-- CreateIndex
CREATE INDEX "maintenance_plans_organizationId_companyId_active_nextDueDa_idx" ON "maintenance_plans"("organizationId", "companyId", "active", "nextDueDate");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_plans_id_organizationId_companyId_key" ON "maintenance_plans"("id", "organizationId", "companyId");

-- CreateIndex
CREATE INDEX "maintenance_tickets_organizationId_companyId_status_idx" ON "maintenance_tickets"("organizationId", "companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_tickets_companyId_code_key" ON "maintenance_tickets"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_tickets_id_organizationId_companyId_key" ON "maintenance_tickets"("id", "organizationId", "companyId");

-- CreateIndex
CREATE INDEX "work_orders_organizationId_companyId_status_dueDate_idx" ON "work_orders"("organizationId", "companyId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "work_orders_assetId_type_status_idx" ON "work_orders"("assetId", "type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "work_orders_companyId_code_key" ON "work_orders"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "work_orders_ticketId_key" ON "work_orders"("ticketId");

-- CreateIndex
CREATE UNIQUE INDEX "work_orders_planId_plannedFor_key" ON "work_orders"("planId", "plannedFor");

-- CreateIndex
CREATE UNIQUE INDEX "work_orders_id_organizationId_companyId_key" ON "work_orders"("id", "organizationId", "companyId");

-- CreateIndex
CREATE INDEX "work_order_labor_workOrderId_idx" ON "work_order_labor"("workOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "work_order_parts_stockMovementId_key" ON "work_order_parts"("stockMovementId");

-- CreateIndex
CREATE INDEX "work_order_parts_workOrderId_idx" ON "work_order_parts"("workOrderId");

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_equipmentId_organizationId_companyId_fkey" FOREIGN KEY ("equipmentId", "organizationId", "companyId") REFERENCES "mep_equipment"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_assetId_organizationId_companyId_fkey" FOREIGN KEY ("assetId", "organizationId", "companyId") REFERENCES "assets"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_assetId_organizationId_companyId_fkey" FOREIGN KEY ("assetId", "organizationId", "companyId") REFERENCES "assets"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_labor" ADD CONSTRAINT "work_order_labor_workOrderId_organizationId_companyId_fkey" FOREIGN KEY ("workOrderId", "organizationId", "companyId") REFERENCES "work_orders"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_parts" ADD CONSTRAINT "work_order_parts_workOrderId_organizationId_companyId_fkey" FOREIGN KEY ("workOrderId", "organizationId", "companyId") REFERENCES "work_orders"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Garanties en base (INC-15)
-- ---------------------------------------------------------------------------

ALTER TABLE "assets" ADD CONSTRAINT "assets_origin_traceable" CHECK (
  ("origin" = 'COMMISSIONING' AND "equipmentId" IS NOT NULL AND "commissioningActivityId" IS NOT NULL)
  OR ("origin" = 'MANUAL' AND length(btrim(coalesce("originJustification", ''))) > 0)
);
CREATE TRIGGER "assets_no_delete" BEFORE DELETE ON "assets" FOR EACH ROW EXECUTE FUNCTION axora_forbid_delete();

ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_interval_positive" CHECK ("intervalDays" > 0);

CREATE TRIGGER "maintenance_tickets_no_delete" BEFORE DELETE ON "maintenance_tickets" FOR EACH ROW EXECUTE FUNCTION axora_forbid_delete();
CREATE TRIGGER "work_orders_no_delete" BEFORE DELETE ON "work_orders" FOR EACH ROW EXECUTE FUNCTION axora_forbid_delete();

-- OT cloture : compte-rendu, temps saisi et, pour un correctif, remise en service posterieure a la defaillance.
CREATE OR REPLACE FUNCTION axora_work_order_guard() RETURNS trigger AS $$
BEGIN
  IF OLD."status" IN ('COMPLETED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Work order % is closed', OLD."code" USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW."status" = 'COMPLETED' THEN
    IF length(btrim(coalesce(NEW."completionReport", ''))) = 0 THEN
      RAISE EXCEPTION 'Work order %: a completion report is required', NEW."code" USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM "work_order_labor" WHERE "workOrderId" = NEW."id") THEN
      RAISE EXCEPTION 'Work order %: recorded labor time is required', NEW."code" USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF NEW."type" = 'CORRECTIVE' AND (NEW."failureAt" IS NULL OR NEW."restoredAt" IS NULL OR NEW."restoredAt" <= NEW."failureAt") THEN
      RAISE EXCEPTION 'Work order %: a corrective closes with a restoration after the failure', NEW."code" USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "work_orders_closure_guard" BEFORE UPDATE ON "work_orders" FOR EACH ROW EXECUTE FUNCTION axora_work_order_guard();

CREATE TRIGGER "work_order_labor_append_only" BEFORE UPDATE OR DELETE ON "work_order_labor" FOR EACH ROW EXECUTE FUNCTION axora_forbid_mutation();
CREATE TRIGGER "work_order_parts_append_only" BEFORE UPDATE OR DELETE ON "work_order_parts" FOR EACH ROW EXECUTE FUNCTION axora_forbid_mutation();
ALTER TABLE "work_order_labor" ADD CONSTRAINT "work_order_labor_hours" CHECK ("hours" > 0 AND "hours" <= 24);
