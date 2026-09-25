import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type {
  FleetAssignmentView,
  FleetCostView,
  FleetDocumentView,
  FleetFuelLogView,
  FleetIncidentView,
  FleetProjectCostView,
  FleetSummaryView,
  FleetVehicleDetailView,
  FleetVehicleView,
} from "@axora24/contracts";
import { Prisma } from "@axora24/database";
import { PrismaService } from "../core/prisma.service.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import { NumberingService } from "../common/numbering.service.js";
import { writeAudit } from "../common/audit.js";
import { AutomationService } from "../workflow/automation.service.js";
import { dec, money } from "../common/decimal.js";
import { assertBody, optionalDate, optionalDecimal, optionalEnum, optionalId, optionalInt, optionalText, requiredDate, requiredDecimal, requiredEnum, requiredId, requiredText } from "../common/validation.js";
import { blockingDocuments, compliance, fullToFullConsumption, type DocumentKind } from "./fleet-math.js";

type Tx = Prisma.TransactionClient;
type Vehicle = Prisma.FleetVehicleGetPayload<object>;

const KINDS = ["VEHICLE", "ENGINE", "MACHINE"] as const;
const FUELS = ["DIESEL", "PETROL", "ELECTRIC", "NONE"] as const;
const UNITS = ["KM", "HOURS"] as const;
const DOCUMENT_KINDS = ["INSURANCE", "REGISTRATION", "INSPECTION", "PERMIT", "OTHER"] as const;
const INCIDENT_KINDS = ["ACCIDENT", "BREAKDOWN", "DAMAGE", "THEFT", "FINE"] as const;
const DOCUMENT_LABEL: Record<string, string> = { INSURANCE: "assurance", REGISTRATION: "carte grise", INSPECTION: "contrôle / vérification périodique", PERMIT: "autorisation", OTHER: "document" };
const DAY_MS = 86_400_000;
const FUTURE_SKEW_MS = 5 * 60_000;

function str(value: Prisma.Decimal | string | null | undefined): string | null {
  return value === null || value === undefined ? null : dec(value).toString();
}

/**
 * INC-18 — Gestion de parc (BC-18). La maintenance passe par la GMAO
 * (passeport d'actif, tickets et OT) ; les compteurs et le carburant sont
 * des series append-only ; une affectation exige un chauffeur habilite et
 * un vehicule en regle.
 */
