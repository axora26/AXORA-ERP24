-- CreateEnum
CREATE TYPE "EstimationStudyStatus" AS ENUM ('DRAFT', 'READY_FOR_DQE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "EstimationRequirementCategory" AS ENUM ('FACT', 'ASSUMPTION', 'CONSTRAINT', 'RISK', 'NOTE');

-- CreateEnum
CREATE TYPE "DqeStatus" AS ENUM ('DRAFT', 'FINALIZED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "estimation_studies" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "sourceReference" TEXT,
    "status" "EstimationStudyStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "estimation_studies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "estimation_study_requirements" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "category" "EstimationRequirementCategory" NOT NULL,
    "statement" TEXT NOT NULL,
    "sourceReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "estimation_study_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dqe_documents" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "opportunityId" TEXT,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "status" "DqeStatus" NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "finalizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dqe_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dqe_lines" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "dqeId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "reference" TEXT,
    "designation" TEXT NOT NULL,
    "unitCode" TEXT NOT NULL,
    "quantity" DECIMAL(24,6) NOT NULL,
    "unitPrice" DECIMAL(24,6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dqe_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dqe_study_sources" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "dqeId" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "studyCode" TEXT NOT NULL,
    "studyOpportunityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dqe_study_sources_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "estimation_studies_organizationId_companyId_status_createdA_idx" ON "estimation_studies"("organizationId", "companyId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "estimation_studies_opportunityId_idx" ON "estimation_studies"("opportunityId");

-- CreateIndex
CREATE UNIQUE INDEX "estimation_studies_companyId_code_key" ON "estimation_studies"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "estimation_studies_id_organizationId_companyId_key" ON "estimation_studies"("id", "organizationId", "companyId");

-- CreateIndex
CREATE INDEX "estimation_study_requirements_organizationId_companyId_stud_idx" ON "estimation_study_requirements"("organizationId", "companyId", "studyId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "estimation_study_requirements_studyId_position_key" ON "estimation_study_requirements"("studyId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "estimation_study_requirements_id_organizationId_companyId_key" ON "estimation_study_requirements"("id", "organizationId", "companyId");

-- CreateIndex
CREATE INDEX "dqe_documents_organizationId_companyId_status_createdAt_idx" ON "dqe_documents"("organizationId", "companyId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "dqe_documents_opportunityId_idx" ON "dqe_documents"("opportunityId");

-- CreateIndex
CREATE UNIQUE INDEX "dqe_documents_companyId_code_key" ON "dqe_documents"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "dqe_documents_id_organizationId_companyId_key" ON "dqe_documents"("id", "organizationId", "companyId");

-- CreateIndex
CREATE INDEX "dqe_lines_organizationId_companyId_dqeId_position_idx" ON "dqe_lines"("organizationId", "companyId", "dqeId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "dqe_lines_dqeId_position_key" ON "dqe_lines"("dqeId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "dqe_study_sources_dqeId_key" ON "dqe_study_sources"("dqeId");

-- CreateIndex
CREATE INDEX "dqe_study_sources_organizationId_companyId_studyId_idx" ON "dqe_study_sources"("organizationId", "companyId", "studyId");

-- CreateIndex
CREATE UNIQUE INDEX "dqe_study_sources_dqeId_organizationId_companyId_key" ON "dqe_study_sources"("dqeId", "organizationId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "dqe_study_sources_id_organizationId_companyId_key" ON "dqe_study_sources"("id", "organizationId", "companyId");

-- AddForeignKey
ALTER TABLE "estimation_study_requirements" ADD CONSTRAINT "estimation_study_requirements_studyId_organizationId_compa_fkey" FOREIGN KEY ("studyId", "organizationId", "companyId") REFERENCES "estimation_studies"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dqe_lines" ADD CONSTRAINT "dqe_lines_dqeId_organizationId_companyId_fkey" FOREIGN KEY ("dqeId", "organizationId", "companyId") REFERENCES "dqe_documents"("id", "organizationId", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dqe_study_sources" ADD CONSTRAINT "dqe_study_sources_dqeId_organizationId_companyId_fkey" FOREIGN KEY ("dqeId", "organizationId", "companyId") REFERENCES "dqe_documents"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dqe_study_sources" ADD CONSTRAINT "dqe_study_sources_studyId_organizationId_companyId_fkey" FOREIGN KEY ("studyId", "organizationId", "companyId") REFERENCES "estimation_studies"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Database invariant: an Estimation Study can only reference a CRM opportunity
-- from the exact same organization/company scope.
CREATE FUNCTION "enforce_estimation_opportunity_scope"() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "crm_opportunities"
    WHERE "id" = NEW."opportunityId"
      AND "organizationId" = NEW."organizationId"
      AND "companyId" = NEW."companyId"
  ) THEN
    RAISE EXCEPTION 'Estimation Study opportunity scope mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "estimation_study_opportunity_scope_guard"
BEFORE INSERT OR UPDATE OF "opportunityId", "organizationId", "companyId"
ON "estimation_studies"
FOR EACH ROW EXECUTE FUNCTION "enforce_estimation_opportunity_scope"();

-- Study requirements are append-only evidence: application and direct SQL
-- callers cannot rewrite or remove them once recorded.
CREATE FUNCTION "reject_estimation_requirement_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Estimation Study requirements are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "estimation_requirement_append_only_guard"
BEFORE UPDATE OR DELETE ON "estimation_study_requirements"
FOR EACH ROW EXECUTE FUNCTION "reject_estimation_requirement_mutation"();

-- A DQE line may only change while its parent document remains DRAFT.
CREATE FUNCTION "enforce_dqe_line_draft"() RETURNS trigger AS $$
DECLARE
  target_dqe_id TEXT;
  target_org_id TEXT;
  target_company_id TEXT;
BEGIN
  target_dqe_id := COALESCE(NEW."dqeId", OLD."dqeId");
  target_org_id := COALESCE(NEW."organizationId", OLD."organizationId");
  target_company_id := COALESCE(NEW."companyId", OLD."companyId");

  IF NOT EXISTS (
    SELECT 1 FROM "dqe_documents"
    WHERE "id" = target_dqe_id
      AND "organizationId" = target_org_id
      AND "companyId" = target_company_id
      AND "status" = 'DRAFT'
  ) THEN
    RAISE EXCEPTION 'DQE lines can only be mutated while the document is DRAFT';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "dqe_line_draft_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "dqe_lines"
FOR EACH ROW EXECUTE FUNCTION "enforce_dqe_line_draft"();

-- Study -> DQE provenance is an immutable snapshot. The database independently
-- validates document state, study state and every copied source field.
CREATE FUNCTION "enforce_dqe_study_source"() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "dqe_documents" d
    JOIN "estimation_studies" s
      ON s."id" = NEW."studyId"
     AND s."organizationId" = NEW."organizationId"
     AND s."companyId" = NEW."companyId"
    WHERE d."id" = NEW."dqeId"
      AND d."organizationId" = NEW."organizationId"
      AND d."companyId" = NEW."companyId"
      AND d."status" = 'DRAFT'
      AND s."status" = 'READY_FOR_DQE'
      AND s."code" = NEW."studyCode"
      AND s."opportunityId" = NEW."studyOpportunityId"
      AND (d."opportunityId" IS NULL OR d."opportunityId" = s."opportunityId")
  ) THEN
    RAISE EXCEPTION 'Invalid Study to DQE source snapshot';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "dqe_study_source_insert_guard"
BEFORE INSERT ON "dqe_study_sources"
FOR EACH ROW EXECUTE FUNCTION "enforce_dqe_study_source"();

CREATE FUNCTION "reject_dqe_study_source_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'DQE Study source is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "dqe_study_source_append_only_guard"
BEFORE UPDATE OR DELETE ON "dqe_study_sources"
FOR EACH ROW EXECUTE FUNCTION "reject_dqe_study_source_mutation"();
