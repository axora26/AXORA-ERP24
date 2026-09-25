-- CreateEnum
CREATE TYPE "QhseDomain" AS ENUM ('QUALITY', 'SAFETY', 'ENVIRONMENT');

-- CreateEnum
CREATE TYPE "QhseInspectionStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "QhseCheckResult" AS ENUM ('CONFORM', 'NON_CONFORM', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "QhseSeverity" AS ENUM ('MINOR', 'MAJOR', 'CRITICAL');

-- CreateEnum
CREATE TYPE "QhseFindingStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'CLOSED');

-- CreateEnum
CREATE TYPE "QhseActionStatus" AS ENUM ('OPEN', 'DONE', 'VERIFIED');

-- CreateEnum
CREATE TYPE "SafetyIncidentType" AS ENUM ('NEAR_MISS', 'FIRST_AID', 'MEDICAL_TREATMENT', 'LOST_TIME', 'PROPERTY_DAMAGE', 'ENVIRONMENTAL');

-- CreateEnum
CREATE TYPE "SafetyIncidentStatus" AS ENUM ('REPORTED', 'INVESTIGATED', 'CLOSED');

-- CreateEnum
CREATE TYPE "WorkPermitType" AS ENUM ('HOT_WORK', 'WORK_AT_HEIGHT', 'CONFINED_SPACE', 'ELECTRICAL', 'EXCAVATION', 'LIFTING', 'OTHER');

-- CreateEnum
CREATE TYPE "WorkPermitStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'CLOSED');

-- CreateTable
CREATE TABLE "qhse_checklist_templates" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" "QhseDomain" NOT NULL,
    "items" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qhse_checklist_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qhse_inspections" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "zoneId" TEXT,
    "templateId" TEXT,
    "title" TEXT NOT NULL,
    "domain" "QhseDomain" NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "inspectorUserId" TEXT NOT NULL,
    "status" "QhseInspectionStatus" NOT NULL DEFAULT 'PLANNED',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "conformityRate" DECIMAL(5,2),
    "notes" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qhse_inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qhse_inspection_items" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "critical" BOOLEAN NOT NULL DEFAULT false,
    "result" "QhseCheckResult",
    "comment" TEXT,
    "fileId" TEXT,
    "answeredByUserId" TEXT,
    "answeredAt" TIMESTAMP(3),

    CONSTRAINT "qhse_inspection_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qhse_findings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "projectId" TEXT,
    "category" "QhseDomain" NOT NULL,
    "severity" "QhseSeverity" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL,
    "inspectionId" TEXT,
    "inspectionItemId" TEXT,
    "incidentId" TEXT,
    "status" "QhseFindingStatus" NOT NULL DEFAULT 'OPEN',
    "createdByUserId" TEXT NOT NULL,
    "closedByUserId" TEXT,
    "closedAt" TIMESTAMP(3),
    "closureNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qhse_findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qhse_corrective_actions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "assigneeName" TEXT NOT NULL,
    "assigneeUserId" TEXT,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" "QhseActionStatus" NOT NULL DEFAULT 'OPEN',
    "createdByUserId" TEXT NOT NULL,
    "completedByUserId" TEXT,
    "completedAt" TIMESTAMP(3),
    "completionNote" TEXT,
    "fileId" TEXT,
    "verifiedByUserId" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verificationNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qhse_corrective_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qhse_incidents" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "projectId" TEXT,
    "type" "SafetyIncidentType" NOT NULL,
    "severity" "QhseSeverity" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "location" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "injuredPerson" TEXT,
    "immediateActions" TEXT,
    "reportedByUserId" TEXT NOT NULL,
    "lostDays" INTEGER NOT NULL DEFAULT 0,
    "status" "SafetyIncidentStatus" NOT NULL DEFAULT 'REPORTED',
    "investigationSummary" TEXT,
    "investigatedByUserId" TEXT,
    "investigatedAt" TIMESTAMP(3),
    "closedByUserId" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qhse_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qhse_work_permits" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "zoneId" TEXT,
    "type" "WorkPermitType" NOT NULL,
    "description" TEXT NOT NULL,
    "precautions" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3) NOT NULL,
    "status" "WorkPermitStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedByUserId" TEXT NOT NULL,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "closedByUserId" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qhse_work_permits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qhse_toolbox_meetings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "heldAt" TIMESTAMP(3) NOT NULL,
    "topic" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "facilitatorUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qhse_toolbox_meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qhse_toolbox_attendance" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,

    CONSTRAINT "qhse_toolbox_attendance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "qhse_checklist_templates_companyId_code_key" ON "qhse_checklist_templates"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "qhse_checklist_templates_id_organizationId_companyId_key" ON "qhse_checklist_templates"("id", "organizationId", "companyId");

