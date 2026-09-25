import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@axora24/database";
import type {
  BankAccountView,
  CustomerInvoiceView,
  FinanceSummaryView,
  PaymentView,
  SupplierInvoiceView,
  TaxRateView,
} from "@axora24/contracts";
import { PrismaService } from "../core/prisma.service.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import { NumberingService } from "../common/numbering.service.js";
import { writeAudit } from "../common/audit.js";
import { dec, money, qty, sumDecimals } from "../common/decimal.js";
import {
  assertBody,
  currencyCode,
  optionalDate,
  optionalEnum,
  optionalId,
  optionalInt,
  optionalText,
  requiredDate,
  requiredDecimal,
  requiredEnum,
  requiredId,
  requiredText,
} from "../common/validation.js";

type Tx = Prisma.TransactionClient;

const PAYMENT_METHODS = ["TRANSFER", "CHECK", "CASH", "MOBILE_MONEY", "CARD"] as const;
const OPEN_CUSTOMER = ["ISSUED", "PARTIALLY_PAID", "PAID"] as const;
const APPROVED_SUPPLIER = ["APPROVED", "PARTIALLY_PAID", "PAID"] as const;

interface ParsedLine {
  position: number;
  description: string;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  taxRate: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
  lineTax: Prisma.Decimal;
  orderLineId: string | null;
}

/**
 * INC-08 — Finance (docs/foundation/02-domain-model.md BC-07).
 * Aucune regle fiscale presumee : les taux proviennent des parametres de
 * l'entreprise et sont figes sur chaque ligne.
 */
