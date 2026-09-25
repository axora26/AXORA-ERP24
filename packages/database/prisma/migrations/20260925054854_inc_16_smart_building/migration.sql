-- CreateEnum
CREATE TYPE "SmartProtocol" AS ENUM ('HTTP_API', 'MQTT', 'BACNET_IP', 'MODBUS_TCP', 'KNX_IP');

-- CreateEnum
CREATE TYPE "SmartPointKind" AS ENUM ('ANALOG', 'BINARY', 'MULTISTATE');

-- CreateEnum
CREATE TYPE "SmartReadingQuality" AS ENUM ('GOOD', 'UNCERTAIN', 'BAD');

-- CreateEnum
CREATE TYPE "SmartAlarmCondition" AS ENUM ('ABOVE', 'BELOW', 'EQUALS');

-- CreateEnum
CREATE TYPE "SmartAlarmSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "SmartAlarmStatus" AS ENUM ('ACTIVE', 'ACKNOWLEDGED', 'CLEARED');

-- CreateEnum
CREATE TYPE "SmartSetpointStatus" AS ENUM ('REQUESTED', 'DISPATCHED', 'ACKNOWLEDGED', 'CONFIRMED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SmartTestKind" AS ENUM ('READ', 'WRITE');

-- CreateEnum
CREATE TYPE "SmartTestOutcome" AS ENUM ('PASS', 'FAIL');

-- CreateTable
CREATE TABLE "smart_buildings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "projectId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "smart_buildings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "smart_gateways" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "protocol" "SmartProtocol" NOT NULL,
    "endpoint" TEXT,
    "simulated" BOOLEAN NOT NULL DEFAULT false,
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3),
    "lastSeenIp" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "smart_gateways_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "smart_points" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "gatewayId" TEXT NOT NULL,
    "externalRef" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "SmartPointKind" NOT NULL,
    "unit" TEXT,
    "assetId" TEXT,
    "writable" BOOLEAN NOT NULL DEFAULT false,
    "writeTolerance" DECIMAL(18,6),
    "minPlausible" DECIMAL(18,6),
    "maxPlausible" DECIMAL(18,6),
    "lastValue" DECIMAL(18,6),
    "lastReadingAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "smart_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "smart_readings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "pointId" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "value" DECIMAL(18,6) NOT NULL,
    "quality" "SmartReadingQuality" NOT NULL DEFAULT 'GOOD',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "smart_readings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "smart_alarm_rules" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "pointId" TEXT NOT NULL,
    "condition" "SmartAlarmCondition" NOT NULL,
    "threshold" DECIMAL(18,6) NOT NULL,
    "severity" "SmartAlarmSeverity" NOT NULL DEFAULT 'WARNING',
    "message" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "smart_alarm_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "smart_alarms" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "pointId" TEXT NOT NULL,
    "condition" "SmartAlarmCondition" NOT NULL,
    "threshold" DECIMAL(18,6) NOT NULL,
    "severity" "SmartAlarmSeverity" NOT NULL,
    "message" TEXT NOT NULL,
    "triggerValue" DECIMAL(18,6) NOT NULL,
    "triggerReadingAt" TIMESTAMP(3) NOT NULL,
    "raisedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "SmartAlarmStatus" NOT NULL DEFAULT 'ACTIVE',
    "acknowledgedByUserId" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgeNote" TEXT,
    "clearedAt" TIMESTAMP(3),
    "clearValue" DECIMAL(18,6),

    CONSTRAINT "smart_alarms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "smart_setpoints" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "pointId" TEXT NOT NULL,
    "requestedValue" DECIMAL(18,6) NOT NULL,
    "reason" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "SmartSetpointStatus" NOT NULL DEFAULT 'REQUESTED',
    "dispatchedAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "gatewayNote" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "confirmReadingAt" TIMESTAMP(3),
    "confirmValue" DECIMAL(18,6),
    "cancelledByUserId" TEXT,

    CONSTRAINT "smart_setpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "smart_gateway_tests" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "gatewayId" TEXT NOT NULL,
    "pointId" TEXT NOT NULL,
    "kind" "SmartTestKind" NOT NULL,
    "referenceValue" DECIMAL(18,6),
    "tolerance" DECIMAL(18,6),
    "observedValue" DECIMAL(18,6) NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "setpointId" TEXT,
    "outcome" "SmartTestOutcome" NOT NULL,
    "evidence" TEXT NOT NULL,
    "performedByUserId" TEXT NOT NULL,
    "performedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "smart_gateway_tests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "smart_buildings_companyId_code_key" ON "smart_buildings"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "smart_buildings_id_organizationId_companyId_key" ON "smart_buildings"("id", "organizationId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "smart_gateways_tokenHash_key" ON "smart_gateways"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "smart_gateways_companyId_code_key" ON "smart_gateways"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "smart_gateways_id_organizationId_companyId_key" ON "smart_gateways"("id", "organizationId", "companyId");

-- CreateIndex
CREATE INDEX "smart_points_organizationId_companyId_active_idx" ON "smart_points"("organizationId", "companyId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "smart_points_gatewayId_externalRef_key" ON "smart_points"("gatewayId", "externalRef");

-- CreateIndex
CREATE UNIQUE INDEX "smart_points_id_organizationId_companyId_key" ON "smart_points"("id", "organizationId", "companyId");

-- CreateIndex
CREATE INDEX "smart_readings_organizationId_companyId_ts_idx" ON "smart_readings"("organizationId", "companyId", "ts");

-- CreateIndex
CREATE UNIQUE INDEX "smart_readings_pointId_ts_key" ON "smart_readings"("pointId", "ts");

-- CreateIndex
CREATE UNIQUE INDEX "smart_alarm_rules_id_organizationId_companyId_key" ON "smart_alarm_rules"("id", "organizationId", "companyId");

-- CreateIndex
CREATE INDEX "smart_alarms_organizationId_companyId_status_idx" ON "smart_alarms"("organizationId", "companyId", "status");

-- CreateIndex
CREATE INDEX "smart_setpoints_organizationId_companyId_status_idx" ON "smart_setpoints"("organizationId", "companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "smart_setpoints_id_organizationId_companyId_key" ON "smart_setpoints"("id", "organizationId", "companyId");

-- CreateIndex
CREATE INDEX "smart_gateway_tests_gatewayId_kind_idx" ON "smart_gateway_tests"("gatewayId", "kind");

-- AddForeignKey
ALTER TABLE "smart_gateways" ADD CONSTRAINT "smart_gateways_buildingId_organizationId_companyId_fkey" FOREIGN KEY ("buildingId", "organizationId", "companyId") REFERENCES "smart_buildings"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "smart_points" ADD CONSTRAINT "smart_points_gatewayId_organizationId_companyId_fkey" FOREIGN KEY ("gatewayId", "organizationId", "companyId") REFERENCES "smart_gateways"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "smart_points" ADD CONSTRAINT "smart_points_assetId_organizationId_companyId_fkey" FOREIGN KEY ("assetId", "organizationId", "companyId") REFERENCES "assets"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "smart_readings" ADD CONSTRAINT "smart_readings_pointId_organizationId_companyId_fkey" FOREIGN KEY ("pointId", "organizationId", "companyId") REFERENCES "smart_points"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "smart_alarm_rules" ADD CONSTRAINT "smart_alarm_rules_pointId_organizationId_companyId_fkey" FOREIGN KEY ("pointId", "organizationId", "companyId") REFERENCES "smart_points"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "smart_alarms" ADD CONSTRAINT "smart_alarms_ruleId_organizationId_companyId_fkey" FOREIGN KEY ("ruleId", "organizationId", "companyId") REFERENCES "smart_alarm_rules"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "smart_setpoints" ADD CONSTRAINT "smart_setpoints_pointId_organizationId_companyId_fkey" FOREIGN KEY ("pointId", "organizationId", "companyId") REFERENCES "smart_points"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "smart_gateway_tests" ADD CONSTRAINT "smart_gateway_tests_gatewayId_organizationId_companyId_fkey" FOREIGN KEY ("gatewayId", "organizationId", "companyId") REFERENCES "smart_gateways"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Garanties en base (INC-16)
-- ---------------------------------------------------------------------------

ALTER TABLE "smart_points" ADD CONSTRAINT "smart_points_plausible_range" CHECK ("minPlausible" IS NULL OR "maxPlausible" IS NULL OR "minPlausible" < "maxPlausible");
ALTER TABLE "smart_points" ADD CONSTRAINT "smart_points_write_tolerance" CHECK ("writeTolerance" IS NULL OR ("writable" AND "writeTolerance" >= 0));

-- Serie temporelle append-only : jamais reecrite ni supprimee.
CREATE TRIGGER "smart_readings_append_only" BEFORE UPDATE OR DELETE ON "smart_readings" FOR EACH ROW EXECUTE FUNCTION axora_forbid_mutation();

-- Alarme : faits de declenchement figes, CLEARED terminal, jamais supprimee.
CREATE OR REPLACE FUNCTION axora_smart_alarm_guard() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'CLEARED' THEN
    RAISE EXCEPTION 'Alarm % is cleared: it is history', OLD."id" USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW."ruleId" <> OLD."ruleId" OR NEW."pointId" <> OLD."pointId" OR NEW."condition" <> OLD."condition"
     OR NEW."threshold" <> OLD."threshold" OR NEW."severity" <> OLD."severity" OR NEW."message" <> OLD."message"
     OR NEW."triggerValue" <> OLD."triggerValue" OR NEW."triggerReadingAt" <> OLD."triggerReadingAt" OR NEW."raisedAt" <> OLD."raisedAt" THEN
    RAISE EXCEPTION 'Alarm trigger facts are immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "smart_alarms_guard" BEFORE UPDATE ON "smart_alarms" FOR EACH ROW EXECUTE FUNCTION axora_smart_alarm_guard();
CREATE TRIGGER "smart_alarms_no_delete" BEFORE DELETE ON "smart_alarms" FOR EACH ROW EXECUTE FUNCTION axora_forbid_delete();
ALTER TABLE "smart_alarms" ADD CONSTRAINT "smart_alarms_ack_traced" CHECK ("status" <> 'ACKNOWLEDGED' OR ("acknowledgedByUserId" IS NOT NULL AND "acknowledgedAt" IS NOT NULL));
ALTER TABLE "smart_alarms" ADD CONSTRAINT "smart_alarms_clear_traced" CHECK ("status" <> 'CLEARED' OR ("clearedAt" IS NOT NULL AND "clearValue" IS NOT NULL));

-- Consigne : valeur demandee figee, etats terminaux figes, confirmation uniquement par relecture.
CREATE OR REPLACE FUNCTION axora_smart_setpoint_guard() RETURNS trigger AS $$
BEGIN
  IF OLD."status" IN ('CONFIRMED', 'FAILED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Setpoint % is closed', OLD."id" USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW."requestedValue" <> OLD."requestedValue" OR NEW."pointId" <> OLD."pointId" OR NEW."requestedByUserId" <> OLD."requestedByUserId" THEN
    RAISE EXCEPTION 'A setpoint request is immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "smart_setpoints_guard" BEFORE UPDATE ON "smart_setpoints" FOR EACH ROW EXECUTE FUNCTION axora_smart_setpoint_guard();
CREATE TRIGGER "smart_setpoints_no_delete" BEFORE DELETE ON "smart_setpoints" FOR EACH ROW EXECUTE FUNCTION axora_forbid_delete();
ALTER TABLE "smart_setpoints" ADD CONSTRAINT "smart_setpoints_confirmed_by_readback" CHECK (
  "status" <> 'CONFIRMED' OR ("confirmedAt" IS NOT NULL AND "confirmReadingAt" IS NOT NULL AND "confirmValue" IS NOT NULL AND "acknowledgedAt" IS NOT NULL AND "confirmReadingAt" >= "acknowledgedAt")
);

-- Essais reels : append-only, jamais sur une passerelle de simulation, preuves exigees.
CREATE OR REPLACE FUNCTION axora_smart_test_guard() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "smart_gateways" WHERE "id" = NEW."gatewayId" AND "simulated") THEN
    RAISE EXCEPTION 'A simulator is never evidence of physical communication' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "smart_gateway_tests_simulator_guard" BEFORE INSERT ON "smart_gateway_tests" FOR EACH ROW EXECUTE FUNCTION axora_smart_test_guard();
CREATE TRIGGER "smart_gateway_tests_append_only" BEFORE UPDATE OR DELETE ON "smart_gateway_tests" FOR EACH ROW EXECUTE FUNCTION axora_forbid_mutation();
ALTER TABLE "smart_gateway_tests" ADD CONSTRAINT "smart_gateway_tests_evidence" CHECK (
  length(btrim("evidence")) > 0
  AND ("kind" <> 'READ' OR ("referenceValue" IS NOT NULL AND "tolerance" IS NOT NULL AND "tolerance" >= 0))
  AND ("kind" <> 'WRITE' OR "setpointId" IS NOT NULL)
);

-- Une passerelle declaree simulateur le reste (on ne requalifie pas un historique simule en historique physique).
CREATE OR REPLACE FUNCTION axora_smart_gateway_guard() RETURNS trigger AS $$
BEGIN
  IF OLD."simulated" AND NOT NEW."simulated" THEN
    RAISE EXCEPTION 'A simulated gateway cannot be requalified as physical' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW."protocol" <> OLD."protocol" THEN
    RAISE EXCEPTION 'The protocol of a gateway is immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "smart_gateways_guard" BEFORE UPDATE ON "smart_gateways" FOR EACH ROW EXECUTE FUNCTION axora_smart_gateway_guard();
CREATE TRIGGER "smart_gateways_no_delete" BEFORE DELETE ON "smart_gateways" FOR EACH ROW EXECUTE FUNCTION axora_forbid_delete();
