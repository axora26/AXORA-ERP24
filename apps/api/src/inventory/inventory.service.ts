import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Prisma } from "@axora24/database";
import type {
  InventoryItemView,
  StockBalanceView,
  StockCountView,
  StockMovementView,
  WarehouseView,
} from "@axora24/contracts";
import { PrismaService } from "../core/prisma.service.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import { NumberingService } from "../common/numbering.service.js";
import { writeAudit } from "../common/audit.js";
import { dec, money, qty, sumDecimals } from "../common/decimal.js";
import {
  assertBody,
  optionalBoolean,
  optionalDecimal,
  optionalEnum,
  optionalId,
  optionalInt,
  optionalText,
  requiredDecimal,
  requiredId,
  requiredText,
} from "../common/validation.js";
import { StockLedgerService } from "./stock-ledger.service.js";

type Tx = Prisma.TransactionClient;

/**
 * INC-07 — Stock & Logistique (docs/foundation/02-domain-model.md BC-06).
 * Toutes les ecritures de mouvements passent par StockLedgerService.
 */
@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly ledger: StockLedgerService,
  ) {}

  // ---------------------------------------------------------------------
  // Articles et magasins
  // ---------------------------------------------------------------------

  async listItems(scope: CompanyScope): Promise<InventoryItemView[]> {
    const items = await this.prisma.inventoryItem.findMany({
      where: scope,
      include: { balances: { select: { quantity: true, value: true } } },
      orderBy: { code: "asc" },
    });
    return items.map((item) => {
      const quantity = sumDecimals(item.balances.map((balance) => balance.quantity));
      const value = sumDecimals(item.balances.map((balance) => balance.value));
      return {
        id: item.id,
        code: item.code,
        name: item.name,
        unitCode: item.unitCode,
        category: item.category,
        barcode: item.barcode,
        minStock: qty(item.minStock),
        isActive: item.isActive,
        totalQuantity: qty(quantity),
        totalValue: money(value),
        averageCost: quantity.isZero() ? null : value.div(quantity).toFixed(4),
        belowMinimum: dec(item.minStock).greaterThan(0) && quantity.lessThan(item.minStock),
      };
    });
  }

  async createItem(scope: CompanyScope, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const name = requiredText(input.name, "name", 180);
    const unitCode = requiredText(input.unitCode, "unitCode", 20);
    const category = optionalText(input.category, "category", 120);
    const barcode = optionalText(input.barcode, "barcode", 80);
    const minStock = optionalDecimal(input.minStock, "minStock") ?? new Prisma.Decimal(0);
    const requestedCode = optionalText(input.code, "code", 40);

    const id = await this.prisma.$transaction(async (tx) => {
      const code = requestedCode ?? (await this.numbering.next(tx, scope, "ART"));
      const duplicate = await tx.inventoryItem.findFirst({ where: { companyId: scope.companyId, code }, select: { id: true } });
      if (duplicate) throw new ConflictException(`An item with code "${code}" already exists`);
      const item = await tx.inventoryItem.create({ data: { ...scope, code, name, unitCode, category, barcode, minStock } });
      await writeAudit(tx, scope, actorUserId, "inventory.item.created", "InventoryItem", item.id, { code, name });
      return item.id;
    });
    return (await this.listItems(scope)).find((item) => item.id === id);
  }

  async updateItem(scope: CompanyScope, itemId: string, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const item = await this.prisma.inventoryItem.findFirst({ where: { id: itemId, ...scope } });
    if (!item) throw new NotFoundException("Inventory item not found");
    const minStock = optionalDecimal(input.minStock, "minStock");
    const isActive = optionalBoolean(input.isActive, "isActive");
    const name = input.name === undefined ? undefined : requiredText(input.name, "name", 180);
    await this.prisma.$transaction(async (tx) => {
      await tx.inventoryItem.update({
        where: { id: item.id },
        data: {
          ...(minStock !== null ? { minStock } : {}),
          ...(isActive !== null ? { isActive } : {}),
          ...(name !== undefined ? { name } : {}),
          ...(input.barcode !== undefined ? { barcode: optionalText(input.barcode, "barcode", 80) } : {}),
        },
      });
      await writeAudit(tx, scope, actorUserId, "inventory.item.updated", "InventoryItem", item.id, {
        minStock: minStock ? qty(minStock) : undefined,
        isActive,
      });
    });
    return (await this.listItems(scope)).find((candidate) => candidate.id === item.id);
  }

  async listWarehouses(scope: CompanyScope): Promise<WarehouseView[]> {
    const warehouses = await this.prisma.warehouse.findMany({
      where: scope,
      include: { balances: { select: { quantity: true, value: true } } },
      orderBy: { code: "asc" },
    });
    const projectCodes = await this.projectCodes(scope, warehouses.map((warehouse) => warehouse.projectId));
    return warehouses.map((warehouse) => ({
      id: warehouse.id,
      code: warehouse.code,
      name: warehouse.name,
      kind: warehouse.kind,
      projectId: warehouse.projectId,
      projectCode: warehouse.projectId ? (projectCodes.get(warehouse.projectId) ?? null) : null,
      location: warehouse.location,
      isActive: warehouse.isActive,
      itemCount: warehouse.balances.filter((balance) => dec(balance.quantity).greaterThan(0)).length,
      totalValue: money(sumDecimals(warehouse.balances.map((balance) => balance.value))),
    }));
  }

  async createWarehouse(scope: CompanyScope, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const code = requiredText(input.code, "code", 40).toUpperCase();
    const name = requiredText(input.name, "name", 180);
    const kind = optionalEnum(input.kind, "kind", ["WAREHOUSE", "SITE"] as const) ?? "WAREHOUSE";
    const projectId = optionalId(input.projectId, "projectId");
    const location = optionalText(input.location, "location", 180);
    if (kind === "SITE" && !projectId) throw new BadRequestException("A site store must be attached to a project");
    if (kind === "WAREHOUSE" && projectId) throw new BadRequestException("Only a SITE store is attached to a project");

    const id = await this.prisma.$transaction(async (tx) => {
      if (projectId) {
        const project = await tx.project.findFirst({ where: { id: projectId, ...scope }, select: { id: true } });
        if (!project) throw new NotFoundException("Project not found");
      }
      const duplicate = await tx.warehouse.findFirst({ where: { companyId: scope.companyId, code }, select: { id: true } });
      if (duplicate) throw new ConflictException(`A warehouse with code "${code}" already exists`);
      const warehouse = await tx.warehouse.create({ data: { ...scope, code, name, kind, projectId, location } });
      await writeAudit(tx, scope, actorUserId, "inventory.warehouse.created", "Warehouse", warehouse.id, { code, kind, projectId });
      return warehouse.id;
    });
    return (await this.listWarehouses(scope)).find((warehouse) => warehouse.id === id);
  }

  // ---------------------------------------------------------------------
  // Soldes et grand livre
  // ---------------------------------------------------------------------

  async balances(scope: CompanyScope, query: Record<string, unknown>): Promise<StockBalanceView[]> {
    const warehouseId = optionalId(query.warehouseId, "warehouseId");
    const itemId = optionalId(query.itemId, "itemId");
    const balances = await this.prisma.stockBalance.findMany({
      where: { ...scope, ...(warehouseId ? { warehouseId } : {}), ...(itemId ? { itemId } : {}) },
      include: { item: true, warehouse: true },
      orderBy: [{ warehouse: { code: "asc" } }, { item: { code: "asc" } }],
    });
    return balances.map((balance) => ({
      itemId: balance.itemId,
      itemCode: balance.item.code,
      itemName: balance.item.name,
      unitCode: balance.item.unitCode,
      warehouseId: balance.warehouseId,
      warehouseCode: balance.warehouse.code,
      quantity: qty(balance.quantity),
      value: money(balance.value),
      averageCost: dec(balance.quantity).isZero() ? null : dec(balance.value).div(balance.quantity).toFixed(4),
    }));
  }

  async movements(scope: CompanyScope, query: Record<string, unknown>): Promise<StockMovementView[]> {
    const warehouseId = optionalId(query.warehouseId, "warehouseId");
    const itemId = optionalId(query.itemId, "itemId");
    const projectId = optionalId(query.projectId, "projectId");
    const limit = optionalInt(query.limit, "limit", { min: 1, max: 500 }) ?? 100;
    const movements = await this.prisma.stockMovement.findMany({
      where: {
        ...scope,
        ...(warehouseId ? { warehouseId } : {}),
        ...(itemId ? { itemId } : {}),
        ...(projectId ? { projectId } : {}),
      },
      include: { item: true, warehouse: true },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    const [projectCodes, userNames] = await Promise.all([
      this.projectCodes(scope, movements.map((movement) => movement.projectId)),
      this.userNames(scope, movements.map((movement) => movement.createdByUserId)),
    ]);
    return movements.map((movement) => ({
      id: movement.id,
      type: movement.type,
      itemId: movement.itemId,
      itemCode: movement.item.code,
      itemName: movement.item.name,
      warehouseId: movement.warehouseId,
      warehouseCode: movement.warehouse.code,
      quantityDelta: qty(movement.quantityDelta),
      unitCost: dec(movement.unitCost).toFixed(4),
      valueDelta: money(movement.valueDelta),
      projectId: movement.projectId,
      projectCode: movement.projectId ? (projectCodes.get(movement.projectId) ?? null) : null,
      reference: movement.reference,
      reason: movement.reason,
      createdByName: userNames.get(movement.createdByUserId) ?? null,
      createdAt: movement.createdAt.toISOString(),
    }));
  }

  // ---------------------------------------------------------------------
  // Flux : sortie chantier, retour, transfert, ajustement
  // ---------------------------------------------------------------------

  /** Sortie de stock affectee a un projet (consommation chantier tracee). */
  async issue(scope: CompanyScope, body: unknown, actorUserId: string, type: "ISSUE" | "RETURN" = "ISSUE") {
    const input = assertBody(body);
    const warehouseId = requiredId(input.warehouseId, "warehouseId");
    const projectId = requiredId(input.projectId, "projectId");
    const wbsItemId = optionalId(input.wbsItemId, "wbsItemId");
    const reference = optionalText(input.reference, "reference", 120);
    const idempotencyKey = requiredText(input.idempotencyKey, "idempotencyKey", 120);
    const lines = parseLines(input.lines);

    return this.withIdempotency(scope, idempotencyKey, async (tx) => {
      const project = await tx.project.findFirst({ where: { id: projectId, ...scope } });
      if (!project) throw new NotFoundException("Project not found");
      if (project.status !== "IN_PROGRESS" && type === "ISSUE") {
        throw new BadRequestException(`Materials can only be issued to an IN_PROGRESS project (currently ${project.status})`);
      }
      if (wbsItemId) {
        const node = await tx.projectWbsItem.findFirst({
          where: { id: wbsItemId, projectId, ...scope },
          include: { _count: { select: { children: true } } },
        });
        if (!node || node._count.children > 0) throw new BadRequestException("wbsItemId must be a leaf WBS item of the project");
      }
      const posted = [];
      for (const line of lines) {
        posted.push(
          await this.ledger.post(tx, scope, {
            itemId: line.itemId,
            warehouseId,
            type,
            quantity: line.quantity,
            projectId,
            wbsItemId,
            reference,
            idempotencyKey,
            actorUserId,
          }),
        );
      }
      await writeAudit(tx, scope, actorUserId, type === "ISSUE" ? "inventory.issue.posted" : "inventory.return.posted", "Project", projectId, {
        warehouseId,
        reference,
        value: money(sumDecimals(posted.map((movement) => movement.valueDelta)).abs()),
        lines: lines.map((line) => ({ itemId: line.itemId, quantity: qty(line.quantity) })),
      });
      return { posted: posted.length };
    });
  }

  async transfer(scope: CompanyScope, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const fromWarehouseId = requiredId(input.fromWarehouseId, "fromWarehouseId");
    const toWarehouseId = requiredId(input.toWarehouseId, "toWarehouseId");
    if (fromWarehouseId === toWarehouseId) throw new BadRequestException("Source and destination must differ");
    const idempotencyKey = requiredText(input.idempotencyKey, "idempotencyKey", 120);
    const reference = optionalText(input.reference, "reference", 120);
    const lines = parseLines(input.lines);

    return this.withIdempotency(scope, idempotencyKey, async (tx) => {
      const transferGroupId = randomUUID();
      for (const line of lines) {
        const out = await this.ledger.post(tx, scope, {
          itemId: line.itemId,
          warehouseId: fromWarehouseId,
          type: "TRANSFER_OUT",
          quantity: line.quantity,
          transferGroupId,
          reference,
          idempotencyKey,
          actorUserId,
        });
        // La valeur sortie est exactement la valeur entree : aucun ecart de valorisation.
        await this.ledger.post(tx, scope, {
          itemId: line.itemId,
          warehouseId: toWarehouseId,
          type: "TRANSFER_IN",
          quantity: line.quantity,
          unitCost: out.unitCost,
          exactValue: out.valueDelta.negated(),
          transferGroupId,
          reference,
          idempotencyKey,
          actorUserId,
        });
      }
      await writeAudit(tx, scope, actorUserId, "inventory.transfer.posted", "Warehouse", fromWarehouseId, {
        toWarehouseId,
        transferGroupId,
        lines: lines.map((line) => ({ itemId: line.itemId, quantity: qty(line.quantity) })),
      });
      return { posted: lines.length * 2 };
    });
  }

  /** Ajustement hors flux (casse, perte, trouvaille) : motif obligatoire, permission distincte. */
  async adjust(scope: CompanyScope, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const warehouseId = requiredId(input.warehouseId, "warehouseId");
    const itemId = requiredId(input.itemId, "itemId");
    const delta = requiredDecimal(input.quantityDelta, "quantityDelta", { allowNegative: true });
    if (delta.isZero()) throw new BadRequestException("quantityDelta must not be zero");
    const unitCost = optionalDecimal(input.unitCost, "unitCost");
    const reason = requiredText(input.reason, "reason", 500);

    await this.prisma.$transaction(async (tx) => {
      const movement = await this.ledger.post(tx, scope, {
        itemId,
        warehouseId,
        type: delta.greaterThan(0) ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT",
        quantity: delta.abs(),
        unitCost,
        reason,
        actorUserId,
      });
      await writeAudit(tx, scope, actorUserId, "inventory.adjustment.posted", "StockMovement", movement.id, {
        itemId,
        warehouseId,
        quantityDelta: qty(delta),
        valueDelta: money(movement.valueDelta),
        reason,
      });
    });
    return this.balances(scope, { warehouseId, itemId });
  }

  // ---------------------------------------------------------------------
  // Inventaires physiques
  // ---------------------------------------------------------------------

  async listCounts(scope: CompanyScope): Promise<StockCountView[]> {
    const counts = await this.prisma.stockCount.findMany({ where: scope, orderBy: { createdAt: "desc" }, select: { id: true } });
    return Promise.all(counts.map((count) => this.getCount(scope, count.id)));
  }

  async getCount(scope: CompanyScope, countId: string): Promise<StockCountView> {
    const count = await this.prisma.stockCount.findFirst({ where: { id: countId, ...scope }, include: { lines: true, warehouse: true } });
    if (!count) throw new NotFoundException("Stock count not found");
    const items = await this.prisma.inventoryItem.findMany({
      where: { id: { in: count.lines.map((line) => line.itemId) }, ...scope },
    });
    const byId = new Map(items.map((item) => [item.id, item]));
    return {
      id: count.id,
      code: count.code,
      warehouseId: count.warehouseId,
      warehouseCode: count.warehouse.code,
      status: count.status,
      createdAt: count.createdAt.toISOString(),
      closedAt: count.closedAt?.toISOString() ?? null,
      lines: count.lines
        .map((line) => ({
          itemId: line.itemId,
          itemCode: byId.get(line.itemId)?.code ?? "",
          itemName: byId.get(line.itemId)?.name ?? "",
          unitCode: byId.get(line.itemId)?.unitCode ?? "",
          systemQuantity: qty(line.systemQuantity),
          countedQuantity: line.countedQuantity === null ? null : qty(line.countedQuantity),
          difference: line.countedQuantity === null ? null : qty(dec(line.countedQuantity).minus(line.systemQuantity)),
        }))
        .sort((left, right) => left.itemCode.localeCompare(right.itemCode)),
    };
  }

  async openCount(scope: CompanyScope, body: unknown, actorUserId: string) {
    const warehouseId = requiredId(assertBody(body).warehouseId, "warehouseId");
    const id = await this.prisma.$transaction(async (tx) => {
      const warehouse = await tx.warehouse.findFirst({ where: { id: warehouseId, ...scope } });
      if (!warehouse) throw new NotFoundException("Warehouse not found");
      const open = await tx.stockCount.findFirst({ where: { warehouseId, status: "OPEN" }, select: { code: true } });
      if (open) throw new ConflictException(`Stock count ${open.code} is already open for this warehouse`);
      const balances = await tx.stockBalance.findMany({ where: { warehouseId, ...scope } });
      const code = await this.numbering.next(tx, scope, "INV");
      const count = await tx.stockCount.create({ data: { ...scope, code, warehouseId, createdByUserId: actorUserId } });
      if (balances.length > 0) {
        await tx.stockCountLine.createMany({
          data: balances.map((balance) => ({ countId: count.id, itemId: balance.itemId, systemQuantity: balance.quantity })),
        });
      }
      await writeAudit(tx, scope, actorUserId, "inventory.count.opened", "StockCount", count.id, { code, warehouseId });
      return count.id;
    });
    return this.getCount(scope, id);
  }

  async recordCount(scope: CompanyScope, countId: string, body: unknown) {
    const input = assertBody(body);
    const itemId = requiredId(input.itemId, "itemId");
    const countedQuantity = requiredDecimal(input.countedQuantity, "countedQuantity");
    const count = await this.prisma.stockCount.findFirst({ where: { id: countId, ...scope } });
    if (!count) throw new NotFoundException("Stock count not found");
    if (count.status !== "OPEN") throw new BadRequestException("This stock count is closed");
    const item = await this.prisma.inventoryItem.findFirst({ where: { id: itemId, ...scope } });
    if (!item) throw new NotFoundException("Inventory item not found");
    await this.prisma.stockCountLine.upsert({
      where: { countId_itemId: { countId, itemId } },
      create: { countId, itemId, systemQuantity: 0, countedQuantity },
      update: { countedQuantity },
    });
    return this.getCount(scope, countId);
  }

  /** Cloture : chaque ecart compte devient un ajustement trace ; toutes les lignes doivent etre comptees. */
  async closeCount(scope: CompanyScope, countId: string, actorUserId: string) {
    await this.prisma.$transaction(async (tx) => {
      const count = await tx.stockCount.findFirst({ where: { id: countId, ...scope }, include: { lines: true } });
      if (!count) throw new NotFoundException("Stock count not found");
      if (count.status !== "OPEN") throw new BadRequestException("This stock count is already closed");
      const uncounted = count.lines.filter((line) => line.countedQuantity === null);
      if (uncounted.length > 0) throw new BadRequestException(`${uncounted.length} line(s) have not been counted`);
      const adjustments: Array<{ itemId: string; delta: string }> = [];
      for (const line of count.lines) {
        const balance = await tx.stockBalance.findFirst({ where: { itemId: line.itemId, warehouseId: count.warehouseId } });
        const current = dec(balance?.quantity);
        const delta = dec(line.countedQuantity).minus(current);
        if (delta.isZero()) continue;
        const lastCost = delta.greaterThan(0) && current.isZero() ? await this.lastUnitCost(tx, line.itemId) : null;
        await this.ledger.post(tx, scope, {
          itemId: line.itemId,
          warehouseId: count.warehouseId,
          type: delta.greaterThan(0) ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT",
          quantity: delta.abs(),
          unitCost: lastCost,
          countId: count.id,
          reason: `Écart d'inventaire ${count.code}`,
          reference: count.code,
          actorUserId,
        });
        adjustments.push({ itemId: line.itemId, delta: qty(delta) });
      }
      await tx.stockCount.update({
        where: { id: count.id },
        data: { status: "CLOSED", closedAt: new Date(), closedByUserId: actorUserId },
      });
      await writeAudit(tx, scope, actorUserId, "inventory.count.closed", "StockCount", count.id, { code: count.code, adjustments });
    });
    return this.getCount(scope, countId);
  }

  // ---------------------------------------------------------------------
  // Internes
  // ---------------------------------------------------------------------

  /**
   * Execute une operation de mouvements une seule fois par cle d'idempotence :
   * un rejeu (meme cle) ne poste rien de plus ; une course sur la meme cle est
   * arbitree par la contrainte unique du grand livre.
   */
  private async withIdempotency<T>(scope: CompanyScope, key: string, action: (tx: Tx) => Promise<T>): Promise<T | { posted: number; replayed: true }> {
    const existing = await this.prisma.stockMovement.count({ where: { companyId: scope.companyId, idempotencyKey: key } });
    if (existing > 0) return { posted: 0, replayed: true };
    try {
      return await this.prisma.$transaction((tx) => action(tx));
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return { posted: 0, replayed: true };
      }
      throw error;
    }
  }

  private async lastUnitCost(tx: Tx, itemId: string): Promise<Prisma.Decimal | null> {
    const last = await tx.stockMovement.findFirst({
      where: { itemId, unitCost: { gt: 0 } },
      orderBy: { createdAt: "desc" },
      select: { unitCost: true },
    });
    return last ? dec(last.unitCost) : null;
  }

  private async projectCodes(scope: CompanyScope, ids: Array<string | null>): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (unique.length === 0) return new Map();
    const rows = await this.prisma.project.findMany({ where: { id: { in: unique }, ...scope }, select: { id: true, code: true } });
    return new Map(rows.map((row) => [row.id, row.code]));
  }

  private async userNames(scope: CompanyScope, ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await this.prisma.user.findMany({
      where: { id: { in: unique }, organizationId: scope.organizationId },
      select: { id: true, fullName: true },
    });
    return new Map(rows.map((row) => [row.id, row.fullName]));
  }
}

function parseLines(value: unknown): Array<{ itemId: string; quantity: Prisma.Decimal }> {
  if (!Array.isArray(value) || value.length === 0) throw new BadRequestException("lines must contain at least one line");
  const seen = new Set<string>();
  return value.map((raw, index) => {
    const line = assertBody(raw);
    const itemId = requiredId(line.itemId, `lines[${index}].itemId`);
    if (seen.has(itemId)) throw new BadRequestException("Each item may appear only once per movement");
    seen.add(itemId);
    return { itemId, quantity: requiredDecimal(line.quantity, `lines[${index}].quantity`, { positive: true }) };
  });
}
