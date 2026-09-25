-- CreateEnum
CREATE TYPE "PortalPrincipalKind" AS ENUM ('CLIENT', 'SUPPLIER');

-- CreateEnum
CREATE TYPE "PortalPrincipalStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'REVOKED');

-- CreateEnum
CREATE TYPE "PortalResourceType" AS ENUM ('PROJECT', 'CUSTOMER_INVOICE', 'DOCUMENT', 'PURCHASE_ORDER', 'SUPPLIER_INVOICE');

-- CreateTable
CREATE TABLE "portal_principals" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" "PortalPrincipalKind" NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "crmAccountId" TEXT,
    "supplierId" TEXT,
    "passwordHash" TEXT,
    "status" "PortalPrincipalStatus" NOT NULL DEFAULT 'INVITED',
    "activatedAt" TIMESTAMP(3),
    "statusChangedAt" TIMESTAMP(3),
    "statusChangedBy" TEXT,
    "statusReason" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_principals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_invitations" (
    "id" TEXT NOT NULL,
    "principalId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_sessions" (
    "id" TEXT NOT NULL,
    "principalId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_resource_grants" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "principalId" TEXT NOT NULL,
    "resourceType" "PortalResourceType" NOT NULL,
    "resourceId" TEXT NOT NULL,
    "grantedByUserId" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedByUserId" TEXT,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "portal_resource_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_order_acknowledgements" (
    "id" TEXT NOT NULL,
    "principalId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "confirmedDate" DATE NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_order_acknowledgements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "portal_principals_organizationId_companyId_status_idx" ON "portal_principals"("organizationId", "companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "portal_principals_companyId_email_key" ON "portal_principals"("companyId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "portal_invitations_tokenHash_key" ON "portal_invitations"("tokenHash");

-- CreateIndex
CREATE INDEX "portal_invitations_principalId_idx" ON "portal_invitations"("principalId");

-- CreateIndex
CREATE UNIQUE INDEX "portal_sessions_tokenHash_key" ON "portal_sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "portal_sessions_principalId_idx" ON "portal_sessions"("principalId");

-- CreateIndex
CREATE INDEX "portal_resource_grants_principalId_resourceType_idx" ON "portal_resource_grants"("principalId", "resourceType");

-- CreateIndex
CREATE INDEX "portal_order_acknowledgements_orderId_idx" ON "portal_order_acknowledgements"("orderId");

-- AddForeignKey
ALTER TABLE "portal_principals" ADD CONSTRAINT "portal_principals_supplierId_organizationId_companyId_fkey" FOREIGN KEY ("supplierId", "organizationId", "companyId") REFERENCES "suppliers"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_invitations" ADD CONSTRAINT "portal_invitations_principalId_fkey" FOREIGN KEY ("principalId") REFERENCES "portal_principals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_sessions" ADD CONSTRAINT "portal_sessions_principalId_fkey" FOREIGN KEY ("principalId") REFERENCES "portal_principals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_resource_grants" ADD CONSTRAINT "portal_resource_grants_principalId_fkey" FOREIGN KEY ("principalId") REFERENCES "portal_principals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_order_acknowledgements" ADD CONSTRAINT "portal_order_acknowledgements_principalId_fkey" FOREIGN KEY ("principalId") REFERENCES "portal_principals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Garanties en base (INC-20)
-- ---------------------------------------------------------------------------

-- Un principal = une societe + exactement un enregistrement racine du bon type.
ALTER TABLE "portal_principals" ADD CONSTRAINT "portal_principals_root_record" CHECK (
  ("kind" = 'CLIENT' AND "crmAccountId" IS NOT NULL AND "supplierId" IS NULL)
  OR ("kind" = 'SUPPLIER' AND "supplierId" IS NOT NULL AND "crmAccountId" IS NULL)
);
ALTER TABLE "portal_principals" ADD CONSTRAINT "portal_principals_active_password" CHECK ("status" <> 'ACTIVE' OR "passwordHash" IS NOT NULL);
CREATE OR REPLACE FUNCTION axora_portal_principal_guard() RETURNS trigger AS $$
BEGIN
  IF NEW."kind" <> OLD."kind" OR NEW."companyId" <> OLD."companyId" OR NEW."organizationId" <> OLD."organizationId"
     OR NEW."crmAccountId" IS DISTINCT FROM OLD."crmAccountId" OR NEW."supplierId" IS DISTINCT FROM OLD."supplierId" THEN
    RAISE EXCEPTION 'A portal principal never changes company or root record' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD."status" = 'REVOKED' AND NEW."status" <> 'REVOKED' THEN
    RAISE EXCEPTION 'A revoked portal principal stays revoked' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "portal_principals_guard" BEFORE UPDATE ON "portal_principals" FOR EACH ROW EXECUTE FUNCTION axora_portal_principal_guard();
CREATE TRIGGER "portal_principals_no_delete" BEFORE DELETE ON "portal_principals" FOR EACH ROW EXECUTE FUNCTION axora_forbid_delete();

-- Suspension / revocation : toutes les sessions et invitations ouvertes sont invalidees dans la meme transaction.
CREATE OR REPLACE FUNCTION axora_portal_status_cascade() RETURNS trigger AS $$
BEGIN
  IF NEW."status" IN ('SUSPENDED', 'REVOKED') AND OLD."status" NOT IN ('SUSPENDED', 'REVOKED') THEN
    UPDATE "portal_sessions" SET "revokedAt" = now() WHERE "principalId" = NEW."id" AND "revokedAt" IS NULL;
    UPDATE "portal_invitations" SET "revokedAt" = now() WHERE "principalId" = NEW."id" AND "revokedAt" IS NULL AND "usedAt" IS NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "portal_principals_status_cascade" AFTER UPDATE OF "status" ON "portal_principals" FOR EACH ROW EXECUTE FUNCTION axora_portal_status_cascade();

-- Invitation : usage unique.
ALTER TABLE "portal_invitations" ADD CONSTRAINT "portal_invitations_single_use" CHECK ("usedAt" IS NULL OR "revokedAt" IS NULL);
CREATE OR REPLACE FUNCTION axora_portal_invitation_guard() RETURNS trigger AS $$
BEGIN
  IF OLD."usedAt" IS NOT NULL OR OLD."revokedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'A portal invitation is single-use' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "portal_invitations_guard" BEFORE UPDATE ON "portal_invitations" FOR EACH ROW EXECUTE FUNCTION axora_portal_invitation_guard();

-- Autorisation : une seule autorisation active par ressource et par principal ; revocation definitive.
CREATE UNIQUE INDEX "portal_resource_grants_one_active" ON "portal_resource_grants" ("principalId", "resourceType", "resourceId") WHERE "revokedAt" IS NULL;
CREATE OR REPLACE FUNCTION axora_portal_grant_guard() RETURNS trigger AS $$
BEGIN
  IF OLD."revokedAt" IS NOT NULL OR NEW."principalId" <> OLD."principalId" OR NEW."resourceType" <> OLD."resourceType" OR NEW."resourceId" <> OLD."resourceId" THEN
    RAISE EXCEPTION 'A portal grant is only ever revoked, never changed' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "portal_resource_grants_guard" BEFORE UPDATE ON "portal_resource_grants" FOR EACH ROW EXECUTE FUNCTION axora_portal_grant_guard();
CREATE TRIGGER "portal_resource_grants_no_delete" BEFORE DELETE ON "portal_resource_grants" FOR EACH ROW EXECUTE FUNCTION axora_forbid_delete();

CREATE TRIGGER "portal_order_acknowledgements_append_only" BEFORE UPDATE OR DELETE ON "portal_order_acknowledgements" FOR EACH ROW EXECUTE FUNCTION axora_forbid_mutation();
