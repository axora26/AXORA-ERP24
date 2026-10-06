CREATE TYPE "ProjectForecastStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "project_forecast_revisions" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "revisionNumber" INTEGER NOT NULL,
  "status" "ProjectForecastStatus" NOT NULL DEFAULT 'PENDING',
  "justification" TEXT NOT NULL,
  "asOf" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "currency" CHAR(3) NOT NULL,
  "contractAmount" DECIMAL(18,2) NOT NULL,
  "revisedBudget" DECIMAL(18,2) NOT NULL,
  "consumedAmount" DECIMAL(18,2) NOT NULL,
  "remainingAmount" DECIMAL(18,2) NOT NULL,
  "eacAmount" DECIMAL(18,2) NOT NULL,
  "marginAmount" DECIMAL(18,2) NOT NULL,
  "requestedByUserId" TEXT NOT NULL,
  "decidedByUserId" TEXT,
  "decidedAt" TIMESTAMP(3),
  "decisionNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "project_forecast_revisions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "project_forecast_lines" (
  "id" TEXT NOT NULL,
  "revisionId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "category" "ProjectCostCategory" NOT NULL,
  "wbsItemId" TEXT,
  "description" TEXT NOT NULL,
  "remainingAmount" DECIMAL(18,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "project_forecast_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "project_forecast_revisions_projectId_revisionNumber_key" ON "project_forecast_revisions" ("projectId", "revisionNumber");
CREATE INDEX "project_forecast_revisions_scope_project_status_idx" ON "project_forecast_revisions" ("organizationId", "companyId", "projectId", "status");
CREATE UNIQUE INDEX "project_forecast_lines_revisionId_category_key" ON "project_forecast_lines" ("revisionId", "category");
CREATE INDEX "project_forecast_lines_scope_revision_idx" ON "project_forecast_lines" ("organizationId", "companyId", "revisionId");
CREATE INDEX "project_forecast_lines_wbsItemId_idx" ON "project_forecast_lines" ("wbsItemId");

ALTER TABLE "project_forecast_revisions" ADD CONSTRAINT "project_forecast_revisions_project_fkey"
  FOREIGN KEY ("projectId", "organizationId", "companyId") REFERENCES "projects" ("id", "organizationId", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_forecast_lines" ADD CONSTRAINT "project_forecast_lines_revision_fkey"
  FOREIGN KEY ("revisionId") REFERENCES "project_forecast_revisions" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_forecast_lines" ADD CONSTRAINT "project_forecast_lines_wbs_fkey"
  FOREIGN KEY ("wbsItemId") REFERENCES "project_wbs_items" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "project_forecast_revisions" ADD CONSTRAINT "project_forecast_amounts_check"
  CHECK ("contractAmount" >= 0 AND "revisedBudget" >= 0 AND "consumedAmount" >= 0 AND "remainingAmount" >= 0 AND "eacAmount" = "consumedAmount" + "remainingAmount" AND "marginAmount" = "contractAmount" - "eacAmount");
ALTER TABLE "project_forecast_lines" ADD CONSTRAINT "project_forecast_lines_amount_check" CHECK ("remainingAmount" >= 0);

CREATE OR REPLACE FUNCTION axora_project_forecast_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."contractAmount" < 0 OR NEW."revisedBudget" < 0 OR NEW."consumedAmount" < 0 OR NEW."remainingAmount" < 0 THEN
    RAISE EXCEPTION 'Forecast amounts cannot be negative';
  END IF;
  IF NEW."eacAmount" <> NEW."consumedAmount" + NEW."remainingAmount" OR NEW."marginAmount" <> NEW."contractAmount" - NEW."eacAmount" THEN
    RAISE EXCEPTION 'Forecast totals do not reconcile';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD."status" <> 'PENDING' THEN RAISE EXCEPTION 'A decided forecast is immutable'; END IF;
    IF (to_jsonb(NEW) - ARRAY['status','decidedByUserId','decidedAt','decisionNote']) IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['status','decidedByUserId','decidedAt','decisionNote']) THEN
      RAISE EXCEPTION 'Forecast evidence is immutable';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "project_forecast_revisions_guard" BEFORE INSERT OR UPDATE ON "project_forecast_revisions"
  FOR EACH ROW EXECUTE FUNCTION axora_project_forecast_guard();
CREATE TRIGGER "project_forecast_revisions_no_delete" BEFORE DELETE ON "project_forecast_revisions"
  FOR EACH ROW EXECUTE FUNCTION axora_forbid_delete();
CREATE TRIGGER "project_forecast_lines_append_only" BEFORE UPDATE OR DELETE ON "project_forecast_lines"
  FOR EACH ROW EXECUTE FUNCTION axora_forbid_mutation();
