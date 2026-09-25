import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { AssetView, MaintenancePlanView, MaintenanceSummaryView, MaintenanceTicketView, ReliabilityView, WorkOrderView } from "@axora24/contracts";
import { Prisma } from "@axora24/database";
import { PrismaService } from "../core/prisma.service.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import { NumberingService } from "../common/numbering.service.js";
import { writeAudit } from "../common/audit.js";
import { AutomationService } from "../workflow/automation.service.js";
import { dec, money, qty, sumDecimals } from "../common/decimal.js";
import { StockLedgerService } from "../inventory/stock-ledger.service.js";
import {
  assertBody,
  optionalDate,
  optionalDecimal,
  optionalEnum,
  optionalId,
  optionalText,
  requiredDate,
  requiredDecimal,
  requiredId,
  requiredInt,
  requiredText,
} from "../common/validation.js";
import { reliability, type FailureRecord } from "./reliability.js";

type Tx = Prisma.TransactionClient;

const CRITICALITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
const STATUSES = ["IN_SERVICE", "OUT_OF_SERVICE", "RETIRED"] as const;
const DAY_MS = 86_400_000;

function startOfToday(): Date {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return today;
}

/**
 * Delai tenu si les travaux sont faits au plus tard le jour d'echeance : pour
 * un correctif, c'est la remise en service qui compte (pas la cloture
 * administrative de l'OT) ; pour un preventif, la cloture.
 */
function completedOnTime(order: { type: string; completedAt: Date | null; restoredAt: Date | null; dueDate: Date }): boolean | null {
  const doneAt = order.type === "CORRECTIVE" ? order.restoredAt : order.completedAt;
  return doneAt ? doneAt.getTime() < order.dueDate.getTime() + DAY_MS : null;
}

/**
 * INC-15 — Actifs / GMAO (docs/foundation/02-domain-model.md BC-15) :
 * Actif -> Ticket -> OT -> Intervention -> Cloture (backlog §5.10).
 */
