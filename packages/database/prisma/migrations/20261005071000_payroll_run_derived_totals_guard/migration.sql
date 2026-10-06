-- Payroll adjustments recalculate derived totals while preserving the source snapshot.
CREATE OR REPLACE FUNCTION axora_closed_payroll_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" = 'CLOSED' THEN RAISE EXCEPTION 'Closed payroll is immutable'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF (to_jsonb(NEW) - ARRAY['status', 'closedAt', 'closedByUserId', 'totalDeductions', 'netAmount', 'updatedAt']) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status', 'closedAt', 'closedByUserId', 'totalDeductions', 'netAmount', 'updatedAt']) THEN
    RAISE EXCEPTION 'Prepared payroll source and policy snapshot are immutable';
  END IF;
  RETURN NEW;
END $$;
