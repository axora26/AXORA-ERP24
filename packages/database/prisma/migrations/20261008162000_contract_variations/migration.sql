-- Avenants contractuels structurés : workflow, lignes immuables et isolation tenant.

CREATE TYPE "ContractVariationStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED');

CREATE TABLE "sales_contract_variations" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "contractId" TEXT NOT NULL,
  "revisionNumber" INTEGER NOT NULL,
  "code" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "amountDelta" DECIMAL(24,6) NOT NULL,
  "status" "ContractVariationStatus" NOT NULL DEFAULT 'DRAFT',
  "version" INTEGER NOT NULL DEFAULT 1,
  "submittedAt" TIMESTAMP(3),
  "decidedAt" TIMESTAMP(3),
  "decisionNote" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "decidedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sales_contract_variations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sales_contract_variation_lines" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "contractId" TEXT NOT NULL,
  "variationId" TEXT NOT NULL,
  "sourceContractLotId" TEXT,
  "position" INTEGER NOT NULL,
  "reference" TEXT,
  "designation" TEXT NOT NULL,
  "unitCode" TEXT NOT NULL,
  "quantity" DECIMAL(24,6) NOT NULL,
  "unitPrice" DECIMAL(24,6) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sales_contract_variation_lines_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "sales_contract_variations"
  ADD CONSTRAINT "sales_contract_variations_revisionNumber_check" CHECK ("revisionNumber" > 0),
  ADD CONSTRAINT "sales_contract_variations_version_check" CHECK ("version" > 0),
  ADD CONSTRAINT "sales_contract_variations_amountDelta_check" CHECK (
    "amountDelta" <> 0
    AND "amountDelta"::TEXT NOT IN ('NaN', 'Infinity', '-Infinity')
  ),
  ADD CONSTRAINT "sales_contract_variations_status_timestamps_check" CHECK (
    ("status" = 'DRAFT' AND "submittedAt" IS NULL AND "decidedAt" IS NULL AND "decidedByUserId" IS NULL AND "decisionNote" IS NULL)
    OR ("status" = 'SUBMITTED' AND "submittedAt" IS NOT NULL AND "decidedAt" IS NULL AND "decidedByUserId" IS NULL AND "decisionNote" IS NULL)
    OR ("status" = 'APPROVED' AND "submittedAt" IS NOT NULL AND "decidedAt" IS NOT NULL AND "decidedByUserId" IS NOT NULL AND "decidedByUserId" <> "createdByUserId")
    OR ("status" = 'REJECTED' AND "submittedAt" IS NOT NULL AND "decidedAt" IS NOT NULL AND "decidedByUserId" IS NOT NULL AND "decidedByUserId" <> "createdByUserId" AND NULLIF(BTRIM("decisionNote"), '') IS NOT NULL)
  );

ALTER TABLE "sales_contract_variation_lines"
  ADD CONSTRAINT "sales_contract_variation_lines_position_check" CHECK ("position" > 0),
  ADD CONSTRAINT "sales_contract_variation_lines_quantity_check" CHECK (
    "quantity" <> 0
    AND "quantity"::TEXT NOT IN ('NaN', 'Infinity', '-Infinity')
  ),
  ADD CONSTRAINT "sales_contract_variation_lines_unitPrice_check" CHECK (
    "unitPrice" >= 0
    AND "unitPrice"::TEXT NOT IN ('NaN', 'Infinity', '-Infinity')
  );

CREATE UNIQUE INDEX "sales_contract_variations_contractId_revisionNumber_key"
  ON "sales_contract_variations"("contractId", "revisionNumber");
CREATE UNIQUE INDEX "sales_contract_variations_contractId_code_key"
  ON "sales_contract_variations"("contractId", "code");
CREATE UNIQUE INDEX "sales_contract_variations_id_organizationId_companyId_key"
  ON "sales_contract_variations"("id", "organizationId", "companyId");
CREATE UNIQUE INDEX "sales_contract_variations_id_organizationId_companyId_contractId_key"
  ON "sales_contract_variations"("id", "organizationId", "companyId", "contractId");
CREATE INDEX "sales_contract_variations_organizationId_companyId_contractId_status_createdAt_idx"
  ON "sales_contract_variations"("organizationId", "companyId", "contractId", "status", "createdAt");

CREATE UNIQUE INDEX "sales_contract_variation_lines_variationId_position_key"
  ON "sales_contract_variation_lines"("variationId", "position");
CREATE INDEX "sales_contract_variation_lines_organizationId_companyId_contractId_variationId_position_idx"
  ON "sales_contract_variation_lines"("organizationId", "companyId", "contractId", "variationId", "position");
CREATE INDEX "sales_contract_variation_lines_organizationId_companyId_sourceContractLotId_idx"
  ON "sales_contract_variation_lines"("organizationId", "companyId", "sourceContractLotId");

ALTER TABLE "sales_contract_variations"
  ADD CONSTRAINT "sales_contract_variations_contractId_organizationId_companyId_fkey"
  FOREIGN KEY ("contractId", "organizationId", "companyId")
  REFERENCES "sales_contracts"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sales_contract_variation_lines"
  ADD CONSTRAINT "sales_contract_variation_lines_variationId_organizationId_companyId_contractId_fkey"
  FOREIGN KEY ("variationId", "organizationId", "companyId", "contractId")
  REFERENCES "sales_contract_variations"("id", "organizationId", "companyId", "contractId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sales_contract_variation_lines"
  ADD CONSTRAINT "sales_contract_variation_lines_sourceContractLotId_organizationId_companyId_contractId_fkey"
  FOREIGN KEY ("sourceContractLotId", "organizationId", "companyId", "contractId")
  REFERENCES "sales_contract_lots"("id", "organizationId", "companyId", "contractId") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "enforce_contract_variation_line_insert"() RETURNS trigger AS $$
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

CREATE TRIGGER "contract_variation_line_insert_guard"
BEFORE INSERT ON "sales_contract_variation_lines"
FOR EACH ROW EXECUTE FUNCTION "enforce_contract_variation_line_insert"();

CREATE FUNCTION "reject_contract_variation_line_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Contract variation lines are immutable'
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "contract_variation_line_mutation_guard"
BEFORE UPDATE OR DELETE ON "sales_contract_variation_lines"
FOR EACH ROW EXECUTE FUNCTION "reject_contract_variation_line_mutation"();

CREATE FUNCTION "validate_contract_variation_amount"() RETURNS trigger AS $$
DECLARE
  stored_line_count INTEGER;
  stored_amount NUMERIC(24,6);
BEGIN
  SELECT COUNT(*), COALESCE(SUM(ROUND("quantity" * "unitPrice", 6)), 0)
    INTO stored_line_count, stored_amount
  FROM "sales_contract_variation_lines"
  WHERE "variationId" = NEW."id"
    AND "organizationId" = NEW."organizationId"
    AND "companyId" = NEW."companyId"
    AND "contractId" = NEW."contractId";

  IF stored_line_count = 0 OR stored_amount IS DISTINCT FROM NEW."amountDelta" THEN
    RAISE EXCEPTION 'Contract variation amount must equal the rounded sum of its sealed lines'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "contract_variation_amount_seal_guard"
AFTER INSERT ON "sales_contract_variations"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_contract_variation_amount"();

CREATE FUNCTION "enforce_contract_variation_update"() RETURNS trigger AS $$
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

CREATE TRIGGER "contract_variation_update_guard"
BEFORE UPDATE OR DELETE ON "sales_contract_variations"
FOR EACH ROW EXECUTE FUNCTION "enforce_contract_variation_update"();
