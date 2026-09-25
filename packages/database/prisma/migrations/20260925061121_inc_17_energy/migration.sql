-- CreateEnum
CREATE TYPE "EnergyMeterKind" AS ENUM ('GRID_IMPORT', 'GRID_EXPORT', 'PV_PRODUCTION', 'GENSET_PRODUCTION', 'BATTERY_CHARGE', 'BATTERY_DISCHARGE', 'CONSUMPTION', 'GENSET_FUEL');

-- CreateEnum
CREATE TYPE "EnergyIntervalSource" AS ENUM ('GATEWAY', 'IMPORT');

-- CreateEnum
CREATE TYPE "EnergyStorageKind" AS ENUM ('BATTERY', 'FUEL_TANK');

-- CreateEnum
CREATE TYPE "EnergyAlertKind" AS ENUM ('INTERVAL_ABOVE', 'DAILY_ABOVE');

-- CreateEnum
CREATE TYPE "EnergyAlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED');

-- AlterTable
ALTER TABLE "smart_buildings" ADD COLUMN     "floorAreaM2" DECIMAL(12,2);

-- CreateTable
CREATE TABLE "energy_meters" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "EnergyMeterKind" NOT NULL,
    "intervalMinutes" INTEGER NOT NULL,
    "gatewayId" TEXT,
    "externalRef" TEXT,
    "assetId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "energy_meters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "energy_intervals" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "meterId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "value" DECIMAL(18,4) NOT NULL,
    "source" "EnergyIntervalSource" NOT NULL,
    "gatewayId" TEXT,
    "simulated" BOOLEAN NOT NULL DEFAULT false,
    "recordedByUserId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "energy_intervals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "energy_tariffs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "meterId" TEXT NOT NULL,
    "validFrom" DATE NOT NULL,
    "unitPrice" DECIMAL(14,6) NOT NULL,
    "note" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "energy_tariffs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "energy_storages" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "EnergyStorageKind" NOT NULL,
    "usableCapacity" DECIMAL(14,3) NOT NULL,
    "levelPointId" TEXT NOT NULL,
    "levelIsPercent" BOOLEAN NOT NULL DEFAULT true,
    "reserve" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "drainMeterId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "energy_storages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "energy_alert_rules" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "meterId" TEXT NOT NULL,
    "kind" "EnergyAlertKind" NOT NULL,
    "threshold" DECIMAL(18,4) NOT NULL,
    "message" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "energy_alert_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "energy_alerts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "meterId" TEXT NOT NULL,
    "kind" "EnergyAlertKind" NOT NULL,
    "threshold" DECIMAL(18,4) NOT NULL,
    "message" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "value" DECIMAL(18,4) NOT NULL,
    "raisedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "EnergyAlertStatus" NOT NULL DEFAULT 'OPEN',
    "acknowledgedByUserId" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgeNote" TEXT,

    CONSTRAINT "energy_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "energy_meters_companyId_code_key" ON "energy_meters"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "energy_meters_gatewayId_externalRef_key" ON "energy_meters"("gatewayId", "externalRef");

-- CreateIndex
CREATE UNIQUE INDEX "energy_meters_id_organizationId_companyId_key" ON "energy_meters"("id", "organizationId", "companyId");

