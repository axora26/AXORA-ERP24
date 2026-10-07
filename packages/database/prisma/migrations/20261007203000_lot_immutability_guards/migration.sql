-- Fige les structures de lots au même niveau que les lignes documentaires.

CREATE FUNCTION "enforce_dqe_lot_draft"() RETURNS trigger AS $$
DECLARE
  target_dqe_id TEXT;
  target_org_id TEXT;
  target_company_id TEXT;
  parent_status TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW."dqeId" IS DISTINCT FROM OLD."dqeId"
    OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
    OR NEW."companyId" IS DISTINCT FROM OLD."companyId"
  ) THEN
    RAISE EXCEPTION 'DQE lot parent and tenant scope are immutable';
  END IF;

  target_dqe_id := COALESCE(NEW."dqeId", OLD."dqeId");
  target_org_id := COALESCE(NEW."organizationId", OLD."organizationId");
  target_company_id := COALESCE(NEW."companyId", OLD."companyId");

  SELECT "status"::TEXT INTO parent_status
  FROM "dqe_documents"
  WHERE "id" = target_dqe_id
    AND "organizationId" = target_org_id
    AND "companyId" = target_company_id
  FOR UPDATE;

  IF parent_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'DQE lots can only be mutated while the document is DRAFT';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "dqe_lot_draft_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "dqe_lots"
FOR EACH ROW EXECUTE FUNCTION "enforce_dqe_lot_draft"();

CREATE FUNCTION "enforce_quote_lot_snapshot"() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "sales_quotes" q
    JOIN "dqe_lots" dl
      ON dl."dqeId" = q."dqeId"
     AND dl."organizationId" = q."organizationId"
     AND dl."companyId" = q."companyId"
    WHERE q."id" = NEW."quoteId"
      AND q."organizationId" = NEW."organizationId"
      AND q."companyId" = NEW."companyId"
      AND dl."position" = NEW."position"
      AND dl."code" = NEW."code"
      AND dl."designation" = NEW."designation"
  ) THEN
    RAISE EXCEPTION 'Invalid immutable Quote lot snapshot';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "quote_lot_snapshot_insert_guard"
BEFORE INSERT ON "sales_quote_lots"
FOR EACH ROW EXECUTE FUNCTION "enforce_quote_lot_snapshot"();

CREATE FUNCTION "reject_quote_lot_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Quote lots are immutable snapshots';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "quote_lot_snapshot_mutation_guard"
BEFORE UPDATE OR DELETE ON "sales_quote_lots"
FOR EACH ROW EXECUTE FUNCTION "reject_quote_lot_mutation"();

CREATE FUNCTION "enforce_quote_line_snapshot"() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "sales_quotes" q
    JOIN "dqe_lines" dl
      ON dl."dqeId" = q."dqeId"
     AND dl."organizationId" = q."organizationId"
     AND dl."companyId" = q."companyId"
    LEFT JOIN "dqe_lots" dl_lot ON dl_lot."id" = dl."lotId"
    LEFT JOIN "sales_quote_lots" ql ON ql."id" = NEW."lotId"
    WHERE q."id" = NEW."quoteId"
      AND q."organizationId" = NEW."organizationId"
      AND q."companyId" = NEW."companyId"
      AND dl."position" = NEW."position"
      AND dl."reference" IS NOT DISTINCT FROM NEW."reference"
      AND dl."designation" = NEW."designation"
      AND dl."unitCode" = NEW."unitCode"
      AND dl."quantity" = NEW."quantity"
      AND dl."unitPrice" = NEW."unitPrice"
      AND (
        (dl."lotId" IS NULL AND NEW."lotId" IS NULL)
        OR (
          dl."lotId" IS NOT NULL
          AND ql."quoteId" = NEW."quoteId"
          AND ql."position" = dl_lot."position"
          AND ql."code" = dl_lot."code"
          AND ql."designation" = dl_lot."designation"
        )
      )
  ) THEN
    RAISE EXCEPTION 'Invalid immutable Quote line snapshot';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "quote_line_snapshot_insert_guard"
BEFORE INSERT ON "sales_quote_lines"
FOR EACH ROW EXECUTE FUNCTION "enforce_quote_line_snapshot"();

CREATE FUNCTION "reject_quote_line_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Quote lines are immutable snapshots';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "quote_line_snapshot_mutation_guard"
BEFORE UPDATE OR DELETE ON "sales_quote_lines"
FOR EACH ROW EXECUTE FUNCTION "reject_quote_line_mutation"();

CREATE FUNCTION "enforce_contract_lot_snapshot"() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "sales_contracts" c
    JOIN "sales_quote_lots" ql
      ON ql."quoteId" = c."quoteId"
     AND ql."organizationId" = c."organizationId"
     AND ql."companyId" = c."companyId"
    WHERE c."id" = NEW."contractId"
      AND c."organizationId" = NEW."organizationId"
      AND c."companyId" = NEW."companyId"
      AND ql."position" = NEW."position"
      AND ql."code" = NEW."code"
      AND ql."designation" = NEW."designation"
  ) THEN
    RAISE EXCEPTION 'Invalid immutable Contract lot snapshot';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "contract_lot_snapshot_insert_guard"
BEFORE INSERT ON "sales_contract_lots"
FOR EACH ROW EXECUTE FUNCTION "enforce_contract_lot_snapshot"();

CREATE FUNCTION "reject_contract_lot_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Contract lots are immutable snapshots';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "contract_lot_snapshot_mutation_guard"
BEFORE UPDATE OR DELETE ON "sales_contract_lots"
FOR EACH ROW EXECUTE FUNCTION "reject_contract_lot_mutation"();

CREATE FUNCTION "enforce_contract_line_snapshot"() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "sales_contracts" c
    JOIN "sales_quote_lines" qline
      ON qline."quoteId" = c."quoteId"
     AND qline."organizationId" = c."organizationId"
     AND qline."companyId" = c."companyId"
    LEFT JOIN "sales_quote_lots" ql ON ql."id" = qline."lotId"
    LEFT JOIN "sales_contract_lots" cl ON cl."id" = NEW."lotId"
    WHERE c."id" = NEW."contractId"
      AND c."organizationId" = NEW."organizationId"
      AND c."companyId" = NEW."companyId"
      AND qline."position" = NEW."position"
      AND qline."reference" IS NOT DISTINCT FROM NEW."reference"
      AND qline."designation" = NEW."designation"
      AND qline."unitCode" = NEW."unitCode"
      AND qline."quantity" = NEW."quantity"
      AND qline."unitPrice" = NEW."unitPrice"
      AND (
        (qline."lotId" IS NULL AND NEW."lotId" IS NULL)
        OR (
          qline."lotId" IS NOT NULL
          AND cl."contractId" = NEW."contractId"
          AND cl."position" = ql."position"
          AND cl."code" = ql."code"
          AND cl."designation" = ql."designation"
        )
      )
  ) THEN
    RAISE EXCEPTION 'Invalid immutable Contract line snapshot';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "contract_line_snapshot_insert_guard"
BEFORE INSERT ON "sales_contract_lines"
FOR EACH ROW EXECUTE FUNCTION "enforce_contract_line_snapshot"();

CREATE FUNCTION "reject_contract_line_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Contract lines are immutable snapshots';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "contract_line_snapshot_mutation_guard"
BEFORE UPDATE OR DELETE ON "sales_contract_lines"
FOR EACH ROW EXECUTE FUNCTION "reject_contract_line_mutation"();
