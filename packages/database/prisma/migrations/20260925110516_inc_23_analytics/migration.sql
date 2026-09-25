-- CreateTable
CREATE TABLE "analytics_snapshots" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL,
    "isDemo" BOOLEAN NOT NULL,
    "metrics" JSONB NOT NULL,
    "excludedMetrics" TEXT[],
    "capturedByUserId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_dashboards" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "metrics" TEXT[],
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "analytics_dashboards_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "analytics_snapshots_organizationId_companyId_period_idx" ON "analytics_snapshots"("organizationId", "companyId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_snapshots_companyId_period_version_key" ON "analytics_snapshots"("companyId", "period", "version");

-- CreateIndex
CREATE INDEX "analytics_dashboards_organizationId_companyId_ownerUserId_idx" ON "analytics_dashboards"("organizationId", "companyId", "ownerUserId");

-- ---------------------------------------------------------------------------
-- Garanties INC-23 (analytique)
-- ---------------------------------------------------------------------------

-- Fenetre explicite et coherente : un mois calendaire entier.
ALTER TABLE "analytics_snapshots" ADD CONSTRAINT "analytics_snapshots_period" CHECK (
  "period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
  AND "periodStart" = make_timestamp(substr("period", 1, 4)::int, substr("period", 6, 2)::int, 1, 0, 0, 0)
  AND "periodEnd" = ("periodStart" + interval '1 month')
  AND "version" >= 1
);
-- Instantane fige : ni modification ni suppression.
CREATE TRIGGER "analytics_snapshots_append_only" BEFORE UPDATE OR DELETE ON "analytics_snapshots" FOR EACH ROW EXECUTE FUNCTION axora_forbid_mutation();

-- Tableau de bord : proprietaire et perimetre immuables.
CREATE OR REPLACE FUNCTION axora_analytics_dashboard_guard() RETURNS trigger AS $$
BEGIN
  IF NEW."organizationId" <> OLD."organizationId" OR NEW."companyId" <> OLD."companyId" OR NEW."ownerUserId" <> OLD."ownerUserId" THEN
    RAISE EXCEPTION 'Dashboard owner and scope are immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "analytics_dashboards_guard" BEFORE UPDATE ON "analytics_dashboards" FOR EACH ROW EXECUTE FUNCTION axora_analytics_dashboard_guard();
ALTER TABLE "analytics_dashboards" ADD CONSTRAINT "analytics_dashboards_metrics" CHECK (cardinality("metrics") BETWEEN 1 AND 12);