-- CreateIndex
CREATE INDEX "qhse_inspections_organizationId_companyId_projectId_status_idx" ON "qhse_inspections"("organizationId", "companyId", "projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "qhse_inspections_companyId_code_key" ON "qhse_inspections"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "qhse_inspections_id_organizationId_companyId_key" ON "qhse_inspections"("id", "organizationId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "qhse_inspection_items_inspectionId_position_key" ON "qhse_inspection_items"("inspectionId", "position");

-- CreateIndex
CREATE INDEX "qhse_findings_organizationId_companyId_status_idx" ON "qhse_findings"("organizationId", "companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "qhse_findings_companyId_code_key" ON "qhse_findings"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "qhse_findings_inspectionItemId_key" ON "qhse_findings"("inspectionItemId");

-- CreateIndex
CREATE UNIQUE INDEX "qhse_findings_id_organizationId_companyId_key" ON "qhse_findings"("id", "organizationId", "companyId");

-- CreateIndex
CREATE INDEX "qhse_corrective_actions_organizationId_companyId_status_due_idx" ON "qhse_corrective_actions"("organizationId", "companyId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "qhse_corrective_actions_findingId_idx" ON "qhse_corrective_actions"("findingId");

-- CreateIndex
CREATE INDEX "qhse_incidents_organizationId_companyId_occurredAt_idx" ON "qhse_incidents"("organizationId", "companyId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "qhse_incidents_companyId_code_key" ON "qhse_incidents"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "qhse_incidents_id_organizationId_companyId_key" ON "qhse_incidents"("id", "organizationId", "companyId");

-- CreateIndex
CREATE INDEX "qhse_work_permits_organizationId_companyId_projectId_status_idx" ON "qhse_work_permits"("organizationId", "companyId", "projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "qhse_work_permits_companyId_code_key" ON "qhse_work_permits"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "qhse_work_permits_id_organizationId_companyId_key" ON "qhse_work_permits"("id", "organizationId", "companyId");

-- CreateIndex
CREATE INDEX "qhse_toolbox_meetings_organizationId_companyId_projectId_he_idx" ON "qhse_toolbox_meetings"("organizationId", "companyId", "projectId", "heldAt");

-- CreateIndex
CREATE UNIQUE INDEX "qhse_toolbox_meetings_id_organizationId_companyId_key" ON "qhse_toolbox_meetings"("id", "organizationId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "qhse_toolbox_attendance_meetingId_employeeId_key" ON "qhse_toolbox_attendance"("meetingId", "employeeId");

-- AddForeignKey
ALTER TABLE "qhse_inspection_items" ADD CONSTRAINT "qhse_inspection_items_inspectionId_organizationId_companyI_fkey" FOREIGN KEY ("inspectionId", "organizationId", "companyId") REFERENCES "qhse_inspections"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qhse_corrective_actions" ADD CONSTRAINT "qhse_corrective_actions_findingId_organizationId_companyId_fkey" FOREIGN KEY ("findingId", "organizationId", "companyId") REFERENCES "qhse_findings"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qhse_toolbox_attendance" ADD CONSTRAINT "qhse_toolbox_attendance_meetingId_organizationId_companyId_fkey" FOREIGN KEY ("meetingId", "organizationId", "companyId") REFERENCES "qhse_toolbox_meetings"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Garanties en base (INC-11)
-- ---------------------------------------------------------------------------

-- NCR : faits constates immuables, aucune suppression.
CREATE OR REPLACE FUNCTION axora_qhse_finding_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Non-conformities are never deleted' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW."code" IS DISTINCT FROM OLD."code"
    OR NEW."projectId" IS DISTINCT FROM OLD."projectId"
    OR NEW."category" IS DISTINCT FROM OLD."category"
    OR NEW."severity" IS DISTINCT FROM OLD."severity"
    OR NEW."title" IS DISTINCT FROM OLD."title"
    OR NEW."description" IS DISTINCT FROM OLD."description"
    OR NEW."detectedAt" IS DISTINCT FROM OLD."detectedAt"
    OR NEW."inspectionId" IS DISTINCT FROM OLD."inspectionId"
    OR NEW."inspectionItemId" IS DISTINCT FROM OLD."inspectionItemId"
    OR NEW."incidentId" IS DISTINCT FROM OLD."incidentId"
    OR NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'Non-conformity % facts are immutable', OLD."code" USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD."status" = 'CLOSED' THEN
    RAISE EXCEPTION 'Non-conformity % is closed', OLD."code" USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "qhse_findings_facts_immutable"
  BEFORE UPDATE OR DELETE ON "qhse_findings"
  FOR EACH ROW EXECUTE FUNCTION axora_qhse_finding_guard();

ALTER TABLE "qhse_findings"
  ADD CONSTRAINT "qhse_findings_closed_by_third_party"
  CHECK ("status" <> 'CLOSED' OR ("closedByUserId" IS NOT NULL AND "closedByUserId" <> "createdByUserId"));

-- Actions correctives : jamais supprimees ; verification par un tiers.
CREATE OR REPLACE FUNCTION axora_forbid_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Table % keeps its history: DELETE is forbidden', TG_TABLE_NAME USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "qhse_corrective_actions_no_delete"
  BEFORE DELETE ON "qhse_corrective_actions"
  FOR EACH ROW EXECUTE FUNCTION axora_forbid_delete();

ALTER TABLE "qhse_corrective_actions"
  ADD CONSTRAINT "qhse_actions_verified_by_third_party"
  CHECK ("status" <> 'VERIFIED' OR ("verifiedByUserId" IS NOT NULL AND "completedByUserId" IS NOT NULL AND "verifiedByUserId" <> "completedByUserId"));

-- Incidents : faits immuables, aucune suppression (audit renforce).
CREATE OR REPLACE FUNCTION axora_safety_incident_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Safety incidents are never deleted' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW."code" IS DISTINCT FROM OLD."code"
    OR NEW."projectId" IS DISTINCT FROM OLD."projectId"
    OR NEW."type" IS DISTINCT FROM OLD."type"
    OR NEW."severity" IS DISTINCT FROM OLD."severity"
    OR NEW."occurredAt" IS DISTINCT FROM OLD."occurredAt"
    OR NEW."location" IS DISTINCT FROM OLD."location"
    OR NEW."description" IS DISTINCT FROM OLD."description"
    OR NEW."injuredPerson" IS DISTINCT FROM OLD."injuredPerson"
    OR NEW."immediateActions" IS DISTINCT FROM OLD."immediateActions"
    OR NEW."reportedByUserId" IS DISTINCT FROM OLD."reportedByUserId"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'Safety incident % facts are immutable', OLD."code" USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "qhse_incidents_facts_immutable"
  BEFORE UPDATE OR DELETE ON "qhse_incidents"
  FOR EACH ROW EXECUTE FUNCTION axora_safety_incident_guard();

ALTER TABLE "qhse_incidents" ADD CONSTRAINT "qhse_incidents_lost_days" CHECK ("lostDays" >= 0);

-- Inspection terminee : points de controle figes ; aucune suppression.
CREATE OR REPLACE FUNCTION axora_inspection_item_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Inspection items are never deleted' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF (SELECT "status" FROM "qhse_inspections" WHERE "id" = OLD."inspectionId") = 'COMPLETED' THEN
    RAISE EXCEPTION 'Inspection % is completed: its checklist is frozen', OLD."inspectionId" USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "qhse_inspection_items_frozen"
  BEFORE UPDATE OR DELETE ON "qhse_inspection_items"
  FOR EACH ROW EXECUTE FUNCTION axora_inspection_item_guard();

CREATE TRIGGER "qhse_inspections_no_delete"
  BEFORE DELETE ON "qhse_inspections"
  FOR EACH ROW EXECUTE FUNCTION axora_forbid_delete();

-- Permis de travail : fenetre de validite coherente, decision par un tiers.
ALTER TABLE "qhse_work_permits"
  ADD CONSTRAINT "qhse_work_permits_window" CHECK ("validTo" > "validFrom");
ALTER TABLE "qhse_work_permits"
  ADD CONSTRAINT "qhse_work_permits_decided_by_third_party"
  CHECK ("decidedByUserId" IS NULL OR "decidedByUserId" <> "requestedByUserId");

-- Quarts d'heure securite : faits d'emargement append-only.
CREATE TRIGGER "qhse_toolbox_meetings_append_only"
  BEFORE UPDATE OR DELETE ON "qhse_toolbox_meetings"
  FOR EACH ROW EXECUTE FUNCTION axora_forbid_mutation();
CREATE TRIGGER "qhse_toolbox_attendance_append_only"
  BEFORE UPDATE OR DELETE ON "qhse_toolbox_attendance"
  FOR EACH ROW EXECUTE FUNCTION axora_forbid_mutation();
