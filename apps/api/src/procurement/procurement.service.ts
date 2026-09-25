import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@axora24/database";
import type { PurchaseOrderView, PurchaseRequestView, SupplierView } from "@axora24/contracts";
import { PrismaService } from "../core/prisma.service.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import { NumberingService } from "../common/numbering.service.js";
import { writeAudit } from "../common/audit.js";
import { dec, money, qty, sumDecimals } from "../common/decimal.js";
import {
  assertBody,
  currencyCode,
  optionalBoolean,
  optionalDate,
  optionalId,
  optionalInt,
  optionalText,
  requiredDecimal,
  requiredId,
  requiredInt,
  requiredText,
} from "../common/validation.js";

type Tx = Prisma.TransactionClient;

const REQUEST_INCLUDE = {
  lines: { orderBy: { position: "asc" } },
  quotes: {
    include: { lines: true, supplier: { select: { name: true } } },
    orderBy: { total: "asc" },
  },
  orders: { select: { id: true } },
} satisfies Prisma.PurchaseRequestInclude;

const ORDER_INCLUDE = {
  lines: { orderBy: { position: "asc" } },
  supplier: { select: { name: true } },
  request: { select: { code: true } },
  receipts: { include: { lines: true }, orderBy: { receivedAt: "asc" } },
} satisfies Prisma.PurchaseOrderInclude;

/**
 * INC-06 — Achats : DA -> approbation -> consultation -> BC -> reception.
 * docs/foundation/02-domain-model.md BC-05.
 */