@Injectable()
export class FinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
  ) {}

  // ---------------------------------------------------------------------
  // Parametres : taxes et comptes de tresorerie
  // ---------------------------------------------------------------------

  async listTaxRates(scope: CompanyScope): Promise<TaxRateView[]> {
    const rates = await this.prisma.taxRate.findMany({ where: scope, orderBy: { name: "asc" } });
    return rates.map((rate) => ({ id: rate.id, name: rate.name, rate: dec(rate.rate).toFixed(2), isActive: rate.isActive }));
  }

  async createTaxRate(scope: CompanyScope, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const name = requiredText(input.name, "name", 80);
    const rate = requiredDecimal(input.rate, "rate");
    if (rate.greaterThan(100)) throw new BadRequestException("rate must be between 0 and 100");
    const duplicate = await this.prisma.taxRate.findFirst({ where: { companyId: scope.companyId, name }, select: { id: true } });
    if (duplicate) throw new ConflictException(`A tax rate named "${name}" already exists`);
    await this.prisma.$transaction(async (tx) => {
      const created = await tx.taxRate.create({ data: { ...scope, name, rate } });
      await writeAudit(tx, scope, actorUserId, "finance.taxrate.created", "TaxRate", created.id, { name, rate: rate.toFixed(2) });
    });
    return this.listTaxRates(scope);
  }

  async listBankAccounts(scope: CompanyScope): Promise<BankAccountView[]> {
    const accounts = await this.prisma.bankAccount.findMany({ where: scope, orderBy: { code: "asc" } });
    const flows = await this.prisma.payment.groupBy({
      by: ["bankAccountId", "direction"],
      where: scope,
      _sum: { amount: true },
    });
    return accounts.map((account) => {
      const incoming = dec(flows.find((flow) => flow.bankAccountId === account.id && flow.direction === "IN")?._sum.amount);
      const outgoing = dec(flows.find((flow) => flow.bankAccountId === account.id && flow.direction === "OUT")?._sum.amount);
      return {
        id: account.id,
        code: account.code,
        name: account.name,
        kind: account.kind,
        currency: account.currency.trim(),
        iban: account.iban,
        openingBalance: money(account.openingBalance),
        balance: money(dec(account.openingBalance).plus(incoming).minus(outgoing)),
        isActive: account.isActive,
      };
    });
  }

  async createBankAccount(scope: CompanyScope, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const code = requiredText(input.code, "code", 40).toUpperCase();
    const name = requiredText(input.name, "name", 120);
    const kind = optionalEnum(input.kind, "kind", ["BANK", "CASH"] as const) ?? "BANK";
    const currency = currencyCode(input.currency);
    const iban = optionalText(input.iban, "iban", 60);
    const openingBalance = requiredDecimal(input.openingBalance ?? "0", "openingBalance");
    const duplicate = await this.prisma.bankAccount.findFirst({ where: { companyId: scope.companyId, code }, select: { id: true } });
    if (duplicate) throw new ConflictException(`A bank account with code "${code}" already exists`);
    await this.prisma.$transaction(async (tx) => {
      const account = await tx.bankAccount.create({ data: { ...scope, code, name, kind, currency, iban, openingBalance } });
      await writeAudit(tx, scope, actorUserId, "finance.bank.created", "BankAccount", account.id, { code, currency, openingBalance: money(openingBalance) });
    });
    return this.listBankAccounts(scope);
  }

  // ---------------------------------------------------------------------
  // Factures clients
  // ---------------------------------------------------------------------

  async listCustomerInvoices(scope: CompanyScope): Promise<CustomerInvoiceView[]> {
    const invoices = await this.prisma.customerInvoice.findMany({
      where: scope,
      include: { lines: { orderBy: { position: "asc" } }, payments: { include: { bankAccount: true }, orderBy: { paidAt: "asc" } } },
      orderBy: { createdAt: "desc" },
    });
    const refs = await this.references(scope, invoices.map((invoice) => invoice.contractId), invoices.map((invoice) => invoice.projectId));
    return invoices.map((invoice) => toCustomerView(invoice, refs));
  }

  async getCustomerInvoice(scope: CompanyScope, invoiceId: string): Promise<CustomerInvoiceView> {
    const invoice = await this.prisma.customerInvoice.findFirst({
      where: { id: invoiceId, ...scope },
      include: { lines: { orderBy: { position: "asc" } }, payments: { include: { bankAccount: true }, orderBy: { paidAt: "asc" } } },
    });
    if (!invoice) throw new NotFoundException("Customer invoice not found");
    const refs = await this.references(scope, [invoice.contractId], [invoice.projectId]);
    return toCustomerView(invoice, refs);
  }

  /** Brouillon de facture : aucun numero legal n'est attribue avant l'emission. */
  async createCustomerInvoice(scope: CompanyScope, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const contractId = optionalId(input.contractId, "contractId");
    const notes = optionalText(input.notes, "notes", 2000);
    const customerAddress = optionalText(input.customerAddress, "customerAddress", 500);

    const id = await this.prisma.$transaction(async (tx) => {
      let customerName = optionalText(input.customerName, "customerName", 180);
      let currency = input.currency === undefined ? null : currencyCode(input.currency);
      let projectId = optionalId(input.projectId, "projectId");
      let lines: ParsedLine[];

      if (contractId) {
        const contract = await tx.contract.findFirst({ where: { id: contractId, ...scope }, include: { lines: { orderBy: { position: "asc" } } } });
        if (!contract) throw new NotFoundException("Contract not found");
        currency = contract.currency.trim();
        const opportunity = await tx.crmOpportunity.findFirst({
          where: { id: contract.opportunityId, ...scope },
          include: { account: { select: { name: true } } },
        });
        customerName = customerName ?? opportunity?.account?.name ?? null;
        const project = await tx.project.findFirst({ where: { contractId, ...scope }, select: { id: true } });
        projectId = project?.id ?? projectId;
        const percent = input.percent === undefined ? null : requiredDecimal(input.percent, "percent", { positive: true });
        if (percent) {
          // Facture de situation : un pourcentage de chaque ligne du contrat.
          if (percent.greaterThan(100)) throw new BadRequestException("percent must be <= 100");
          const taxRate = await this.taxRateValue(tx, scope, optionalId(input.taxRateId, "taxRateId"));
          lines = contract.lines.map((line, index) =>
            buildLine(index + 1, `${line.designation} — situation ${percent.toFixed(2)} %`, dec(line.quantity).mul(percent).div(100).toDecimalPlaces(3), dec(line.unitPrice).toDecimalPlaces(2), taxRate, null),
          );
        } else {
          lines = await this.parseLines(tx, scope, input.lines);
        }
      } else {
        lines = await this.parseLines(tx, scope, input.lines);
        if (projectId) {
          const project = await tx.project.findFirst({ where: { id: projectId, ...scope } });
          if (!project) throw new NotFoundException("Project not found");
          currency = currency ?? project.currency.trim();
        }
      }
      if (!customerName) throw new BadRequestException("customerName is required");
      if (!currency) throw new BadRequestException("currency is required");

      const totals = invoiceTotals(lines);
      const invoice = await tx.customerInvoice.create({
        data: {
          ...scope,
          customerName,
          customerAddress,
          contractId,
          projectId,
          currency,
          notes,
          ...totals,
          createdByUserId: actorUserId,
        },
      });
      await tx.customerInvoiceLine.createMany({
        data: lines.map((line) => ({
          ...scope,
          invoiceId: invoice.id,
          position: line.position,
          description: line.description,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          taxRate: line.taxRate,
          lineTotal: line.lineTotal,
          lineTax: line.lineTax,
        })),
      });
      await writeAudit(tx, scope, actorUserId, "finance.invoice.drafted", "CustomerInvoice", invoice.id, {
        contractId,
        total: money(totals.total),
      });
      return invoice.id;
    });
    return this.getCustomerInvoice(scope, id);
  }

  /** Emission : numero legal sequentiel attribue a cet instant (pas de trou), garde sur le cumul du contrat. */
  async issueCustomerInvoice(scope: CompanyScope, invoiceId: string, body: unknown, actorUserId: string) {
    const input = assertBody(body ?? {});
    const issueDate = optionalDate(input.issueDate, "issueDate") ?? startOfToday();
    const dueDays = optionalInt(input.dueDays, "dueDays", { min: 0, max: 365 }) ?? 30;

    await this.prisma.$transaction(async (tx) => {
      const invoice = await this.lockCustomerInvoice(tx, scope, invoiceId);
      if (invoice.status !== "DRAFT") throw new BadRequestException("Only a draft invoice can be issued");
      if (dec(invoice.total).lessThanOrEqualTo(0)) throw new BadRequestException("An invoice must have a positive total");
      if (invoice.contractId) {
        const contract = await tx.contract.findFirstOrThrow({ where: { id: invoice.contractId, ...scope } });
        // Verrou sur le contrat : deux emissions concurrentes ne peuvent pas depasser son montant.
        await tx.$queryRaw`SELECT "id" FROM "sales_contracts" WHERE "id" = ${contract.id} FOR UPDATE`;
        const issued = await tx.customerInvoice.aggregate({
          where: { contractId: contract.id, ...scope, status: { in: [...OPEN_CUSTOMER] } },
          _sum: { subtotal: true },
        });
        const cumulative = dec(issued._sum.subtotal).plus(invoice.subtotal);
        const ceiling = dec(contract.subtotal).toDecimalPlaces(2);
        if (cumulative.greaterThan(ceiling)) {
          throw new BadRequestException(
            `Cumulative invoicing (${money(cumulative)}) would exceed the contract amount (${money(ceiling)})`,
          );
        }
      }
      // Numerotation legale chronologique : pas d'emission anterieure a la derniere facture emise.
      const latest = await tx.customerInvoice.findFirst({
        where: { ...scope, issueDate: { not: null }, status: { in: [...OPEN_CUSTOMER] } },
        orderBy: { issueDate: "desc" },
        select: { issueDate: true, code: true },
      });
      if (latest?.issueDate && issueDate < latest.issueDate) {
        throw new BadRequestException(
          `issueDate cannot precede the last issued invoice ${latest.code} (${latest.issueDate.toISOString().slice(0, 10)})`,
        );
      }
      const code = await this.numbering.next(tx, scope, "FAC", issueDate);
      const dueDate = new Date(issueDate.getTime() + dueDays * 86_400_000);
      await tx.customerInvoice.update({
        where: { id: invoice.id },
        data: { status: "ISSUED", code, issueDate, dueDate, issuedByUserId: actorUserId },
      });
      await writeAudit(tx, scope, actorUserId, "finance.invoice.issued", "CustomerInvoice", invoice.id, {
        code,
        total: money(invoice.total),
        contractId: invoice.contractId,
      });
    });
    return this.getCustomerInvoice(scope, invoiceId);
  }

  async cancelCustomerInvoice(scope: CompanyScope, invoiceId: string, body: unknown, actorUserId: string) {
    const reason = requiredText(assertBody(body).reason, "reason", 500);
    await this.prisma.$transaction(async (tx) => {
      const invoice = await this.lockCustomerInvoice(tx, scope, invoiceId);
      if (invoice.status !== "DRAFT") {
        throw new BadRequestException("An issued invoice cannot be cancelled: it must be corrected by a credit note");
      }
      await tx.customerInvoice.update({ where: { id: invoice.id }, data: { status: "CANCELLED", cancelReason: reason } });
      await writeAudit(tx, scope, actorUserId, "finance.invoice.cancelled", "CustomerInvoice", invoice.id, { reason });
    });
    return this.getCustomerInvoice(scope, invoiceId);
  }

  // ---------------------------------------------------------------------
  // Factures fournisseurs (rapprochement 3-way)
  // ---------------------------------------------------------------------

  async listSupplierInvoices(scope: CompanyScope): Promise<SupplierInvoiceView[]> {
    const invoices = await this.prisma.supplierInvoice.findMany({
      where: scope,
      include: { lines: { orderBy: { position: "asc" } }, payments: { include: { bankAccount: true }, orderBy: { paidAt: "asc" } } },
      orderBy: { createdAt: "desc" },
    });
    const refs = await this.supplierReferences(scope, invoices);
    return invoices.map((invoice) => toSupplierView(invoice, refs));
  }

  async getSupplierInvoice(scope: CompanyScope, invoiceId: string): Promise<SupplierInvoiceView> {
    const invoice = await this.prisma.supplierInvoice.findFirst({
      where: { id: invoiceId, ...scope },
      include: { lines: { orderBy: { position: "asc" } }, payments: { include: { bankAccount: true }, orderBy: { paidAt: "asc" } } },
    });
    if (!invoice) throw new NotFoundException("Supplier invoice not found");
    const refs = await this.supplierReferences(scope, [invoice]);
    return toSupplierView(invoice, refs);
  }

  async recordSupplierInvoice(scope: CompanyScope, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const supplierId = requiredId(input.supplierId, "supplierId");
    const orderId = optionalId(input.orderId, "orderId");
    const supplierReference = requiredText(input.supplierReference, "supplierReference", 80);
    const invoiceDate = requiredDate(input.invoiceDate, "invoiceDate");

    const id = await this.prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.findFirst({ where: { id: supplierId, ...scope } });
      if (!supplier) throw new NotFoundException("Supplier not found");
      const duplicate = await tx.supplierInvoice.findFirst({ where: { supplierId, supplierReference }, select: { code: true } });
      if (duplicate) {
        throw new ConflictException(`Invoice "${supplierReference}" of this supplier is already recorded (${duplicate.code})`);
      }
      let currency = supplier.currency.trim();
      let projectId: string | null = null;
      const notes: string[] = [];
      let orderLines = new Map<string, Prisma.PurchaseOrderLineGetPayload<object>>();
      if (orderId) {
        const order = await tx.purchaseOrder.findFirst({ where: { id: orderId, ...scope }, include: { lines: true } });
        if (!order) throw new NotFoundException("Purchase order not found");
        if (order.supplierId !== supplierId) throw new BadRequestException("The order belongs to another supplier");
        if (order.status === "DRAFT" || order.status === "CANCELLED") {
          throw new BadRequestException(`A ${order.status} order cannot be invoiced`);
        }
        await tx.$queryRaw`SELECT "id" FROM "purchase_orders" WHERE "id" = ${order.id} FOR UPDATE`;
        currency = order.currency.trim();
        projectId = order.projectId;
        orderLines = new Map(order.lines.map((line) => [line.id, line]));
      }
      const lines = await this.parseLines(tx, scope, input.lines, true);

      // --- Rapprochement 3-way : commande <-> reception <-> facture ---------
      if (orderId) {
        const previous = await tx.supplierInvoiceLine.findMany({
          where: { orderLineId: { in: [...orderLines.keys()] }, invoice: { status: { not: "REJECTED" } } },
          select: { orderLineId: true, quantity: true },
        });
        for (const line of lines) {
          if (!line.orderLineId) {
            notes.push(`Ligne ${line.position} : hors commande`);
            continue;
          }
          const orderLine = orderLines.get(line.orderLineId);
          if (!orderLine) throw new BadRequestException(`Line ${line.position}: order line does not belong to the order`);
          const alreadyInvoiced = sumDecimals(previous.filter((entry) => entry.orderLineId === line.orderLineId).map((entry) => entry.quantity));
          const received = dec(orderLine.receivedQuantity);
          if (alreadyInvoiced.plus(line.quantity).greaterThan(received)) {
            notes.push(
              `Ligne ${line.position} : facturé ${qty(alreadyInvoiced.plus(line.quantity))} > reçu ${qty(received)} ${orderLine.unitCode}`,
            );
          }
          if (!line.unitPrice.equals(orderLine.unitPrice)) {
            notes.push(`Ligne ${line.position} : prix ${money(line.unitPrice)} ≠ prix commande ${money(orderLine.unitPrice)}`);
          }
        }
      }
      const matchStatus = !orderId ? "NO_ORDER" : notes.length === 0 ? "MATCHED" : "DISCREPANCY";
      const totals = invoiceTotals(lines);
      const dueDate = optionalDate(input.dueDate, "dueDate") ?? new Date(invoiceDate.getTime() + supplier.paymentTermsDays * 86_400_000);
      const code = await this.numbering.next(tx, scope, "FF");
      const invoice = await tx.supplierInvoice.create({
        data: {
          ...scope,
          code,
          supplierId,
          orderId,
          projectId,
          supplierReference,
          currency,
          invoiceDate,
          dueDate,
          matchStatus,
          matchNotes: notes.length ? notes.join(" · ") : null,
          ...totals,
          recordedByUserId: actorUserId,
        },
      });
      await tx.supplierInvoiceLine.createMany({
        data: lines.map((line) => ({
          ...scope,
          invoiceId: invoice.id,
          position: line.position,
          orderLineId: line.orderLineId,
          description: line.description,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          taxRate: line.taxRate,
          lineTotal: line.lineTotal,
          lineTax: line.lineTax,
        })),
      });
      await writeAudit(tx, scope, actorUserId, "finance.payable.recorded", "SupplierInvoice", invoice.id, {
        code,
        supplierReference,
        orderId,
        matchStatus,
        total: money(totals.total),
      });
      return invoice.id;
    });
    return this.getSupplierInvoice(scope, id);
  }

  async decideSupplierInvoice(
    scope: CompanyScope,
    invoiceId: string,
    decision: "APPROVED" | "REJECTED",
    body: unknown,
    actorUserId: string,
  ) {
    const note = optionalText(assertBody(body ?? {}).note, "note", 1000);
    await this.prisma.$transaction(async (tx) => {
      const invoice = await this.lockSupplierInvoice(tx, scope, invoiceId);
      if (invoice.status !== "RECORDED") throw new BadRequestException("Only a recorded invoice can be decided");
      if (invoice.recordedByUserId === actorUserId) {
        throw new ForbiddenException("The person who recorded the invoice cannot approve or reject it");
      }
      if (decision === "REJECTED" && !note) throw new BadRequestException("A note is required to reject an invoice");
      if (decision === "APPROVED" && invoice.matchStatus !== "MATCHED" && !note) {
        throw new BadRequestException(
          `Approving an invoice with status ${invoice.matchStatus} requires a justification note`,
        );
      }
      await tx.supplierInvoice.update({
        where: { id: invoice.id },
        data: { status: decision, decidedByUserId: actorUserId, decidedAt: new Date(), decisionNote: note },
      });
      await writeAudit(
        tx,
        scope,
        actorUserId,
        decision === "APPROVED" ? "finance.payable.approved" : "finance.payable.rejected",
        "SupplierInvoice",
        invoice.id,
        { code: invoice.code, matchStatus: invoice.matchStatus, note },
      );
    });
    return this.getSupplierInvoice(scope, invoiceId);
  }

  // ---------------------------------------------------------------------
  // Paiements (anti double paiement)
  // ---------------------------------------------------------------------

  async pay(scope: CompanyScope, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const kind = requiredEnum(input.invoiceType, "invoiceType", ["CUSTOMER", "SUPPLIER"] as const);
    const invoiceId = requiredId(input.invoiceId, "invoiceId");
    const bankAccountId = requiredId(input.bankAccountId, "bankAccountId");
    const amount = requiredDecimal(input.amount, "amount", { positive: true });
    const method = requiredEnum(input.method, "method", PAYMENT_METHODS);
    const paidAt = optionalDate(input.paidAt, "paidAt") ?? new Date();
    const reference = optionalText(input.reference, "reference", 120);
    const idempotencyKey = requiredText(input.idempotencyKey, "idempotencyKey", 120);

    const replay = await this.prisma.payment.findFirst({ where: { companyId: scope.companyId, idempotencyKey } });
    if (replay) {
      const replayId = replay.customerInvoiceId ?? replay.supplierInvoiceId;
      if (replayId !== invoiceId) throw new ConflictException("idempotencyKey already used for another payment");
      return kind === "CUSTOMER" ? this.getCustomerInvoice(scope, invoiceId) : this.getSupplierInvoice(scope, invoiceId);
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        const account = await tx.bankAccount.findFirst({ where: { id: bankAccountId, ...scope } });
        if (!account) throw new NotFoundException("Bank account not found");
        if (!account.isActive) throw new BadRequestException("Bank account is inactive");
        const invoice =
          kind === "CUSTOMER" ? await this.lockCustomerInvoice(tx, scope, invoiceId) : await this.lockSupplierInvoice(tx, scope, invoiceId);
        const payable =
          kind === "CUSTOMER"
            ? ["ISSUED", "PARTIALLY_PAID"].includes(invoice.status)
            : ["APPROVED", "PARTIALLY_PAID"].includes(invoice.status);
        if (!payable) {
          throw new BadRequestException(
            kind === "SUPPLIER" && invoice.status === "RECORDED"
              ? "A supplier invoice must be approved before payment"
              : `An invoice with status ${invoice.status} cannot receive a payment`,
          );
        }
        if (account.currency.trim() !== invoice.currency.trim()) {
          throw new BadRequestException(
            `Account currency ${account.currency.trim()} differs from invoice currency ${invoice.currency.trim()} (no implicit conversion)`,
          );
        }
        const remaining = dec(invoice.total).minus(invoice.paidAmount);
        if (amount.greaterThan(remaining)) {
          throw new BadRequestException(`Payment ${money(amount)} exceeds the remaining balance ${money(remaining)}`);
        }
        const paidAmount = dec(invoice.paidAmount).plus(amount);
        const status = paidAmount.equals(invoice.total) ? "PAID" : "PARTIALLY_PAID";
        const code = await this.numbering.next(tx, scope, kind === "CUSTOMER" ? "ENC" : "DEC");
        const payment = await tx.payment.create({
          data: {
            ...scope,
            code,
            direction: kind === "CUSTOMER" ? "IN" : "OUT",
            customerInvoiceId: kind === "CUSTOMER" ? invoice.id : null,
            supplierInvoiceId: kind === "SUPPLIER" ? invoice.id : null,
            bankAccountId: account.id,
            amount,
            currency: invoice.currency.trim(),
            paidAt,
            method,
            reference,
            idempotencyKey,
            createdByUserId: actorUserId,
          },
        });
        if (kind === "CUSTOMER") {
          await tx.customerInvoice.update({ where: { id: invoice.id }, data: { paidAmount, status } });
        } else {
          await tx.supplierInvoice.update({ where: { id: invoice.id }, data: { paidAmount, status } });
        }
        await writeAudit(tx, scope, actorUserId, kind === "CUSTOMER" ? "finance.payment.received" : "finance.payment.sent", "Payment", payment.id, {
          code,
          invoiceId: invoice.id,
          amount: money(amount),
          method,
          invoiceStatus: status,
        });
      });
    } catch (error) {
      // Course sur la meme cle d'idempotence : la contrainte unique arbitre.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
    }
    return kind === "CUSTOMER" ? this.getCustomerInvoice(scope, invoiceId) : this.getSupplierInvoice(scope, invoiceId);
  }

  async listPayments(scope: CompanyScope, query: Record<string, unknown>): Promise<PaymentView[]> {
    const limit = optionalInt(query.limit, "limit", { min: 1, max: 500 }) ?? 100;
    const payments = await this.prisma.payment.findMany({
      where: scope,
      include: {
        bankAccount: true,
        customerInvoice: { select: { code: true, customerName: true } },
        supplierInvoice: { select: { code: true, supplierId: true } },
      },
      orderBy: { paidAt: "desc" },
      take: limit,
    });
    const supplierIds = [...new Set(payments.map((payment) => payment.supplierInvoice?.supplierId).filter((id): id is string => Boolean(id)))];
    const suppliers = supplierIds.length
      ? await this.prisma.supplier.findMany({ where: { id: { in: supplierIds }, ...scope }, select: { id: true, name: true } })
      : [];
    const supplierNames = new Map(suppliers.map((supplier) => [supplier.id, supplier.name]));
    return payments.map((payment) => ({
      id: payment.id,
      code: payment.code,
      direction: payment.direction,
      amount: money(payment.amount),
      currency: payment.currency.trim(),
      paidAt: payment.paidAt.toISOString(),
      method: payment.method,
      reference: payment.reference,
      bankAccountId: payment.bankAccountId,
      bankAccountName: payment.bankAccount.name,
      invoiceId: (payment.customerInvoiceId ?? payment.supplierInvoiceId)!,
      invoiceCode: payment.customerInvoice?.code ?? payment.supplierInvoice?.code ?? null,
      counterparty: payment.customerInvoice?.customerName ?? supplierNames.get(payment.supplierInvoice?.supplierId ?? "") ?? "—",
      createdAt: payment.createdAt.toISOString(),
    }));
  }

  async summary(scope: CompanyScope, canReadPayables: boolean): Promise<FinanceSummaryView> {
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: scope.companyId }, select: { currency: true } });
    const currency = company.currency.trim();
    const today = startOfToday();
    const [customer, supplier, accounts, toApprove] = await Promise.all([
      this.prisma.customerInvoice.findMany({
        where: { ...scope, currency, status: { in: ["ISSUED", "PARTIALLY_PAID"] } },
        select: { total: true, paidAmount: true, dueDate: true },
      }),
      this.prisma.supplierInvoice.findMany({
        where: { ...scope, currency, status: { in: ["APPROVED", "PARTIALLY_PAID"] } },
        select: { total: true, paidAmount: true, dueDate: true },
      }),
      this.listBankAccounts(scope),
      this.prisma.supplierInvoice.count({ where: { ...scope, status: "RECORDED" } }),
    ]);
    const due = (rows: Array<{ total: Prisma.Decimal; paidAmount: Prisma.Decimal; dueDate: Date | null }>, overdueOnly: boolean) =>
      sumDecimals(
        rows
          .filter((row) => !overdueOnly || (row.dueDate !== null && row.dueDate < today))
          .map((row) => dec(row.total).minus(row.paidAmount)),
      );
    return {
      currency,
      receivables: money(due(customer, false)),
      receivablesOverdue: money(due(customer, true)),
      // Deny-by-default : les dettes fournisseurs ne sont exposees qu'avec finance.payable.read.
      payables: canReadPayables ? money(due(supplier, false)) : null,
      payablesOverdue: canReadPayables ? money(due(supplier, true)) : null,
      cashPosition: money(sumDecimals(accounts.filter((account) => account.currency === currency).map((account) => account.balance))),
      toApprove,
    };
  }

  // ---------------------------------------------------------------------
  // Internes
  // ---------------------------------------------------------------------

  private async parseLines(tx: Tx, scope: CompanyScope, value: unknown, withOrderLine = false): Promise<ParsedLine[]> {
    if (!Array.isArray(value) || value.length === 0) throw new BadRequestException("lines must contain at least one line");
    if (value.length > 300) throw new BadRequestException("An invoice is limited to 300 lines");
    const rates = await tx.taxRate.findMany({ where: { ...scope, isActive: true } });
    const rateById = new Map(rates.map((rate) => [rate.id, dec(rate.rate)]));
    return value.map((raw, index) => {
      const line = assertBody(raw);
      const taxRateId = optionalId(line.taxRateId, `lines[${index}].taxRateId`);
      if (taxRateId && !rateById.has(taxRateId)) throw new BadRequestException(`lines[${index}].taxRateId is not an active tax rate`);
      return buildLine(
        index + 1,
        requiredText(line.description, `lines[${index}].description`, 240),
        requiredDecimal(line.quantity, `lines[${index}].quantity`, { positive: true }),
        requiredDecimal(line.unitPrice, `lines[${index}].unitPrice`),
        taxRateId ? rateById.get(taxRateId)! : new Prisma.Decimal(0),
        withOrderLine ? optionalId(line.orderLineId, `lines[${index}].orderLineId`) : null,
      );
    });
  }

  private async taxRateValue(tx: Tx, scope: CompanyScope, taxRateId: string | null): Promise<Prisma.Decimal> {
    if (!taxRateId) return new Prisma.Decimal(0);
    const rate = await tx.taxRate.findFirst({ where: { id: taxRateId, ...scope, isActive: true } });
    if (!rate) throw new BadRequestException("taxRateId is not an active tax rate");
    return dec(rate.rate);
  }

  private async lockCustomerInvoice(tx: Tx, scope: CompanyScope, invoiceId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "customer_invoices"
      WHERE "id" = ${invoiceId} AND "organizationId" = ${scope.organizationId} AND "companyId" = ${scope.companyId}
      FOR UPDATE
    `;
    if (rows.length === 0) throw new NotFoundException("Customer invoice not found");
    return tx.customerInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
  }

  private async lockSupplierInvoice(tx: Tx, scope: CompanyScope, invoiceId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "supplier_invoices"
      WHERE "id" = ${invoiceId} AND "organizationId" = ${scope.organizationId} AND "companyId" = ${scope.companyId}
      FOR UPDATE
    `;
    if (rows.length === 0) throw new NotFoundException("Supplier invoice not found");
    return tx.supplierInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
  }

  private async references(scope: CompanyScope, contractIds: Array<string | null>, projectIds: Array<string | null>) {
    const contracts = [...new Set(contractIds.filter((id): id is string => Boolean(id)))];
    const projects = [...new Set(projectIds.filter((id): id is string => Boolean(id)))];
    const [contractRows, projectRows] = await Promise.all([
      contracts.length ? this.prisma.contract.findMany({ where: { id: { in: contracts }, ...scope }, select: { id: true, code: true } }) : [],
      projects.length ? this.prisma.project.findMany({ where: { id: { in: projects }, ...scope }, select: { id: true, code: true } }) : [],
    ]);
    return {
      contracts: new Map(contractRows.map((row) => [row.id, row.code])),
      projects: new Map(projectRows.map((row) => [row.id, row.code])),
    };
  }

  private async supplierReferences(scope: CompanyScope, invoices: Array<{ supplierId: string; orderId: string | null; projectId: string | null }>) {
    const supplierIds = [...new Set(invoices.map((invoice) => invoice.supplierId))];
    const orderIds = [...new Set(invoices.map((invoice) => invoice.orderId).filter((id): id is string => Boolean(id)))];
    const projectIds = [...new Set(invoices.map((invoice) => invoice.projectId).filter((id): id is string => Boolean(id)))];
    const [suppliers, orders, projects] = await Promise.all([
      supplierIds.length ? this.prisma.supplier.findMany({ where: { id: { in: supplierIds }, ...scope }, select: { id: true, name: true } }) : [],
      orderIds.length ? this.prisma.purchaseOrder.findMany({ where: { id: { in: orderIds }, ...scope }, select: { id: true, code: true } }) : [],
      projectIds.length ? this.prisma.project.findMany({ where: { id: { in: projectIds }, ...scope }, select: { id: true, code: true } }) : [],
    ]);
    return {
      suppliers: new Map(suppliers.map((row) => [row.id, row.name])),
      orders: new Map(orders.map((row) => [row.id, row.code])),
      projects: new Map(projects.map((row) => [row.id, row.code])),
    };
  }
}

