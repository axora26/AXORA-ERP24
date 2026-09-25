-- CreateTable
CREATE TABLE "number_sequences" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "number_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "number_sequences_organizationId_idx" ON "number_sequences"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "number_sequences_companyId_key_key" ON "number_sequences"("companyId", "key");
