-- CreateEnum
CREATE TYPE "FleetVehicleKind" AS ENUM ('VEHICLE', 'ENGINE', 'MACHINE');

-- CreateEnum
CREATE TYPE "FleetUsageUnit" AS ENUM ('KM', 'HOURS');

-- CreateEnum
CREATE TYPE "FleetFuelType" AS ENUM ('DIESEL', 'PETROL', 'ELECTRIC', 'NONE');

-- CreateEnum
CREATE TYPE "FleetVehicleStatus" AS ENUM ('ACTIVE', 'IMMOBILIZED', 'DISPOSED');

-- CreateEnum
CREATE TYPE "FleetReadingSource" AS ENUM ('MANUAL', 'FUEL', 'ASSIGNMENT_START', 'ASSIGNMENT_END', 'INCIDENT');

-- CreateEnum
CREATE TYPE "FleetDocumentKind" AS ENUM ('INSURANCE', 'REGISTRATION', 'INSPECTION', 'PERMIT', 'OTHER');

-- CreateEnum
CREATE TYPE "FleetIncidentKind" AS ENUM ('ACCIDENT', 'BREAKDOWN', 'DAMAGE', 'THEFT', 'FINE');

-- CreateEnum
CREATE TYPE "FleetIncidentStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateTable
CREATE TABLE "fleet_vehicles" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "FleetVehicleKind" NOT NULL,
    "category" TEXT NOT NULL,
    "registration" TEXT,
    "serialNumber" TEXT,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "year" INTEGER,
    "fuelType" "FleetFuelType" NOT NULL,
    "usageUnit" "FleetUsageUnit" NOT NULL,
    "requiredLicence" TEXT,
    "assetId" TEXT NOT NULL,
    "acquisitionDate" DATE NOT NULL,
    "acquisitionCost" DECIMAL(14,2),
    "homeBase" TEXT NOT NULL,
    "status" "FleetVehicleStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fleet_vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fleet_meter_readings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL,
    "value" DECIMAL(12,1) NOT NULL,
    "source" "FleetReadingSource" NOT NULL,
    "recordedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fleet_meter_readings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fleet_assignments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "projectId" TEXT,
    "purpose" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "startReading" DECIMAL(12,1) NOT NULL,
    "endAt" TIMESTAMP(3),
    "endReading" DECIMAL(12,1),
    "endNote" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "closedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fleet_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fleet_fuel_logs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "filledAt" TIMESTAMP(3) NOT NULL,
    "liters" DECIMAL(10,2) NOT NULL,
    "unitPrice" DECIMAL(10,4) NOT NULL,
    "totalCost" DECIMAL(12,2) NOT NULL,
    "reading" DECIMAL(12,1) NOT NULL,
    "fullTank" BOOLEAN NOT NULL,
    "station" TEXT,
    "projectId" TEXT,
    "assignmentId" TEXT,
    "receiptFileId" TEXT,
    "recordedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fleet_fuel_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fleet_documents" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "kind" "FleetDocumentKind" NOT NULL,
    "reference" TEXT NOT NULL,
    "issuer" TEXT,
    "validFrom" DATE NOT NULL,
    "validUntil" DATE NOT NULL,
    "cost" DECIMAL(12,2),
    "fileId" TEXT,
    "recordedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fleet_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fleet_incidents" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "kind" "FleetIncidentKind" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "location" TEXT,
    "driverEmployeeId" TEXT,
    "assignmentId" TEXT,
    "cost" DECIMAL(12,2),
    "maintenanceTicketId" TEXT,
    "status" "FleetIncidentStatus" NOT NULL DEFAULT 'OPEN',
    "reportedByUserId" TEXT NOT NULL,
    "closedByUserId" TEXT,
    "closedAt" TIMESTAMP(3),
    "closureNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fleet_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fleet_vehicles_organizationId_companyId_status_idx" ON "fleet_vehicles"("organizationId", "companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "fleet_vehicles_companyId_code_key" ON "fleet_vehicles"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "fleet_vehicles_companyId_registration_key" ON "fleet_vehicles"("companyId", "registration");

-- CreateIndex
CREATE UNIQUE INDEX "fleet_vehicles_assetId_organizationId_companyId_key" ON "fleet_vehicles"("assetId", "organizationId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "fleet_vehicles_id_organizationId_companyId_key" ON "fleet_vehicles"("id", "organizationId", "companyId");

-- CreateIndex
CREATE INDEX "fleet_meter_readings_vehicleId_readAt_idx" ON "fleet_meter_readings"("vehicleId", "readAt");

-- CreateIndex
CREATE INDEX "fleet_assignments_organizationId_companyId_projectId_idx" ON "fleet_assignments"("organizationId", "companyId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "fleet_assignments_companyId_code_key" ON "fleet_assignments"("companyId", "code");

-- CreateIndex
CREATE INDEX "fleet_fuel_logs_vehicleId_filledAt_idx" ON "fleet_fuel_logs"("vehicleId", "filledAt");

-- CreateIndex
CREATE INDEX "fleet_fuel_logs_organizationId_companyId_projectId_idx" ON "fleet_fuel_logs"("organizationId", "companyId", "projectId");

-- CreateIndex
CREATE INDEX "fleet_documents_vehicleId_kind_validUntil_idx" ON "fleet_documents"("vehicleId", "kind", "validUntil");

-- CreateIndex
CREATE INDEX "fleet_incidents_organizationId_companyId_status_idx" ON "fleet_incidents"("organizationId", "companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "fleet_incidents_companyId_code_key" ON "fleet_incidents"("companyId", "code");

-- AddForeignKey
ALTER TABLE "fleet_vehicles" ADD CONSTRAINT "fleet_vehicles_assetId_organizationId_companyId_fkey" FOREIGN KEY ("assetId", "organizationId", "companyId") REFERENCES "assets"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_meter_readings" ADD CONSTRAINT "fleet_meter_readings_vehicleId_organizationId_companyId_fkey" FOREIGN KEY ("vehicleId", "organizationId", "companyId") REFERENCES "fleet_vehicles"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_assignments" ADD CONSTRAINT "fleet_assignments_vehicleId_organizationId_companyId_fkey" FOREIGN KEY ("vehicleId", "organizationId", "companyId") REFERENCES "fleet_vehicles"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_assignments" ADD CONSTRAINT "fleet_assignments_employeeId_organizationId_companyId_fkey" FOREIGN KEY ("employeeId", "organizationId", "companyId") REFERENCES "hr_employees"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_fuel_logs" ADD CONSTRAINT "fleet_fuel_logs_vehicleId_organizationId_companyId_fkey" FOREIGN KEY ("vehicleId", "organizationId", "companyId") REFERENCES "fleet_vehicles"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_documents" ADD CONSTRAINT "fleet_documents_vehicleId_organizationId_companyId_fkey" FOREIGN KEY ("vehicleId", "organizationId", "companyId") REFERENCES "fleet_vehicles"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_incidents" ADD CONSTRAINT "fleet_incidents_vehicleId_organizationId_companyId_fkey" FOREIGN KEY ("vehicleId", "organizationId", "companyId") REFERENCES "fleet_vehicles"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Garanties en base (INC-18)
-- ---------------------------------------------------------------------------

CREATE TRIGGER "fleet_vehicles_no_delete" BEFORE DELETE ON "fleet_vehicles" FOR EACH ROW EXECUTE FUNCTION axora_forbid_delete();
ALTER TABLE "fleet_vehicles" ADD CONSTRAINT "fleet_vehicles_year" CHECK ("year" IS NULL OR "year" BETWEEN 1950 AND 2100);

-- Compteurs : append-only, jamais en recul par rapport a l'historique.
ALTER TABLE "fleet_meter_readings" ADD CONSTRAINT "fleet_meter_readings_value" CHECK ("value" >= 0);
CREATE OR REPLACE FUNCTION axora_fleet_reading_guard() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "fleet_meter_readings" WHERE "vehicleId" = NEW."vehicleId" AND "readAt" <= NEW."readAt" AND "value" > NEW."value") THEN
    RAISE EXCEPTION 'Meter reading % is lower than an earlier reading: a counter never goes back', NEW."value" USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM "fleet_meter_readings" WHERE "vehicleId" = NEW."vehicleId" AND "readAt" >= NEW."readAt" AND "value" < NEW."value") THEN
    RAISE EXCEPTION 'Meter reading % is higher than a later reading', NEW."value" USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "fleet_meter_readings_monotonic" BEFORE INSERT ON "fleet_meter_readings" FOR EACH ROW EXECUTE FUNCTION axora_fleet_reading_guard();
CREATE TRIGGER "fleet_meter_readings_append_only" BEFORE UPDATE OR DELETE ON "fleet_meter_readings" FOR EACH ROW EXECUTE FUNCTION axora_forbid_mutation();

-- Affectations : une seule ouverte par vehicule et par chauffeur ; cloture figee.
CREATE UNIQUE INDEX "fleet_assignments_one_open_per_vehicle" ON "fleet_assignments" ("vehicleId") WHERE "endAt" IS NULL;
CREATE UNIQUE INDEX "fleet_assignments_one_open_per_driver" ON "fleet_assignments" ("employeeId") WHERE "endAt" IS NULL;
ALTER TABLE "fleet_assignments" ADD CONSTRAINT "fleet_assignments_closure" CHECK (
  ("endAt" IS NULL AND "endReading" IS NULL AND "closedByUserId" IS NULL)
  OR ("endAt" > "startAt" AND "endReading" >= "startReading" AND "closedByUserId" IS NOT NULL)
);
CREATE OR REPLACE FUNCTION axora_fleet_assignment_guard() RETURNS trigger AS $$
BEGIN
  IF OLD."endAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Assignment % is closed', OLD."code" USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW."vehicleId" <> OLD."vehicleId" OR NEW."employeeId" <> OLD."employeeId" OR NEW."startAt" <> OLD."startAt" OR NEW."startReading" <> OLD."startReading" THEN
    RAISE EXCEPTION 'Assignment facts are immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "fleet_assignments_guard" BEFORE UPDATE ON "fleet_assignments" FOR EACH ROW EXECUTE FUNCTION axora_fleet_assignment_guard();
CREATE TRIGGER "fleet_assignments_no_delete" BEFORE DELETE ON "fleet_assignments" FOR EACH ROW EXECUTE FUNCTION axora_forbid_delete();

-- Carburant : append-only, montant coherent.
ALTER TABLE "fleet_fuel_logs" ADD CONSTRAINT "fleet_fuel_logs_amounts" CHECK ("liters" > 0 AND "unitPrice" >= 0 AND "reading" >= 0 AND "totalCost" = round("liters" * "unitPrice", 2));
CREATE TRIGGER "fleet_fuel_logs_append_only" BEFORE UPDATE OR DELETE ON "fleet_fuel_logs" FOR EACH ROW EXECUTE FUNCTION axora_forbid_mutation();

-- Documents : append-only (un renouvellement est un nouveau document).
ALTER TABLE "fleet_documents" ADD CONSTRAINT "fleet_documents_validity" CHECK ("validUntil" >= "validFrom" AND ("cost" IS NULL OR "cost" >= 0));
CREATE TRIGGER "fleet_documents_append_only" BEFORE UPDATE OR DELETE ON "fleet_documents" FOR EACH ROW EXECUTE FUNCTION axora_forbid_mutation();

-- Incidents : faits figes, cloture tracee, jamais supprimes.
ALTER TABLE "fleet_incidents" ADD CONSTRAINT "fleet_incidents_closure" CHECK ("status" <> 'CLOSED' OR ("closedByUserId" IS NOT NULL AND "closedAt" IS NOT NULL AND length(btrim(coalesce("closureNote", ''))) > 0));
ALTER TABLE "fleet_incidents" ADD CONSTRAINT "fleet_incidents_cost" CHECK ("cost" IS NULL OR "cost" >= 0);
CREATE OR REPLACE FUNCTION axora_fleet_incident_guard() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'CLOSED' THEN
    RAISE EXCEPTION 'Incident % is closed', OLD."code" USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW."vehicleId" <> OLD."vehicleId" OR NEW."kind" <> OLD."kind" OR NEW."occurredAt" <> OLD."occurredAt" OR NEW."description" <> OLD."description"
     OR NEW."driverEmployeeId" IS DISTINCT FROM OLD."driverEmployeeId" OR NEW."assignmentId" IS DISTINCT FROM OLD."assignmentId" THEN
    RAISE EXCEPTION 'Incident facts are immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "fleet_incidents_guard" BEFORE UPDATE ON "fleet_incidents" FOR EACH ROW EXECUTE FUNCTION axora_fleet_incident_guard();
CREATE TRIGGER "fleet_incidents_no_delete" BEFORE DELETE ON "fleet_incidents" FOR EACH ROW EXECUTE FUNCTION axora_forbid_delete();
