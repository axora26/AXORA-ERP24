import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@axora24/database";
import { ASSETS_PERMISSIONS, FLEET_PERMISSIONS, HR_PERMISSIONS, INVENTORY_PERMISSIONS, PROCUREMENT_PERMISSIONS, SUBCONTRACTING_PERMISSIONS, type ProjectOperationsCostFigure, type ProjectOperationsView } from "@axora24/contracts";
import type { CompanyScope } from "../common/company-scope.service.js";
import { dec, money, qty, sumDecimals } from "../common/decimal.js";
import { PrismaService } from "../core/prisma.service.js";
import { projectPresence } from "../hr/project-presence.js";

const DAY_MS = 86_400_000;
/** Strict calendar dates prevent normalized impossible dates and unbounded reporting. */
export function operationsRange(query: Record<string, unknown>, now = new Date()) {
  if (Object.keys(query).some((key) => !["from", "to", "companyId"].includes(key))) throw new BadRequestException("Unknown operations filter");
  const parse = (value: unknown, field: string): Date => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException(`${field} must be YYYY-MM-DD`);
    const date = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new BadRequestException(`${field} must be a valid calendar date`);
    return date;
  };
  const last = query.to === undefined ? parse(now.toISOString().slice(0, 10), "to") : parse(query.to, "to");
  const from = query.from === undefined ? new Date(last.getTime() - 6 * DAY_MS) : parse(query.from, "from");
  const to = new Date(last.getTime() + DAY_MS);
  const days = (to.getTime() - from.getTime()) / DAY_MS;
  if (days < 1 || days > 31) throw new BadRequestException("Operations range must cover between 1 and 31 inclusive days");
  return { from, to, fromLabel: from.toISOString().slice(0, 10), toLabel: last.toISOString().slice(0, 10) };
}

const hidden = (source: string): ProjectOperationsCostFigure => ({ amount: null, available: false, source });
const figure = (amount: Prisma.Decimal, source: string): ProjectOperationsCostFigure => ({ amount: money(amount), available: true, source });

/** Each source is queried only with its own effective company permission. */
@Injectable()
export class ProjectOperationsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(scope: CompanyScope, projectId: string, query: Record<string, unknown>, permissions: Set<string>): Promise<ProjectOperationsView> {
    const range = operationsRange(query);
    const dateFilter = { gte: range.from, lt: range.to };
    const has = (key: string) => permissions.has(key);
    const employeeRead = has(HR_PERMISSIONS.EMPLOYEE_READ);
    const payrollRead = has(HR_PERMISSIONS.PAYROLL_READ);
    const stockRead = has(INVENTORY_PERMISSIONS.ITEM_READ);
    const fleetRead = has(FLEET_PERMISSIONS.READ);
    const assetRead = has(ASSETS_PERMISSIONS.ASSET_READ);
    const receiptRead = has(PROCUREMENT_PERMISSIONS.ORDER_READ);
    const subcontractRead = has(SUBCONTRACTING_PERMISSIONS.READ);
    const asOf = new Date().toISOString();