function buildLine(
  position: number,
  description: string,
  quantity: Prisma.Decimal,
  unitPrice: Prisma.Decimal,
  taxRate: Prisma.Decimal,
  orderLineId: string | null,
): ParsedLine {
  const lineTotal = quantity.mul(unitPrice).toDecimalPlaces(2);
  const lineTax = lineTotal.mul(taxRate).div(100).toDecimalPlaces(2);
  return { position, description, quantity, unitPrice, taxRate, lineTotal, lineTax, orderLineId };
}

function invoiceTotals(lines: ParsedLine[]) {
  const subtotal = sumDecimals(lines.map((line) => line.lineTotal));
  const taxTotal = sumDecimals(lines.map((line) => line.lineTax));
  return { subtotal, taxTotal, total: subtotal.plus(taxTotal) };
}

function startOfToday(): Date {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return today;
}

type InvoiceLineRow = {
  id: string;
  position: number;
  description: string;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  taxRate: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
  lineTax: Prisma.Decimal;
  orderLineId?: string | null;
};

type PaymentRow = Prisma.PaymentGetPayload<{ include: { bankAccount: true } }>;

function lineView(line: InvoiceLineRow) {
  return {
    id: line.id,
    position: line.position,
    description: line.description,
    quantity: qty(line.quantity),
    unitPrice: money(line.unitPrice),
    taxRate: dec(line.taxRate).toFixed(2),
    lineTotal: money(line.lineTotal),
    lineTax: money(line.lineTax),
    orderLineId: line.orderLineId ?? null,
  };
}

