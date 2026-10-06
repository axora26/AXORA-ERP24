CREATE OR REPLACE FUNCTION axora_closed_payroll_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" = 'CLOSED' THEN RAISE EXCEPTION 'Closed payroll is immutable'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF (to_jsonb(NEW) - ARRAY['status', 'closedAt', 'closedByUserId']) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status', 'closedAt', 'closedByUserId']) THEN
    RAISE EXCEPTION 'Prepared payroll source and policy snapshot are immutable';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION axora_payroll_line_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE run_status "PayrollStatus";
BEGIN
  SELECT "status" INTO run_status FROM "hr_payroll_runs"
    WHERE "id" = CASE WHEN TG_OP = 'DELETE' THEN OLD."runId" ELSE NEW."runId" END FOR UPDATE;
  IF run_status = 'CLOSED' THEN RAISE EXCEPTION 'Closed payroll lines are immutable'; END IF;
  IF TG_OP = 'UPDATE' AND
    (to_jsonb(NEW) - ARRAY['adjustments', 'adjustmentNotes', 'grossAmount']) IS DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['adjustments', 'adjustmentNotes', 'grossAmount']) THEN
    RAISE EXCEPTION 'Prepared payroll line sources are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF NEW."grossAmount" < 0 OR NEW."grossAmount" <> NEW."automaticAmount" + NEW."adjustments" THEN
    RAISE EXCEPTION 'Payroll total must equal automatic remuneration plus adjustments';
  END IF;
  RETURN NEW;
END $$;
