-- Gestion hiérarchique des DQE par lots.
-- Migration additive : les lignes existantes restent non affectées (lotId nullable).

CREATE TABLE "dqe_lots" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "dqeId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "code" TEXT NOT NULL,
  "designation" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "dqe_lots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "dqe_lots_position_check" CHECK ("position" > 0),
  CONSTRAINT "dqe_lots_code_not_blank_check" CHECK (length(btrim("code")) > 0),
  CONSTRAINT "dqe_lots_designation_not_blank_check" CHECK (length(btrim("designation")) > 0)
);

ALTER TABLE "dqe_lines" ADD COLUMN "lotId" TEXT;

CREATE UNIQUE INDEX "dqe_lots_dqeId_position_key" ON "dqe_lots"("dqeId", "position");
CREATE UNIQUE INDEX "dqe_lots_dqeId_code_key" ON "dqe_lots"("dqeId", "code");
CREATE UNIQUE INDEX "dqe_lots_id_organizationId_companyId_key" ON "dqe_lots"("id", "organizationId", "companyId");
CREATE INDEX "dqe_lots_organizationId_companyId_dqeId_position_idx" ON "dqe_lots"("organizationId", "companyId", "dqeId", "position");
CREATE INDEX "dqe_lines_organizationId_companyId_lotId_position_idx" ON "dqe_lines"("organizationId", "companyId", "lotId", "position");

ALTER TABLE "dqe_lots"
  ADD CONSTRAINT "dqe_lots_dqeId_organizationId_companyId_fkey"
  FOREIGN KEY ("dqeId", "organizationId", "companyId")
  REFERENCES "dqe_documents"("id", "organizationId", "companyId")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "dqe_lines"
  ADD CONSTRAINT "dqe_lines_lotId_organizationId_companyId_fkey"
  FOREIGN KEY ("lotId", "organizationId", "companyId")
  REFERENCES "dqe_lots"("id", "organizationId", "companyId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
