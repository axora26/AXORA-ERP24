CREATE TYPE "DqeCostCategory" AS ENUM ('MATERIAL', 'LABOR', 'EQUIPMENT', 'SUBCONTRACTING', 'OTHER');

ALTER TABLE "dqe_documents"
  ADD COLUMN "overheadRate" DECIMAL(9,6) NOT NULL DEFAULT 0,
  ADD COLUMN "marginRate" DECIMAL(9,6) NOT NULL DEFAULT 0,
  ADD COLUMN "taxRate" DECIMAL(9,6) NOT NULL DEFAULT 0;

ALTER TABLE "dqe_lines"
  ADD COLUMN "costCategory" "DqeCostCategory" NOT NULL DEFAULT 'MATERIAL';

ALTER TABLE "dqe_documents"
  ADD CONSTRAINT "dqe_documents_overheadRate_check" CHECK ("overheadRate" >= 0 AND "overheadRate" <= 100),
  ADD CONSTRAINT "dqe_documents_marginRate_check" CHECK ("marginRate" >= 0 AND "marginRate" <= 100),
  ADD CONSTRAINT "dqe_documents_taxRate_check" CHECK ("taxRate" >= 0 AND "taxRate" <= 100);
