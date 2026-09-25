-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "DocumentVersionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "DocumentCategory" AS ENUM ('PLAN', 'SPECIFICATION', 'TECHNICAL_SHEET', 'REPORT', 'MINUTES', 'CONTRACT', 'PHOTO', 'DOE', 'CERTIFICATE', 'OTHER');

-- CreateEnum
CREATE TYPE "SiteLogStatus" AS ENUM ('DRAFT', 'SIGNED');

-- CreateEnum
CREATE TYPE "SiteIssueStatus" AS ENUM ('OPEN', 'CORRECTION_SUBMITTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "SiteIssueCategory" AS ENUM ('QUALITY', 'SAFETY', 'ENVIRONMENT', 'PROGRESS', 'OTHER');

-- CreateEnum
CREATE TYPE "SiteIssueSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "SiteEvidenceKind" AS ENUM ('PHOTO', 'OBSERVATION', 'CORRECTION');

-- CreateTable
CREATE TABLE "stored_files" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "size" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "uploadedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stored_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_folders" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_folders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" "DocumentCategory" NOT NULL,
    "projectId" TEXT,
    "folderId" TEXT,
    "keywords" TEXT,
    "status" "DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "currentVersionNumber" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" TEXT NOT NULL,
    "archivedByUserId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_versions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "revision" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "changeNote" TEXT,
    "status" "DocumentVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "uploadedByUserId" TEXT NOT NULL,
    "submittedByUserId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_zones" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_daily_logs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "logDate" DATE NOT NULL,
    "weather" TEXT,
    "temperature" TEXT,
    "workforceCount" INTEGER NOT NULL,
    "summary" TEXT NOT NULL,
    "safetyNotes" TEXT,
    "status" "SiteLogStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "clientId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "signedByUserId" TEXT,
    "signedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_daily_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_issues" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" "SiteIssueCategory" NOT NULL,
    "severity" "SiteIssueSeverity" NOT NULL,
    "zoneId" TEXT,
    "taskId" TEXT,
    "assigneeName" TEXT NOT NULL,
    "assigneeUserId" TEXT,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" "SiteIssueStatus" NOT NULL DEFAULT 'OPEN',
    "version" INTEGER NOT NULL DEFAULT 1,
    "clientId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "correctionSubmittedByUserId" TEXT,
    "correctionSubmittedAt" TIMESTAMP(3),
    "correctionNote" TEXT,
    "closedByUserId" TEXT,
    "closedAt" TIMESTAMP(3),
    "closureNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_evidence" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" "SiteEvidenceKind" NOT NULL,
    "note" TEXT,
    "fileId" TEXT,
    "takenAt" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "issueId" TEXT,
    "taskId" TEXT,
    "zoneId" TEXT,
    "dailyLogId" TEXT,
    "clientId" TEXT,
    "createdByUserId" TEXT NOT NULL,

    CONSTRAINT "site_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "field_sync_operations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "field_sync_operations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stored_files_companyId_sha256_key" ON "stored_files"("companyId", "sha256");

-- CreateIndex
CREATE UNIQUE INDEX "stored_files_id_organizationId_companyId_key" ON "stored_files"("id", "organizationId", "companyId");

-- CreateIndex
CREATE INDEX "document_folders_organizationId_companyId_projectId_idx" ON "document_folders"("organizationId", "companyId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "document_folders_id_organizationId_companyId_key" ON "document_folders"("id", "organizationId", "companyId");

-- CreateIndex
CREATE INDEX "documents_organizationId_companyId_projectId_status_idx" ON "documents"("organizationId", "companyId", "projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "documents_companyId_code_key" ON "documents"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "documents_id_organizationId_companyId_key" ON "documents"("id", "organizationId", "companyId");

-- CreateIndex
CREATE INDEX "document_versions_organizationId_companyId_status_idx" ON "document_versions"("organizationId", "companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "document_versions_documentId_versionNumber_key" ON "document_versions"("documentId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "site_zones_projectId_code_key" ON "site_zones"("projectId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "site_zones_id_organizationId_companyId_key" ON "site_zones"("id", "organizationId", "companyId");

-- CreateIndex
CREATE INDEX "site_daily_logs_organizationId_companyId_projectId_logDate_idx" ON "site_daily_logs"("organizationId", "companyId", "projectId", "logDate");

-- CreateIndex
CREATE UNIQUE INDEX "site_daily_logs_projectId_logDate_key" ON "site_daily_logs"("projectId", "logDate");

-- CreateIndex
CREATE UNIQUE INDEX "site_daily_logs_companyId_clientId_key" ON "site_daily_logs"("companyId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "site_daily_logs_id_organizationId_companyId_key" ON "site_daily_logs"("id", "organizationId", "companyId");

-- CreateIndex
CREATE INDEX "site_issues_organizationId_companyId_projectId_status_idx" ON "site_issues"("organizationId", "companyId", "projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "site_issues_companyId_code_key" ON "site_issues"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "site_issues_companyId_clientId_key" ON "site_issues"("companyId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "site_issues_id_organizationId_companyId_key" ON "site_issues"("id", "organizationId", "companyId");

-- CreateIndex
CREATE INDEX "site_evidence_organizationId_companyId_projectId_takenAt_idx" ON "site_evidence"("organizationId", "companyId", "projectId", "takenAt");

-- CreateIndex
CREATE INDEX "site_evidence_issueId_idx" ON "site_evidence"("issueId");

-- CreateIndex
CREATE INDEX "site_evidence_taskId_idx" ON "site_evidence"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "site_evidence_companyId_clientId_key" ON "site_evidence"("companyId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "field_sync_operations_companyId_clientId_key" ON "field_sync_operations"("companyId", "clientId");

-- AddForeignKey
ALTER TABLE "document_folders" ADD CONSTRAINT "document_folders_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "document_folders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_folderId_organizationId_companyId_fkey" FOREIGN KEY ("folderId", "organizationId", "companyId") REFERENCES "document_folders"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_documentId_organizationId_companyId_fkey" FOREIGN KEY ("documentId", "organizationId", "companyId") REFERENCES "documents"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_fileId_organizationId_companyId_fkey" FOREIGN KEY ("fileId", "organizationId", "companyId") REFERENCES "stored_files"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_evidence" ADD CONSTRAINT "site_evidence_fileId_organizationId_companyId_fkey" FOREIGN KEY ("fileId", "organizationId", "companyId") REFERENCES "stored_files"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_evidence" ADD CONSTRAINT "site_evidence_issueId_organizationId_companyId_fkey" FOREIGN KEY ("issueId", "organizationId", "companyId") REFERENCES "site_issues"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_evidence" ADD CONSTRAINT "site_evidence_dailyLogId_organizationId_companyId_fkey" FOREIGN KEY ("dailyLogId", "organizationId", "companyId") REFERENCES "site_daily_logs"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Garanties en base (INC-10)
-- ---------------------------------------------------------------------------

-- Fichiers stockes : immuables (le contenu est adresse par son empreinte).
CREATE TRIGGER "stored_files_append_only"
  BEFORE UPDATE OR DELETE ON "stored_files"
  FOR EACH ROW EXECUTE FUNCTION axora_forbid_mutation();

-- Versions de document : le contenu publie ne change jamais ; seul le cycle
-- de decision (soumission, approbation, remplacement) evolue.
CREATE OR REPLACE FUNCTION axora_document_version_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Document versions are immutable: DELETE is forbidden'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW."fileId" IS DISTINCT FROM OLD."fileId"
    OR NEW."fileName" IS DISTINCT FROM OLD."fileName"
    OR NEW."versionNumber" IS DISTINCT FROM OLD."versionNumber"
    OR NEW."revision" IS DISTINCT FROM OLD."revision"
    OR NEW."documentId" IS DISTINCT FROM OLD."documentId"
    OR NEW."uploadedByUserId" IS DISTINCT FROM OLD."uploadedByUserId"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'Document versions are immutable: content of version % cannot change', OLD."versionNumber"
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "document_versions_immutable"
  BEFORE UPDATE OR DELETE ON "document_versions"
  FOR EACH ROW EXECUTE FUNCTION axora_document_version_guard();

-- Preuves de chantier : append-only et toujours rattachees a un contexte metier.
CREATE TRIGGER "site_evidence_append_only"
  BEFORE UPDATE OR DELETE ON "site_evidence"
  FOR EACH ROW EXECUTE FUNCTION axora_forbid_mutation();

ALTER TABLE "site_evidence"
  ADD CONSTRAINT "site_evidence_has_context"
  CHECK (num_nonnulls("issueId", "taskId", "zoneId", "dailyLogId") >= 1);

ALTER TABLE "site_evidence"
  ADD CONSTRAINT "site_evidence_photo_has_file"
  CHECK ("kind" = 'OBSERVATION' OR "fileId" IS NOT NULL);

ALTER TABLE "site_evidence"
  ADD CONSTRAINT "site_evidence_not_empty"
  CHECK ("fileId" IS NOT NULL OR length(btrim(coalesce("note", ''))) > 0);

-- Journal de chantier signe : fige.
CREATE OR REPLACE FUNCTION axora_site_log_guard() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'SIGNED' THEN
    RAISE EXCEPTION 'Signed site log % is frozen: % is forbidden', OLD."id", TG_OP
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "site_daily_logs_signed_frozen"
  BEFORE UPDATE OR DELETE ON "site_daily_logs"
  FOR EACH ROW EXECUTE FUNCTION axora_site_log_guard();

ALTER TABLE "site_daily_logs"
  ADD CONSTRAINT "site_daily_logs_workforce_non_negative" CHECK ("workforceCount" >= 0);

-- Reserve fermee : uniquement apres correction declaree et verification.
ALTER TABLE "site_issues"
  ADD CONSTRAINT "site_issues_closed_after_correction"
  CHECK ("status" <> 'CLOSED' OR ("correctionSubmittedAt" IS NOT NULL AND "closedByUserId" IS NOT NULL AND "closedByUserId" <> "correctionSubmittedByUserId"));

-- Journal des operations de synchronisation : append-only.
CREATE TRIGGER "field_sync_operations_append_only"
  BEFORE UPDATE OR DELETE ON "field_sync_operations"
  FOR EACH ROW EXECUTE FUNCTION axora_forbid_mutation();
