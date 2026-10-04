ALTER TABLE "hr_company_payroll_policies"
  ADD COLUMN "countryCode" CHAR(2),
  ADD COLUMN "employeeSocialRate" DECIMAL(5,2),
  ADD COLUMN "employeeHealthRate" DECIMAL(5,2),
  ADD COLUMN "incomeTaxRate" DECIMAL(5,2),
  ADD COLUMN "taxFreeAllowance" DECIMAL(18,2);

ALTER TABLE "hr_payroll_runs"
  ADD COLUMN "totalDeductions" DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN "netAmount" DECIMAL(18,2) NOT NULL DEFAULT 0;

ALTER TABLE "hr_payroll_lines"
  ADD COLUMN "incomeTax" DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN "socialContribution" DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN "healthContribution" DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN "totalDeductions" DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN "netAmount" DECIMAL(18,2) NOT NULL DEFAULT 0;

ALTER TABLE "hr_company_payroll_policies"
  ADD CONSTRAINT "payroll_policy_country_code_check"
    CHECK ("countryCode" IS NULL OR "countryCode" ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT "payroll_policy_rates_check"
    CHECK ("employeeSocialRate" IS NULL OR ("employeeSocialRate" >= 0 AND "employeeSocialRate" <= 100)),
  ADD CONSTRAINT "payroll_policy_health_rate_check"
    CHECK ("employeeHealthRate" IS NULL OR ("employeeHealthRate" >= 0 AND "employeeHealthRate" <= 100)),
  ADD CONSTRAINT "payroll_policy_income_tax_rate_check"
    CHECK ("incomeTaxRate" IS NULL OR ("incomeTaxRate" >= 0 AND "incomeTaxRate" <= 100)),
  ADD CONSTRAINT "payroll_policy_allowance_check"
    CHECK ("taxFreeAllowance" IS NULL OR "taxFreeAllowance" >= 0);

ALTER TABLE "hr_payroll_lines"
  ADD CONSTRAINT "payroll_line_deductions_non_negative"
    CHECK ("incomeTax" >= 0 AND "socialContribution" >= 0 AND "healthContribution" >= 0 AND "totalDeductions" >= 0 AND "netAmount" >= 0);

ALTER TABLE "hr_payroll_runs"
  ADD CONSTRAINT "payroll_run_totals_non_negative"
    CHECK ("totalDeductions" >= 0 AND "netAmount" >= 0);
