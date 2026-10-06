CREATE TYPE "InvoiceSignatureStatus" AS ENUM ('VALID', 'REVOKED');

CREATE TABLE "invoice_signatures" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "invoiceCode" TEXT NOT NULL,
  "documentHash" CHAR(64) NOT NULL,
  "signature" TEXT NOT NULL,
  "algorithm" TEXT NOT NULL DEFAULT 'HMAC-SHA256',
  "signerUserId" TEXT NOT NULL,
  "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" "InvoiceSignatureStatus" NOT NULL DEFAULT 'VALID',
  "revokedAt" TIMESTAMP(3),
  "revokedByUserId" TEXT,
  "revokeReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "invoice_signatures_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "invoice_signatures_companyId_invoiceId_documentHash_key"
  ON "invoice_signatures"("companyId", "invoiceId", "documentHash");
CREATE INDEX "invoice_signatures_org_company_invoice_status_idx"
  ON "invoice_signatures"("organizationId", "companyId", "invoiceId", "status");
ALTER TABLE "invoice_signatures"
  ADD CONSTRAINT "invoice_signatures_documentHash_check"
  CHECK ("documentHash" ~ '^[0-9a-f]{64}$');

CREATE OR REPLACE FUNCTION axora_invoice_signature_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'invoice signatures are append-only' USING ERRCODE = 'P0001';
  END IF;
  IF NEW."organizationId" <> OLD."organizationId"
    OR NEW."companyId" <> OLD."companyId"
    OR NEW."invoiceId" <> OLD."invoiceId"
    OR NEW."invoiceCode" <> OLD."invoiceCode"
    OR NEW."documentHash" <> OLD."documentHash"
    OR NEW."signature" <> OLD."signature"
    OR NEW."algorithm" <> OLD."algorithm"
    OR NEW."signerUserId" <> OLD."signerUserId"
    OR NEW."signedAt" <> OLD."signedAt"
    OR NEW."createdAt" <> OLD."createdAt" THEN
    RAISE EXCEPTION 'invoice signature evidence is immutable' USING ERRCODE = 'P0001';
  END IF;
  IF OLD."status" = 'REVOKED' THEN
    RAISE EXCEPTION 'revoked invoice signatures are immutable' USING ERRCODE = 'P0001';
  END IF;
  IF NEW."status" = 'VALID' AND (NEW."revokedAt" IS NOT NULL OR NEW."revokedByUserId" IS NOT NULL OR NEW."revokeReason" IS NOT NULL) THEN
    RAISE EXCEPTION 'a valid invoice signature cannot contain revocation evidence' USING ERRCODE = 'P0001';
  END IF;
  IF NEW."status" = 'REVOKED' AND (NEW."revokedAt" IS NULL OR NEW."revokedByUserId" IS NULL OR COALESCE(length(trim(NEW."revokeReason")), 0) < 3) THEN
    RAISE EXCEPTION 'revoked invoice signatures require reason and actor' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER invoice_signature_guard
  BEFORE UPDATE OR DELETE ON "invoice_signatures"
  FOR EACH ROW EXECUTE FUNCTION axora_invoice_signature_guard();
