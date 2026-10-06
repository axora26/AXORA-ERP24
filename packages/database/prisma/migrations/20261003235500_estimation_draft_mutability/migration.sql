-- Draft corrections are allowed; frozen evidence remains immutable. Lock the
-- parent even for direct SQL so a concurrent finalization cannot race the write.
CREATE OR REPLACE FUNCTION "reject_estimation_requirement_mutation"() RETURNS trigger AS $$
DECLARE
  parent_status TEXT;
  parent_id TEXT;
  parent_org TEXT;
  parent_company TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW."studyId", NEW."organizationId", NEW."companyId")
    IS DISTINCT FROM (OLD."studyId", OLD."organizationId", OLD."companyId") THEN
    RAISE EXCEPTION 'A requirement cannot change study or scope';
  END IF;
  IF TG_OP = 'DELETE' THEN
    parent_id := OLD."studyId"; parent_org := OLD."organizationId"; parent_company := OLD."companyId";
  ELSE
    parent_id := NEW."studyId"; parent_org := NEW."organizationId"; parent_company := NEW."companyId";
  END IF;
  SELECT "status"::TEXT INTO parent_status FROM "estimation_studies"
    WHERE "id" = parent_id AND "organizationId" = parent_org AND "companyId" = parent_company FOR UPDATE;
  IF parent_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'Estimation Study requirements are immutable outside a draft';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER "estimation_requirement_append_only_guard" ON "estimation_study_requirements";
CREATE TRIGGER "estimation_requirement_append_only_guard" BEFORE INSERT OR UPDATE OR DELETE
  ON "estimation_study_requirements" FOR EACH ROW EXECUTE FUNCTION "reject_estimation_requirement_mutation"();

CREATE OR REPLACE FUNCTION "enforce_dqe_line_draft"() RETURNS trigger AS $$
DECLARE
  parent_status TEXT;
  parent_id TEXT;
  parent_org TEXT;
  parent_company TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW."dqeId", NEW."organizationId", NEW."companyId")
    IS DISTINCT FROM (OLD."dqeId", OLD."organizationId", OLD."companyId") THEN
    RAISE EXCEPTION 'A DQE line cannot change document or scope';
  END IF;
  IF TG_OP = 'DELETE' THEN
    parent_id := OLD."dqeId"; parent_org := OLD."organizationId"; parent_company := OLD."companyId";
  ELSE
    parent_id := NEW."dqeId"; parent_org := NEW."organizationId"; parent_company := NEW."companyId";
  END IF;
  SELECT "status"::TEXT INTO parent_status FROM "dqe_documents"
    WHERE "id" = parent_id AND "organizationId" = parent_org AND "companyId" = parent_company FOR UPDATE;
  IF parent_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'DQE lines can only be mutated while the document is DRAFT';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
