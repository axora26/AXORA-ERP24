-- CreateEnum
CREATE TYPE "PayrollCalculationMode" AS ENUM ('MONTHLY_BASE', 'VALIDATED_HOURS');

-- AlterTable
ALTER TABLE "hr_attendance_events" ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "serviceCardId" TEXT;

-- AlterTable
ALTER TABLE "hr_payroll_lines" ADD COLUMN     "attendanceHours" DECIMAL(7,2) NOT NULL DEFAULT 0,
ADD COLUMN     "automaticAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "hourlyRate" DECIMAL(18,6) NOT NULL DEFAULT 0,
ADD COLUMN     "overtimeHours" DECIMAL(7,2) NOT NULL DEFAULT 0,
ADD COLUMN     "regularHours" DECIMAL(7,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "hr_payroll_runs" ADD COLUMN     "policySnapshot" JSONB,
ADD COLUMN     "policyVersion" INTEGER;

-- AlterTable
ALTER TABLE "hr_timesheet_entries" ADD COLUMN     "attendanceInId" TEXT,
ADD COLUMN     "attendanceOutId" TEXT;

-- CreateTable
CREATE TABLE "hr_company_payroll_policies" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "mode" "PayrollCalculationMode" NOT NULL DEFAULT 'MONTHLY_BASE',
    "standardMonthlyHours" DECIMAL(7,2),
    "overtimeCoefficient" DECIMAL(5,2),
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_company_payroll_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_employee_service_cards" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenCiphertext" TEXT NOT NULL,
    "issuedByUserId" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,

    CONSTRAINT "hr_employee_service_cards_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hr_company_payroll_policies_companyId_key" ON "hr_company_payroll_policies"("companyId");

-- CreateIndex
CREATE INDEX "hr_company_payroll_policies_organizationId_companyId_idx" ON "hr_company_payroll_policies"("organizationId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "hr_company_payroll_policies_companyId_organizationId_key" ON "hr_company_payroll_policies"("companyId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "hr_company_payroll_policies_id_organizationId_companyId_key" ON "hr_company_payroll_policies"("id", "organizationId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "hr_employee_service_cards_tokenHash_key" ON "hr_employee_service_cards"("tokenHash");

-- CreateIndex
CREATE INDEX "hr_employee_service_cards_organizationId_companyId_employee_idx" ON "hr_employee_service_cards"("organizationId", "companyId", "employeeId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "hr_employee_service_cards_id_organizationId_companyId_key" ON "hr_employee_service_cards"("id", "organizationId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "hr_employee_service_cards_id_employeeId_organizationId_comp_key" ON "hr_employee_service_cards"("id", "employeeId", "organizationId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "companies_id_organizationId_key" ON "companies"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "hr_attendance_events_id_organizationId_companyId_key" ON "hr_attendance_events"("id", "organizationId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "hr_attendance_events_companyId_idempotencyKey_key" ON "hr_attendance_events"("companyId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "hr_timesheet_entries_companyId_attendanceInId_attendanceOut_key" ON "hr_timesheet_entries"("companyId", "attendanceInId", "attendanceOutId", "workDate");

-- AddForeignKey
ALTER TABLE "hr_attendance_events" ADD CONSTRAINT "hr_attendance_events_employeeId_organizationId_companyId_fkey" FOREIGN KEY ("employeeId", "organizationId", "companyId") REFERENCES "hr_employees"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_attendance_events" ADD CONSTRAINT "hr_attendance_events_serviceCardId_employeeId_organization_fkey" FOREIGN KEY ("serviceCardId", "employeeId", "organizationId", "companyId") REFERENCES "hr_employee_service_cards"("id", "employeeId", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_timesheet_entries" ADD CONSTRAINT "hr_timesheet_entries_attendanceInId_organizationId_company_fkey" FOREIGN KEY ("attendanceInId", "organizationId", "companyId") REFERENCES "hr_attendance_events"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_timesheet_entries" ADD CONSTRAINT "hr_timesheet_entries_attendanceOutId_organizationId_compan_fkey" FOREIGN KEY ("attendanceOutId", "organizationId", "companyId") REFERENCES "hr_attendance_events"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_company_payroll_policies" ADD CONSTRAINT "hr_company_payroll_policies_companyId_organizationId_fkey" FOREIGN KEY ("companyId", "organizationId") REFERENCES "companies"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_employee_service_cards" ADD CONSTRAINT "hr_employee_service_cards_employeeId_organizationId_compan_fkey" FOREIGN KEY ("employeeId", "organizationId", "companyId") REFERENCES "hr_employees"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preserve existing monthly payroll calculations when adding the new provenance fields.
UPDATE "hr_payroll_lines" SET "automaticAmount" = "baseSalary";

CREATE UNIQUE INDEX "hr_service_card_one_active_per_employee"
  ON "hr_employee_service_cards" ("companyId", "employeeId") WHERE "revokedAt" IS NULL;
ALTER TABLE "hr_employee_service_cards" ADD CONSTRAINT "service_card_revocation_complete"
  CHECK (("revokedAt" IS NULL) = ("revokedByUserId" IS NULL));
ALTER TABLE "hr_employee_service_cards" ADD CONSTRAINT "service_card_validity"
  CHECK ("expiresAt" IS NULL OR "expiresAt" > "issuedAt");

CREATE FUNCTION axora_service_card_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Service card evidence cannot be deleted'; END IF;
  IF OLD."revokedAt" IS NOT NULL OR NEW."revokedAt" IS NULL
     OR (to_jsonb(NEW) - ARRAY['revokedAt', 'revokedByUserId']) IS DISTINCT FROM
        (to_jsonb(OLD) - ARRAY['revokedAt', 'revokedByUserId'])
     OR NEW."revokedAt" < OLD."issuedAt" THEN
    RAISE EXCEPTION 'Service cards can only be revoked once';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "hr_service_card_evidence_guard" BEFORE UPDATE OR DELETE ON "hr_employee_service_cards"
  FOR EACH ROW EXECUTE FUNCTION axora_service_card_evidence();

ALTER TABLE "hr_company_payroll_policies" ADD CONSTRAINT "payroll_policy_explicit_positive_values"
  CHECK ("version" > 0 AND ("standardMonthlyHours" IS NULL OR "standardMonthlyHours" > 0)
    AND ("overtimeCoefficient" IS NULL OR "overtimeCoefficient" >= 0)
    AND ("mode" <> 'VALIDATED_HOURS' OR ("standardMonthlyHours" IS NOT NULL AND "overtimeCoefficient" IS NOT NULL)));

CREATE FUNCTION axora_timesheet_attendance_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sheet RECORD; entering RECORD; leaving RECORD;
BEGIN
  IF NEW."attendanceInId" IS NULL AND NEW."attendanceOutId" IS NULL THEN RETURN NEW; END IF;
  IF NEW."attendanceInId" IS NULL OR NEW."attendanceOutId" IS NULL THEN
    RAISE EXCEPTION 'Imported attendance requires an IN and an OUT event';
  END IF;
  SELECT * INTO sheet FROM "hr_timesheets" WHERE "id" = NEW."timesheetId" FOR SHARE;
  SELECT * INTO entering FROM "hr_attendance_events" WHERE "id" = NEW."attendanceInId";
  SELECT * INTO leaving FROM "hr_attendance_events" WHERE "id" = NEW."attendanceOutId";
  IF sheet."employeeId" IS DISTINCT FROM entering."employeeId"
    OR sheet."employeeId" IS DISTINCT FROM leaving."employeeId"
    OR sheet."companyId" IS DISTINCT FROM entering."companyId"
    OR sheet."companyId" IS DISTINCT FROM leaving."companyId"
    OR sheet."organizationId" IS DISTINCT FROM entering."organizationId"
    OR sheet."organizationId" IS DISTINCT FROM leaving."organizationId"
    OR entering."type" <> 'IN' OR leaving."type" <> 'OUT'
    OR entering."occurredAt" >= leaving."occurredAt"
    OR NEW."projectId" IS DISTINCT FROM entering."projectId"
    OR NEW."workDate"::date < entering."occurredAt"::date
    OR NEW."workDate"::date > leaving."occurredAt"::date THEN
    RAISE EXCEPTION 'Timesheet attendance sources must match employee, scope, interval and project';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "hr_timesheet_attendance_sources_guard" BEFORE INSERT OR UPDATE ON "hr_timesheet_entries"
  FOR EACH ROW EXECUTE FUNCTION axora_timesheet_attendance_evidence();

CREATE FUNCTION axora_closed_payroll_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" = 'CLOSED' THEN RAISE EXCEPTION 'Closed payroll is immutable'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF NEW."organizationId" <> OLD."organizationId" OR NEW."companyId" <> OLD."companyId"
    OR NEW."period" <> OLD."period" OR NEW."currency" <> OLD."currency" THEN
    RAISE EXCEPTION 'Payroll scope and period are immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "hr_closed_payroll_guard" BEFORE UPDATE OR DELETE ON "hr_payroll_runs"
  FOR EACH ROW EXECUTE FUNCTION axora_closed_payroll_evidence();

CREATE FUNCTION axora_payroll_line_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE run_status "PayrollStatus";
BEGIN
  SELECT "status" INTO run_status FROM "hr_payroll_runs"
    WHERE "id" = CASE WHEN TG_OP = 'DELETE' THEN OLD."runId" ELSE NEW."runId" END FOR UPDATE;
  IF run_status = 'CLOSED' THEN RAISE EXCEPTION 'Closed payroll lines are immutable'; END IF;
  IF TG_OP = 'UPDATE' AND (NEW."runId" <> OLD."runId" OR NEW."employeeId" <> OLD."employeeId"
    OR NEW."organizationId" <> OLD."organizationId" OR NEW."companyId" <> OLD."companyId") THEN
    RAISE EXCEPTION 'Payroll line source and scope are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "hr_payroll_line_evidence_guard" BEFORE INSERT OR UPDATE OR DELETE ON "hr_payroll_lines"
  FOR EACH ROW EXECUTE FUNCTION axora_payroll_line_evidence();

