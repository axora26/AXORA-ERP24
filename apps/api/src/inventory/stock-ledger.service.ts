import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@axora24/database";
import type { CompanyScope } from "../common/company-scope.service.js";
import { dec, qty } from "../common/decimal.js";

type Tx = Prisma.TransactionClient;

export type StockMovementKind = Prisma.StockMovementCreateInput["type"];

const ENTRY_TYPES = new Set<StockMovementKind>(["RECEIPT", "RETURN", "TRANSFER_IN", "ADJUSTMENT_IN"]);

export interface PostMovementInput {
  itemId: string;
  warehouseId: string;
  type: StockMovementKind;
  /** Quantite positive ; le signe est deduit du type. */
  quantity: Prisma.Decimal;
  /** Cout unitaire impose pour une entree (prix d'achat, cout transfere). */
  unitCost?: Prisma.Decimal | null;
  /** Valeur exacte imposee (transfert : valeur sortie = valeur entree). */
  exactValue?: Prisma.Decimal | null;
  projectId?: string | null;
  wbsItemId?: string | null;
  goodsReceiptLineId?: string | null;
  transferGroupId?: string | null;
  countId?: string | null;
  reference?: string | null;
  reason?: string | null;
  idempotencyKey?: string | null;
  actorUserId: string;
}

export interface PostedMovement {
  id: string;
  quantityDelta: Prisma.Decimal;
  valueDelta: Prisma.Decimal;
  unitCost: Prisma.Decimal;
}

/**
 * Grand livre de stock : SEUL point d'ecriture des mouvements et des soldes.
 *
 * - Verrou pessimiste sur la ligne de solde article x magasin (SELECT ... FOR
 *   UPDATE) : deux sorties concurrentes ne peuvent jamais consommer le meme
 *   disponible ; la base refuse de toute facon un solde negatif (CHECK).
 * - Cout moyen pondere : une entree ajoute sa valeur reelle, une sortie retire
 *   quantite x cout moyen (et solde exactement la valeur restante quand la
 *   quantite tombe a zero, sans residu d'arrondi).
 * - Le mouvement est insere dans la meme transaction que la mise a jour du
 *   solde ; il est ensuite immuable (trigger append-only).
 */
@Injectable()
export class StockLedgerService {
  async post(tx: Tx, scope: CompanyScope, input: PostMovementInput): Promise<PostedMovement> {
    if (!input.quantity.greaterThan(0)) throw new BadRequestException("Movement quantity must be greater than zero");

    const [item, warehouse] = await Promise.all([
      tx.inventoryItem.findFirst({ where: { id: input.itemId, ...scope } }),
      tx.warehouse.findFirst({ where: { id: input.warehouseId, ...scope } }),
    ]);
    if (!item) throw new NotFoundException("Inventory item not found");
    if (!warehouse) throw new NotFoundException("Warehouse not found");
    if (!warehouse.isActive) throw new BadRequestException(`Warehouse ${warehouse.code} is inactive`);
    if (!input.countId) {
      // Un inventaire ouvert gele le magasin : seuls ses propres ajustements y sont admis.
      const openCount = await tx.stockCount.findFirst({
        where: { warehouseId: warehouse.id, status: "OPEN" },
        select: { code: true },
      });
      if (openCount) {
        throw new BadRequestException(`Warehouse ${warehouse.code} is frozen by the open stock count ${openCount.code}`);
      }
    }

    await tx.$executeRaw`
      INSERT INTO "stock_balances" ("id", "organizationId", "companyId", "itemId", "warehouseId", "quantity", "value", "updatedAt")
      VALUES (gen_random_uuid()::text, ${scope.organizationId}, ${scope.companyId}, ${item.id}, ${warehouse.id}, 0, 0, now())
      ON CONFLICT ("itemId", "warehouseId") DO NOTHING
    `;
    const rows = await tx.$queryRaw<Array<{ id: string; quantity: Prisma.Decimal; value: Prisma.Decimal }>>`
      SELECT "id", "quantity", "value" FROM "stock_balances"
      WHERE "itemId" = ${item.id} AND "warehouseId" = ${warehouse.id}
      FOR UPDATE
    `;
    const balance = rows[0]!;
    const onHand = dec(balance.quantity);
    const onHandValue = dec(balance.value);
    const averageCost = onHand.isZero() ? null : onHandValue.div(onHand);

    let quantityDelta: Prisma.Decimal;
    let valueDelta: Prisma.Decimal;
    let unitCost: Prisma.Decimal;

    if (ENTRY_TYPES.has(input.type)) {
      const cost = input.unitCost ?? averageCost;
      if (cost === null || cost === undefined) {
        throw new BadRequestException(`A unit cost is required for this entry of ${item.code} (no stock to value it)`);
      }
      if (dec(cost).isNegative()) throw new BadRequestException("unitCost must not be negative");
      unitCost = dec(cost);
      quantityDelta = input.quantity;
      valueDelta = input.exactValue ? dec(input.exactValue) : input.quantity.mul(unitCost).toDecimalPlaces(2);
    } else {
      if (input.quantity.greaterThan(onHand)) {
        throw new BadRequestException(
          `Insufficient stock for ${item.code} in ${warehouse.code}: available ${qty(onHand)} ${item.unitCode}, requested ${qty(input.quantity)}`,
        );
      }
      unitCost = averageCost ?? new Prisma.Decimal(0);
      quantityDelta = input.quantity.negated();
      valueDelta = input.quantity.equals(onHand) ? onHandValue.negated() : input.quantity.mul(unitCost).toDecimalPlaces(2).negated();
    }

    await tx.stockBalance.update({
      where: { id: balance.id },
      data: { quantity: onHand.plus(quantityDelta), value: onHandValue.plus(valueDelta) },
    });
    const movement = await tx.stockMovement.create({
      data: {
        ...scope,
        itemId: item.id,
        warehouseId: warehouse.id,
        type: input.type,
        quantityDelta,
        unitCost: unitCost.toDecimalPlaces(4),
        valueDelta,
        projectId: input.projectId ?? null,
        wbsItemId: input.wbsItemId ?? null,
        goodsReceiptLineId: input.goodsReceiptLineId ?? null,
        transferGroupId: input.transferGroupId ?? null,
        countId: input.countId ?? null,
        reference: input.reference ?? null,
        reason: input.reason ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        createdByUserId: input.actorUserId,
      },
    });
    return { id: movement.id, quantityDelta, valueDelta, unitCost };
  }
}