@Injectable()
export class ProcurementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
  ) {}

  // ---------------------------------------------------------------------
  // Fournisseurs
  // ---------------------------------------------------------------------

  async listSuppliers(scope: CompanyScope): Promise<SupplierView[]> {
    const suppliers = await this.prisma.supplier.findMany({
      where: scope,
      include: {
        evaluations: { select: { quality: true, delivery: true, price: true } },
        _count: { select: { orders: true } },
      },
      orderBy: { name: "asc" },
    });
    return suppliers.map((supplier) => {
      const scores = supplier.evaluations.map((evaluation) => (evaluation.quality + evaluation.delivery + evaluation.price) / 3);
      const rating = scores.length ? (scores.reduce((sum, value) => sum + value, 0) / scores.length).toFixed(1) : null;
      return {
        id: supplier.id,
        code: supplier.code,
        name: supplier.name,
        taxId: supplier.taxId,
        email: supplier.email,
        phone: supplier.phone,
        city: supplier.city,
        country: supplier.country,
        category: supplier.category,
        paymentTermsDays: supplier.paymentTermsDays,
        currency: supplier.currency.trim(),
        isActive: supplier.isActive,
        rating,
        evaluationCount: scores.length,
        orderCount: supplier._count.orders,
      };
    });
  }

  async createSupplier(scope: CompanyScope, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const name = requiredText(input.name, "name", 180);
    const data = {
      taxId: optionalText(input.taxId, "taxId", 60),
      email: optionalText(input.email, "email", 180),
      phone: optionalText(input.phone, "phone", 60),
      address: optionalText(input.address, "address", 240),
      city: optionalText(input.city, "city", 120),
      country: optionalText(input.country, "country", 120),
      category: optionalText(input.category, "category", 120),
      paymentTermsDays: optionalInt(input.paymentTermsDays, "paymentTermsDays", { min: 0, max: 365 }) ?? 30,
      currency: input.currency === undefined ? "USD" : currencyCode(input.currency),
    };
    const duplicate = await this.prisma.supplier.findFirst({ where: { companyId: scope.companyId, name }, select: { id: true } });
    if (duplicate) throw new ConflictException(`A supplier named "${name}" already exists`);

    const id = await this.prisma.$transaction(async (tx) => {
      const code = await this.numbering.next(tx, scope, "FRN");
      const supplier = await tx.supplier.create({ data: { ...scope, code, name, ...data } });
      await writeAudit(tx, scope, actorUserId, "procurement.supplier.created", "Supplier", supplier.id, { code, name });
      return supplier.id;
    });
    return (await this.listSuppliers(scope)).find((supplier) => supplier.id === id);
  }

  async updateSupplier(scope: CompanyScope, supplierId: string, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const supplier = await this.prisma.supplier.findFirst({ where: { id: supplierId, ...scope } });
    if (!supplier) throw new NotFoundException("Supplier not found");
    const isActive = optionalBoolean(input.isActive, "isActive");
    const paymentTermsDays = optionalInt(input.paymentTermsDays, "paymentTermsDays", { min: 0, max: 365 });
    await this.prisma.$transaction(async (tx) => {
      await tx.supplier.update({
        where: { id: supplier.id },
        data: {
          ...(isActive !== null ? { isActive } : {}),
          ...(paymentTermsDays !== null ? { paymentTermsDays } : {}),
          ...(input.email !== undefined ? { email: optionalText(input.email, "email", 180) } : {}),
          ...(input.phone !== undefined ? { phone: optionalText(input.phone, "phone", 60) } : {}),
        },
      });
      await writeAudit(tx, scope, actorUserId, "procurement.supplier.updated", "Supplier", supplier.id, { isActive, paymentTermsDays });
    });
    return (await this.listSuppliers(scope)).find((candidate) => candidate.id === supplier.id);
  }

  async evaluateSupplier(scope: CompanyScope, supplierId: string, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const quality = requiredInt(input.quality, "quality", { min: 1, max: 5 });
    const delivery = requiredInt(input.delivery, "delivery", { min: 1, max: 5 });
    const price = requiredInt(input.price, "price", { min: 1, max: 5 });
    const comment = optionalText(input.comment, "comment", 1000);
    const orderId = optionalId(input.orderId, "orderId");
    const supplier = await this.prisma.supplier.findFirst({ where: { id: supplierId, ...scope } });
    if (!supplier) throw new NotFoundException("Supplier not found");
    if (orderId) {
      const order = await this.prisma.purchaseOrder.findFirst({ where: { id: orderId, supplierId, ...scope } });
      if (!order) throw new BadRequestException("The order does not belong to this supplier");
    }
    await this.prisma.$transaction(async (tx) => {
      const evaluation = await tx.supplierEvaluation.create({
        data: { ...scope, supplierId, orderId, quality, delivery, price, comment, evaluatedByUserId: actorUserId },
      });
      await writeAudit(tx, scope, actorUserId, "procurement.supplier.evaluated", "Supplier", supplierId, {
        evaluationId: evaluation.id,
        quality,
        delivery,
        price,
      });
    });
    return (await this.listSuppliers(scope)).find((candidate) => candidate.id === supplierId);
  }

  // ---------------------------------------------------------------------
  // Demandes d'achat
  // ---------------------------------------------------------------------

  async listRequests(scope: CompanyScope): Promise<PurchaseRequestView[]> {
    const requests = await this.prisma.purchaseRequest.findMany({
      where: scope,
      include: REQUEST_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
    const context = await this.referenceNames(scope, requests.map((request) => request.projectId), requests.map((request) => request.requestedByUserId));
    return requests.map((request) => toRequestView(request, context));
  }

  async getRequest(scope: CompanyScope, requestId: string): Promise<PurchaseRequestView> {
    const request = await this.prisma.purchaseRequest.findFirst({ where: { id: requestId, ...scope }, include: REQUEST_INCLUDE });
    if (!request) throw new NotFoundException("Purchase request not found");
    const context = await this.referenceNames(scope, [request.projectId], [request.requestedByUserId]);
    return toRequestView(request, context);
  }

  async createRequest(scope: CompanyScope, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const title = requiredText(input.title, "title", 180);
    const justification = optionalText(input.justification, "justification", 2000);
    const projectId = optionalId(input.projectId, "projectId");
    const neededBy = optionalDate(input.neededBy, "neededBy");
    if (!Array.isArray(input.lines) || input.lines.length === 0) {
      throw new BadRequestException("lines must contain at least one line");
    }
    if (input.lines.length > 200) throw new BadRequestException("A request is limited to 200 lines");

    const id = await this.prisma.$transaction(async (tx) => {
      let currency = input.currency === undefined ? "USD" : currencyCode(input.currency);
      let leaves = new Set<string>();
      if (projectId) {
        const project = await tx.project.findFirst({ where: { id: projectId, ...scope } });
        if (!project) throw new NotFoundException("Project not found");
        if (project.status === "COMPLETED" || project.status === "CANCELLED") {
          throw new BadRequestException(`Project is ${project.status}`);
        }
        // Pas de conversion de change implicite : la demande est dans la devise du projet.
        currency = project.currency.trim();
        const wbs = await tx.projectWbsItem.findMany({
          where: { projectId, ...scope },
          include: { _count: { select: { children: true } } },
        });
        leaves = new Set(wbs.filter((item) => item._count.children === 0).map((item) => item.id));
      }
      const lines = (input.lines as unknown[]).map((raw, index) => {
        const line = assertBody(raw);
        const wbsItemId = optionalId(line.wbsItemId, `lines[${index}].wbsItemId`);
        if (wbsItemId && !projectId) throw new BadRequestException("wbsItemId requires a projectId");
        if (wbsItemId && !leaves.has(wbsItemId)) {
          throw new BadRequestException(`lines[${index}].wbsItemId must be a leaf WBS item of the project`);
        }
        return {
          position: index + 1,
          description: requiredText(line.description, `lines[${index}].description`, 240),
          unitCode: requiredText(line.unitCode, `lines[${index}].unitCode`, 20),
          quantity: requiredDecimal(line.quantity, `lines[${index}].quantity`, { positive: true }),
          estimatedUnitPrice: requiredDecimal(line.estimatedUnitPrice, `lines[${index}].estimatedUnitPrice`),
          wbsItemId,
        };
      });
      const code = await this.numbering.next(tx, scope, "DA");
      const request = await tx.purchaseRequest.create({
        data: { ...scope, code, title, justification, projectId, currency, neededBy, requestedByUserId: actorUserId },
      });
      await tx.purchaseRequestLine.createMany({ data: lines.map((line) => ({ ...scope, requestId: request.id, ...line })) });
      await writeAudit(tx, scope, actorUserId, "procurement.request.created", "PurchaseRequest", request.id, {
        code,
        projectId,
        lineCount: lines.length,
      });
      return request.id;
    });
    return this.getRequest(scope, id);
  }

  async submitRequest(scope: CompanyScope, requestId: string, actorUserId: string) {
    await this.prisma.$transaction(async (tx) => {
      const request = await tx.purchaseRequest.findFirst({ where: { id: requestId, ...scope } });
      if (!request) throw new NotFoundException("Purchase request not found");
      if (request.requestedByUserId !== actorUserId) {
        throw new ForbiddenException("Only the requester can submit their request");
      }
      const updated = await tx.purchaseRequest.updateMany({
        where: { id: requestId, status: "DRAFT" },
        data: { status: "SUBMITTED", submittedAt: new Date() },
      });
      if (updated.count !== 1) throw new BadRequestException("Only a draft request can be submitted");
      await writeAudit(tx, scope, actorUserId, "procurement.request.submitted", "PurchaseRequest", requestId, { code: request.code });
    });
    return this.getRequest(scope, requestId);
  }

  async decideRequest(
    scope: CompanyScope,
    requestId: string,
    decision: "APPROVED" | "REJECTED",
    body: unknown,
    actorUserId: string,
  ) {
    const note = optionalText(assertBody(body ?? {}).note, "note", 1000);
    if (decision === "REJECTED" && !note) throw new BadRequestException("A note is required to reject a request");
    await this.prisma.$transaction(async (tx) => {
      const request = await tx.purchaseRequest.findFirst({ where: { id: requestId, ...scope }, include: { lines: true } });
      if (!request) throw new NotFoundException("Purchase request not found");
      if (request.requestedByUserId === actorUserId) {
        // Separation des devoirs (BC-05 invariant 5) : demandeur != approbateur.
        throw new ForbiddenException("The requester cannot approve or reject their own request");
      }
      const updated = await tx.purchaseRequest.updateMany({
        where: { id: requestId, status: "SUBMITTED" },
        data: { status: decision, decidedByUserId: actorUserId, decidedAt: new Date(), decisionNote: note },
      });
      if (updated.count !== 1) throw new BadRequestException("Only a submitted request can be decided");
      const estimated = sumDecimals(request.lines.map((line) => dec(line.quantity).mul(line.estimatedUnitPrice)));
      await writeAudit(
        tx,
        scope,
        actorUserId,
        decision === "APPROVED" ? "procurement.request.approved" : "procurement.request.rejected",
        "PurchaseRequest",
        requestId,
        { code: request.code, estimatedTotal: money(estimated), note },
      );
    });
    return this.getRequest(scope, requestId);
  }

  // ---------------------------------------------------------------------
  // Consultation fournisseurs
  // ---------------------------------------------------------------------

  async addQuote(scope: CompanyScope, requestId: string, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const supplierId = requiredId(input.supplierId, "supplierId");
    const reference = optionalText(input.reference, "reference", 80);
    const validUntil = optionalDate(input.validUntil, "validUntil");
    const deliveryDays = optionalInt(input.deliveryDays, "deliveryDays", { min: 0, max: 730 });
    const note = optionalText(input.note, "note", 1000);
    if (!Array.isArray(input.lines)) throw new BadRequestException("lines are required");

    await this.prisma.$transaction(async (tx) => {
      const request = await tx.purchaseRequest.findFirst({ where: { id: requestId, ...scope }, include: { lines: true } });
      if (!request) throw new NotFoundException("Purchase request not found");
      if (request.status !== "APPROVED") throw new BadRequestException("Suppliers are consulted on an APPROVED request");
      const supplier = await tx.supplier.findFirst({ where: { id: supplierId, ...scope } });
      if (!supplier) throw new NotFoundException("Supplier not found");
      if (!supplier.isActive) throw new BadRequestException("Supplier is inactive");
      const existing = await tx.supplierQuote.findFirst({ where: { requestId, supplierId }, select: { id: true } });
      if (existing) throw new ConflictException("This supplier already quoted this request");

      const prices = new Map<string, Prisma.Decimal>();
      for (const [index, raw] of (input.lines as unknown[]).entries()) {
        const line = assertBody(raw);
        const requestLineId = requiredId(line.requestLineId, `lines[${index}].requestLineId`);
        prices.set(requestLineId, requiredDecimal(line.unitPrice, `lines[${index}].unitPrice`));
      }
      const missing = request.lines.filter((line) => !prices.has(line.id));
      if (missing.length > 0 || prices.size !== request.lines.length) {
        throw new BadRequestException("A quote must price every line of the request, and only those");
      }
      const total = sumDecimals(request.lines.map((line) => dec(line.quantity).mul(prices.get(line.id)!))).toDecimalPlaces(2);
      const quote = await tx.supplierQuote.create({
        data: { ...scope, requestId, supplierId, reference, validUntil, deliveryDays, note, total, createdByUserId: actorUserId },
      });
      await tx.supplierQuoteLine.createMany({
        data: request.lines.map((line) => ({ quoteId: quote.id, requestLineId: line.id, unitPrice: prices.get(line.id)! })),
      });
      await writeAudit(tx, scope, actorUserId, "procurement.quote.recorded", "SupplierQuote", quote.id, {
        requestId,
        supplierId,
        total: money(total),
      });
    });
    return this.getRequest(scope, requestId);
  }

  // ---------------------------------------------------------------------
  // Commandes
  // ---------------------------------------------------------------------

  async listOrders(scope: CompanyScope): Promise<PurchaseOrderView[]> {
    const orders = await this.prisma.purchaseOrder.findMany({ where: scope, include: ORDER_INCLUDE, orderBy: { createdAt: "desc" } });
    const context = await this.referenceNames(
      scope,
      orders.map((order) => order.projectId),
      orders.flatMap((order) => order.receipts.map((receipt) => receipt.receivedByUserId)),
    );
    return orders.map((order) => toOrderView(order, context));
  }

  async getOrder(scope: CompanyScope, orderId: string): Promise<PurchaseOrderView> {
    const order = await this.prisma.purchaseOrder.findFirst({ where: { id: orderId, ...scope }, include: ORDER_INCLUDE });
    if (!order) throw new NotFoundException("Purchase order not found");
    const context = await this.referenceNames(scope, [order.projectId], order.receipts.map((receipt) => receipt.receivedByUserId));
    return toOrderView(order, context);
  }

  /** Commande creee depuis une DA approuvee et l'offre retenue (une seule commande par DA). */
  async createOrder(scope: CompanyScope, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const requestId = requiredId(input.requestId, "requestId");
    const quoteId = requiredId(input.quoteId, "quoteId");
    const expectedDate = optionalDate(input.expectedDate, "expectedDate");

    const orderId = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "purchase_requests"
        WHERE "id" = ${requestId} AND "organizationId" = ${scope.organizationId} AND "companyId" = ${scope.companyId}
        FOR UPDATE
      `;
      if (locked.length === 0) throw new NotFoundException("Purchase request not found");
      const request = await tx.purchaseRequest.findUniqueOrThrow({ where: { id: requestId }, include: { lines: { orderBy: { position: "asc" } } } });
      if (request.status !== "APPROVED") {
        throw new BadRequestException(
          request.status === "ORDERED" ? "This request has already been ordered" : "Only an APPROVED request can be ordered",
        );
      }
      const quote = await tx.supplierQuote.findFirst({
        where: { id: quoteId, requestId, ...scope },
        include: { lines: true, supplier: true },
      });
      if (!quote) throw new NotFoundException("Supplier quote not found for this request");
      if (!quote.supplier.isActive) throw new BadRequestException("Supplier is inactive");
      if (quote.validUntil && quote.validUntil < startOfToday()) {
        throw new BadRequestException("This supplier quote has expired");
      }

      const priceByLine = new Map(quote.lines.map((line) => [line.requestLineId, dec(line.unitPrice)]));
      const lines = request.lines.map((line) => {
        const unitPrice = priceByLine.get(line.id)!;
        return {
          position: line.position,
          description: line.description,
          unitCode: line.unitCode,
          quantity: line.quantity,
          unitPrice,
          lineTotal: dec(line.quantity).mul(unitPrice).toDecimalPlaces(2),
          projectId: request.projectId,
          wbsItemId: line.wbsItemId,
        };
      });
      const code = await this.numbering.next(tx, scope, "BC");
      const order = await tx.purchaseOrder.create({
        data: {
          ...scope,
          code,
          supplierId: quote.supplierId,
          requestId: request.id,
          quoteId: quote.id,
          projectId: request.projectId,
          currency: request.currency,
          total: sumDecimals(lines.map((line) => line.lineTotal)),
          expectedDate,
          createdByUserId: actorUserId,
        },
      });
      await tx.purchaseOrderLine.createMany({ data: lines.map((line) => ({ ...scope, orderId: order.id, ...line })) });
      await tx.supplierQuote.update({ where: { id: quote.id }, data: { selected: true } });
      await tx.purchaseRequest.update({ where: { id: request.id }, data: { status: "ORDERED" } });
      await writeAudit(tx, scope, actorUserId, "procurement.order.created", "PurchaseOrder", order.id, {
        code,
        requestId,
        quoteId,
        supplierId: quote.supplierId,
      });
      return order.id;
    });
    return this.getOrder(scope, orderId);
  }

  /** Emission : la commande engage le budget du projet a partir de cet instant. */
  async issueOrder(scope: CompanyScope, orderId: string, actorUserId: string) {
    await this.prisma.$transaction(async (tx) => {
      const order = await this.lockOrder(tx, scope, orderId);
      if (order.status !== "DRAFT") throw new BadRequestException("Only a draft order can be issued");
      await tx.purchaseOrder.update({
        where: { id: order.id },
        data: { status: "ISSUED", issuedAt: new Date(), issuedByUserId: actorUserId },
      });
      await writeAudit(tx, scope, actorUserId, "procurement.order.issued", "PurchaseOrder", order.id, {
        code: order.code,
        total: money(order.total),
        projectId: order.projectId,
      });
    });
    return this.getOrder(scope, orderId);
  }

  async cancelOrder(scope: CompanyScope, orderId: string, body: unknown, actorUserId: string) {
    const reason = requiredText(assertBody(body).reason, "reason", 500);
    await this.prisma.$transaction(async (tx) => {
      const order = await this.lockOrder(tx, scope, orderId);
      if (order.status !== "DRAFT" && order.status !== "ISSUED") {
        throw new BadRequestException("An order with receipts (or already cancelled) cannot be cancelled");
      }
      await tx.purchaseOrder.update({
        where: { id: order.id },
        data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason },
      });
      if (order.requestId) {
        // La DA redevient commandable (nouvelle consultation possible).
        await tx.purchaseRequest.update({ where: { id: order.requestId }, data: { status: "APPROVED" } });
        await tx.supplierQuote.updateMany({ where: { requestId: order.requestId }, data: { selected: false } });
      }
      await writeAudit(tx, scope, actorUserId, "procurement.order.cancelled", "PurchaseOrder", order.id, { code: order.code, reason });
    });
    return this.getOrder(scope, orderId);
  }

  /**
   * Reception (totale ou partielle). Idempotente : une meme cle renvoie la
   * reception existante sans rien recreer. Verrou pessimiste sur la commande :
   * deux receptions concurrentes ne peuvent jamais depasser la quantite commandee.
   */
  async receive(scope: CompanyScope, orderId: string, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const idempotencyKey = requiredText(input.idempotencyKey, "idempotencyKey", 120);
    const note = optionalText(input.note, "note", 1000);
    if (!Array.isArray(input.lines) || input.lines.length === 0) {
      throw new BadRequestException("lines must contain at least one received line");
    }
    const requested = (input.lines as unknown[]).map((raw, index) => {
      const line = assertBody(raw);
      return {
        orderLineId: requiredId(line.orderLineId, `lines[${index}].orderLineId`),
        quantity: requiredDecimal(line.quantity, `lines[${index}].quantity`, { positive: true }),
      };
    });

    await this.prisma.$transaction(async (tx) => {
      const order = await this.lockOrder(tx, scope, orderId);
      const replay = await tx.goodsReceipt.findFirst({ where: { companyId: scope.companyId, idempotencyKey } });
      if (replay) {
        if (replay.orderId !== order.id) throw new ConflictException("idempotencyKey already used for another order");
        return;
      }
      if (order.status !== "ISSUED" && order.status !== "PARTIALLY_RECEIVED") {
        throw new BadRequestException("Only an issued order can be received");
      }
      const lines = await tx.purchaseOrderLine.findMany({ where: { orderId: order.id } });
      const byId = new Map(lines.map((line) => [line.id, line]));
      const seen = new Set<string>();
      for (const item of requested) {
        const line = byId.get(item.orderLineId);
        if (!line) throw new BadRequestException("A received line does not belong to this order");
        if (seen.has(item.orderLineId)) throw new BadRequestException("Each order line may appear only once per receipt");
        seen.add(item.orderLineId);
        const remaining = dec(line.quantity).minus(line.receivedQuantity);
        if (item.quantity.greaterThan(remaining)) {
          throw new BadRequestException(
            `Line ${line.position}: received ${qty(item.quantity)} exceeds remaining ${qty(remaining)}`,
          );
        }
      }
      const code = await this.numbering.next(tx, scope, "BR");
      const receipt = await tx.goodsReceipt.create({
        data: { ...scope, code, orderId: order.id, idempotencyKey, note, receivedByUserId: actorUserId },
      });
      for (const item of requested) {
        await tx.goodsReceiptLine.create({ data: { receiptId: receipt.id, orderLineId: item.orderLineId, quantity: item.quantity } });
        await tx.purchaseOrderLine.update({
          where: { id: item.orderLineId },
          data: { receivedQuantity: { increment: item.quantity } },
        });
      }
      const refreshed = await tx.purchaseOrderLine.findMany({ where: { orderId: order.id } });
      const complete = refreshed.every((line) => dec(line.receivedQuantity).greaterThanOrEqualTo(line.quantity));
      await tx.purchaseOrder.update({
        where: { id: order.id },
        data: { status: complete ? "RECEIVED" : "PARTIALLY_RECEIVED" },
      });
      await writeAudit(tx, scope, actorUserId, "procurement.receipt.created", "GoodsReceipt", receipt.id, {
        code,
        orderId: order.id,
        lines: requested.map((item) => ({ orderLineId: item.orderLineId, quantity: qty(item.quantity) })),
        orderStatus: complete ? "RECEIVED" : "PARTIALLY_RECEIVED",
      });
    });
    return this.getOrder(scope, orderId);
  }

  // ---------------------------------------------------------------------
  // Internes
  // ---------------------------------------------------------------------

  private async lockOrder(tx: Tx, scope: CompanyScope, orderId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "purchase_orders"
      WHERE "id" = ${orderId} AND "organizationId" = ${scope.organizationId} AND "companyId" = ${scope.companyId}
      FOR UPDATE
    `;
    if (rows.length === 0) throw new NotFoundException("Purchase order not found");
    return tx.purchaseOrder.findUniqueOrThrow({ where: { id: orderId } });
  }

  private async referenceNames(scope: CompanyScope, projectIds: Array<string | null>, userIds: string[]) {
    const projects = [...new Set(projectIds.filter((id): id is string => Boolean(id)))];
    const users = [...new Set(userIds)];
    const [projectRows, userRows] = await Promise.all([
      projects.length
        ? this.prisma.project.findMany({ where: { id: { in: projects }, ...scope }, select: { id: true, code: true } })
        : [],
      users.length
        ? this.prisma.user.findMany({ where: { id: { in: users }, organizationId: scope.organizationId }, select: { id: true, fullName: true } })
        : [],
    ]);
    return {
      projectCodes: new Map(projectRows.map((row) => [row.id, row.code])),
      userNames: new Map(userRows.map((row) => [row.id, row.fullName])),
    };
  }
}

type Names = { projectCodes: Map<string, string>; userNames: Map<string, string> };
type RequestWithRelations = Prisma.PurchaseRequestGetPayload<{ include: typeof REQUEST_INCLUDE }>;
type OrderWithRelations = Prisma.PurchaseOrderGetPayload<{ include: typeof ORDER_INCLUDE }>;

function startOfToday(): Date {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return today;
}

function toRequestView(request: RequestWithRelations, names: Names): PurchaseRequestView {
  const quantities = new Map(request.lines.map((line) => [line.id, dec(line.quantity)]));
  return {
    id: request.id,
    code: request.code,
    title: request.title,
    justification: request.justification,
    projectId: request.projectId,
    projectCode: request.projectId ? (names.projectCodes.get(request.projectId) ?? null) : null,
    currency: request.currency.trim(),
    neededBy: request.neededBy?.toISOString() ?? null,
    status: request.status,
    estimatedTotal: money(sumDecimals(request.lines.map((line) => dec(line.quantity).mul(line.estimatedUnitPrice)))),
    requestedByUserId: request.requestedByUserId,
    requestedByName: names.userNames.get(request.requestedByUserId) ?? null,
    submittedAt: request.submittedAt?.toISOString() ?? null,
    decidedByUserId: request.decidedByUserId,
    decidedAt: request.decidedAt?.toISOString() ?? null,
    decisionNote: request.decisionNote,
    createdAt: request.createdAt.toISOString(),
    lines: request.lines.map((line) => ({
      id: line.id,
      position: line.position,
      description: line.description,
      unitCode: line.unitCode,
      quantity: qty(line.quantity),
      estimatedUnitPrice: money(line.estimatedUnitPrice),
      estimatedTotal: money(dec(line.quantity).mul(line.estimatedUnitPrice)),
      wbsItemId: line.wbsItemId,
    })),
    quotes: request.quotes.map((quote) => ({
      id: quote.id,
      supplierId: quote.supplierId,
      supplierName: quote.supplier.name,
      reference: quote.reference,
      validUntil: quote.validUntil?.toISOString() ?? null,
      deliveryDays: quote.deliveryDays,
      note: quote.note,
      total: money(quote.total),
      selected: quote.selected,
      lines: quote.lines.map((line) => ({
        requestLineId: line.requestLineId,
        unitPrice: money(line.unitPrice),
        lineTotal: money(dec(quantities.get(line.requestLineId)).mul(line.unitPrice)),
      })),
      createdAt: quote.createdAt.toISOString(),
    })),
    orderIds: request.orders.map((order) => order.id),
  };
}

function toOrderView(order: OrderWithRelations, names: Names): PurchaseOrderView {
  return {
    id: order.id,
    code: order.code,
    supplierId: order.supplierId,
    supplierName: order.supplier.name,
    requestId: order.requestId,
    requestCode: order.request?.code ?? null,
    projectId: order.projectId,
    projectCode: order.projectId ? (names.projectCodes.get(order.projectId) ?? null) : null,
    currency: order.currency.trim(),
    status: order.status,
    total: money(order.total),
    receivedValue: money(sumDecimals(order.lines.map((line) => dec(line.receivedQuantity).mul(line.unitPrice)))),
    expectedDate: order.expectedDate?.toISOString() ?? null,
    issuedAt: order.issuedAt?.toISOString() ?? null,
    cancelledAt: order.cancelledAt?.toISOString() ?? null,
    cancelReason: order.cancelReason,
    createdAt: order.createdAt.toISOString(),
    lines: order.lines.map((line) => ({
      id: line.id,
      position: line.position,
      description: line.description,
      unitCode: line.unitCode,
      quantity: qty(line.quantity),
      unitPrice: money(line.unitPrice),
      lineTotal: money(line.lineTotal),
      receivedQuantity: qty(line.receivedQuantity),
      remainingQuantity: qty(dec(line.quantity).minus(line.receivedQuantity)),
      projectId: line.projectId,
      wbsItemId: line.wbsItemId,
    })),
    receipts: order.receipts.map((receipt) => ({
      id: receipt.id,
      code: receipt.code,
      receivedAt: receipt.receivedAt.toISOString(),
      receivedByName: names.userNames.get(receipt.receivedByUserId) ?? null,
      note: receipt.note,
      lines: receipt.lines.map((line) => ({ orderLineId: line.orderLineId, quantity: qty(line.quantity) })),
    })),
  };
}
