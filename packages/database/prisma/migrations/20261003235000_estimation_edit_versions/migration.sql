ALTER TABLE "estimation_studies" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "dqe_documents" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "estimation_studies" ADD CONSTRAINT "estimation_study_version_positive" CHECK ("version" >= 1);
ALTER TABLE "dqe_documents" ADD CONSTRAINT "dqe_document_version_positive" CHECK ("version" >= 1);
