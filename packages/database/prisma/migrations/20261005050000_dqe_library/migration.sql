CREATE TABLE "dqe_library_items" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "designation" TEXT NOT NULL,
  "unitCode" TEXT NOT NULL,
  "costCategory" "DqeCostCategory" NOT NULL DEFAULT 'MATERIAL',
  "unitPrice" DECIMAL(24,6) NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "dqe_library_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "dqe_library_items_companyId_code_key" ON "dqe_library_items"("companyId", "code");
CREATE UNIQUE INDEX "dqe_library_items_id_organizationId_companyId_key" ON "dqe_library_items"("id", "organizationId", "companyId");
CREATE INDEX "dqe_library_items_organizationId_companyId_isActive_code_idx" ON "dqe_library_items"("organizationId", "companyId", "isActive", "code");