function paymentView(payment: PaymentRow, invoiceCode: string | null, counterparty: string): PaymentView {
  return {
    id: payment.id,
    code: payment.code,
    direction: payment.direction,
    amount: money(payment.amount),
    currency: payment.currency.trim(),
    paidAt: payment.paidAt.toISOString(),
    method: payment.method,
    reference: payment.reference,
    bankAccountId: payment.bankAccountId,
    bankAccountName: payment.bankAccount.name,
    invoiceId: (payment.customerInvoiceId ?? payment.supplierInvoiceId)!,
    invoiceCode,
    counterparty,
    createdAt: payment.createdAt.toISOString(),
  };
}

function toCustomerView(
  invoice: Prisma.CustomerInvoiceGetPayload<{ include: { lines: true; payments: { include: { bankAccount: true } } } }>,
  refs: { contracts: Map<string, string>; projects: Map<string, string> },
): CustomerInvoiceView {
  const balance = dec(invoice.total).minus(invoice.paidAmount);
  return {
    id: invoice.id,
    code: invoice.code,
    customerName: invoice.customerName,
    customerAddress: invoice.customerAddress,
    contractId: invoice.contractId,
    contractCode: invoice.contractId ? (refs.contracts.get(invoice.contractId) ?? null) : null,
    projectId: invoice.projectId,
    projectCode: invoice.projectId ? (refs.projects.get(invoice.projectId) ?? null) : null,
    currency: invoice.currency.trim(),
    issueDate: invoice.issueDate?.toISOString() ?? null,
    dueDate: invoice.dueDate?.toISOString() ?? null,
    status: invoice.status,
    subtotal: money(invoice.subtotal),
    taxTotal: money(invoice.taxTotal),
    total: money(invoice.total),
    paidAmount: money(invoice.paidAmount),
    balanceDue: money(balance),
    overdue: (invoice.status === "ISSUED" || invoice.status === "PARTIALLY_PAID") && invoice.dueDate !== null && invoice.dueDate < startOfToday(),
    notes: invoice.notes,
    cancelReason: invoice.cancelReason,
    createdAt: invoice.createdAt.toISOString(),
    lines: invoice.lines.map(lineView),
    payments: invoice.payments.map((payment) => paymentView(payment, invoice.code, invoice.customerName)),
  };
}

