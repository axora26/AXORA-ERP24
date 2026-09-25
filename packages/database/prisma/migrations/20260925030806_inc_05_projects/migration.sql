-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProjectWbsKind" AS ENUM ('LOT', 'PHASE', 'WORK_PACKAGE');

-- CreateEnum
CREATE TYPE "ProjectCostCategory" AS ENUM ('MATERIAL', 'LABOR', 'EQUIPMENT', 'SUBCONTRACT', 'OVERHEAD', 'OTHER');

-- CreateEnum
CREATE TYPE "ProjectTaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE');

-- CreateEnum
CREATE TYPE "ProjectChangeOrderStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ProjectMilestoneStatus" AS ENUM ('PLANNED', 'ACHIEVED');

-- CreateEnum
CREATE TYPE "ProjectRiskStatus" AS ENUM ('OPEN', 'MITIGATED', 'CLOSED');

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "clientName" TEXT,
    "status" "ProjectStatus" NOT NULL DEFAULT 'PLANNED',
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "contractAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "contractId" TEXT,
    "managerUserId" TEXT,
    "plannedStart" TIMESTAMP(3),
    "plannedEnd" TIMESTAMP(3),
    "budgetBaselinedAt" TIMESTAMP(3),
    "budgetBaselinedBy" TEXT,
    "statusReason" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_wbs_items" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "parentId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "ProjectWbsKind" NOT NULL DEFAULT 'WORK_PACKAGE',
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_wbs_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_budget_lines" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "wbsItemId" TEXT NOT NULL,
    "category" "ProjectCostCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_budget_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_tasks" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "wbsItemId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ProjectTaskStatus" NOT NULL DEFAULT 'TODO',
    "weight" DECIMAL(10,2) NOT NULL DEFAULT 1,
    "plannedStart" TIMESTAMP(3),
    "plannedEnd" TIMESTAMP(3),
    "assigneeUserId" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_milestones" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" "ProjectMilestoneStatus" NOT NULL DEFAULT 'PLANNED',
    "achievedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_change_orders" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "wbsItemId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "status" "ProjectChangeOrderStatus" NOT NULL DEFAULT 'PENDING',
    "requestedByUserId" TEXT NOT NULL,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_change_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_risks" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "probability" INTEGER NOT NULL,
    "impact" INTEGER NOT NULL,
    "status" "ProjectRiskStatus" NOT NULL DEFAULT 'OPEN',
    "mitigation" TEXT,
    "ownerUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_risks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "projects_contractId_key" ON "projects"("contractId");

-- CreateIndex
CREATE INDEX "projects_organizationId_companyId_status_idx" ON "projects"("organizationId", "companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "projects_companyId_code_key" ON "projects"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "projects_id_organizationId_companyId_key" ON "projects"("id", "organizationId", "companyId");

-- CreateIndex
CREATE INDEX "project_wbs_items_organizationId_companyId_projectId_idx" ON "project_wbs_items"("organizationId", "companyId", "projectId");

-- CreateIndex
CREATE INDEX "project_wbs_items_parentId_idx" ON "project_wbs_items"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "project_wbs_items_projectId_code_key" ON "project_wbs_items"("projectId", "code");

-- CreateIndex
CREATE INDEX "project_budget_lines_organizationId_companyId_projectId_idx" ON "project_budget_lines"("organizationId", "companyId", "projectId");

-- CreateIndex
CREATE INDEX "project_budget_lines_wbsItemId_idx" ON "project_budget_lines"("wbsItemId");

-- CreateIndex
CREATE INDEX "project_tasks_organizationId_companyId_projectId_status_idx" ON "project_tasks"("organizationId", "companyId", "projectId", "status");

-- CreateIndex
CREATE INDEX "project_tasks_wbsItemId_idx" ON "project_tasks"("wbsItemId");

-- CreateIndex
CREATE INDEX "project_milestones_organizationId_companyId_projectId_idx" ON "project_milestones"("organizationId", "companyId", "projectId");

-- CreateIndex
CREATE INDEX "project_change_orders_organizationId_companyId_projectId_st_idx" ON "project_change_orders"("organizationId", "companyId", "projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "project_change_orders_projectId_code_key" ON "project_change_orders"("projectId", "code");

-- CreateIndex
CREATE INDEX "project_risks_organizationId_companyId_projectId_status_idx" ON "project_risks"("organizationId", "companyId", "projectId", "status");

-- AddForeignKey
ALTER TABLE "project_wbs_items" ADD CONSTRAINT "project_wbs_items_projectId_organizationId_companyId_fkey" FOREIGN KEY ("projectId", "organizationId", "companyId") REFERENCES "projects"("id", "organizationId", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_wbs_items" ADD CONSTRAINT "project_wbs_items_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "project_wbs_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_budget_lines" ADD CONSTRAINT "project_budget_lines_projectId_organizationId_companyId_fkey" FOREIGN KEY ("projectId", "organizationId", "companyId") REFERENCES "projects"("id", "organizationId", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_budget_lines" ADD CONSTRAINT "project_budget_lines_wbsItemId_fkey" FOREIGN KEY ("wbsItemId") REFERENCES "project_wbs_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_projectId_organizationId_companyId_fkey" FOREIGN KEY ("projectId", "organizationId", "companyId") REFERENCES "projects"("id", "organizationId", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_wbsItemId_fkey" FOREIGN KEY ("wbsItemId") REFERENCES "project_wbs_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_projectId_organizationId_companyId_fkey" FOREIGN KEY ("projectId", "organizationId", "companyId") REFERENCES "projects"("id", "organizationId", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_change_orders" ADD CONSTRAINT "project_change_orders_projectId_organizationId_companyId_fkey" FOREIGN KEY ("projectId", "organizationId", "companyId") REFERENCES "projects"("id", "organizationId", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_change_orders" ADD CONSTRAINT "project_change_orders_wbsItemId_fkey" FOREIGN KEY ("wbsItemId") REFERENCES "project_wbs_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_risks" ADD CONSTRAINT "project_risks_projectId_organizationId_companyId_fkey" FOREIGN KEY ("projectId", "organizationId", "companyId") REFERENCES "projects"("id", "organizationId", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;
