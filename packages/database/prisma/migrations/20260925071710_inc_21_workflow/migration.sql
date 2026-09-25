-- CreateEnum
CREATE TYPE "AutomationExecutionStatus" AS ENUM ('SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "WorkflowApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED');

-- CreateTable
CREATE TABLE "automation_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "payload" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "automation_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_definitions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "eventType" TEXT NOT NULL,
    "conditions" JSONB NOT NULL,
    "actions" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_executions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "status" "AutomationExecutionStatus" NOT NULL,
    "log" JSONB NOT NULL,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_approvals" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "executionId" TEXT,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "requesterUserId" TEXT,
    "approverRoleId" TEXT NOT NULL,
    "escalationRoleId" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "escalatedAt" TIMESTAMP(3),
    "status" "WorkflowApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "executionId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "timestamp" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "lastStatusCode" INTEGER,
    "lastError" TEXT,
    "nextAttemptAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "automation_events_processedAt_occurredAt_idx" ON "automation_events"("processedAt", "occurredAt");

-- CreateIndex
CREATE INDEX "automation_events_organizationId_companyId_type_idx" ON "automation_events"("organizationId", "companyId", "type");

-- CreateIndex
CREATE INDEX "workflow_definitions_organizationId_companyId_eventType_act_idx" ON "workflow_definitions"("organizationId", "companyId", "eventType", "active");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_definitions_companyId_code_version_key" ON "workflow_definitions"("companyId", "code", "version");

-- CreateIndex
CREATE INDEX "automation_executions_organizationId_companyId_status_idx" ON "automation_executions"("organizationId", "companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "automation_executions_definitionId_eventId_key" ON "automation_executions"("definitionId", "eventId");

-- CreateIndex
CREATE INDEX "workflow_approvals_organizationId_companyId_status_idx" ON "workflow_approvals"("organizationId", "companyId", "status");

-- CreateIndex
CREATE INDEX "workflow_approvals_resourceType_resourceId_idx" ON "workflow_approvals"("resourceType", "resourceId");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_approvals_companyId_code_key" ON "workflow_approvals"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_approvals_definitionId_eventId_key" ON "workflow_approvals"("definitionId", "eventId");

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_createdAt_idx" ON "notifications"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "webhook_deliveries_status_nextAttemptAt_idx" ON "webhook_deliveries"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "webhook_deliveries_organizationId_companyId_status_idx" ON "webhook_deliveries"("organizationId", "companyId", "status");

-- AddForeignKey
ALTER TABLE "automation_executions" ADD CONSTRAINT "automation_executions_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "workflow_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_executions" ADD CONSTRAINT "automation_executions_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "automation_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Garanties en base (INC-21)
-- ---------------------------------------------------------------------------

-- Evenement : contenu fige ; seule la date de traitement est posee, une fois.
CREATE OR REPLACE FUNCTION axora_automation_event_guard() RETURNS trigger AS $$
BEGIN
  IF NEW."type" <> OLD."type" OR NEW."resourceType" <> OLD."resourceType" OR NEW."resourceId" <> OLD."resourceId"
     OR NEW."payload"::text <> OLD."payload"::text OR NEW."occurredAt" <> OLD."occurredAt" OR NEW."actorUserId" IS DISTINCT FROM OLD."actorUserId" THEN
    RAISE EXCEPTION 'Automation events are immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD."processedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Automation event already processed' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "automation_events_guard" BEFORE UPDATE ON "automation_events" FOR EACH ROW EXECUTE FUNCTION axora_automation_event_guard();
CREATE TRIGGER "automation_events_no_delete" BEFORE DELETE ON "automation_events" FOR EACH ROW EXECUTE FUNCTION axora_forbid_delete();

-- Definition : versionnee ; seul l'etat actif peut changer (une modification = une nouvelle version).
CREATE OR REPLACE FUNCTION axora_workflow_definition_guard() RETURNS trigger AS $$
BEGIN
  IF NEW."code" <> OLD."code" OR NEW."version" <> OLD."version" OR NEW."eventType" <> OLD."eventType"
     OR NEW."conditions"::text <> OLD."conditions"::text OR NEW."actions"::text <> OLD."actions"::text OR NEW."name" <> OLD."name" THEN
    RAISE EXCEPTION 'A workflow definition version is immutable: create a new version' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "workflow_definitions_guard" BEFORE UPDATE ON "workflow_definitions" FOR EACH ROW EXECUTE FUNCTION axora_workflow_definition_guard();
CREATE TRIGGER "workflow_definitions_no_delete" BEFORE DELETE ON "workflow_definitions" FOR EACH ROW EXECUTE FUNCTION axora_forbid_delete();

-- Journal d'execution append-only.
CREATE TRIGGER "automation_executions_append_only" BEFORE UPDATE OR DELETE ON "automation_executions" FOR EACH ROW EXECUTE FUNCTION axora_forbid_mutation();

-- Approbation de workflow : quatre yeux, decision figee.
ALTER TABLE "workflow_approvals" ADD CONSTRAINT "workflow_approvals_four_eyes" CHECK (
  "status" = 'PENDING' OR ("decidedByUserId" IS NOT NULL AND "decidedAt" IS NOT NULL AND ("requesterUserId" IS NULL OR "decidedByUserId" <> "requesterUserId"))
);
CREATE OR REPLACE FUNCTION axora_workflow_approval_guard() RETURNS trigger AS $$
BEGIN
  IF OLD."status" <> 'PENDING' THEN
    RAISE EXCEPTION 'Workflow approval % is decided', OLD."code" USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW."resourceType" <> OLD."resourceType" OR NEW."resourceId" <> OLD."resourceId" OR NEW."approverRoleId" <> OLD."approverRoleId" OR NEW."requesterUserId" IS DISTINCT FROM OLD."requesterUserId" THEN
    RAISE EXCEPTION 'Workflow approval terms are immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "workflow_approvals_guard" BEFORE UPDATE ON "workflow_approvals" FOR EACH ROW EXECUTE FUNCTION axora_workflow_approval_guard();
CREATE TRIGGER "workflow_approvals_no_delete" BEFORE DELETE ON "workflow_approvals" FOR EACH ROW EXECUTE FUNCTION axora_forbid_delete();

-- Webhook : contenu fige ; chaque tentative est re-signee avec un horodatage
-- frais (anti-rejeu cote destinataire) ; une livraison reussie est definitive.
CREATE OR REPLACE FUNCTION axora_webhook_delivery_guard() RETURNS trigger AS $$
BEGIN
  IF NEW."body" <> OLD."body" OR NEW."url" <> OLD."url" OR NEW."executionId" <> OLD."executionId" OR NEW."definitionId" <> OLD."definitionId" THEN
    RAISE EXCEPTION 'A webhook payload is immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW."attempts" < OLD."attempts" THEN
    RAISE EXCEPTION 'Webhook attempts cannot decrease' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD."status" = 'DELIVERED' THEN
    RAISE EXCEPTION 'Webhook already delivered' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "webhook_deliveries_guard" BEFORE UPDATE ON "webhook_deliveries" FOR EACH ROW EXECUTE FUNCTION axora_webhook_delivery_guard();
CREATE TRIGGER "webhook_deliveries_no_delete" BEFORE DELETE ON "webhook_deliveries" FOR EACH ROW EXECUTE FUNCTION axora_forbid_delete();