function toSupplierView(
  invoice: Prisma.SupplierInvoiceGetPayload<{ include: { lines: true; payments: { include: { bankAccount: true } } } }>,
  refs: { suppliers: Map<string, string>; orders: Map<string, string>; projects: Map<string, string> },
): SupplierInvoiceView {
  const balance = dec(invoice.total).minus(invoice.paidAmount);
  const supplierName = refs.suppliers.get(invoice.supplierId) ?? "—";
  return {
    id: invoice.id,
    code: invoice.code,
    supplierId: invoice.supplierId,
    supplierName,
    orderId: invoice.orderId,
    orderCode: invoice.orderId ? (refs.orders.get(invoice.orderId) ?? null) : null,
    projectId: invoice.projectId,
    projectCode: invoice.projectId ? (refs.projects.get(invoice.projectId) ?? null) : null,
    supplierReference: invoice.supplierReference,
    currency: invoice.currency.trim(),
    invoiceDate: invoice.invoiceDate.toISOString(),
    dueDate: invoice.dueDate.toISOString(),
    status: invoice.status,
    matchStatus: invoice.matchStatus,
    matchNotes: invoice.matchNotes,
    subtotal: money(invoice.subtotal),
    taxTotal: money(invoice.taxTotal),
    total: money(invoice.total),
    paidAmount: money(invoice.paidAmount),
    balanceDue: money(balance),
    overdue: (invoice.status === "APPROVED" || invoice.status === "PARTIALLY_PAID") && invoice.dueDate < startOfToday(),
    recordedByUserId: invoice.recordedByUserId,
    decidedByUserId: invoice.decidedByUserId,
    decidedAt: invoice.decidedAt?.toISOString() ?? null,
    decisionNote: invoice.decisionNote,
    createdAt: invoice.createdAt.toISOString(),
    lines: invoice.lines.map(lineView),
    payments: invoice.payments.map((payment) => paymentView(payment, invoice.code, supplierName)),
  };
}

export { APPROVED_SUPPLIER, OPEN_CUSTOMER };
