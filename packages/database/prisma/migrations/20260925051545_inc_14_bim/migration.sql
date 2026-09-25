-- CreateEnum
CREATE TYPE "BimDiscipline" AS ENUM ('ARCHITECTURE', 'STRUCTURE', 'HVAC', 'ELECTRICAL', 'PLUMBING', 'FIRE_PROTECTION', 'COORDINATION', 'OTHER');

-- CreateEnum
CREATE TYPE "BimVersionStatus" AS ENUM ('IMPORTED', 'APPROVED', 'REJECTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "BimClashStatus" AS ENUM ('OPEN', 'RESOLUTION_PROPOSED', 'RESOLVED');

-- CreateTable
CREATE TABLE "bim_models" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "discipline" "BimDiscipline" NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bim_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bim_model_versions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "fileId" TEXT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "fileName" TEXT NOT NULL,
    "schema" TEXT NOT NULL,
    "application" TEXT,
    "entityCount" INTEGER NOT NULL,
    "elementCount" INTEGER NOT NULL,
    "summary" JSONB NOT NULL,
    "status" "BimVersionStatus" NOT NULL DEFAULT 'IMPORTED',
    "importedByUserId" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,

    CONSTRAINT "bim_model_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bim_elements" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "globalId" TEXT NOT NULL,
    "ifcType" TEXT NOT NULL,
    "name" TEXT,
    "description" TEXT,
    "objectType" TEXT,
    "tag" TEXT,
    "storeyName" TEXT,
    "typeName" TEXT,
    "systems" JSONB NOT NULL,
    "classifications" JSONB NOT NULL,
    "properties" JSONB NOT NULL,
    "quantities" JSONB NOT NULL,

    CONSTRAINT "bim_elements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bim_equipment_bindings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "globalId" TEXT NOT NULL,
    "boundByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bim_equipment_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bim_clashes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "elementAGlobalId" TEXT NOT NULL,
    "elementBGlobalId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "BimClashStatus" NOT NULL DEFAULT 'OPEN',
    "proposal" TEXT,
    "proposedByUserId" TEXT,
    "proposedAt" TIMESTAMP(3),
    "resolvedByUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bim_clashes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bim_clash_comments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "clashId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bim_clash_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bim_models_organizationId_companyId_projectId_idx" ON "bim_models"("organizationId", "companyId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "bim_models_companyId_code_key" ON "bim_models"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "bim_models_id_organizationId_companyId_key" ON "bim_models"("id", "organizationId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "bim_model_versions_modelId_versionNumber_key" ON "bim_model_versions"("modelId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "bim_model_versions_id_organizationId_companyId_key" ON "bim_model_versions"("id", "organizationId", "companyId");

-- CreateIndex
CREATE INDEX "bim_elements_versionId_ifcType_idx" ON "bim_elements"("versionId", "ifcType");

-- CreateIndex
CREATE UNIQUE INDEX "bim_elements_versionId_globalId_key" ON "bim_elements"("versionId", "globalId");

-- CreateIndex
CREATE INDEX "bim_equipment_bindings_modelId_globalId_idx" ON "bim_equipment_bindings"("modelId", "globalId");

-- CreateIndex
CREATE UNIQUE INDEX "bim_equipment_bindings_equipmentId_modelId_key" ON "bim_equipment_bindings"("equipmentId", "modelId");

-- CreateIndex
CREATE INDEX "bim_clashes_organizationId_companyId_modelId_status_idx" ON "bim_clashes"("organizationId", "companyId", "modelId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "bim_clashes_companyId_code_key" ON "bim_clashes"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "bim_clashes_id_organizationId_companyId_key" ON "bim_clashes"("id", "organizationId", "companyId");

-- CreateIndex
CREATE INDEX "bim_clash_comments_clashId_idx" ON "bim_clash_comments"("clashId");

-- AddForeignKey
ALTER TABLE "bim_model_versions" ADD CONSTRAINT "bim_model_versions_modelId_organizationId_companyId_fkey" FOREIGN KEY ("modelId", "organizationId", "companyId") REFERENCES "bim_models"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bim_elements" ADD CONSTRAINT "bim_elements_versionId_organizationId_companyId_fkey" FOREIGN KEY ("versionId", "organizationId", "companyId") REFERENCES "bim_model_versions"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bim_clash_comments" ADD CONSTRAINT "bim_clash_comments_clashId_organizationId_companyId_fkey" FOREIGN KEY ("clashId", "organizationId", "companyId") REFERENCES "bim_clashes"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Garanties en base (INC-14)
-- ---------------------------------------------------------------------------

-- Version de maquette : contenu importe immuable ; seul le visa evolue.
CREATE OR REPLACE FUNCTION axora_bim_version_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'BIM model versions are never deleted' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW."modelId" IS DISTINCT FROM OLD."modelId"
    OR NEW."versionNumber" IS DISTINCT FROM OLD."versionNumber"
    OR NEW."fileId" IS DISTINCT FROM OLD."fileId"
    OR NEW."sha256" IS DISTINCT FROM OLD."sha256"
    OR NEW."schema" IS DISTINCT FROM OLD."schema"
    OR NEW."entityCount" IS DISTINCT FROM OLD."entityCount"
    OR NEW."elementCount" IS DISTINCT FROM OLD."elementCount"
    OR NEW."summary"::text IS DISTINCT FROM OLD."summary"::text
    OR NEW."importedByUserId" IS DISTINCT FROM OLD."importedByUserId"
    OR NEW."importedAt" IS DISTINCT FROM OLD."importedAt" THEN
    RAISE EXCEPTION 'BIM model version % content is immutable', OLD."versionNumber" USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "bim_model_versions_immutable"
  BEFORE UPDATE OR DELETE ON "bim_model_versions"
  FOR EACH ROW EXECUTE FUNCTION axora_bim_version_guard();

ALTER TABLE "bim_model_versions"
  ADD CONSTRAINT "bim_version_decided_by_third_party" CHECK ("decidedByUserId" IS NULL OR "decidedByUserId" <> "importedByUserId");

CREATE TRIGGER "bim_elements_append_only"
  BEFORE UPDATE OR DELETE ON "bim_elements"
  FOR EACH ROW EXECUTE FUNCTION axora_forbid_mutation();

CREATE TRIGGER "bim_clash_comments_append_only"
  BEFORE UPDATE OR DELETE ON "bim_clash_comments"
  FOR EACH ROW EXECUTE FUNCTION axora_forbid_mutation();

CREATE TRIGGER "bim_clashes_no_delete"
  BEFORE DELETE ON "bim_clashes"
  FOR EACH ROW EXECUTE FUNCTION axora_forbid_delete();

ALTER TABLE "bim_clashes"
  ADD CONSTRAINT "bim_clash_resolved_by_third_party"
  CHECK ("status" <> 'RESOLVED' OR ("resolvedByUserId" IS NOT NULL AND "resolvedByUserId" <> "proposedByUserId"));
ALTER TABLE "bim_clashes"
  ADD CONSTRAINT "bim_clash_distinct_elements" CHECK ("elementAGlobalId" <> "elementBGlobalId");
