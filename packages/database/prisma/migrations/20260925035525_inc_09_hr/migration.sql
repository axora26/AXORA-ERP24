-- CreateEnum
CREATE TYPE "EmploymentContractType" AS ENUM ('PERMANENT', 'FIXED_TERM', 'TEMPORARY', 'CONTRACTOR', 'INTERN');

-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "AttendanceType" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "AttendanceSource" AS ENUM ('MANUAL', 'QR', 'PIN', 'BADGE', 'BIOMETRIC');

-- CreateEnum
CREATE TYPE "TimesheetStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'VALIDATED', 'REJECTED');

-- CreateEnum
CREATE TYPE "LeaveType" AS ENUM ('PAID', 'SICK', 'UNPAID', 'TRAINING', 'OTHER');

-- CreateEnum
CREATE TYPE "LeaveStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PayrollStatus" AS ENUM ('DRAFT', 'CLOSED');

-- CreateTable
CREATE TABLE "hr_departments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_employees" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "jobTitle" TEXT NOT NULL,
    "departmentId" TEXT,
    "userId" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "hireDate" TIMESTAMP(3) NOT NULL,
    "contractType" "EmploymentContractType" NOT NULL,
    "status" "EmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
    "terminationDate" TIMESTAMP(3),
    "badgeCode" TEXT,
    "hourlyCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "baseSalary" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_employee_skills" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "certifiedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_employee_skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_attendance_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" "AttendanceType" NOT NULL,
    "source" "AttendanceSource" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "projectId" TEXT,
    "deviceRef" TEXT,
    "note" TEXT,
    "capturedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_attendance_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_timesheets" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "status" "TimesheetStatus" NOT NULL DEFAULT 'DRAFT',
    "totalHours" DECIMAL(7,2) NOT NULL DEFAULT 0,
    "createdByUserId" TEXT NOT NULL,
    "submittedByUserId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_timesheets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_timesheet_entries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "timesheetId" TEXT NOT NULL,
    "workDate" TIMESTAMP(3) NOT NULL,
    "hours" DECIMAL(5,2) NOT NULL,
    "projectId" TEXT,
    "wbsItemId" TEXT,
    "description" TEXT,
    "costAmount" DECIMAL(18,2),

    CONSTRAINT "hr_timesheet_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_leave_requests" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" "LeaveType" NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "days" DECIMAL(5,1) NOT NULL,
    "reason" TEXT,
    "status" "LeaveStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedByUserId" TEXT NOT NULL,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_leave_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_payroll_runs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "status" "PayrollStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" CHAR(3) NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "closedByUserId" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_payroll_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_payroll_lines" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "baseSalary" DECIMAL(18,2) NOT NULL,
    "validatedHours" DECIMAL(7,2) NOT NULL,
    "adjustments" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "grossAmount" DECIMAL(18,2) NOT NULL,
    "adjustmentNotes" TEXT,

    CONSTRAINT "hr_payroll_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hr_departments_companyId_code_key" ON "hr_departments"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "hr_departments_id_organizationId_companyId_key" ON "hr_departments"("id", "organizationId", "companyId");

-- CreateIndex
CREATE INDEX "hr_employees_organizationId_companyId_status_idx" ON "hr_employees"("organizationId", "companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "hr_employees_companyId_code_key" ON "hr_employees"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "hr_employees_companyId_badgeCode_key" ON "hr_employees"("companyId", "badgeCode");

-- CreateIndex
CREATE UNIQUE INDEX "hr_employees_id_organizationId_companyId_key" ON "hr_employees"("id", "organizationId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "hr_employee_skills_employeeId_name_key" ON "hr_employee_skills"("employeeId", "name");

-- CreateIndex
CREATE INDEX "hr_attendance_events_organizationId_companyId_employeeId_oc_idx" ON "hr_attendance_events"("organizationId", "companyId", "employeeId", "occurredAt");

-- CreateIndex
CREATE INDEX "hr_attendance_events_projectId_idx" ON "hr_attendance_events"("projectId");

-- CreateIndex
CREATE INDEX "hr_timesheets_organizationId_companyId_status_idx" ON "hr_timesheets"("organizationId", "companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "hr_timesheets_employeeId_weekStart_key" ON "hr_timesheets"("employeeId", "weekStart");

-- CreateIndex
CREATE UNIQUE INDEX "hr_timesheets_id_organizationId_companyId_key" ON "hr_timesheets"("id", "organizationId", "companyId");

-- CreateIndex
CREATE INDEX "hr_timesheet_entries_timesheetId_idx" ON "hr_timesheet_entries"("timesheetId");

-- CreateIndex
CREATE INDEX "hr_timesheet_entries_projectId_idx" ON "hr_timesheet_entries"("projectId");

-- CreateIndex
CREATE INDEX "hr_leave_requests_organizationId_companyId_status_idx" ON "hr_leave_requests"("organizationId", "companyId", "status");

-- CreateIndex
CREATE INDEX "hr_leave_requests_employeeId_startDate_idx" ON "hr_leave_requests"("employeeId", "startDate");

-- CreateIndex
CREATE UNIQUE INDEX "hr_payroll_runs_companyId_period_key" ON "hr_payroll_runs"("companyId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "hr_payroll_runs_id_organizationId_companyId_key" ON "hr_payroll_runs"("id", "organizationId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "hr_payroll_lines_runId_employeeId_key" ON "hr_payroll_lines"("runId", "employeeId");

-- AddForeignKey
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_departmentId_organizationId_companyId_fkey" FOREIGN KEY ("departmentId", "organizationId", "companyId") REFERENCES "hr_departments"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_employee_skills" ADD CONSTRAINT "hr_employee_skills_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "hr_employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_timesheets" ADD CONSTRAINT "hr_timesheets_employeeId_organizationId_companyId_fkey" FOREIGN KEY ("employeeId", "organizationId", "companyId") REFERENCES "hr_employees"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_timesheet_entries" ADD CONSTRAINT "hr_timesheet_entries_timesheetId_organizationId_companyId_fkey" FOREIGN KEY ("timesheetId", "organizationId", "companyId") REFERENCES "hr_timesheets"("id", "organizationId", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_leave_requests" ADD CONSTRAINT "hr_leave_requests_employeeId_organizationId_companyId_fkey" FOREIGN KEY ("employeeId", "organizationId", "companyId") REFERENCES "hr_employees"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_payroll_lines" ADD CONSTRAINT "hr_payroll_lines_runId_organizationId_companyId_fkey" FOREIGN KEY ("runId", "organizationId", "companyId") REFERENCES "hr_payroll_runs"("id", "organizationId", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Garanties en base (INC-09)
CREATE TRIGGER "hr_attendance_events_append_only"
  BEFORE UPDATE OR DELETE ON "hr_attendance_events"
  FOR EACH ROW EXECUTE FUNCTION axora_forbid_mutation();
ALTER TABLE "hr_timesheet_entries"
  ADD CONSTRAINT "hr_timesheet_entries_hours_range" CHECK ("hours" > 0 AND "hours" <= 24);
ALTER TABLE "hr_employee_skills"
  ADD CONSTRAINT "hr_employee_skills_level_range" CHECK ("level" BETWEEN 1 AND 5);
