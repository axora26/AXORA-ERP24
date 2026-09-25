-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "keyHash" CHAR(64) NOT NULL,
    "permissions" TEXT[],
    "rateLimitPerMinute" INTEGER NOT NULL,
    "dailyQuota" INTEGER NOT NULL,
    "allowedIps" TEXT[],
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,
    "revokeReason" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_key_usage" (
    "keyId" TEXT NOT NULL,
    "window" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "api_key_usage_pkey" PRIMARY KEY ("keyId","window")
);

-- CreateTable
CREATE TABLE "api_request_logs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "status" INTEGER NOT NULL,
    "ip" TEXT,
    "durationMs" INTEGER NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_request_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbound_endpoints" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "secretEnc" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastReceivedAt" TIMESTAMP(3),

    CONSTRAINT "inbound_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbound_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "resourceType" TEXT,
    "resourceId" TEXT,
    "payloadSha256" CHAR(64) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbound_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_keyHash_key" ON "api_keys"("keyHash");

-- CreateIndex
CREATE INDEX "api_keys_organizationId_companyId_idx" ON "api_keys"("organizationId", "companyId");

-- CreateIndex
CREATE INDEX "api_request_logs_keyId_at_idx" ON "api_request_logs"("keyId", "at");

-- CreateIndex
CREATE INDEX "inbound_endpoints_organizationId_companyId_idx" ON "inbound_endpoints"("organizationId", "companyId");

-- CreateIndex
CREATE INDEX "inbound_events_organizationId_companyId_receivedAt_idx" ON "inbound_events"("organizationId", "companyId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "inbound_events_endpointId_externalId_key" ON "inbound_events"("endpointId", "externalId");

-- AddForeignKey
ALTER TABLE "api_key_usage" ADD CONSTRAINT "api_key_usage_keyId_fkey" FOREIGN KEY ("keyId") REFERENCES "api_keys"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_request_logs" ADD CONSTRAINT "api_request_logs_keyId_fkey" FOREIGN KEY ("keyId") REFERENCES "api_keys"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_events" ADD CONSTRAINT "inbound_events_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "inbound_endpoints"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Garanties INC-23 (API publique & integrations)
-- ---------------------------------------------------------------------------

ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_limits" CHECK (
  cardinality("permissions") >= 1
  AND "rateLimitPerMinute" BETWEEN 1 AND 600
  AND "dailyQuota" BETWEEN 1 AND 1000000
  AND "keyHash" ~ '^[0-9a-f]{64}$'
);

-- Cle : secret, perimetre, createur et permissions figes ; revocation definitive.
CREATE OR REPLACE FUNCTION axora_api_key_guard() RETURNS trigger AS $$
BEGIN
  IF NEW."keyHash" <> OLD."keyHash" OR NEW."prefix" <> OLD."prefix" OR NEW."organizationId" <> OLD."organizationId" OR NEW."companyId" <> OLD."companyId"
     OR NEW."createdByUserId" <> OLD."createdByUserId" OR NEW."permissions" <> OLD."permissions" THEN
    RAISE EXCEPTION 'API key identity and permissions are immutable: issue a new key' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD."revokedAt" IS NOT NULL AND (NEW."revokedAt" IS DISTINCT FROM OLD."revokedAt" OR NEW."revokeReason" IS DISTINCT FROM OLD."revokeReason") THEN
    RAISE EXCEPTION 'API key revocation is final' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "api_keys_guard" BEFORE UPDATE ON "api_keys" FOR EACH ROW EXECUTE FUNCTION axora_api_key_guard();
CREATE TRIGGER "api_keys_no_delete" BEFORE DELETE ON "api_keys" FOR EACH ROW EXECUTE FUNCTION axora_forbid_delete();

-- Compteurs : jamais decrementes.
ALTER TABLE "api_key_usage" ADD CONSTRAINT "api_key_usage_count" CHECK ("count" >= 0);
CREATE OR REPLACE FUNCTION axora_api_usage_guard() RETURNS trigger AS $$
BEGIN
  IF NEW."count" < OLD."count" THEN
    RAISE EXCEPTION 'API usage counters never decrease' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "api_key_usage_guard" BEFORE UPDATE ON "api_key_usage" FOR EACH ROW EXECUTE FUNCTION axora_api_usage_guard();

-- Journaux append-only.
CREATE TRIGGER "api_request_logs_append_only" BEFORE UPDATE OR DELETE ON "api_request_logs" FOR EACH ROW EXECUTE FUNCTION axora_forbid_mutation();
CREATE TRIGGER "inbound_events_append_only" BEFORE UPDATE OR DELETE ON "inbound_events" FOR EACH ROW EXECUTE FUNCTION axora_forbid_mutation();
ALTER TABLE "inbound_events" ADD CONSTRAINT "inbound_events_status" CHECK ("status" IN ('ACCEPTED', 'REJECTED') AND ("status" = 'REJECTED' OR "resourceId" IS NOT NULL));

-- Point d'entree : secret et perimetre figes, jamais supprime.
CREATE OR REPLACE FUNCTION axora_inbound_endpoint_guard() RETURNS trigger AS $$
BEGIN
  IF NEW."secretEnc" <> OLD."secretEnc" OR NEW."organizationId" <> OLD."organizationId" OR NEW."companyId" <> OLD."companyId" OR NEW."kind" <> OLD."kind" OR NEW."createdByUserId" <> OLD."createdByUserId" THEN
    RAISE EXCEPTION 'Inbound endpoint identity is immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "inbound_endpoints_guard" BEFORE UPDATE ON "inbound_endpoints" FOR EACH ROW EXECUTE FUNCTION axora_inbound_endpoint_guard();
CREATE TRIGGER "inbound_endpoints_no_delete" BEFORE DELETE ON "inbound_endpoints" FOR EACH ROW EXECUTE FUNCTION axora_forbid_delete();
ALTER TABLE "inbound_endpoints" ADD CONSTRAINT "inbound_endpoints_kind" CHECK ("kind" IN ('CRM_LEAD'));