@Injectable()
export class AssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly ledger: StockLedgerService,
    private readonly automation: AutomationService,
  ) {}

  // -------------------------------------------------------------------
  // Tableau de bord et actifs
  // -------------------------------------------------------------------

  async summary(scope: CompanyScope): Promise<MaintenanceSummaryView> {
    const today = startOfToday();
    const [assets, openTickets, openWorkOrders, overdueWorkOrders, duePlans, completed, costs, company] = await Promise.all([
      this.prisma.asset.findMany({ where: { ...scope, status: { not: "RETIRED" } }, select: { id: true, installedAt: true, status: true } }),
      this.prisma.maintenanceTicket.count({ where: { ...scope, status: "OPEN" } }),
      this.prisma.workOrder.count({ where: { ...scope, status: { in: ["OPEN", "IN_PROGRESS"] } } }),
      this.prisma.workOrder.count({ where: { ...scope, status: { in: ["OPEN", "IN_PROGRESS"] }, dueDate: { lt: today } } }),
      this.prisma.maintenancePlan.count({ where: { ...scope, active: true, nextDueDate: { lte: today } } }),
      this.prisma.workOrder.findMany({ where: { ...scope, status: "COMPLETED" }, select: { type: true, completedAt: true, restoredAt: true, dueDate: true } }),
      this.prisma.workOrder.aggregate({ where: { ...scope, status: { not: "CANCELLED" } }, _sum: { laborCost: true, partsCost: true } }),
      this.prisma.company.findUniqueOrThrow({ where: { id: scope.companyId }, select: { currency: true } }),
    ]);
    const failures = await this.failures(scope, assets.map((asset) => asset.id));
    const now = new Date();
    // Parc : somme des periodes et indisponibilites de chaque actif (formules identiques, donnees reelles).
    const perAsset = assets.map((asset) => reliability(asset.installedAt, now, failures.get(asset.id) ?? []));
    const period = sumDecimals(perAsset.map((item) => item.periodHours));
    const downtime = sumDecimals(perAsset.map((item) => item.downtimeHours));
    const failureCount = perAsset.reduce((sum, item) => sum + item.failures, 0);
    const repairHours = [...failures.values()].flat().reduce((sum, record) => sum + (record.restoredAt.getTime() - record.failureAt.getTime()), 0) / 3_600_000;
    const onTime = completed.filter((order) => completedOnTime(order) === true).length;
    return {
      assets: assets.length,
      inService: assets.filter((asset) => asset.status === "IN_SERVICE").length,
      openTickets,
      openWorkOrders,
      overdueWorkOrders,
      duePlans,
      onTimeRate: completed.length === 0 ? null : new Prisma.Decimal(onTime).mul(100).div(completed.length).toFixed(1),
      fleet: {
        periodHours: period.toFixed(2),
        downtimeHours: downtime.toFixed(2),
        failures: failureCount,
        mttrHours: failureCount === 0 ? null : new Prisma.Decimal(repairHours).div(failureCount).toFixed(2),
        mtbfHours: failureCount === 0 ? null : period.minus(downtime).div(failureCount).toFixed(2),
        availabilityPercent: period.isZero() ? null : period.minus(downtime).div(period).mul(100).toFixed(2),
        formula: perAsset[0]?.formula ?? "",
      },
      maintenanceCost: money(dec(costs._sum.laborCost).plus(dec(costs._sum.partsCost))),
      currency: company.currency.trim(),
    };
  }

  async listAssets(scope: CompanyScope, query: Record<string, unknown>): Promise<AssetView[]> {
    const status = optionalEnum(query.status, "status", STATUSES);
    const projectId = optionalId(query.projectId, "projectId");
    const assets = await this.prisma.asset.findMany({
      where: { ...scope, ...(status ? { status } : {}), ...(projectId ? { projectId } : {}) },
      orderBy: [{ criticality: "desc" }, { code: "asc" }],
      take: 500,
    });
    return this.assetViews(scope, assets, false);
  }

  async getAsset(scope: CompanyScope, assetId: string): Promise<AssetView> {
    const asset = await this.prisma.asset.findFirst({ where: { id: assetId, ...scope } });
    if (!asset) throw new NotFoundException("Asset not found");
    const [view] = await this.assetViews(scope, [asset], true);
    return view!;
  }

  /** Passeport issu d'une mise en service receptionnee : origine tracee, aucun actif « apparu ». */
  async createFromCommissioning(scope: CompanyScope, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const activityId = requiredId(input.commissioningActivityId, "commissioningActivityId");
    const id = await this.prisma.$transaction(async (tx) => {
      const activity = await tx.commissioningActivity.findFirst({ where: { id: activityId, ...scope }, include: { equipment: true } });
      if (!activity) throw new NotFoundException("Commissioning activity not found");
      if (activity.status !== "ACCEPTED" && activity.status !== "HANDED_OVER") throw new BadRequestException("Only an accepted commissioning creates an asset passport");
      if (activity.equipment.status !== "COMMISSIONED") throw new BadRequestException("The equipment is not commissioned");
      const existing = await tx.asset.findFirst({ where: { equipmentId: activity.equipmentId }, select: { code: true } });
      if (existing) throw new ConflictException(`This equipment already has the passport ${existing.code}`);
      const code = await this.numbering.next(tx, scope, "AST");
      const asset = await tx.asset.create({
        data: {
          ...scope,
          code,
          name: activity.equipment.name,
          projectId: activity.projectId,
          equipmentId: activity.equipmentId,
          commissioningActivityId: activity.id,
          origin: "COMMISSIONING",
          serialNumber: optionalText(input.serialNumber, "serialNumber", 120),
          manufacturer: optionalText(input.manufacturer, "manufacturer", 120) ?? activity.equipment.manufacturer,
          model: optionalText(input.model, "model", 120) ?? activity.equipment.model,
          location: optionalText(input.location, "location", 200) ?? activity.equipment.location ?? "Non précisée",
          installedAt: activity.acceptedAt ?? new Date(),
          warrantyEndsAt: optionalDate(input.warrantyEndsAt, "warrantyEndsAt"),
          criticality: optionalEnum(input.criticality, "criticality", CRITICALITIES) ?? "MEDIUM",
          createdByUserId: actorUserId,
        },
      });
      await writeAudit(tx, scope, actorUserId, "assets.asset.created", "Asset", asset.id, { code, origin: "COMMISSIONING", commissioning: activity.code });
      return asset.id;
    });
    return this.getAsset(scope, id);
  }

  /** Actif preexistant (hors projet) : justification obligatoire de son origine. */
  async createManual(scope: CompanyScope, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const name = requiredText(input.name, "name", 200);
    const location = requiredText(input.location, "location", 200);
    const installedAt = requiredDate(input.installedAt, "installedAt");
    if (installedAt.getTime() > Date.now()) throw new BadRequestException("installedAt cannot be in the future");
    const justification = requiredText(input.originJustification, "originJustification", 1000);
    const id = await this.prisma.$transaction(async (tx) => {
      const code = await this.numbering.next(tx, scope, "AST");
      const asset = await tx.asset.create({
        data: {
          ...scope,
          code,
          name,
          location,
          installedAt,
          origin: "MANUAL",
          originJustification: justification,
          serialNumber: optionalText(input.serialNumber, "serialNumber", 120),
          manufacturer: optionalText(input.manufacturer, "manufacturer", 120),
          model: optionalText(input.model, "model", 120),
          warrantyEndsAt: optionalDate(input.warrantyEndsAt, "warrantyEndsAt"),
          criticality: optionalEnum(input.criticality, "criticality", CRITICALITIES) ?? "MEDIUM",
          createdByUserId: actorUserId,
        },
      });
      await writeAudit(tx, scope, actorUserId, "assets.asset.created", "Asset", asset.id, { code, origin: "MANUAL", justification });
      return asset.id;
    });
    return this.getAsset(scope, id);
  }

  async updateAsset(scope: CompanyScope, assetId: string, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const status = optionalEnum(input.status, "status", STATUSES);
    const criticality = optionalEnum(input.criticality, "criticality", CRITICALITIES);
    await this.prisma.$transaction(async (tx) => {
      const asset = await tx.asset.findFirst({ where: { id: assetId, ...scope } });
      if (!asset) throw new NotFoundException("Asset not found");
      if (asset.status === "RETIRED") throw new BadRequestException("A retired asset is read-only");
      if (status === "RETIRED") {
        const open = await tx.workOrder.count({ where: { assetId, status: { in: ["OPEN", "IN_PROGRESS"] } } });
        if (open > 0) throw new BadRequestException("Close the open work orders before retiring the asset");
      }
      await tx.asset.update({
        where: { id: assetId },
        data: {
          ...(status ? { status } : {}),
          ...(criticality ? { criticality } : {}),
          ...(input.location !== undefined ? { location: requiredText(input.location, "location", 200) } : {}),
          ...(input.serialNumber !== undefined ? { serialNumber: optionalText(input.serialNumber, "serialNumber", 120) } : {}),
          ...(input.warrantyEndsAt !== undefined ? { warrantyEndsAt: optionalDate(input.warrantyEndsAt, "warrantyEndsAt") } : {}),
        },
      });
      await writeAudit(tx, scope, actorUserId, "assets.asset.updated", "Asset", assetId, { status, criticality, from: asset.status });
    });
    return this.getAsset(scope, assetId);
  }

  // -------------------------------------------------------------------
  // Preventif
  // -------------------------------------------------------------------

  async listPlans(scope: CompanyScope, query: Record<string, unknown>): Promise<MaintenancePlanView[]> {
    const assetId = optionalId(query.assetId, "assetId");
    const plans = await this.prisma.maintenancePlan.findMany({
      where: { ...scope, ...(assetId ? { assetId } : {}) },
      include: { asset: { select: { code: true } } },
      orderBy: { nextDueDate: "asc" },
    });
    const today = startOfToday();
    return plans.map((plan) => ({
      id: plan.id,
      assetId: plan.assetId,
      assetCode: plan.asset.code,
      title: plan.title,
      instructions: plan.instructions,
      intervalDays: plan.intervalDays,
      nextDueDate: plan.nextDueDate.toISOString().slice(0, 10),
      due: plan.active && plan.nextDueDate <= today,
      estimatedHours: plan.estimatedHours === null ? null : dec(plan.estimatedHours).toFixed(2),
      active: plan.active,
    }));
  }

  async createPlan(scope: CompanyScope, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const assetId = requiredId(input.assetId, "assetId");
    const title = requiredText(input.title, "title", 200);
    const instructions = requiredText(input.instructions, "instructions", 4000);
    const intervalDays = requiredInt(input.intervalDays, "intervalDays", { min: 1, max: 3650 });
    const firstDueDate = requiredDate(input.firstDueDate, "firstDueDate");
    await this.prisma.$transaction(async (tx) => {
      const asset = await tx.asset.findFirst({ where: { id: assetId, ...scope } });
      if (!asset) throw new NotFoundException("Asset not found");
      if (asset.status === "RETIRED") throw new BadRequestException("The asset is retired");
      const plan = await tx.maintenancePlan.create({
        data: { ...scope, assetId, title, instructions, intervalDays, nextDueDate: firstDueDate, estimatedHours: optionalDecimal(input.estimatedHours, "estimatedHours"), createdByUserId: actorUserId },
      });
      await writeAudit(tx, scope, actorUserId, "assets.plan.created", "MaintenancePlan", plan.id, { assetId, intervalDays });
    });
    return this.listPlans(scope, { assetId });
  }

  /** Generation idempotente des OT preventifs echus (une par echeance, cle plan + date). */
  async generateDue(scope: CompanyScope, body: unknown, actorUserId: string) {
    const horizonDays = requiredInt(assertBody(body ?? {}).horizonDays ?? 0, "horizonDays", { min: 0, max: 90 });
    const limit = new Date(startOfToday().getTime() + horizonDays * DAY_MS);
    const plans = await this.prisma.maintenancePlan.findMany({ where: { ...scope, active: true, nextDueDate: { lte: limit } }, include: { asset: true } });
    const created: string[] = [];
    for (const plan of plans) {
      if (plan.asset.status === "RETIRED") continue;
      await this.prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<Array<{ nextDueDate: Date }>>`SELECT "nextDueDate" FROM "maintenance_plans" WHERE "id" = ${plan.id} FOR UPDATE`;
        let due = rows[0]!.nextDueDate;
        for (let occurrence = 0; occurrence < 12 && due <= limit; occurrence += 1) {
          const exists = await tx.workOrder.findFirst({ where: { planId: plan.id, plannedFor: due }, select: { id: true } });
          if (!exists) {
            const code = await this.numbering.next(tx, scope, "OT");
            await tx.workOrder.create({
              data: { ...scope, code, assetId: plan.assetId, type: "PREVENTIVE", planId: plan.id, plannedFor: due, title: plan.title, instructions: plan.instructions, dueDate: due, createdByUserId: actorUserId },
            });
            created.push(code);
          }
          due = new Date(due.getTime() + plan.intervalDays * DAY_MS);
        }
        await tx.maintenancePlan.update({ where: { id: plan.id }, data: { nextDueDate: due } });
      });
    }
    if (created.length > 0) {
      await this.prisma.$transaction((tx) => writeAudit(tx, scope, actorUserId, "assets.plan.generated", "MaintenancePlan", plans[0]!.id, { workOrders: created }));
    }
    return { created };
  }

  // -------------------------------------------------------------------
  // Tickets
  // -------------------------------------------------------------------

  async listTickets(scope: CompanyScope, query: Record<string, unknown>): Promise<MaintenanceTicketView[]> {
    const status = optionalEnum(query.status, "status", ["OPEN", "CONVERTED", "REJECTED"] as const);
    const tickets = await this.prisma.maintenanceTicket.findMany({ where: { ...scope, ...(status ? { status } : {}) }, orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 300 });
    const [assets, workOrders, users] = await Promise.all([
      this.prisma.asset.findMany({ where: { id: { in: tickets.map((ticket) => ticket.assetId) }, ...scope }, select: { id: true, code: true, name: true } }),
      this.prisma.workOrder.findMany({ where: { ticketId: { in: tickets.map((ticket) => ticket.id) }, ...scope }, select: { id: true, code: true, ticketId: true } }),
      this.userNames(scope, tickets.map((ticket) => ticket.reportedByUserId)),
    ]);
    const assetById = new Map(assets.map((asset) => [asset.id, asset]));
    return tickets.map((ticket) => {
      const order = workOrders.find((candidate) => candidate.ticketId === ticket.id);
      return {
        id: ticket.id,
        code: ticket.code,
        assetId: ticket.assetId,
        assetCode: assetById.get(ticket.assetId)?.code ?? "—",
        assetName: assetById.get(ticket.assetId)?.name ?? "—",
        title: ticket.title,
        description: ticket.description,
        priority: ticket.priority,
        failureAt: ticket.failureAt?.toISOString() ?? null,
        status: ticket.status,
        reportedByName: users.get(ticket.reportedByUserId) ?? "—",
        createdAt: ticket.createdAt.toISOString(),
        workOrderId: order?.id ?? null,
        workOrderCode: order?.code ?? null,
        decisionNote: ticket.decisionNote,
      };
    });
  }

  async createTicket(scope: CompanyScope, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const assetId = requiredId(input.assetId, "assetId");
    const failureAt = optionalDate(input.failureAt, "failureAt");
    if (failureAt && failureAt.getTime() > Date.now() + 5 * 60_000) throw new BadRequestException("failureAt cannot be in the future");
    await this.prisma.$transaction(async (tx) => {
      const asset = await tx.asset.findFirst({ where: { id: assetId, ...scope } });
      if (!asset) throw new NotFoundException("Asset not found");
      if (asset.status === "RETIRED") throw new BadRequestException("The asset is retired");
      if (failureAt && failureAt < asset.installedAt) throw new BadRequestException("failureAt precedes the asset's entry into service");
      const code = await this.numbering.next(tx, scope, "TKT");
      const ticket = await tx.maintenanceTicket.create({
        data: {
          ...scope,
          code,
          assetId,
          title: requiredText(input.title, "title", 200),
          description: requiredText(input.description, "description", 4000),
          priority: optionalEnum(input.priority, "priority", PRIORITIES) ?? "NORMAL",
          failureAt,
          reportedByUserId: actorUserId,
        },
      });
      if (failureAt && input.outOfService === true) await tx.asset.update({ where: { id: assetId }, data: { status: "OUT_OF_SERVICE" } });
      await writeAudit(tx, scope, actorUserId, "assets.ticket.created", "MaintenanceTicket", ticket.id, { code, assetId, failureAt: failureAt?.toISOString() ?? null });
      await this.automation.emit(tx, scope, { type: "assets.ticket.created", resourceId: ticket.id, actorUserId, link: `/assets/${assetId}`, payload: { code, title: ticket.title, priority: ticket.priority, assetCode: asset.code } });
    });
    return this.listTickets(scope, {});
  }

  /** Transition explicite ticket -> OT correctif (la defaillance du ticket devient le debut d'indisponibilite). */
  async convertTicket(scope: CompanyScope, ticketId: string, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const dueDate = requiredDate(input.dueDate, "dueDate");
    const assignedEmployeeId = optionalId(input.assignedEmployeeId, "assignedEmployeeId");
    const id = await this.prisma.$transaction(async (tx) => {
      const ticket = await tx.maintenanceTicket.findFirst({ where: { id: ticketId, ...scope } });
      if (!ticket) throw new NotFoundException("Ticket not found");
      if (ticket.status !== "OPEN") throw new BadRequestException("Only an open ticket can be converted");
      if (assignedEmployeeId) await this.requireEmployee(tx, scope, assignedEmployeeId);
      const code = await this.numbering.next(tx, scope, "OT");
      const order = await tx.workOrder.create({
        data: {
          ...scope,
          code,
          assetId: ticket.assetId,
          type: "CORRECTIVE",
          ticketId: ticket.id,
          title: ticket.title,
          instructions: optionalText(input.instructions, "instructions", 4000) ?? ticket.description,
          priority: ticket.priority,
          dueDate,
          assignedEmployeeId,
          failureAt: ticket.failureAt,
          createdByUserId: actorUserId,
        },
      });
      await tx.maintenanceTicket.update({ where: { id: ticket.id }, data: { status: "CONVERTED", decidedByUserId: actorUserId, decidedAt: new Date() } });
      await writeAudit(tx, scope, actorUserId, "assets.ticket.converted", "MaintenanceTicket", ticket.id, { ticket: ticket.code, workOrder: code });
      return order.id;
    });
    return this.getWorkOrder(scope, id);
  }

  async rejectTicket(scope: CompanyScope, ticketId: string, body: unknown, actorUserId: string) {
    const note = requiredText(assertBody(body ?? {}).note, "note", 1000);
    await this.prisma.$transaction(async (tx) => {
      const ticket = await tx.maintenanceTicket.findFirst({ where: { id: ticketId, ...scope } });
      if (!ticket) throw new NotFoundException("Ticket not found");
      if (ticket.status !== "OPEN") throw new BadRequestException("Only an open ticket can be rejected");
      await tx.maintenanceTicket.update({ where: { id: ticketId }, data: { status: "REJECTED", decidedByUserId: actorUserId, decidedAt: new Date(), decisionNote: note } });
      await writeAudit(tx, scope, actorUserId, "assets.ticket.rejected", "MaintenanceTicket", ticketId, { note });
    });
    return this.listTickets(scope, {});
  }

  // -------------------------------------------------------------------
  // Ordres de travail
  // -------------------------------------------------------------------

  async listWorkOrders(scope: CompanyScope, query: Record<string, unknown>): Promise<WorkOrderView[]> {
    const status = optionalEnum(query.status, "status", ["OPEN", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const);
    const assetId = optionalId(query.assetId, "assetId");
    const orders = await this.prisma.workOrder.findMany({
      where: { ...scope, ...(status ? { status } : {}), ...(assetId ? { assetId } : {}) },
      orderBy: [{ status: "asc" }, { dueDate: "asc" }],
      take: 300,
    });
    return this.workOrderViews(scope, orders, false);
  }

  async getWorkOrder(scope: CompanyScope, workOrderId: string): Promise<WorkOrderView> {
    const order = await this.prisma.workOrder.findFirst({ where: { id: workOrderId, ...scope } });
    if (!order) throw new NotFoundException("Work order not found");
    const [view] = await this.workOrderViews(scope, [order], true);
    return view!;
  }

  async startWorkOrder(scope: CompanyScope, workOrderId: string, body: unknown, actorUserId: string) {
    const assignedEmployeeId = optionalId(assertBody(body ?? {}).assignedEmployeeId, "assignedEmployeeId");
    await this.prisma.$transaction(async (tx) => {
      const order = await this.lockWorkOrder(tx, scope, workOrderId);
      if (order.status !== "OPEN") throw new BadRequestException("Only an open work order can be started");
      if (assignedEmployeeId) await this.requireEmployee(tx, scope, assignedEmployeeId);
      await tx.workOrder.update({ where: { id: workOrderId }, data: { status: "IN_PROGRESS", startedAt: new Date(), ...(assignedEmployeeId ? { assignedEmployeeId } : {}) } });
      await writeAudit(tx, scope, actorUserId, "assets.workorder.started", "WorkOrder", workOrderId, { code: order.code });
    });
    return this.getWorkOrder(scope, workOrderId);
  }

  /** Temps d'un employe RH : cout fige au cout horaire de l'employe au moment de la saisie. */
  async addLabor(scope: CompanyScope, workOrderId: string, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const employeeId = requiredId(input.employeeId, "employeeId");
    const workDate = requiredDate(input.workDate, "workDate");
    const hours = requiredDecimal(input.hours, "hours", { positive: true });
    if (hours.greaterThan(24)) throw new BadRequestException("hours must be <= 24");
    await this.prisma.$transaction(async (tx) => {
      const order = await this.lockWorkOrder(tx, scope, workOrderId);
      if (order.status !== "IN_PROGRESS") throw new BadRequestException("Time is recorded on a started work order");
      const employee = await this.requireEmployee(tx, scope, employeeId);
      const cost = hours.mul(employee.hourlyCost).toDecimalPlaces(2);
      await tx.workOrderLabor.create({ data: { ...scope, workOrderId, employeeId, workDate, hours, hourlyCost: employee.hourlyCost, cost, recordedByUserId: actorUserId } });
      await tx.workOrder.update({ where: { id: workOrderId }, data: { laborCost: dec(order.laborCost).plus(cost) } });
      await writeAudit(tx, scope, actorUserId, "assets.workorder.labor", "WorkOrder", workOrderId, { employeeId, hours: hours.toFixed(2), cost: money(cost) });
    });
    return this.getWorkOrder(scope, workOrderId);
  }

  /** Piece consommee : sortie du grand livre de stock (MAINTENANCE_ISSUE), cout moyen pondere. */
  async addPart(scope: CompanyScope, workOrderId: string, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const itemId = requiredId(input.itemId, "itemId");
    const warehouseId = requiredId(input.warehouseId, "warehouseId");
    const quantity = requiredDecimal(input.quantity, "quantity", { positive: true });
    await this.prisma.$transaction(async (tx) => {
      const order = await this.lockWorkOrder(tx, scope, workOrderId);
      if (order.status !== "IN_PROGRESS") throw new BadRequestException("Parts are consumed on a started work order");
      const movement = await this.ledger.post(tx, scope, {
        itemId,
        warehouseId,
        type: "MAINTENANCE_ISSUE",
        quantity,
        reference: order.code,
        reason: `Maintenance ${order.code}`,
        actorUserId,
      });
      const cost = movement.valueDelta.abs();
      await tx.workOrderPart.create({ data: { ...scope, workOrderId, stockMovementId: movement.id, itemId, warehouseId, quantity, cost, recordedByUserId: actorUserId } });
      await tx.workOrder.update({ where: { id: workOrderId }, data: { partsCost: dec(order.partsCost).plus(cost) } });
      await writeAudit(tx, scope, actorUserId, "assets.workorder.part", "WorkOrder", workOrderId, { itemId, quantity: qty(quantity), cost: money(cost), stockMovementId: movement.id });
    });
    return this.getWorkOrder(scope, workOrderId);
  }

  /** Cloture : compte-rendu et temps saisi obligatoires ; un correctif indique sa remise en service. */
  async completeWorkOrder(scope: CompanyScope, workOrderId: string, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const report = requiredText(input.report, "report", 8000);
    const restoredAt = optionalDate(input.restoredAt, "restoredAt");
    await this.prisma.$transaction(async (tx) => {
      const order = await this.lockWorkOrder(tx, scope, workOrderId);
      if (order.status !== "IN_PROGRESS") throw new BadRequestException("Only a started work order can be completed");
      const labor = await tx.workOrderLabor.count({ where: { workOrderId } });
      if (labor === 0) throw new BadRequestException("Record the intervention time before closing");
      if (order.type === "CORRECTIVE") {
        if (!order.failureAt) throw new BadRequestException("A corrective work order needs the failure time of its ticket");
        if (!restoredAt || restoredAt <= order.failureAt) throw new BadRequestException("restoredAt must be after the failure time");
        if (restoredAt.getTime() > Date.now() + 5 * 60_000) throw new BadRequestException("restoredAt cannot be in the future");
      }
      await tx.workOrder.update({
        where: { id: workOrderId },
        data: { status: "COMPLETED", completedAt: new Date(), completionReport: report, completedByUserId: actorUserId, ...(order.type === "CORRECTIVE" ? { restoredAt } : {}) },
      });
      if (order.type === "CORRECTIVE") await tx.asset.updateMany({ where: { id: order.assetId, status: "OUT_OF_SERVICE" }, data: { status: "IN_SERVICE" } });
      await writeAudit(tx, scope, actorUserId, "assets.workorder.completed", "WorkOrder", workOrderId, { code: order.code, restoredAt: restoredAt?.toISOString() ?? null });
    });
    return this.getWorkOrder(scope, workOrderId);
  }

  async cancelWorkOrder(scope: CompanyScope, workOrderId: string, body: unknown, actorUserId: string) {
    const reason = requiredText(assertBody(body ?? {}).reason, "reason", 1000);
    await this.prisma.$transaction(async (tx) => {
      const order = await this.lockWorkOrder(tx, scope, workOrderId);
      if (order.status === "COMPLETED" || order.status === "CANCELLED") throw new BadRequestException("The work order is closed");
      const [labor, parts] = await Promise.all([tx.workOrderLabor.count({ where: { workOrderId } }), tx.workOrderPart.count({ where: { workOrderId } })]);
      if (labor + parts > 0) throw new BadRequestException("Time or parts are recorded: complete the work order instead");
      await tx.workOrder.update({ where: { id: workOrderId }, data: { status: "CANCELLED", completionReport: `Annulé : ${reason}` } });
      await writeAudit(tx, scope, actorUserId, "assets.workorder.cancelled", "WorkOrder", workOrderId, { reason });
    });
    return this.getWorkOrder(scope, workOrderId);
  }

  // -------------------------------------------------------------------
  // Internes
  // -------------------------------------------------------------------

  private async failures(scope: CompanyScope, assetIds: string[]): Promise<Map<string, FailureRecord[]>> {
    const orders = await this.prisma.workOrder.findMany({
      where: { ...scope, assetId: { in: assetIds }, type: "CORRECTIVE", status: "COMPLETED", failureAt: { not: null }, restoredAt: { not: null } },
      select: { assetId: true, failureAt: true, restoredAt: true },
    });
    const map = new Map<string, FailureRecord[]>();
    for (const order of orders) map.set(order.assetId, [...(map.get(order.assetId) ?? []), { failureAt: order.failureAt!, restoredAt: order.restoredAt! }]);
    return map;
  }

  private async assetViews(scope: CompanyScope, assets: Prisma.AssetGetPayload<object>[], detailed: boolean): Promise<AssetView[]> {
    const ids = assets.map((asset) => asset.id);
    const [failures, openCounts, costs, projects, equipment, activities, company] = await Promise.all([
      this.failures(scope, ids),
      this.prisma.workOrder.groupBy({ by: ["assetId"], where: { ...scope, assetId: { in: ids }, status: { in: ["OPEN", "IN_PROGRESS"] } }, _count: { _all: true } }),
      this.prisma.workOrder.groupBy({ by: ["assetId"], where: { ...scope, assetId: { in: ids }, status: { not: "CANCELLED" } }, _sum: { laborCost: true, partsCost: true } }),
      this.prisma.project.findMany({ where: { id: { in: assets.map((asset) => asset.projectId).filter((id): id is string => Boolean(id)) }, ...scope }, select: { id: true, code: true } }),
      this.prisma.mepEquipment.findMany({ where: { id: { in: assets.map((asset) => asset.equipmentId).filter((id): id is string => Boolean(id)) }, ...scope }, select: { id: true, tag: true } }),
      this.prisma.commissioningActivity.findMany({
        where: { id: { in: assets.map((asset) => asset.commissioningActivityId).filter((id): id is string => Boolean(id)) }, ...scope },
        include: { documents: true },
      }),
      this.prisma.company.findUniqueOrThrow({ where: { id: scope.companyId }, select: { currency: true } }),
    ]);
    const now = new Date();
    const documentIds = activities.flatMap((activity) => activity.documents.map((link) => link.documentId));
    const documents = detailed && documentIds.length ? await this.prisma.managedDocument.findMany({ where: { id: { in: documentIds }, ...scope }, select: { id: true, code: true, title: true } }) : [];
    const views: AssetView[] = [];
    for (const asset of assets) {
      const activity = activities.find((candidate) => candidate.id === asset.commissioningActivityId);
      const cost = costs.find((row) => row.assetId === asset.id);
      const view: AssetView = {
        id: asset.id,
        code: asset.code,
        name: asset.name,
        projectId: asset.projectId,
        projectCode: projects.find((project) => project.id === asset.projectId)?.code ?? null,
        equipmentId: asset.equipmentId,
        equipmentTag: equipment.find((item) => item.id === asset.equipmentId)?.tag ?? null,
        commissioningActivityId: asset.commissioningActivityId,
        commissioningCode: activity?.code ?? null,
        origin: asset.origin,
        originJustification: asset.originJustification,
        serialNumber: asset.serialNumber,
        manufacturer: asset.manufacturer,
        model: asset.model,
        location: asset.location,
        installedAt: asset.installedAt.toISOString(),
        warrantyEndsAt: asset.warrantyEndsAt?.toISOString() ?? null,
        underWarranty: asset.warrantyEndsAt !== null && asset.warrantyEndsAt > now,
        criticality: asset.criticality,
        status: asset.status,
        openWorkOrders: openCounts.find((row) => row.assetId === asset.id)?._count._all ?? 0,
        reliability: reliability(asset.installedAt, now, failures.get(asset.id) ?? []) as ReliabilityView,
        maintenanceCost: money(dec(cost?._sum.laborCost).plus(dec(cost?._sum.partsCost))),
        currency: company.currency.trim(),
      };
      if (detailed) {
        view.documents = activity ? documents.filter((document) => activity.documents.some((link) => link.documentId === document.id)) : [];
        view.plans = await this.listPlans(scope, { assetId: asset.id });
        view.workOrders = await this.listWorkOrders(scope, { assetId: asset.id });
      }
      views.push(view);
    }
    return views;
  }

  private async workOrderViews(scope: CompanyScope, orders: Prisma.WorkOrderGetPayload<object>[], detailed: boolean): Promise<WorkOrderView[]> {
    const today = startOfToday();
    const [assets, tickets, employees, company] = await Promise.all([
      this.prisma.asset.findMany({ where: { id: { in: orders.map((order) => order.assetId) }, ...scope }, select: { id: true, code: true, name: true } }),
      this.prisma.maintenanceTicket.findMany({ where: { id: { in: orders.map((order) => order.ticketId).filter((id): id is string => Boolean(id)) }, ...scope }, select: { id: true, code: true } }),
      this.prisma.employee.findMany({ where: { id: { in: orders.map((order) => order.assignedEmployeeId).filter((id): id is string => Boolean(id)) }, ...scope }, select: { id: true, firstName: true, lastName: true } }),
      this.prisma.company.findUniqueOrThrow({ where: { id: scope.companyId }, select: { currency: true } }),
    ]);
    const views: WorkOrderView[] = [];
    for (const order of orders) {
      const employee = employees.find((candidate) => candidate.id === order.assignedEmployeeId);
      const asset = assets.find((candidate) => candidate.id === order.assetId);
      const view: WorkOrderView = {
        id: order.id,
        code: order.code,
        assetId: order.assetId,
        assetCode: asset?.code ?? "—",
        assetName: asset?.name ?? "—",
        type: order.type,
        ticketId: order.ticketId,
        ticketCode: tickets.find((ticket) => ticket.id === order.ticketId)?.code ?? null,
        planId: order.planId,
        plannedFor: order.plannedFor?.toISOString().slice(0, 10) ?? null,
        title: order.title,
        instructions: order.instructions,
        priority: order.priority,
        dueDate: order.dueDate.toISOString(),
        overdue: (order.status === "OPEN" || order.status === "IN_PROGRESS") && order.dueDate < today,
        status: order.status,
        assignedEmployeeId: order.assignedEmployeeId,
        assignedEmployeeName: employee ? `${employee.firstName} ${employee.lastName}` : null,
        failureAt: order.failureAt?.toISOString() ?? null,
        restoredAt: order.restoredAt?.toISOString() ?? null,
        startedAt: order.startedAt?.toISOString() ?? null,
        completedAt: order.completedAt?.toISOString() ?? null,
        completionReport: order.completionReport,
        completedOnTime: completedOnTime(order),
        laborCost: money(order.laborCost),
        partsCost: money(order.partsCost),
        totalCost: money(dec(order.laborCost).plus(order.partsCost)),
        currency: company.currency.trim(),
      };
      if (detailed) {
        const [labor, parts] = await Promise.all([
          this.prisma.workOrderLabor.findMany({ where: { workOrderId: order.id }, orderBy: { createdAt: "asc" } }),
          this.prisma.workOrderPart.findMany({ where: { workOrderId: order.id }, orderBy: { createdAt: "asc" } }),
        ]);
        const [laborEmployees, items, warehouses] = await Promise.all([
          this.prisma.employee.findMany({ where: { id: { in: labor.map((line) => line.employeeId) }, ...scope }, select: { id: true, firstName: true, lastName: true } }),
          this.prisma.inventoryItem.findMany({ where: { id: { in: parts.map((part) => part.itemId) }, ...scope }, select: { id: true, code: true, name: true, unitCode: true } }),
          this.prisma.warehouse.findMany({ where: { id: { in: parts.map((part) => part.warehouseId) }, ...scope }, select: { id: true, code: true } }),
        ]);
        view.labor = labor.map((line) => {
          const person = laborEmployees.find((candidate) => candidate.id === line.employeeId);
          return { id: line.id, employeeName: person ? `${person.firstName} ${person.lastName}` : "—", workDate: line.workDate.toISOString().slice(0, 10), hours: dec(line.hours).toFixed(2), hourlyCost: money(line.hourlyCost), cost: money(line.cost) };
        });
        view.parts = parts.map((part) => {
          const item = items.find((candidate) => candidate.id === part.itemId);
          return {
            id: part.id,
            itemCode: item?.code ?? "—",
            itemName: item?.name ?? "—",
            warehouseCode: warehouses.find((candidate) => candidate.id === part.warehouseId)?.code ?? "—",
            quantity: qty(part.quantity),
            unitCode: item?.unitCode ?? "",
            cost: money(part.cost),
            stockMovementId: part.stockMovementId,
          };
        });
      }
      views.push(view);
    }
    return views;
  }

  private async lockWorkOrder(tx: Tx, scope: CompanyScope, workOrderId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "work_orders"
      WHERE "id" = ${workOrderId} AND "organizationId" = ${scope.organizationId} AND "companyId" = ${scope.companyId}
      FOR UPDATE
    `;
    if (rows.length === 0) throw new NotFoundException("Work order not found");
    return tx.workOrder.findUniqueOrThrow({ where: { id: workOrderId } });
  }

  private async requireEmployee(tx: Tx, scope: CompanyScope, employeeId: string) {
    const employee = await tx.employee.findFirst({ where: { id: employeeId, ...scope } });
    if (!employee) throw new NotFoundException("Employee not found");
    if (employee.status !== "ACTIVE") throw new BadRequestException(`Employee is ${employee.status}`);
    return employee;
  }

  private async userNames(scope: CompanyScope, ids: string[]): Promise<Map<string, string>> {
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(ids)] }, organizationId: scope.organizationId }, select: { id: true, fullName: true } });
    return new Map(users.map((user) => [user.id, user.fullName]));
  }
}
