-- CreateEnum
CREATE TYPE "CommissioningStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'ACCEPTED', 'HANDED_OVER');

-- CreateEnum
CREATE TYPE "CommissioningTestKind" AS ENUM ('PRECOMMISSIONING', 'FUNCTIONAL', 'RETEST');

-- CreateEnum
CREATE TYPE "CommissioningOutcome" AS ENUM ('PASS', 'FAIL');

-- CreateEnum
CREATE TYPE "PunchItemStatus" AS ENUM ('OPEN', 'CORRECTED', 'CLOSED');

-- CreateTable
CREATE TABLE "commissioning_activities" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "procedure" TEXT NOT NULL,
    "status" "CommissioningStatus" NOT NULL DEFAULT 'PLANNED',
    "acceptedByUserId" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "acceptanceNote" TEXT,
    "handedOverByUserId" TEXT,
    "handedOverAt" TIMESTAMP(3),
    "handoverRecipient" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commissioning_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commissioning_tests" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "kind" "CommissioningTestKind" NOT NULL,
    "measurements" JSONB NOT NULL,
    "checks" JSONB NOT NULL,
    "outcome" "CommissioningOutcome" NOT NULL,
    "notes" TEXT,
    "fileIds" JSONB NOT NULL,
    "performedByUserId" TEXT NOT NULL,
    "performedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commissioning_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commissioning_punch_items" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" "PunchItemStatus" NOT NULL DEFAULT 'OPEN',
    "correctionNote" TEXT,
    "correctionFileId" TEXT,
    "correctedByUserId" TEXT,
    "correctedAt" TIMESTAMP(3),
    "closedByTestId" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commissioning_punch_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commissioning_documents" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "linkedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commissioning_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "commissioning_activities_organizationId_companyId_projectId_idx" ON "commissioning_activities"("organizationId", "companyId", "projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "commissioning_activities_companyId_code_key" ON "commissioning_activities"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "commissioning_activities_equipmentId_organizationId_company_key" ON "commissioning_activities"("equipmentId", "organizationId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "commissioning_activities_id_organizationId_companyId_key" ON "commissioning_activities"("id", "organizationId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "commissioning_tests_activityId_sequence_key" ON "commissioning_tests"("activityId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "commissioning_tests_id_organizationId_companyId_key" ON "commissioning_tests"("id", "organizationId", "companyId");

-- CreateIndex
CREATE INDEX "commissioning_punch_items_activityId_status_idx" ON "commissioning_punch_items"("activityId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "commissioning_documents_activityId_documentId_key" ON "commissioning_documents"("activityId", "documentId");

-- AddForeignKey
ALTER TABLE "commissioning_activities" ADD CONSTRAINT "commissioning_activities_equipmentId_organizationId_compan_fkey" FOREIGN KEY ("equipmentId", "organizationId", "companyId") REFERENCES "mep_equipment"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissioning_tests" ADD CONSTRAINT "commissioning_tests_activityId_organizationId_companyId_fkey" FOREIGN KEY ("activityId", "organizationId", "companyId") REFERENCES "commissioning_activities"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissioning_punch_items" ADD CONSTRAINT "commissioning_punch_items_activityId_organizationId_compan_fkey" FOREIGN KEY ("activityId", "organizationId", "companyId") REFERENCES "commissioning_activities"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissioning_documents" ADD CONSTRAINT "commissioning_documents_activityId_organizationId_companyI_fkey" FOREIGN KEY ("activityId", "organizationId", "companyId") REFERENCES "commissioning_activities"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Garanties en base (INC-12) : sequence de mise en service non contournable
-- ---------------------------------------------------------------------------

CREATE TRIGGER "commissioning_tests_append_only"
  BEFORE UPDATE OR DELETE ON "commissioning_tests"
  FOR EACH ROW EXECUTE FUNCTION axora_forbid_mutation();

CREATE TRIGGER "commissioning_punch_items_no_delete"
  BEFORE DELETE ON "commissioning_punch_items"
  FOR EACH ROW EXECUTE FUNCTION axora_forbid_delete();

CREATE TRIGGER "commissioning_documents_append_only"
  BEFORE UPDATE OR DELETE ON "commissioning_documents"
  FOR EACH ROW EXECUTE FUNCTION axora_forbid_mutation();

CREATE OR REPLACE FUNCTION axora_commissioning_sequence_guard() RETURNS trigger AS $$
DECLARE
  last_correction TIMESTAMP(3);
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Commissioning activities are never deleted' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD."status" IN ('ACCEPTED', 'HANDED_OVER') AND NEW."status" NOT IN ('ACCEPTED', 'HANDED_OVER') THEN
    RAISE EXCEPTION 'Commissioning % cannot go back after acceptance', OLD."code" USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW."status" = 'ACCEPTED' AND OLD."status" <> 'ACCEPTED' THEN
    IF NOT EXISTS (SELECT 1 FROM "commissioning_tests" WHERE "activityId" = NEW."id" AND "kind" = 'PRECOMMISSIONING' AND "outcome" = 'PASS') THEN
      RAISE EXCEPTION 'Commissioning %: no passed precommissioning', NEW."code" USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM "commissioning_tests" WHERE "activityId" = NEW."id" AND "kind" IN ('FUNCTIONAL', 'RETEST') AND "outcome" = 'PASS') THEN
      RAISE EXCEPTION 'Commissioning %: no passed functional test', NEW."code" USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM "commissioning_punch_items" WHERE "activityId" = NEW."id" AND "status" <> 'CLOSED') THEN
      RAISE EXCEPTION 'Commissioning %: open punch items remain', NEW."code" USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    SELECT max("correctedAt") INTO last_correction FROM "commissioning_punch_items" WHERE "activityId" = NEW."id";
    IF last_correction IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "commissioning_tests" WHERE "activityId" = NEW."id" AND "kind" = 'RETEST' AND "outcome" = 'PASS' AND "performedAt" > last_correction
    ) THEN
      RAISE EXCEPTION 'Commissioning %: a passed retest after the last correction is required', NEW."code" USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF NEW."acceptedByUserId" IS NULL OR NEW."acceptedByUserId" = (
      SELECT "performedByUserId" FROM "commissioning_tests" WHERE "activityId" = NEW."id" ORDER BY "sequence" DESC LIMIT 1
    ) THEN
      RAISE EXCEPTION 'Commissioning %: acceptance by someone other than the last tester', NEW."code" USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  IF NEW."status" = 'HANDED_OVER' AND OLD."status" <> 'HANDED_OVER' THEN
    IF OLD."status" <> 'ACCEPTED' THEN
      RAISE EXCEPTION 'Commissioning %: handover requires acceptance', NEW."code" USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM "commissioning_documents" WHERE "activityId" = NEW."id") THEN
      RAISE EXCEPTION 'Commissioning %: handover requires as-built documents', NEW."code" USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "commissioning_activities_sequence"
  BEFORE UPDATE OR DELETE ON "commissioning_activities"
  FOR EACH ROW EXECUTE FUNCTION axora_commissioning_sequence_guard();
