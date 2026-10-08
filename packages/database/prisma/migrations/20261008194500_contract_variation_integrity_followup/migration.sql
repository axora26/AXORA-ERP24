-- Corrective migration for databases that applied an earlier draft of the
-- contract-variation guards before Wave 3 was published.

CREATE OR REPLACE FUNCTION "enforce_contract_variation_line_insert"() RETURNS trigger AS $$
DECLARE
  parent_status TEXT;
  parent_created_in_current_transaction BOOLEAN;
BEGIN
  SELECT
    "status"::TEXT,
    xmin = pg_current_xact_id()::XID
  INTO parent_status, parent_created_in_current_transaction
  FROM "sales_contract_variations"
  WHERE "id" = NEW."variationId"
    AND "organizationId" = NEW."organizationId"
    AND "companyId" = NEW."companyId"
    AND "contractId" = NEW."contractId"
  FOR UPDATE;

  IF parent_status IS DISTINCT FROM 'DRAFT'
    OR parent_created_in_current_transaction IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Contract variation lines can only be inserted by the variation creation transaction'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "enforce_contract_variation_update"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Contract variations cannot be deleted'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
    OR NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."companyId" IS DISTINCT FROM OLD."companyId"
    OR NEW."contractId" IS DISTINCT FROM OLD."contractId"
    OR NEW."revisionNumber" IS DISTINCT FROM OLD."revisionNumber"
    OR NEW."code" IS DISTINCT FROM OLD."code"
    OR NEW."title" IS DISTINCT FROM OLD."title"
    OR NEW."reason" IS DISTINCT FROM OLD."reason"
    OR NEW."currency" IS DISTINCT FROM OLD."currency"
    OR NEW."amountDelta" IS DISTINCT FROM OLD."amountDelta"
    OR NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'Immutable Contract variation fields cannot be changed'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF NEW."status" IS NOT DISTINCT FROM OLD."status" THEN
    RAISE EXCEPTION 'Contract variations can only change through a valid workflow transition'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF NEW."version" <> OLD."version" + 1 THEN
    RAISE EXCEPTION 'Contract variation version must increment exactly once per transition'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF OLD."status" = 'DRAFT' AND NEW."status" = 'SUBMITTED' THEN
    IF NEW."submittedAt" IS NULL
      OR NEW."submittedAt" < NEW."createdAt"
      OR NEW."decidedAt" IS NOT NULL
      OR NEW."decidedByUserId" IS NOT NULL
      OR NEW."decisionNote" IS NOT NULL THEN
      RAISE EXCEPTION 'Invalid Contract variation submission timestamps'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" = 'SUBMITTED' AND NEW."status" IN ('APPROVED', 'REJECTED') THEN
    IF NEW."submittedAt" IS DISTINCT FROM OLD."submittedAt"
      OR NEW."submittedAt" IS NULL
      OR NEW."decidedAt" IS NULL
      OR NEW."decidedAt" < NEW."submittedAt"
      OR NEW."decidedByUserId" IS NULL
      OR NEW."decidedByUserId" = OLD."createdByUserId"
      OR (NEW."status" = 'REJECTED' AND NULLIF(BTRIM(NEW."decisionNote"), '') IS NULL) THEN
      RAISE EXCEPTION 'Invalid Contract variation decision timestamps'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Invalid Contract variation status transition'
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

ALTER TABLE "sales_contract_variations"
  ADD CONSTRAINT "sales_contract_variations_submitted_chronology_check"
  CHECK ("submittedAt" IS NULL OR "submittedAt" >= "createdAt") NOT VALID;
ALTER TABLE "sales_contract_variations"
  VALIDATE CONSTRAINT "sales_contract_variations_submitted_chronology_check";

ALTER TABLE "sales_contract_variations"
  ADD CONSTRAINT "sales_contract_variations_decided_chronology_check"
  CHECK ("decidedAt" IS NULL OR ("submittedAt" IS NOT NULL AND "decidedAt" >= "submittedAt")) NOT VALID;
ALTER TABLE "sales_contract_variations"
  VALIDATE CONSTRAINT "sales_contract_variations_decided_chronology_check";