@Injectable()
export class FleetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly automation: AutomationService,
  ) {}

  // -------------------------------------------------------------------
  // Vehicules
  // -------------------------------------------------------------------

  async summary(scope: CompanyScope): Promise<FleetSummaryView> {
    const vehicles = await this.listVehicles(scope, {});
    const since = new Date(Date.now() - 30 * DAY_MS);
    const [fuel, company] = await Promise.all([
      this.prisma.fleetFuelLog.aggregate({ where: { ...scope, filledAt: { gte: since } }, _sum: { totalCost: true } }),
      this.prisma.company.findUniqueOrThrow({ where: { id: scope.companyId }, select: { currency: true } }),
    ]);
    const active = vehicles.filter((vehicle) => vehicle.status !== "DISPOSED");
    return {
      vehicles: active.length,
      assigned: active.filter((vehicle) => vehicle.currentAssignment).length,
      immobilized: active.filter((vehicle) => vehicle.status === "IMMOBILIZED").length,
      complianceIssues: active.filter((vehicle) => vehicle.compliance.some((item) => item.required && item.state !== "VALID")).length,
      openIncidents: active.reduce((sum, vehicle) => sum + vehicle.openIncidents, 0),
      fuelCost30d: money(fuel._sum.totalCost ?? 0),
      currency: company.currency.trim(),
    };
  }

  async listVehicles(scope: CompanyScope, query: Record<string, unknown>): Promise<FleetVehicleView[]> {
    const status = optionalEnum(query.status, "status", ["ACTIVE", "IMMOBILIZED", "DISPOSED"] as const);
    const vehicles = await this.prisma.fleetVehicle.findMany({ where: { ...scope, ...(status ? { status } : {}) }, orderBy: { code: "asc" } });
    return this.vehicleViews(scope, vehicles);
  }

  async getVehicle(scope: CompanyScope, vehicleId: string): Promise<FleetVehicleDetailView> {
    const vehicle = await this.prisma.fleetVehicle.findFirst({ where: { id: vehicleId, ...scope } });
    if (!vehicle) throw new NotFoundException("Vehicle not found");
    const [[view], readings, assignments, fuelLogs, documents, incidents] = await Promise.all([
      this.vehicleViews(scope, [vehicle]),
      this.prisma.fleetMeterReading.findMany({ where: { vehicleId }, orderBy: { readAt: "desc" }, take: 30 }),
      this.listAssignments(scope, { vehicleId, all: "true" }),
      this.listFuel(scope, { vehicleId }),
      this.prisma.fleetDocument.findMany({ where: { vehicleId }, orderBy: [{ kind: "asc" }, { validUntil: "desc" }] }),
      this.listIncidents(scope, { vehicleId, status: "ALL" }),
    ]);
    const users = await this.userNames(scope, readings.map((reading) => reading.recordedByUserId));
    const allFills = await this.prisma.fleetFuelLog.findMany({ where: { vehicleId }, select: { filledAt: true, liters: true, reading: true, fullTank: true } });
    const consumption = fullToFullConsumption(allFills, vehicle.usageUnit);
    return {
      ...view!,
      readings: readings.map((reading) => ({ readAt: reading.readAt.toISOString(), value: str(reading.value)!, source: reading.source, recordedByName: users.get(reading.recordedByUserId) ?? "—" })),
      assignments,
      fuelLogs: fuelLogs.slice(0, 50),
      documents: documents.map((document) => this.documentView(document)),
      incidents,
      consumption: {
        value: consumption.value?.toString() ?? null,
        unit: vehicle.usageUnit === "KM" ? "L/100 km" : "L/h",
        windows: consumption.windows,
        note:
          consumption.value === null
            ? "Non calculable : il faut deux pleins complets encadrant un usage mesuré."
            : `Plein à plein sur ${consumption.windows} intervalle(s) : ${consumption.liters.toString()} L pour ${consumption.usage.toString()} ${vehicle.usageUnit === "KM" ? "km" : "h"}.`,
      },
      costs12m: await this.costs(scope, vehicle, new Date(Date.now() - 365 * DAY_MS), new Date()),
    };
  }

  /** Mise au parc : le passeport GMAO est cree dans la meme transaction (origine justifiee). */
  async createVehicle(scope: CompanyScope, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const kind = requiredEnum(input.kind, "kind", KINDS);
    const usageUnit = requiredEnum(input.usageUnit, "usageUnit", UNITS);
    const registration = optionalText(input.registration, "registration", 30)?.toUpperCase().replace(/\s+/g, "-") ?? null;
    if (kind === "VEHICLE" && !registration) throw new BadRequestException("A road vehicle needs its registration");
    const acquisitionDate = requiredDate(input.acquisitionDate, "acquisitionDate");
    if (acquisitionDate.getTime() > Date.now()) throw new BadRequestException("acquisitionDate cannot be in the future");
    const initialReading = requiredDecimal(input.initialReading, "initialReading");
    // Releve initial date (reprise d'un parc existant) : entre l'acquisition et maintenant.
    const initialReadingAt = optionalDate(input.initialReadingAt, "initialReadingAt") ?? new Date();
    if (initialReadingAt.getTime() > Date.now() + FUTURE_SKEW_MS || initialReadingAt < acquisitionDate) throw new BadRequestException("initialReadingAt must be between the acquisition date and now");
    const justification = requiredText(input.originJustification, "originJustification", 1000);
    const make = requiredText(input.make, "make", 80);
    const model = requiredText(input.model, "model", 80);
    const homeBase = requiredText(input.homeBase, "homeBase", 200);
    const id = await this.prisma.$transaction(async (tx) => {
      if (registration && (await tx.fleetVehicle.findFirst({ where: { companyId: scope.companyId, registration } }))) throw new ConflictException(`Registration ${registration} already exists`);
      const code = await this.numbering.next(tx, scope, "FLT");
      const assetCode = await this.numbering.next(tx, scope, "AST");
      const asset = await tx.asset.create({
        data: {
          ...scope,
          code: assetCode,
          name: `${make} ${model}${registration ? ` (${registration})` : ""}`,
          origin: "MANUAL",
          originJustification: `Mise au parc ${code} : ${justification}`,
          serialNumber: optionalText(input.serialNumber, "serialNumber", 80),
          manufacturer: make,
          model,
          location: homeBase,
          installedAt: acquisitionDate,
          criticality: kind === "VEHICLE" ? "MEDIUM" : "HIGH",
          createdByUserId: actorUserId,
        },
      });
      const vehicle = await tx.fleetVehicle.create({
        data: {
          ...scope,
          code,
          kind,
          category: requiredText(input.category, "category", 80),
          registration,
          serialNumber: optionalText(input.serialNumber, "serialNumber", 80),
          make,
          model,
          year: optionalInt(input.year, "year", { min: 1950, max: new Date().getUTCFullYear() + 1 }),
          fuelType: requiredEnum(input.fuelType, "fuelType", FUELS),
          usageUnit,
          requiredLicence: optionalText(input.requiredLicence, "requiredLicence", 80),
          assetId: asset.id,
          acquisitionDate,
          acquisitionCost: optionalDecimal(input.acquisitionCost, "acquisitionCost"),
          homeBase,
          createdByUserId: actorUserId,
        },
      });
      await tx.fleetMeterReading.create({ data: { ...scope, vehicleId: vehicle.id, readAt: initialReadingAt, value: initialReading, source: "MANUAL", recordedByUserId: actorUserId } });
      await writeAudit(tx, scope, actorUserId, "assets.asset.created", "Asset", asset.id, { code: assetCode, origin: "MANUAL", fleet: code });
      await writeAudit(tx, scope, actorUserId, "fleet.vehicle.created", "FleetVehicle", vehicle.id, { code, kind, registration, asset: assetCode });
      return vehicle.id;
    });
    return this.getVehicle(scope, id);
  }

  /** Immobilisation / remise en service / cession, repercutees sur le passeport GMAO. */
  async setStatus(scope: CompanyScope, vehicleId: string, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const status = requiredEnum(input.status, "status", ["ACTIVE", "IMMOBILIZED", "DISPOSED"] as const);
    const reason = requiredText(input.reason, "reason", 500);
    await this.prisma.$transaction(async (tx) => {
      const vehicle = await this.lockVehicle(tx, scope, vehicleId);
      if (vehicle.status === "DISPOSED") throw new BadRequestException("A disposed vehicle is read-only");
      if (status !== "ACTIVE" && (await tx.fleetAssignment.count({ where: { vehicleId, endAt: null } })) > 0) throw new BadRequestException("Close the open assignment first");
      if (status === "DISPOSED" && (await tx.workOrder.count({ where: { assetId: vehicle.assetId, status: { in: ["OPEN", "IN_PROGRESS"] } } })) > 0) {
        throw new BadRequestException("Close the open work orders before disposal");
      }
      await tx.fleetVehicle.update({ where: { id: vehicleId }, data: { status } });
      await tx.asset.update({ where: { id: vehicle.assetId }, data: { status: status === "ACTIVE" ? "IN_SERVICE" : status === "IMMOBILIZED" ? "OUT_OF_SERVICE" : "RETIRED" } });
      await writeAudit(tx, scope, actorUserId, "fleet.vehicle.status", "FleetVehicle", vehicleId, { from: vehicle.status, to: status, reason });
    });
    return this.getVehicle(scope, vehicleId);
  }

  async addReading(scope: CompanyScope, vehicleId: string, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const value = requiredDecimal(input.value, "value");
    const readAt = optionalDate(input.readAt, "readAt") ?? new Date();
    if (readAt.getTime() > Date.now() + FUTURE_SKEW_MS) throw new BadRequestException("readAt cannot be in the future");
    await this.prisma.$transaction(async (tx) => {
      await this.lockVehicle(tx, scope, vehicleId);
      await this.recordReading(tx, scope, vehicleId, readAt, value, "MANUAL", actorUserId);
      await writeAudit(tx, scope, actorUserId, "fleet.reading.recorded", "FleetVehicle", vehicleId, { value: value.toString(), readAt: readAt.toISOString() });
    });
    return this.getVehicle(scope, vehicleId);
  }

  // -------------------------------------------------------------------
  // Affectations
  // -------------------------------------------------------------------

  async listAssignments(scope: CompanyScope, query: Record<string, unknown>): Promise<FleetAssignmentView[]> {
    const vehicleId = optionalId(query.vehicleId, "vehicleId");
    const projectId = optionalId(query.projectId, "projectId");
    const all = query.all === "true";
    const assignments = await this.prisma.fleetAssignment.findMany({
      where: { ...scope, ...(vehicleId ? { vehicleId } : {}), ...(projectId ? { projectId } : {}), ...(all ? {} : { endAt: null }) },
      orderBy: { startAt: "desc" },
      take: 300,
      include: { vehicle: true, employee: { select: { firstName: true, lastName: true } } },
    });
    const projects = await this.projectCodes(scope, assignments.map((assignment) => assignment.projectId));
    return assignments.map((assignment) => this.assignmentView(assignment, projects));
  }

  /**
   * Affectation : chauffeur actif ET habilite (competence RH valide si le
   * vehicule l'exige), vehicule actif et en regle (pieces obligatoires en
   * vigueur), releve de depart >= dernier releve. Une seule affectation
   * ouverte par vehicule et par chauffeur (index unique en base).
   */
  async assign(scope: CompanyScope, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const vehicleId = requiredId(input.vehicleId, "vehicleId");
    const employeeId = requiredId(input.employeeId, "employeeId");
    const projectId = optionalId(input.projectId, "projectId");
    const purpose = requiredText(input.purpose, "purpose", 300);
    const startReading = requiredDecimal(input.startReading, "startReading");
    const now = new Date();
    const id = await this.prisma.$transaction(async (tx) => {
      const vehicle = await this.lockVehicle(tx, scope, vehicleId);
      if (vehicle.status !== "ACTIVE") throw new BadRequestException(`Vehicle is ${vehicle.status}`);
      if (await tx.fleetAssignment.findFirst({ where: { vehicleId, endAt: null }, select: { id: true } })) throw new ConflictException("The vehicle is already assigned");
      const employee = await tx.employee.findFirst({ where: { id: employeeId, ...scope }, include: { skills: true } });
      if (!employee) throw new NotFoundException("Employee not found");
      if (employee.status !== "ACTIVE") throw new BadRequestException(`Employee is ${employee.status}`);
      if (await tx.fleetAssignment.findFirst({ where: { employeeId, endAt: null }, select: { id: true } })) throw new ConflictException("The driver already has an open assignment");
      if (vehicle.requiredLicence) {
        const licence = employee.skills.find((skill) => skill.name.trim().toLowerCase() === vehicle.requiredLicence!.trim().toLowerCase());
        if (!licence) throw new BadRequestException(`The driver does not hold the required licence « ${vehicle.requiredLicence} »`);
        if (licence.certifiedUntil && licence.certifiedUntil < now) throw new BadRequestException(`The driver's licence « ${vehicle.requiredLicence} » expired on ${licence.certifiedUntil.toISOString().slice(0, 10)}`);
      }
      const documents = await tx.fleetDocument.findMany({ where: { vehicleId } });
      const blocking = blockingDocuments(compliance(vehicle.kind, documents, now));
      if (blocking.length) throw new BadRequestException(`Vehicle not compliant: ${blocking.map((item) => `${DOCUMENT_LABEL[item.kind]} ${item.state === "MISSING" ? "absente" : "échue"}`).join(", ")}`);
      if (projectId && !(await tx.project.findFirst({ where: { id: projectId, ...scope }, select: { id: true } }))) throw new NotFoundException("Project not found");
      await this.recordReading(tx, scope, vehicleId, now, startReading, "ASSIGNMENT_START", actorUserId);
      const code = await this.numbering.next(tx, scope, "AFF");
      const assignment = await tx.fleetAssignment.create({ data: { ...scope, code, vehicleId, employeeId, projectId, purpose, startAt: now, startReading, createdByUserId: actorUserId } });
      await writeAudit(tx, scope, actorUserId, "fleet.assignment.opened", "FleetAssignment", assignment.id, { code, vehicle: vehicle.code, employeeId, projectId });
      return assignment.id;
    });
    return (await this.listAssignments(scope, { all: "true" })).find((assignment) => assignment.id === id)!;
  }

  async closeAssignment(scope: CompanyScope, assignmentId: string, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const endReading = requiredDecimal(input.endReading, "endReading");
    const note = optionalText(input.note, "note", 1000);
    await this.prisma.$transaction(async (tx) => {
      const assignment = await tx.fleetAssignment.findFirst({ where: { id: assignmentId, ...scope } });
      if (!assignment) throw new NotFoundException("Assignment not found");
      if (assignment.endAt) throw new BadRequestException("Assignment already closed");
      await this.lockVehicle(tx, scope, assignment.vehicleId);
      if (endReading.lessThan(assignment.startReading)) throw new BadRequestException("endReading cannot be lower than the start reading");
      const now = new Date();
      await this.recordReading(tx, scope, assignment.vehicleId, now, endReading, "ASSIGNMENT_END", actorUserId);
      await tx.fleetAssignment.update({ where: { id: assignmentId }, data: { endAt: now, endReading, endNote: note, closedByUserId: actorUserId } });
      await writeAudit(tx, scope, actorUserId, "fleet.assignment.closed", "FleetAssignment", assignmentId, { code: assignment.code, usage: endReading.minus(assignment.startReading).toString() });
    });
    return (await this.listAssignments(scope, { all: "true" })).find((assignment) => assignment.id === assignmentId)!;
  }

  // -------------------------------------------------------------------
  // Carburant
  // -------------------------------------------------------------------

  async listFuel(scope: CompanyScope, query: Record<string, unknown>): Promise<FleetFuelLogView[]> {
    const vehicleId = optionalId(query.vehicleId, "vehicleId");
    const projectId = optionalId(query.projectId, "projectId");
    const logs = await this.prisma.fleetFuelLog.findMany({ where: { ...scope, ...(vehicleId ? { vehicleId } : {}), ...(projectId ? { projectId } : {}) }, orderBy: { filledAt: "desc" }, take: 300, include: { vehicle: { select: { code: true } } } });
    const [projects, users] = await Promise.all([this.projectCodes(scope, logs.map((log) => log.projectId)), this.userNames(scope, logs.map((log) => log.recordedByUserId))]);
    return logs.map((log) => ({
      id: log.id,
      vehicleId: log.vehicleId,
      vehicleCode: log.vehicle.code,
      filledAt: log.filledAt.toISOString(),
      liters: str(log.liters)!,
      unitPrice: str(log.unitPrice)!,
      totalCost: money(log.totalCost),
      reading: str(log.reading)!,
      fullTank: log.fullTank,
      station: log.station,
      projectCode: log.projectId ? (projects.get(log.projectId) ?? null) : null,
      recordedByName: users.get(log.recordedByUserId) ?? "—",
    }));
  }

  /** Plein : releve compteur enregistre dans la serie ; imputation projet par defaut = affectation ouverte a l'instant du plein. */
  async recordFuel(scope: CompanyScope, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const vehicleId = requiredId(input.vehicleId, "vehicleId");
    const filledAt = requiredDate(input.filledAt, "filledAt");
    if (filledAt.getTime() > Date.now() + FUTURE_SKEW_MS) throw new BadRequestException("filledAt cannot be in the future");
    const liters = requiredDecimal(input.liters, "liters", { positive: true });
    const unitPrice = requiredDecimal(input.unitPrice, "unitPrice");
    const reading = requiredDecimal(input.reading, "reading");
    if (typeof input.fullTank !== "boolean") throw new BadRequestException("fullTank must be a boolean");
    const explicitProject = optionalId(input.projectId, "projectId");
    const receiptFileId = optionalId(input.receiptFileId, "receiptFileId");
    await this.prisma.$transaction(async (tx) => {
      const vehicle = await this.lockVehicle(tx, scope, vehicleId);
      if (vehicle.fuelType === "NONE" || vehicle.fuelType === "ELECTRIC") throw new BadRequestException("This vehicle does not use liquid fuel");
      if (vehicle.status === "DISPOSED") throw new BadRequestException("The vehicle is disposed");
      const assignment = await tx.fleetAssignment.findFirst({ where: { vehicleId, startAt: { lte: filledAt }, OR: [{ endAt: null }, { endAt: { gt: filledAt } }] } });
      const projectId = explicitProject ?? assignment?.projectId ?? null;
      if (explicitProject && !(await tx.project.findFirst({ where: { id: explicitProject, ...scope }, select: { id: true } }))) throw new NotFoundException("Project not found");
      if (receiptFileId && !(await tx.storedFile.findFirst({ where: { id: receiptFileId, ...scope }, select: { id: true } }))) throw new NotFoundException("Receipt file not found");
      await this.recordReading(tx, scope, vehicleId, filledAt, reading, "FUEL", actorUserId);
      const log = await tx.fleetFuelLog.create({
        data: {
          ...scope,
          vehicleId,
          filledAt,
          liters,
          unitPrice,
          totalCost: liters.mul(unitPrice).toDecimalPlaces(2),
          reading,
          fullTank: input.fullTank as boolean,
          station: optionalText(input.station, "station", 120),
          projectId,
          assignmentId: assignment?.id ?? null,
          receiptFileId,
          recordedByUserId: actorUserId,
        },
      });
      await writeAudit(tx, scope, actorUserId, "fleet.fuel.recorded", "FleetFuelLog", log.id, { vehicle: vehicle.code, liters: liters.toString(), projectId });
    });
    return this.listFuel(scope, { vehicleId });
  }

  async projectCosts(scope: CompanyScope): Promise<FleetProjectCostView[]> {
    const rows = await this.prisma.fleetFuelLog.groupBy({ by: ["projectId"], where: { ...scope, projectId: { not: null } }, _sum: { totalCost: true, liters: true }, _count: { _all: true } });
    const projects = await this.projectCodes(scope, rows.map((row) => row.projectId));
    return rows.map((row) => ({ projectId: row.projectId!, projectCode: projects.get(row.projectId!) ?? "—", fuelCost: money(row._sum.totalCost ?? 0), liters: str(row._sum.liters) ?? "0", fills: row._count._all }));
  }

  // -------------------------------------------------------------------
  // Documents et conformite
  // -------------------------------------------------------------------

  async addDocument(scope: CompanyScope, vehicleId: string, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const kind = requiredEnum(input.kind, "kind", DOCUMENT_KINDS);
    const validFrom = requiredDate(input.validFrom, "validFrom");
    const validUntil = requiredDate(input.validUntil, "validUntil");
    if (validUntil < validFrom) throw new BadRequestException("validUntil must be after validFrom");
    const fileId = optionalId(input.fileId, "fileId");
    await this.prisma.$transaction(async (tx) => {
      await this.lockVehicle(tx, scope, vehicleId);
      if (fileId && !(await tx.storedFile.findFirst({ where: { id: fileId, ...scope }, select: { id: true } }))) throw new NotFoundException("File not found");
      const document = await tx.fleetDocument.create({
        data: {
          ...scope,
          vehicleId,
          kind,
          reference: requiredText(input.reference, "reference", 120),
          issuer: optionalText(input.issuer, "issuer", 120),
          validFrom,
          validUntil,
          cost: optionalDecimal(input.cost, "cost"),
          fileId,
          recordedByUserId: actorUserId,
        },
      });
      await writeAudit(tx, scope, actorUserId, "fleet.document.recorded", "FleetDocument", document.id, { vehicleId, kind, validUntil: validUntil.toISOString().slice(0, 10) });
    });
    return this.getVehicle(scope, vehicleId);
  }

  // -------------------------------------------------------------------
  // Incidents
  // -------------------------------------------------------------------

  async listIncidents(scope: CompanyScope, query: Record<string, unknown>): Promise<FleetIncidentView[]> {
    const vehicleId = optionalId(query.vehicleId, "vehicleId");
    const status = query.status === "ALL" ? undefined : optionalEnum(query.status ?? "OPEN", "status", ["OPEN", "CLOSED"] as const);
    const incidents = await this.prisma.fleetIncident.findMany({ where: { ...scope, ...(vehicleId ? { vehicleId } : {}), ...(status ? { status } : {}) }, orderBy: { occurredAt: "desc" }, take: 300, include: { vehicle: { select: { code: true } } } });
    const [drivers, assignments, tickets] = await Promise.all([
      this.prisma.employee.findMany({ where: { id: { in: incidents.map((incident) => incident.driverEmployeeId).filter((id): id is string => Boolean(id)) }, ...scope }, select: { id: true, firstName: true, lastName: true } }),
      this.prisma.fleetAssignment.findMany({ where: { id: { in: incidents.map((incident) => incident.assignmentId).filter((id): id is string => Boolean(id)) }, ...scope }, select: { id: true, code: true } }),
      this.prisma.maintenanceTicket.findMany({ where: { id: { in: incidents.map((incident) => incident.maintenanceTicketId).filter((id): id is string => Boolean(id)) }, ...scope }, select: { id: true, code: true } }),
    ]);
    return incidents.map((incident) => {
      const driver = drivers.find((candidate) => candidate.id === incident.driverEmployeeId);
      return {
        id: incident.id,
        code: incident.code,
        vehicleId: incident.vehicleId,
        vehicleCode: incident.vehicle.code,
        kind: incident.kind,
        occurredAt: incident.occurredAt.toISOString(),
        description: incident.description,
        location: incident.location,
        driverName: driver ? `${driver.firstName} ${driver.lastName}` : null,
        assignmentCode: assignments.find((assignment) => assignment.id === incident.assignmentId)?.code ?? null,
        cost: incident.cost === null ? null : money(incident.cost),
        maintenanceTicketId: incident.maintenanceTicketId,
        maintenanceTicketCode: tickets.find((ticket) => ticket.id === incident.maintenanceTicketId)?.code ?? null,
        status: incident.status,
        closureNote: incident.closureNote,
      };
    });
  }

  /**
   * Incident : le conducteur est celui de l'affectation ouverte a l'instant
   * des faits (jamais saisi librement). Une panne ou un accident peut ouvrir
   * un ticket GMAO sur le passeport du vehicule (heure de defaillance reprise).
   */
  async reportIncident(scope: CompanyScope, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const vehicleId = requiredId(input.vehicleId, "vehicleId");
    const kind = requiredEnum(input.kind, "kind", INCIDENT_KINDS);
    const occurredAt = requiredDate(input.occurredAt, "occurredAt");
    if (occurredAt.getTime() > Date.now() + FUTURE_SKEW_MS) throw new BadRequestException("occurredAt cannot be in the future");
    const description = requiredText(input.description, "description", 4000);
    const createTicket = input.createTicket === true;
    const immobilize = input.immobilize === true;
    if (createTicket && kind !== "BREAKDOWN" && kind !== "ACCIDENT" && kind !== "DAMAGE") throw new BadRequestException("Only a breakdown, accident or damage opens a maintenance ticket");
    const id = await this.prisma.$transaction(async (tx) => {
      const vehicle = await this.lockVehicle(tx, scope, vehicleId);
      const assignment = await tx.fleetAssignment.findFirst({ where: { vehicleId, startAt: { lte: occurredAt }, OR: [{ endAt: null }, { endAt: { gt: occurredAt } }] } });
      let ticketId: string | null = null;
      if (createTicket) {
        const asset = await tx.asset.findUniqueOrThrow({ where: { id: vehicle.assetId } });
        if (occurredAt < asset.installedAt) throw new BadRequestException("occurredAt precedes the vehicle's entry into the fleet");
        const ticketCode = await this.numbering.next(tx, scope, "TKT");
        const ticket = await tx.maintenanceTicket.create({
          data: { ...scope, code: ticketCode, assetId: vehicle.assetId, title: `${kind === "BREAKDOWN" ? "Panne" : kind === "ACCIDENT" ? "Accident" : "Dommage"} ${vehicle.code}`, description, priority: immobilize ? "URGENT" : "HIGH", failureAt: occurredAt, reportedByUserId: actorUserId },
        });
        ticketId = ticket.id;
        await writeAudit(tx, scope, actorUserId, "assets.ticket.created", "MaintenanceTicket", ticket.id, { code: ticketCode, assetId: vehicle.assetId, fleet: vehicle.code });
        await this.automation.emit(tx, scope, { type: "assets.ticket.created", resourceId: ticket.id, actorUserId, link: `/assets/${vehicle.assetId}`, payload: { code: ticketCode, title: ticket.title, priority: ticket.priority, assetCode: asset.code } });
      }
      const code = await this.numbering.next(tx, scope, "SIN");
      const incident = await tx.fleetIncident.create({
        data: {
          ...scope,
          code,
          vehicleId,
          kind,
          occurredAt,
          description,
          location: optionalText(input.location, "location", 200),
          driverEmployeeId: assignment?.employeeId ?? null,
          assignmentId: assignment?.id ?? null,
          cost: optionalDecimal(input.cost, "cost"),
          maintenanceTicketId: ticketId,
          reportedByUserId: actorUserId,
        },
      });
      if (immobilize && vehicle.status === "ACTIVE") {
        await tx.fleetVehicle.update({ where: { id: vehicleId }, data: { status: "IMMOBILIZED" } });
        await tx.asset.update({ where: { id: vehicle.assetId }, data: { status: "OUT_OF_SERVICE" } });
      }
      await writeAudit(tx, scope, actorUserId, "fleet.incident.reported", "FleetIncident", incident.id, { code, vehicle: vehicle.code, kind, driverEmployeeId: assignment?.employeeId ?? null, ticketId });
      await this.automation.emit(tx, scope, { type: "fleet.incident.reported", resourceId: incident.id, actorUserId, link: `/fleet/vehicles/${vehicleId}`, payload: { code, kind, vehicleCode: vehicle.code, cost: incident.cost === null ? null : incident.cost.toString() } });
      return incident.id;
    });
    return (await this.listIncidents(scope, { status: "ALL" })).find((incident) => incident.id === id)!;
  }

  async closeIncident(scope: CompanyScope, incidentId: string, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const note = requiredText(input.note, "note", 2000);
    const cost = optionalDecimal(input.cost, "cost");
    await this.prisma.$transaction(async (tx) => {
      const incident = await tx.fleetIncident.findFirst({ where: { id: incidentId, ...scope } });
      if (!incident) throw new NotFoundException("Incident not found");
      if (incident.status === "CLOSED") throw new BadRequestException("Incident already closed");
      await tx.fleetIncident.update({ where: { id: incidentId }, data: { status: "CLOSED", closedByUserId: actorUserId, closedAt: new Date(), closureNote: note, ...(cost ? { cost } : {}) } });
      await writeAudit(tx, scope, actorUserId, "fleet.incident.closed", "FleetIncident", incidentId, { code: incident.code, cost: cost?.toString() ?? null });
    });
    return (await this.listIncidents(scope, { status: "ALL" })).find((incident) => incident.id === incidentId)!;
  }

  // -------------------------------------------------------------------
  // Internes
  // -------------------------------------------------------------------

  private async recordReading(tx: Tx, scope: CompanyScope, vehicleId: string, readAt: Date, value: Prisma.Decimal, source: "MANUAL" | "FUEL" | "ASSIGNMENT_START" | "ASSIGNMENT_END", actorUserId: string) {
    const before = await tx.fleetMeterReading.findFirst({ where: { vehicleId, readAt: { lte: readAt } }, orderBy: [{ value: "desc" }] });
    if (before && dec(before.value).greaterThan(value)) throw new BadRequestException(`Meter reading ${value.toString()} is lower than the reading ${dec(before.value).toString()} of ${before.readAt.toISOString().slice(0, 16)}: a counter never goes back`);
    const after = await tx.fleetMeterReading.findFirst({ where: { vehicleId, readAt: { gte: readAt } }, orderBy: [{ value: "asc" }] });
    if (after && dec(after.value).lessThan(value)) throw new BadRequestException(`Meter reading ${value.toString()} is higher than the later reading ${dec(after.value).toString()}`);
    await tx.fleetMeterReading.create({ data: { ...scope, vehicleId, readAt, value, source, recordedByUserId: actorUserId } });
  }

  private async lockVehicle(tx: Tx, scope: CompanyScope, vehicleId: string): Promise<Vehicle> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "fleet_vehicles" WHERE "id" = ${vehicleId} AND "organizationId" = ${scope.organizationId} AND "companyId" = ${scope.companyId} FOR UPDATE
    `;
    if (rows.length === 0) throw new NotFoundException("Vehicle not found");
    return tx.fleetVehicle.findUniqueOrThrow({ where: { id: vehicleId } });
  }

  private async costs(scope: CompanyScope, vehicle: Vehicle, from: Date, to: Date): Promise<FleetCostView> {
    const [fuel, workOrders, documents, incidents, baseline, inPeriod, company] = await Promise.all([
      this.prisma.fleetFuelLog.aggregate({ where: { vehicleId: vehicle.id, filledAt: { gte: from, lte: to } }, _sum: { totalCost: true } }),
      this.prisma.workOrder.aggregate({ where: { ...scope, assetId: vehicle.assetId, status: { not: "CANCELLED" }, createdAt: { gte: from, lte: to } }, _sum: { laborCost: true, partsCost: true } }),
      this.prisma.fleetDocument.aggregate({ where: { vehicleId: vehicle.id, validFrom: { gte: from, lte: to } }, _sum: { cost: true } }),
      this.prisma.fleetIncident.aggregate({ where: { vehicleId: vehicle.id, occurredAt: { gte: from, lte: to } }, _sum: { cost: true } }),
      this.prisma.fleetMeterReading.findFirst({ where: { vehicleId: vehicle.id, readAt: { lt: from } }, orderBy: { value: "desc" } }),
      this.prisma.fleetMeterReading.aggregate({ where: { vehicleId: vehicle.id, readAt: { gte: from, lte: to } }, _min: { value: true }, _max: { value: true } }),
      this.prisma.company.findUniqueOrThrow({ where: { id: scope.companyId }, select: { currency: true } }),
    ]);
    const fuelCost = dec(fuel._sum.totalCost);
    const maintenance = dec(workOrders._sum.laborCost).plus(dec(workOrders._sum.partsCost));
    const documentCost = dec(documents._sum.cost);
    const incidentCost = dec(incidents._sum.cost);
    const total = fuelCost.plus(maintenance).plus(documentCost).plus(incidentCost);
    const start = baseline ? dec(baseline.value) : inPeriod._min.value === null ? null : dec(inPeriod._min.value);
    const usage = start !== null && inPeriod._max.value !== null ? dec(inPeriod._max.value).minus(start) : null;
    return {
      fuel: money(fuelCost),
      maintenance: money(maintenance),
      documents: money(documentCost),
      incidents: money(incidentCost),
      total: money(total),
      usage: usage === null ? null : usage.toString(),
      perUnit: usage === null || usage.isZero() ? null : total.div(usage).toFixed(vehicle.usageUnit === "KM" ? 3 : 2),
      currency: company.currency.trim(),
    };
  }

  private async vehicleViews(scope: CompanyScope, vehicles: Vehicle[]): Promise<FleetVehicleView[]> {
    const ids = vehicles.map((vehicle) => vehicle.id);
    const now = new Date();
    const [assets, readings, assignments, documents, incidents, workOrders] = await Promise.all([
      this.prisma.asset.findMany({ where: { id: { in: vehicles.map((vehicle) => vehicle.assetId) }, ...scope }, select: { id: true, code: true } }),
      this.prisma.fleetMeterReading.findMany({ where: { vehicleId: { in: ids } }, orderBy: { readAt: "desc" }, distinct: ["vehicleId"] }),
      this.prisma.fleetAssignment.findMany({ where: { vehicleId: { in: ids }, endAt: null }, include: { vehicle: true, employee: { select: { firstName: true, lastName: true } } } }),
      this.prisma.fleetDocument.findMany({ where: { vehicleId: { in: ids } } }),
      this.prisma.fleetIncident.groupBy({ by: ["vehicleId"], where: { vehicleId: { in: ids }, status: "OPEN" }, _count: { _all: true } }),
      this.prisma.workOrder.groupBy({ by: ["assetId"], where: { ...scope, assetId: { in: vehicles.map((vehicle) => vehicle.assetId) }, status: { in: ["OPEN", "IN_PROGRESS"] } }, _count: { _all: true } }),
    ]);
    const projects = await this.projectCodes(scope, assignments.map((assignment) => assignment.projectId));
    return vehicles.map((vehicle) => {
      const last = readings.find((reading) => reading.vehicleId === vehicle.id);
      const assignment = assignments.find((candidate) => candidate.vehicleId === vehicle.id);
      return {
        id: vehicle.id,
        code: vehicle.code,
        kind: vehicle.kind,
        category: vehicle.category,
        registration: vehicle.registration,
        serialNumber: vehicle.serialNumber,
        make: vehicle.make,
        model: vehicle.model,
        year: vehicle.year,
        fuelType: vehicle.fuelType,
        usageUnit: vehicle.usageUnit,
        requiredLicence: vehicle.requiredLicence,
        assetId: vehicle.assetId,
        assetCode: assets.find((asset) => asset.id === vehicle.assetId)?.code ?? "—",
        acquisitionDate: vehicle.acquisitionDate.toISOString().slice(0, 10),
        acquisitionCost: vehicle.acquisitionCost === null ? null : money(vehicle.acquisitionCost),
        homeBase: vehicle.homeBase,
        status: vehicle.status,
        lastReading: last ? dec(last.value).toString() : null,
        lastReadingAt: last?.readAt.toISOString() ?? null,
        currentAssignment: assignment ? this.assignmentView(assignment, projects) : null,
        compliance: compliance(vehicle.kind, documents.filter((document) => document.vehicleId === vehicle.id) as Array<{ kind: DocumentKind; reference: string; validFrom: Date; validUntil: Date }>, now).map((item) => ({
          kind: item.kind,
          state: item.state,
          validUntil: item.validUntil?.toISOString().slice(0, 10) ?? null,
          reference: item.reference,
          required: item.required,
        })),
        openIncidents: incidents.find((row) => row.vehicleId === vehicle.id)?._count._all ?? 0,
        openWorkOrders: workOrders.find((row) => row.assetId === vehicle.assetId)?._count._all ?? 0,
      };
    });
  }

  private assignmentView(
    assignment: Prisma.FleetAssignmentGetPayload<{ include: { vehicle: true; employee: { select: { firstName: true; lastName: true } } } }>,
    projects: Map<string, string>,
  ): FleetAssignmentView {
    return {
      id: assignment.id,
      code: assignment.code,
      vehicleId: assignment.vehicleId,
      vehicleCode: assignment.vehicle.code,
      vehicleLabel: `${assignment.vehicle.make} ${assignment.vehicle.model}${assignment.vehicle.registration ? ` · ${assignment.vehicle.registration}` : ""}`,
      employeeId: assignment.employeeId,
      employeeName: `${assignment.employee.firstName} ${assignment.employee.lastName}`,
      projectId: assignment.projectId,
      projectCode: assignment.projectId ? (projects.get(assignment.projectId) ?? null) : null,
      purpose: assignment.purpose,
      startAt: assignment.startAt.toISOString(),
      startReading: dec(assignment.startReading).toString(),
      endAt: assignment.endAt?.toISOString() ?? null,
      endReading: str(assignment.endReading),
      usage: assignment.endReading === null ? null : dec(assignment.endReading).minus(assignment.startReading).toString(),
      endNote: assignment.endNote,
    };
  }

  private documentView(document: Prisma.FleetDocumentGetPayload<object>): FleetDocumentView {
    return {
      id: document.id,
      kind: document.kind,
      reference: document.reference,
      issuer: document.issuer,
      validFrom: document.validFrom.toISOString().slice(0, 10),
      validUntil: document.validUntil.toISOString().slice(0, 10),
      cost: document.cost === null ? null : money(document.cost),
      fileId: document.fileId,
      fileUrl: document.fileId ? `/api/v1/files/${document.fileId}/content` : null,
    };
  }

  private async projectCodes(scope: CompanyScope, ids: Array<string | null>): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (unique.length === 0) return new Map();
    const projects = await this.prisma.project.findMany({ where: { id: { in: unique }, ...scope }, select: { id: true, code: true } });
    return new Map(projects.map((project) => [project.id, project.code]));
  }

  private async userNames(scope: CompanyScope, ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(ids)] }, organizationId: scope.organizationId }, select: { id: true, fullName: true } });
    return new Map(users.map((user) => [user.id, user.fullName]));
  }
}
