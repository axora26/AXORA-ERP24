CREATE TYPE "EmployeeAdvanceStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'PAID', 'PARTIALLY_REPAID', 'SETTLED', 'CANCELLED');
CREATE TYPE "EmployeeAdvanceRepaymentMethod" AS ENUM ('PAYROLL', 'BANK', 'CASH');

CREATE TABLE "hr_employee_advances" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "reason" TEXT NOT NULL,
  "status" "EmployeeAdvanceStatus" NOT NULL DEFAULT 'REQUESTED',
  "requestedByUserId" TEXT NOT NULL,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decidedByUserId" TEXT,
  "decidedAt" TIMESTAMP(3),
  "decisionNote" TEXT,
  "paidAt" TIMESTAMP(3),
  "settledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hr_employee_advances_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hr_employee_advance_repayments" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "advanceId" TEXT NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  "method" "EmployeeAdvanceRepaymentMethod" NOT NULL,
  "repaymentDate" TIMESTAMP(3) NOT NULL,
  "note" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hr_employee_advance_repayments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "hr_employee_advances_organizationId_companyId_status_requestedAt_idx" ON "hr_employee_advances"("organizationId", "companyId", "status", "requestedAt");
CREATE INDEX "hr_employee_advances_organizationId_companyId_employeeId_status_idx" ON "hr_employee_advances"("organizationId", "companyId", "employeeId", "status");
CREATE INDEX "hr_employee_advance_repayments_organizationId_companyId_advanceId_repaymentDate_idx" ON "hr_employee_advance_repayments"("organizationId", "companyId", "advanceId", "repaymentDate");

ALTER TABLE "hr_employee_advances" ADD CONSTRAINT "hr_employee_advances_employeeId_organizationId_companyId_fkey" FOREIGN KEY ("employeeId", "organizationId", "companyId") REFERENCES "hr_employees"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hr_employee_advance_repayments" ADD CONSTRAINT "hr_employee_advance_repayments_advanceId_fkey" FOREIGN KEY ("advanceId") REFERENCES "hr_employee_advances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "hr_employee_advances" ADD CONSTRAINT "hr_employee_advances_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "hr_employee_advance_repayments" ADD CONSTRAINT "hr_employee_advance_repayments_amount_positive" CHECK ("amount" > 0);

CREATE OR REPLACE FUNCTION axora_guard_employee_advance_repayment_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Employee advance repayments are append-only';
END;
$$;
CREATE TRIGGER "hr_employee_advance_repayments_append_only" BEFORE UPDATE OR DELETE ON "hr_employee_advance_repayments" FOR EACH ROW EXECUTE FUNCTION axora_guard_employee_advance_repayment_append_only();
