-- Allow the explicit payroll adjustment workflow to update derived statutory values.
-- Source evidence (base salary, validated hours and automatic amount) remains immutable.
CREATE OR REPLACE FUNCTION axora_payroll_line_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE run_status "PayrollStatus";
BEGIN
  SELECT "status" INTO run_status FROM "hr_payroll_runs"
    WHERE "id" = CASE WHEN TG_OP = 'DELETE' THEN OLD."runId" ELSE NEW."runId" END FOR UPDATE;
  IF run_status = 'CLOSED' THEN RAISE EXCEPTION 'Closed payroll lines are immutable'; END IF;
  IF TG_OP = 'UPDATE' AND
    (to_jsonb(NEW) - ARRAY['adjustments', 'adjustmentNotes', 'grossAmount', 'incomeTax', 'socialContribution', 'healthContribution', 'totalDeductions', 'netAmount', 'updatedAt']) IS DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['adjustments', 'adjustmentNotes', 'grossAmount', 'incomeTax', 'socialContribution', 'healthContribution', 'totalDeductions', 'netAmount', 'updatedAt']) THEN
    RAISE EXCEPTION 'Prepared payroll line sources are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF NEW."grossAmount" < 0 OR NEW."grossAmount" <> NEW."automaticAmount" + NEW."adjustments" THEN
    RAISE EXCEPTION 'Payroll total must equal automatic remuneration plus adjustments';
  END IF;
  RETURN NEW;
END $$;