-- CreateIndex
CREATE INDEX "energy_intervals_organizationId_companyId_periodStart_idx" ON "energy_intervals"("organizationId", "companyId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "energy_intervals_meterId_periodStart_key" ON "energy_intervals"("meterId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "energy_tariffs_meterId_validFrom_key" ON "energy_tariffs"("meterId", "validFrom");

-- CreateIndex
CREATE UNIQUE INDEX "energy_alert_rules_id_organizationId_companyId_key" ON "energy_alert_rules"("id", "organizationId", "companyId");

-- CreateIndex
CREATE INDEX "energy_alerts_organizationId_companyId_status_idx" ON "energy_alerts"("organizationId", "companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "energy_alerts_ruleId_periodStart_key" ON "energy_alerts"("ruleId", "periodStart");

-- AddForeignKey
ALTER TABLE "energy_meters" ADD CONSTRAINT "energy_meters_buildingId_organizationId_companyId_fkey" FOREIGN KEY ("buildingId", "organizationId", "companyId") REFERENCES "smart_buildings"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "energy_meters" ADD CONSTRAINT "energy_meters_gatewayId_organizationId_companyId_fkey" FOREIGN KEY ("gatewayId", "organizationId", "companyId") REFERENCES "smart_gateways"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "energy_meters" ADD CONSTRAINT "energy_meters_assetId_organizationId_companyId_fkey" FOREIGN KEY ("assetId", "organizationId", "companyId") REFERENCES "assets"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "energy_intervals" ADD CONSTRAINT "energy_intervals_meterId_organizationId_companyId_fkey" FOREIGN KEY ("meterId", "organizationId", "companyId") REFERENCES "energy_meters"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "energy_tariffs" ADD CONSTRAINT "energy_tariffs_meterId_organizationId_companyId_fkey" FOREIGN KEY ("meterId", "organizationId", "companyId") REFERENCES "energy_meters"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "energy_storages" ADD CONSTRAINT "energy_storages_buildingId_organizationId_companyId_fkey" FOREIGN KEY ("buildingId", "organizationId", "companyId") REFERENCES "smart_buildings"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "energy_storages" ADD CONSTRAINT "energy_storages_levelPointId_organizationId_companyId_fkey" FOREIGN KEY ("levelPointId", "organizationId", "companyId") REFERENCES "smart_points"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "energy_storages" ADD CONSTRAINT "energy_storages_drainMeterId_organizationId_companyId_fkey" FOREIGN KEY ("drainMeterId", "organizationId", "companyId") REFERENCES "energy_meters"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "energy_alert_rules" ADD CONSTRAINT "energy_alert_rules_meterId_organizationId_companyId_fkey" FOREIGN KEY ("meterId", "organizationId", "companyId") REFERENCES "energy_meters"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "energy_alerts" ADD CONSTRAINT "energy_alerts_ruleId_organizationId_companyId_fkey" FOREIGN KEY ("ruleId", "organizationId", "companyId") REFERENCES "energy_alert_rules"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Garanties en base (INC-17)
-- ---------------------------------------------------------------------------

ALTER TABLE "energy_meters" ADD CONSTRAINT "energy_meters_interval" CHECK ("intervalMinutes" IN (5, 10, 15, 30, 60));
ALTER TABLE "energy_meters" ADD CONSTRAINT "energy_meters_gateway_ref" CHECK (("gatewayId" IS NULL) = ("externalRef" IS NULL));
CREATE TRIGGER "energy_meters_no_delete" BEFORE DELETE ON "energy_meters" FOR EACH ROW EXECUTE FUNCTION axora_forbid_delete();

-- Intervalles : append-only, valeurs positives, debut a la minute pleine.
ALTER TABLE "energy_intervals" ADD CONSTRAINT "energy_intervals_value" CHECK ("value" >= 0);
ALTER TABLE "energy_intervals" ADD CONSTRAINT "energy_intervals_aligned" CHECK (date_trunc('minute', "periodStart") = "periodStart");
ALTER TABLE "energy_intervals" ADD CONSTRAINT "energy_intervals_source" CHECK (
  ("source" = 'GATEWAY' AND "gatewayId" IS NOT NULL) OR ("source" = 'IMPORT' AND "recordedByUserId" IS NOT NULL AND NOT "simulated")
);
CREATE TRIGGER "energy_intervals_append_only" BEFORE UPDATE OR DELETE ON "energy_intervals" FOR EACH ROW EXECUTE FUNCTION axora_forbid_mutation();

-- Tarifs historises : jamais modifies, un nouveau tarif prend effet a sa date.
ALTER TABLE "energy_tariffs" ADD CONSTRAINT "energy_tariffs_price" CHECK ("unitPrice" >= 0);
CREATE TRIGGER "energy_tariffs_append_only" BEFORE UPDATE OR DELETE ON "energy_tariffs" FOR EACH ROW EXECUTE FUNCTION axora_forbid_mutation();

ALTER TABLE "energy_storages" ADD CONSTRAINT "energy_storages_capacity" CHECK ("usableCapacity" > 0 AND "reserve" >= 0 AND (NOT "levelIsPercent" OR "reserve" < 100));

-- Alertes : faits figes, jamais supprimees.
CREATE OR REPLACE FUNCTION axora_energy_alert_guard() RETURNS trigger AS $$
BEGIN
  IF NEW."ruleId" <> OLD."ruleId" OR NEW."meterId" <> OLD."meterId" OR NEW."kind" <> OLD."kind" OR NEW."threshold" <> OLD."threshold"
     OR NEW."message" <> OLD."message" OR NEW."periodStart" <> OLD."periodStart" OR NEW."value" <> OLD."value" OR NEW."raisedAt" <> OLD."raisedAt" THEN
    RAISE EXCEPTION 'Energy alert facts are immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD."status" = 'ACKNOWLEDGED' AND NEW."status" <> 'ACKNOWLEDGED' THEN
    RAISE EXCEPTION 'An acknowledged energy alert stays acknowledged' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "energy_alerts_guard" BEFORE UPDATE ON "energy_alerts" FOR EACH ROW EXECUTE FUNCTION axora_energy_alert_guard();
CREATE TRIGGER "energy_alerts_no_delete" BEFORE DELETE ON "energy_alerts" FOR EACH ROW EXECUTE FUNCTION axora_forbid_delete();
ALTER TABLE "energy_alerts" ADD CONSTRAINT "energy_alerts_ack_traced" CHECK ("status" <> 'ACKNOWLEDGED' OR ("acknowledgedByUserId" IS NOT NULL AND "acknowledgedAt" IS NOT NULL));