    return this.prisma.$transaction(async (tx) => {
      const project = await tx.project.findFirst({ where: { ...scope, id: projectId }, select: { id: true, currency: true } });
      if (!project) throw new NotFoundException("Project not found");
      const currency = project.currency.trim();
      const [attendance, entries, labor, movements, balances, assignments, assets, receipts, statements] = await Promise.all([
        employeeRead ? projectPresence(tx, scope, projectId, range.from, range.to) : null,
        employeeRead ? tx.timesheetEntry.findMany({
          where: { ...scope, projectId, workDate: dateFilter, timesheet: scope },
          select: { id: true, workDate: true, hours: true, description: true, wbsItemId: true, ...(payrollRead ? { costAmount: true } : {}), timesheet: { select: { status: true, employee: { select: { id: true, code: true, firstName: true, lastName: true, currency: true } } } } },
          orderBy: [{ workDate: "asc" }, { id: "asc" }],
        }) : null,
        payrollRead ? tx.timesheetEntry.findMany({
          where: { ...scope, projectId, workDate: dateFilter, timesheet: { ...scope, status: "VALIDATED" } },
          select: { costAmount: true, timesheet: { select: { employee: { select: { currency: true } } } } },
        }) : null,
        stockRead ? tx.stockMovement.findMany({
          where: { ...scope, projectId, type: { in: ["ISSUE", "RETURN"] }, createdAt: dateFilter },
          include: { item: { select: { code: true, name: true, unitCode: true } }, warehouse: { select: { name: true } } },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        }) : null,
        stockRead ? tx.stockBalance.findMany({
          where: { ...scope, warehouse: { ...scope, projectId, kind: "SITE" } },
          include: { item: { select: { code: true, name: true, unitCode: true } }, warehouse: { select: { name: true } } },
          orderBy: [{ warehouseId: "asc" }, { itemId: "asc" }],
        }) : null,
        fleetRead ? tx.fleetAssignment.findMany({
          where: { ...scope, projectId, startAt: { lt: range.to }, OR: [{ endAt: null }, { endAt: { gt: range.from } }] },
          select: { id: true, code: true, vehicleId: true, purpose: true, startAt: true, endAt: true, vehicle: { select: { code: true, make: true, model: true } }, ...(employeeRead ? { employeeId: true, employee: { select: { firstName: true, lastName: true } } } : {}) },
          orderBy: [{ startAt: "asc" }, { id: "asc" }],
        }) : null,
        assetRead ? tx.asset.findMany({ where: { ...scope, projectId }, select: { id: true, code: true, name: true, status: true, location: true }, orderBy: [{ code: "asc" }, { id: "asc" }] }) : null,
        receiptRead ? tx.goodsReceiptLine.findMany({
          where: { receipt: { ...scope, receivedAt: { lt: range.to } }, orderLine: { ...scope, projectId, inventoryItemId: null, order: { ...scope, status: { in: ["ISSUED", "PARTIALLY_RECEIVED", "RECEIVED"] } } } },
          select: { quantity: true, receipt: { select: { receivedAt: true } }, orderLine: { select: { id: true, unitPrice: true, order: { select: { currency: true } } } } },
        }) : null,
        subcontractRead ? tx.subcontractStatement.findMany({
          where: { ...scope, status: "APPROVED", decidedAt: dateFilter, package: { ...scope, projectId } },
          select: { grossAmount: true, package: { select: { purchaseOrder: { select: { currency: true } } } } },
        }) : null,
      ]);

      const materialAmount = sumDecimals((movements ?? []).map((row) => row.valueDelta)).negated();
      const laborMixed = labor?.some((row) => row.timesheet.employee.currency.trim() !== currency) ?? false;
      const laborUnvalued = labor?.some((row) => row.costAmount === null) ?? false;
      const laborAmount = sumDecimals((labor ?? []).map((row) => row.costAmount));
      const receiptsInRange = (receipts ?? []).filter((row) => row.receipt.receivedAt >= range.from);
      const receiptsMixed = receiptsInRange.some((row) => row.orderLine.order.currency.trim() !== currency);
      // Cumulative rounded deltas reconcile split receipts with the project cockpit.
      const directByLine = new Map<string, { before: Prisma.Decimal; through: Prisma.Decimal; price: Prisma.Decimal }>();
      const affectedLines = new Set(receiptsInRange.map((row) => row.orderLine.id));
      for (const row of receipts ?? []) {
        if (!affectedLines.has(row.orderLine.id)) continue;
        const totals = directByLine.get(row.orderLine.id) ?? { before: dec(0), through: dec(0), price: row.orderLine.unitPrice };
        totals.through = totals.through.plus(row.quantity);
        if (row.receipt.receivedAt < range.from) totals.before = totals.before.plus(row.quantity);
        directByLine.set(row.orderLine.id, totals);
      }
      const directAmount = sumDecimals([...directByLine.values()].map((totals) => totals.through.mul(totals.price).toDecimalPlaces(2).minus(totals.before.mul(totals.price).toDecimalPlaces(2))));
      const statementsMixed = statements?.some((row) => row.package.purchaseOrder.currency.trim() !== currency) ?? false;
      const materialFigure = stockRead ? figure(materialAmount, "Sorties de stock nettes des retours sur la période") : hidden("Permission Stock requise");
      const laborFigure = !payrollRead ? hidden("Permission Paie requise") : laborMixed ? hidden("Temps validés : devises différentes, conversion non configurée") : laborUnvalued ? hidden("Temps validés sans valorisation figée") : figure(laborAmount, "Coûts figés des temps validés, selon la date travaillée");
      const receiptFigure = !receiptRead ? hidden("Permission Commandes requise") : receiptsMixed ? hidden("Réceptions directes : devises différentes, conversion non configurée") : figure(directAmount, "Réceptions directes hors stock sur la période (HT)");
      const subcontractFigure = !subcontractRead ? hidden("Permission Sous-traitance requise") : statementsMixed ? hidden("Situations : devises différentes, conversion non configurée") : figure(sumDecimals((statements ?? []).map((row) => row.grossAmount)), "Situations de sous-traitance certifiées sur la période (HT)");
      const components = [materialFigure, laborFigure, receiptFigure, subcontractFigure];
      const total = components.every((component) => component.available) ? figure(sumDecimals(components.map((component) => component.amount)), "Coût consommé de la période : stock + temps validés + réceptions directes + situations certifiées") : hidden("Total indisponible : une source est protégée, non valorisée ou dans une autre devise");

      return {
        projectId, from: range.fromLabel, to: range.toLabel, timezone: "UTC", currency, attendance,
        timesheets: entries === null ? null : {
          rows: entries.map((row) => ({ id: row.id, employeeId: row.timesheet.employee.id, employeeCode: row.timesheet.employee.code, employeeName: `${row.timesheet.employee.firstName} ${row.timesheet.employee.lastName}`, date: row.workDate.toISOString().slice(0, 10), hours: dec(row.hours).toFixed(2), status: row.timesheet.status, description: row.description, wbsItemId: row.wbsItemId, costAmount: payrollRead && row.costAmount !== null && row.timesheet.status === "VALIDATED" && row.timesheet.employee.currency.trim() === currency ? money(row.costAmount) : null })),
          validatedHours: sumDecimals(entries.filter((row) => row.timesheet.status === "VALIDATED").map((row) => row.hours)).toFixed(2), validatedCost: laborFigure.amount,
        },
        materials: movements === null ? null : {
          rows: movements.map((row) => ({ id: row.id, itemId: row.itemId, itemCode: row.item.code, itemName: row.item.name, unitCode: row.item.unitCode, warehouseId: row.warehouseId, warehouseName: row.warehouse.name, date: row.createdAt.toISOString(), type: row.type as "ISSUE" | "RETURN", quantityDelta: qty(row.quantityDelta), valueDelta: money(row.valueDelta), unitCost: dec(row.unitCost).toFixed(4), wbsItemId: row.wbsItemId, reference: row.reference })),
          netCost: money(materialAmount), siteBalances: (balances ?? []).map((row) => ({ itemId: row.itemId, itemCode: row.item.code, itemName: row.item.name, unitCode: row.item.unitCode, warehouseId: row.warehouseId, warehouseName: row.warehouse.name, quantity: qty(row.quantity), value: money(row.value) })), balancesAsOf: asOf,
        },
        equipment: !fleetRead && !assetRead ? null : {
          fleetAssignments: assignments === null ? null : assignments.map((row) => ({ id: row.id, vehicleId: row.vehicleId, code: row.vehicle.code, name: `${row.vehicle.make} ${row.vehicle.model}`, employeeId: employeeRead ? row.employeeId : null, employeeName: employeeRead && row.employee ? `${row.employee.firstName} ${row.employee.lastName}` : null, startAt: row.startAt.toISOString(), endAt: row.endAt?.toISOString() ?? null, purpose: row.purpose })),
          assets: assets === null ? null : assets.map((row) => ({ ...row, source: "PROJECT_ORIGIN" as const })),
        },
        costs: { materials: materialFigure, labor: laborFigure, directReceipts: receiptFigure, subcontract: subcontractFigure, total },
        actions: { recordAttendance: employeeRead && has(HR_PERMISSIONS.ATTENDANCE_CREATE), manageTimesheets: employeeRead && has(HR_PERMISSIONS.TIMESHEET_MANAGE), recordStockMovement: stockRead && has(INVENTORY_PERMISSIONS.MOVEMENT_CREATE), manageFleetAssignments: fleetRead && has(FLEET_PERMISSIONS.ASSIGN) },
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
}
