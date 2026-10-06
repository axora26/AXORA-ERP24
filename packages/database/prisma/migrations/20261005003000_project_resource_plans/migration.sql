CREATE TYPE "ProjectResourceKind" AS ENUM ('EMPLOYEE', 'VEHICLE', 'ASSET', 'MATERIAL');
CREATE TYPE "ProjectResourcePlanStatus" AS ENUM ('PLANNED', 'RESERVED', 'RELEASED');

CREATE TABLE "project_resource_plans" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "wbsItemId" TEXT,
  "kind" "ProjectResourceKind" NOT NULL,
  "resourceId" TEXT NOT NULL,
  "resourceCode" TEXT NOT NULL,
  "resourceName" TEXT NOT NULL,
  "unitCode" TEXT NOT NULL,
  "plannedQuantity" DECIMAL(18,3) NOT NULL,
  "plannedRate" DECIMAL(18,2),
  "startAt" TIMESTAMP(3) NOT NULL,
  "endAt" TIMESTAMP(3),
  "status" "ProjectResourcePlanStatus" NOT NULL DEFAULT 'PLANNED',
  "notes" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "releasedByUserId" TEXT,
  "releasedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "project_resource_plans_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "project_resource_plans_scope_project_status_start_idx"
  ON "project_resource_plans" ("organizationId", "companyId", "projectId", "status", "startAt");
CREATE INDEX "project_resource_plans_scope_resource_status_start_idx"
  ON "project_resource_plans" ("organizationId", "companyId", "kind", "resourceId", "status", "startAt");
CREATE INDEX "project_resource_plans_wbsItemId_idx" ON "project_resource_plans" ("wbsItemId");

ALTER TABLE "project_resource_plans" ADD CONSTRAINT "project_resource_plans_project_fkey"
  FOREIGN KEY ("projectId", "organizationId", "companyId") REFERENCES "projects" ("id", "organizationId", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_resource_plans" ADD CONSTRAINT "project_resource_plans_wbs_fkey"
  FOREIGN KEY ("wbsItemId") REFERENCES "project_wbs_items" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "project_resource_plans" ADD CONSTRAINT "project_resource_plans_amount_check"
  CHECK ("plannedQuantity" > 0 AND ("plannedRate" IS NULL OR "plannedRate" >= 0) AND ("endAt" IS NULL OR "endAt" > "startAt"));

CREATE OR REPLACE FUNCTION axora_project_resource_plan_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."plannedQuantity" <= 0 THEN RAISE EXCEPTION 'Planned resource quantity must be positive'; END IF;
  IF NEW."endAt" IS NOT NULL AND NEW."endAt" <= NEW."startAt" THEN RAISE EXCEPTION 'Resource plan end must be after start'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD."status" = 'RELEASED' THEN RAISE EXCEPTION 'Released resource plan is immutable'; END IF;
    IF NEW."status" <> 'RELEASED' THEN RAISE EXCEPTION 'Resource plans can only be released'; END IF;
    IF NEW."releasedByUserId" IS NULL OR NEW."releasedAt" IS NULL THEN RAISE EXCEPTION 'Released resource plan requires actor and timestamp'; END IF;
    IF (to_jsonb(NEW) - ARRAY['status','releasedByUserId','releasedAt','updatedAt']) IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['status','releasedByUserId','releasedAt','updatedAt']) THEN
      RAISE EXCEPTION 'Resource plan evidence is immutable';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "project_resource_plans_guard"
  BEFORE INSERT OR UPDATE ON "project_resource_plans"
  FOR EACH ROW EXECUTE FUNCTION axora_project_resource_plan_guard();
CREATE TRIGGER "project_resource_plans_no_delete"
  BEFORE DELETE ON "project_resource_plans"
  FOR EACH ROW EXECUTE FUNCTION axora_forbid_delete();
