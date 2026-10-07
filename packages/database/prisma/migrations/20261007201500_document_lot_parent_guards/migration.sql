-- Renforce l'appartenance d'un lot à son document au niveau PostgreSQL.
-- Une ligne ne peut pas référencer un lot d'un autre DQE, devis ou contrat,
-- même via un import ou une écriture Prisma directe qui contourne les services.

ALTER TABLE "dqe_lines" DROP CONSTRAINT "dqe_lines_lotId_organizationId_companyId_fkey";
ALTER TABLE "sales_quote_lines" DROP CONSTRAINT "sales_quote_lines_lotId_organizationId_companyId_fkey";
ALTER TABLE "sales_contract_lines" DROP CONSTRAINT "sales_contract_lines_lotId_organizationId_companyId_fkey";

CREATE UNIQUE INDEX "dqe_lots_id_organizationId_companyId_dqeId_key"
  ON "dqe_lots"("id", "organizationId", "companyId", "dqeId");
CREATE UNIQUE INDEX "sales_quote_lots_id_organizationId_companyId_quoteId_key"
  ON "sales_quote_lots"("id", "organizationId", "companyId", "quoteId");
CREATE UNIQUE INDEX "sales_contract_lots_id_organizationId_companyId_contractId_key"
  ON "sales_contract_lots"("id", "organizationId", "companyId", "contractId");

ALTER TABLE "dqe_lines"
  ADD CONSTRAINT "dqe_lines_lotId_organizationId_companyId_dqeId_fkey"
  FOREIGN KEY ("lotId", "organizationId", "companyId", "dqeId")
  REFERENCES "dqe_lots"("id", "organizationId", "companyId", "dqeId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sales_quote_lines"
  ADD CONSTRAINT "sales_quote_lines_lotId_organizationId_companyId_quoteId_fkey"
  FOREIGN KEY ("lotId", "organizationId", "companyId", "quoteId")
  REFERENCES "sales_quote_lots"("id", "organizationId", "companyId", "quoteId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sales_contract_lines"
  ADD CONSTRAINT "sales_contract_lines_lotId_organizationId_companyId_contractId_fkey"
  FOREIGN KEY ("lotId", "organizationId", "companyId", "contractId")
  REFERENCES "sales_contract_lots"("id", "organizationId", "companyId", "contractId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
