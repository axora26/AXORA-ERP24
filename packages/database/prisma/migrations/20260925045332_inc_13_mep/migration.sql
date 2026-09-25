-- CreateEnum
CREATE TYPE "MepDiscipline" AS ENUM ('HVAC', 'ELECTRICAL', 'LOW_CURRENT', 'PLUMBING', 'FIRE_PROTECTION');

-- CreateEnum
CREATE TYPE "MepEquipmentStatus" AS ENUM ('SPECIFIED', 'SELECTED', 'INSTALLED', 'COMMISSIONED');

-- CreateEnum
CREATE TYPE "CalculationStatus" AS ENUM ('DRAFT', 'VALIDATED', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "mep_systems" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "discipline" "MepDiscipline" NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mep_systems_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mep_equipment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "systemId" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "discipline" "MepDiscipline" NOT NULL,
    "manufacturer" TEXT,
    "model" TEXT,
    "location" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "specs" JSONB NOT NULL,
    "status" "MepEquipmentStatus" NOT NULL DEFAULT 'SPECIFIED',
    "technicalDocumentId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mep_equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engineering_calculations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "systemId" TEXT,
    "equipmentId" TEXT,
    "calcType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "currentRevision" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engineering_calculations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engineering_calculation_revisions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "calculationId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "inputs" JSONB NOT NULL,
    "outputs" JSONB NOT NULL,
    "formula" TEXT NOT NULL,
    "substitution" TEXT NOT NULL,
    "assumptions" JSONB NOT NULL,
    "sources" TEXT,
    "notes" TEXT,
    "kernelVersion" TEXT NOT NULL,
    "status" "CalculationStatus" NOT NULL DEFAULT 'DRAFT',
    "authorUserId" TEXT NOT NULL,
    "validatedByUserId" TEXT,
    "validatedAt" TIMESTAMP(3),
    "validationNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engineering_calculation_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mep_systems_projectId_code_key" ON "mep_systems"("projectId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "mep_systems_id_organizationId_companyId_key" ON "mep_systems"("id", "organizationId", "companyId");

-- CreateIndex
CREATE INDEX "mep_equipment_organizationId_companyId_projectId_status_idx" ON "mep_equipment"("organizationId", "companyId", "projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "mep_equipment_projectId_tag_key" ON "mep_equipment"("projectId", "tag");

-- CreateIndex
CREATE UNIQUE INDEX "mep_equipment_id_organizationId_companyId_key" ON "mep_equipment"("id", "organizationId", "companyId");

-- CreateIndex
CREATE INDEX "engineering_calculations_organizationId_companyId_projectId_idx" ON "engineering_calculations"("organizationId", "companyId", "projectId");

-- CreateIndex
CREATE INDEX "engineering_calculations_equipmentId_idx" ON "engineering_calculations"("equipmentId");

-- CreateIndex
CREATE UNIQUE INDEX "engineering_calculations_companyId_code_key" ON "engineering_calculations"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "engineering_calculations_id_organizationId_companyId_key" ON "engineering_calculations"("id", "organizationId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "engineering_calculation_revisions_calculationId_revision_key" ON "engineering_calculation_revisions"("calculationId", "revision");

-- AddForeignKey
ALTER TABLE "mep_equipment" ADD CONSTRAINT "mep_equipment_systemId_organizationId_companyId_fkey" FOREIGN KEY ("systemId", "organizationId", "companyId") REFERENCES "mep_systems"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engineering_calculation_revisions" ADD CONSTRAINT "engineering_calculation_revisions_calculationId_organizati_fkey" FOREIGN KEY ("calculationId", "organizationId", "companyId") REFERENCES "engineering_calculations"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Garanties en base (INC-13)
-- ---------------------------------------------------------------------------

-- Revision de note de calcul : contenu jamais reecrit, jamais supprime.
CREATE OR REPLACE FUNCTION axora_calculation_revision_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Calculation revisions are never deleted' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW."calculationId" IS DISTINCT FROM OLD."calculationId"
    OR NEW."revision" IS DISTINCT FROM OLD."revision"
    OR NEW."inputs"::text IS DISTINCT FROM OLD."inputs"::text
    OR NEW."outputs"::text IS DISTINCT FROM OLD."outputs"::text
    OR NEW."formula" IS DISTINCT FROM OLD."formula"
    OR NEW."substitution" IS DISTINCT FROM OLD."substitution"
    OR NEW."assumptions"::text IS DISTINCT FROM OLD."assumptions"::text
    OR NEW."sources" IS DISTINCT FROM OLD."sources"
    OR NEW."kernelVersion" IS DISTINCT FROM OLD."kernelVersion"
    OR NEW."authorUserId" IS DISTINCT FROM OLD."authorUserId"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'Calculation revision % is immutable: create a new revision', OLD."revision" USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "engineering_calculation_revisions_immutable"
  BEFORE UPDATE OR DELETE ON "engineering_calculation_revisions"
  FOR EACH ROW EXECUTE FUNCTION axora_calculation_revision_guard();

ALTER TABLE "engineering_calculation_revisions"
  ADD CONSTRAINT "calculation_validated_by_other_engineer"
  CHECK ("validatedByUserId" IS NULL OR "validatedByUserId" <> "authorUserId");

ALTER TABLE "mep_equipment" ADD CONSTRAINT "mep_equipment_quantity_positive" CHECK ("quantity" > 0);
