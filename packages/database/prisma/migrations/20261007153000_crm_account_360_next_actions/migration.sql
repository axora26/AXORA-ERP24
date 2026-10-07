ALTER TYPE "CrmActivityType" ADD VALUE IF NOT EXISTS 'NEXT_ACTION_CREATED';
ALTER TYPE "CrmActivityType" ADD VALUE IF NOT EXISTS 'NEXT_ACTION_UPDATED';
ALTER TYPE "CrmActivityType" ADD VALUE IF NOT EXISTS 'NEXT_ACTION_COMPLETED';
ALTER TYPE "CrmActivityType" ADD VALUE IF NOT EXISTS 'NEXT_ACTION_CANCELLED';

CREATE TYPE "CrmNextActionStatus" AS ENUM ('OPEN', 'COMPLETED', 'CANCELLED');
CREATE TYPE "CrmNextActionPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

CREATE TABLE "crm_next_actions" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "details" TEXT,
  "dueAt" TIMESTAMP(3) NOT NULL,
  "priority" "CrmNextActionPriority" NOT NULL DEFAULT 'MEDIUM',
  "status" "CrmNextActionStatus" NOT NULL DEFAULT 'OPEN',
  "assigneeUserId" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "updatedByUserId" TEXT NOT NULL,
  "completedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "crm_next_actions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "crm_next_action_version_positive" CHECK ("version" >= 1),
  CONSTRAINT "crm_next_action_terminal_timestamps" CHECK (
    ("status" = 'OPEN' AND "completedAt" IS NULL AND "cancelledAt" IS NULL)
    OR ("status" = 'COMPLETED' AND "completedAt" IS NOT NULL AND "cancelledAt" IS NULL)
    OR ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL AND "completedAt" IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "crm_accounts_organizationId_companyId_id_key"
  ON "crm_accounts"("organizationId", "companyId", "id");

ALTER TABLE "crm_next_actions"
  ADD CONSTRAINT "crm_next_actions_account_scope_fkey"
  FOREIGN KEY ("organizationId", "companyId", "accountId") REFERENCES "crm_accounts"("organizationId", "companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "crm_next_actions_assigneeUserId_fkey"
  FOREIGN KEY ("assigneeUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "crm_next_actions_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "crm_next_actions_updatedByUserId_fkey"
  FOREIGN KEY ("updatedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "crm_next_actions_assignee_company_fkey"
  FOREIGN KEY ("assigneeUserId", "companyId") REFERENCES "company_memberships"("userId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "crm_next_actions_created_by_company_fkey"
  FOREIGN KEY ("createdByUserId", "companyId") REFERENCES "company_memberships"("userId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "crm_next_actions_updated_by_company_fkey"
  FOREIGN KEY ("updatedByUserId", "companyId") REFERENCES "company_memberships"("userId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "enforce_crm_next_action_user_organization"() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "users" u
    WHERE u."id" IN (NEW."assigneeUserId", NEW."createdByUserId", NEW."updatedByUserId")
      AND u."organizationId" <> NEW."organizationId"
  ) THEN
    RAISE EXCEPTION 'CRM next-action users must belong to the scoped organization' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "crm_next_actions_user_organization_guard"
BEFORE INSERT OR UPDATE OF "organizationId", "assigneeUserId", "createdByUserId", "updatedByUserId"
ON "crm_next_actions" FOR EACH ROW EXECUTE FUNCTION "enforce_crm_next_action_user_organization"();

CREATE INDEX "crm_next_actions_organizationId_companyId_status_dueAt_idx"
  ON "crm_next_actions"("organizationId", "companyId", "status", "dueAt");
CREATE INDEX "crm_next_actions_accountId_status_dueAt_idx"
  ON "crm_next_actions"("accountId", "status", "dueAt");
CREATE INDEX "crm_next_actions_organizationId_companyId_assigneeUserId_status_dueAt_idx"
  ON "crm_next_actions"("organizationId", "companyId", "assigneeUserId", "status", "dueAt");

INSERT INTO "permissions" ("id", "key", "description")
VALUES
  (gen_random_uuid()::text, 'crm.nextaction.read', 'Permission systeme: crm.nextaction.read'),
  (gen_random_uuid()::text, 'crm.nextaction.manage', 'Permission systeme: crm.nextaction.manage')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("id", "roleId", "permissionId")
SELECT gen_random_uuid()::text, role."id", permission."id"
FROM "roles" role
CROSS JOIN "permissions" permission
WHERE role."isSystem" = true
  AND role."name" = 'OWNER'
  AND permission."key" IN ('crm.nextaction.read', 'crm.nextaction.manage')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
