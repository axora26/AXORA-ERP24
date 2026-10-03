import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@axora24/database";
import type { CreditNoteKind, CreditNoteView, CreditRefundView } from "@axora24/contracts";
import { PrismaService } from "../core/prisma.service.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import { NumberingService } from "../common/numbering.service.js";
import { writeAudit } from "../common/audit.js";
import { dec, money, sumDecimals } from "../common/decimal.js";
import { requiredDecimal, requiredEnum, requiredId, requiredText, optionalText } from "../common/validation.js";
import { optionalDate } from "../crm/crm.dto.js";
import { creditAllocation } from "./credit-calculation.js";
import { invoiceCreditTotals, netInvoiceFigures } from "./credit-ledger.js";

const INCLUDE = { lines: { orderBy: { position: "asc" as const } }, refunds: { orderBy: { createdAt: "desc" as const } }, sourceInvoice: { include: { lines: true } } } as const;
type Note = Prisma.CustomerCreditNoteGetPayload<{ include: typeof INCLUDE }> | Prisma.SupplierCreditNoteGetPayload<{ include: typeof INCLUDE }>;
type Source = Prisma.CustomerInvoiceGetPayload<{ include: { lines: true } }> | Prisma.SupplierInvoiceGetPayload<{ include: { lines: true } }>;
type LineInput = { sourceInvoiceLineId: string; quantity: Prisma.Decimal };

@Injectable()
export class CreditNotesService {
  constructor(private readonly prisma: PrismaService, private readonly numbering: NumberingService) {}

  async list(scope: CompanyScope, kind: CreditNoteKind, query: Record<string, unknown>): Promise<CreditNoteView[]> {
    const sourceInvoiceId = query.invoiceId === undefined ? undefined : requiredId(query.invoiceId, "invoiceId");
    const status = query.status === undefined ? undefined : requiredEnum(query.status, "status", ["DRAFT", "ISSUED", "CANCELLED"] as const);
    const where = { ...scope, ...(sourceInvoiceId ? { sourceInvoiceId } : {}), ...(status ? { status } : {}) };
    const notes = kind === "CUSTOMER"
      ? await this.prisma.customerCreditNote.findMany({ where, include: INCLUDE, orderBy: [{ createdAt: "desc" }, { id: "desc" }] })
      : await this.prisma.supplierCreditNote.findMany({ where, include: INCLUDE, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    const totals = await invoiceCreditTotals(this.prisma, scope, kind, [...new Set(notes.map((note) => note.sourceInvoiceId))]);
    const names = kind === "SUPPLIER" ? await this.prisma.supplier.findMany({ where: { ...scope, id: { in: notes.map((note) => "supplierId" in note.sourceInvoice ? note.sourceInvoice.supplierId : "") } }, select: { id: true, name: true } }) : [];
    const suppliers = new Map(names.map((supplier) => [supplier.id, supplier.name]));
    return notes.map((note) => this.view(note, kind, netInvoiceFigures(note.sourceInvoice, totals.get(note.sourceInvoiceId)), suppliers));
  }

  async get(scope: CompanyScope, kind: CreditNoteKind, id: string): Promise<CreditNoteView> {
    const note = await this.findNote(this.prisma, scope, kind, id);
    const totals = await invoiceCreditTotals(this.prisma, scope, kind, [note.sourceInvoiceId]);
    const suppliers = new Map<string, string>();
    if ("supplierId" in note.sourceInvoice) {
      const supplier = await this.prisma.supplier.findFirst({ where: { id: note.sourceInvoice.supplierId, ...scope }, select: { id: true, name: true } });
      if (supplier) suppliers.set(supplier.id, supplier.name);
    }
    return this.view(note, kind, netInvoiceFigures(note.sourceInvoice, totals.get(note.sourceInvoiceId)), suppliers);
  }

  async create(scope: CompanyScope, kind: CreditNoteKind, body: unknown, actorUserId: string) {
    const input = inputFields(body, ["companyId", "invoiceId", "reason", "lines"]);
    const invoiceId = requiredId(input.invoiceId, "invoiceId");
    const reason = requiredText(input.reason, "reason", 2000);
    const requested = parseLines(input.lines, kind);
    const id = await this.prisma.$transaction(async (tx) => {
      const source = await this.lockSource(tx, scope, kind, invoiceId);
      assertSource(source, kind);
      const lines = await this.buildLines(tx, scope, kind, source, requested);
      const data = { ...scope, sourceInvoiceId: invoiceId, currency: source.currency.trim(), reason, createdByUserId: actorUserId, ...lineTotals(lines) };
      const note = kind === "CUSTOMER" ? await tx.customerCreditNote.create({ data }) : await tx.supplierCreditNote.create({ data });
      await this.replaceLines(tx, scope, kind, note.id, lines);
      await writeAudit(tx, scope, actorUserId, "finance.credit.drafted", `${kind}CreditNote`, note.id, { sourceInvoiceId: invoiceId, total: money(note.total), kind });
      return note.id;
    });
    return this.get(scope, kind, id);
  }

  async update(scope: CompanyScope, kind: CreditNoteKind, id: string, body: unknown, actorUserId: string) {
    const input = inputFields(body, ["companyId", "expectedVersion", "reason", "lines"]);
    const version = versionInput(input.expectedVersion);
    if (input.reason === undefined && input.lines === undefined) throw new BadRequestException("Provide a reason or lines to update");
    const reason = input.reason === undefined ? undefined : requiredText(input.reason, "reason", 2000);
    const requested = input.lines === undefined ? undefined : parseLines(input.lines, kind);
    const snapshot = await this.findNote(this.prisma, scope, kind, id);
    await this.prisma.$transaction(async (tx) => {
      const source = await this.lockSource(tx, scope, kind, snapshot.sourceInvoiceId);
      assertSource(source, kind);
      const note = await this.lockNote(tx, scope, kind, id); checkNote(note, version, "DRAFT");
      // Always refresh allocation when saving a draft, including a reason-only edit.
      const lines = await this.buildLines(tx, scope, kind, source, requested ?? note.lines.map((line) => ({ sourceInvoiceLineId: line.sourceInvoiceLineId, quantity: line.quantity })));
      const data = { ...(reason !== undefined ? { reason } : {}), ...lineTotals(lines), version: { increment: 1 } };
      const where = { id, ...scope, status: "DRAFT" as const, version };
      const result = kind === "CUSTOMER" ? await tx.customerCreditNote.updateMany({ where, data }) : await tx.supplierCreditNote.updateMany({ where, data });
      if (result.count !== 1) throw new ConflictException("Credit note changed; reload before saving");
      await this.replaceLines(tx, scope, kind, id, lines);
      await writeAudit(tx, scope, actorUserId, "finance.credit.updated", `${kind}CreditNote`, id, { kind, version: version + 1 });
    });
    return this.get(scope, kind, id);
  }

  async issue(scope: CompanyScope, kind: CreditNoteKind, id: string, body: unknown, actorUserId: string) {
    const input = inputFields(body, ["companyId", "expectedVersion", "issueDate"]);
    const version = versionInput(input.expectedVersion); const issueDate = dateInput(input.issueDate, "issueDate");
    const snapshot = await this.findNote(this.prisma, scope, kind, id);
    await this.prisma.$transaction(async (tx) => {
      const source = await this.lockSource(tx, scope, kind, snapshot.sourceInvoiceId);
      assertSource(source, kind);
      const note = await this.lockNote(tx, scope, kind, id); checkNote(note, version, "DRAFT");
      const originalDate = "issueDate" in source ? source.issueDate : source.invoiceDate;
      if (originalDate && issueDate < originalDate) throw new BadRequestException("A credit note cannot precede its source invoice");
      const lines = await this.buildLines(tx, scope, kind, source, note.lines.map((line) => ({ sourceInvoiceLineId: line.sourceInvoiceLineId, quantity: line.quantity })));
      if (lines.some((line) => {
        const saved = note.lines.find((entry) => entry.sourceInvoiceLineId === line.sourceInvoiceLineId)!;
        return !saved.lineTotal.equals(line.lineTotal) || !saved.lineTax.equals(line.lineTax);
      })) throw new ConflictException("Another issued credit changed this draft allocation. Refresh the draft before issuing it.");
      if (!note.total.greaterThan(0)) throw new BadRequestException("An issued credit note must have a positive total");
      const code = await this.numbering.next(tx, scope, kind === "CUSTOMER" ? "AVC" : "AVF", issueDate);
      const where = { id, ...scope, status: "DRAFT" as const, version };
      const data = { status: "ISSUED" as const, code, issueDate, issuedByUserId: actorUserId, version: { increment: 1 } };
      const result = kind === "CUSTOMER" ? await tx.customerCreditNote.updateMany({ where, data }) : await tx.supplierCreditNote.updateMany({ where, data });
      if (result.count !== 1) throw new ConflictException("Credit note changed; reload before issuing");
      await writeAudit(tx, scope, actorUserId, "finance.credit.issued", `${kind}CreditNote`, id, { kind, code, sourceInvoiceId: source.id, total: money(note.total), version: version + 1 });
    });
    return this.get(scope, kind, id);
  }

  async cancel(scope: CompanyScope, kind: CreditNoteKind, id: string, body: unknown, actorUserId: string) {
    const input = inputFields(body, ["companyId", "expectedVersion", "reason"]);
    const version = versionInput(input.expectedVersion); const reason = requiredText(input.reason, "reason", 2000);
    const snapshot = await this.findNote(this.prisma, scope, kind, id);
    await this.prisma.$transaction(async (tx) => {
      await this.lockSource(tx, scope, kind, snapshot.sourceInvoiceId);
      const note = await this.lockNote(tx, scope, kind, id); checkNote(note, version, "DRAFT");
      const where = { id, ...scope, status: "DRAFT" as const, version };
      const data = { status: "CANCELLED" as const, cancelReason: reason, version: { increment: 1 } };
      const result = kind === "CUSTOMER" ? await tx.customerCreditNote.updateMany({ where, data }) : await tx.supplierCreditNote.updateMany({ where, data });
      if (result.count !== 1) throw new ConflictException("Credit note changed; reload before cancelling");
      await writeAudit(tx, scope, actorUserId, "finance.credit.cancelled", `${kind}CreditNote`, id, { kind, reason, version: version + 1 });
    });
    return this.get(scope, kind, id);
  }

  async refund(scope: CompanyScope, kind: CreditNoteKind, id: string, body: unknown, actorUserId: string) {
    const input = inputFields(body, ["companyId", "amount", "bankAccountId", "refundedAt", "method", "reference", "idempotencyKey"]);
    const amount = requiredDecimal(input.amount, "amount", { positive: true });
    if (amount.decimalPlaces() > 2) throw new BadRequestException("Refund amount supports at most two decimals");
    const bankAccountId = requiredId(input.bankAccountId, "bankAccountId");
    const refundedAt = dateInput(input.refundedAt, "refundedAt");
    const method = requiredEnum(input.method, "method", ["TRANSFER", "CHECK", "CASH", "MOBILE_MONEY", "CARD"] as const);
    const reference = optionalText(input.reference, "reference", 120);
    const idempotencyKey = requiredText(input.idempotencyKey, "idempotencyKey", 120);
    const snapshot = await this.findNote(this.prisma, scope, kind, id);
    try {
      await this.prisma.$transaction(async (tx) => {
        const source = await this.lockSource(tx, scope, kind, snapshot.sourceInvoiceId);
        const note = await this.lockNote(tx, scope, kind, id);
        if (note.status !== "ISSUED") throw new BadRequestException("Only an issued credit note can be refunded");
        const replay = await tx.creditRefund.findFirst({ where: { ...scope, idempotencyKey } });
        if (replay) { checkReplay(replay, kind, id, amount, bankAccountId, refundedAt, method, reference); return; }
        if (note.issueDate && refundedAt < note.issueDate) throw new BadRequestException("Refund cannot precede the issued credit note");
        const bankRows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "bank_accounts" WHERE "id" = ${bankAccountId} AND "organizationId" = ${scope.organizationId} AND "companyId" = ${scope.companyId} FOR UPDATE`;
        if (!bankRows.length) throw new NotFoundException("Bank account not found");
        const bank = await tx.bankAccount.findUniqueOrThrow({ where: { id: bankAccountId } });
        if (!bank.isActive) throw new BadRequestException("Bank account is inactive");
        if (bank.currency.trim() !== note.currency.trim()) throw new BadRequestException("Refund and bank currencies differ; no implicit currency conversion");
        const totals = await invoiceCreditTotals(tx, scope, kind, [source.id]);
        const figures = netInvoiceFigures(source, totals.get(source.id));
        const noteRemaining = note.total.minus(sumDecimals(note.refunds.map((entry) => entry.amount)));
        if (amount.greaterThan(figures.refundDue) || amount.greaterThan(noteRemaining)) throw new BadRequestException("Refund exceeds the amount currently due or this credit note's remaining refund balance");
        const code = await this.numbering.next(tx, scope, kind === "CUSTOMER" ? "RMC" : "RMF", refundedAt);
        const refund = await tx.creditRefund.create({ data: { ...scope, code, direction: kind === "CUSTOMER" ? "OUT" : "IN",
          customerCreditNoteId: kind === "CUSTOMER" ? id : null, supplierCreditNoteId: kind === "SUPPLIER" ? id : null,
          bankAccountId, amount, currency: note.currency.trim(), refundedAt, method, reference, idempotencyKey, createdByUserId: actorUserId } });
        await writeAudit(tx, scope, actorUserId, "finance.credit.refunded", "CreditRefund", refund.id, { kind, creditNoteId: id, sourceInvoiceId: source.id, amount: money(amount), bankAccountId, code });
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
      const replay = await this.prisma.creditRefund.findFirst({ where: { ...scope, idempotencyKey } });
      if (!replay) throw error;
      checkReplay(replay, kind, id, amount, bankAccountId, refundedAt, method, reference);
    }
    return this.get(scope, kind, id);
  }

  private async findNote(tx: Prisma.TransactionClient, scope: CompanyScope, kind: CreditNoteKind, id: string): Promise<Note> {
    const note = kind === "CUSTOMER" ? await tx.customerCreditNote.findFirst({ where: { id, ...scope }, include: INCLUDE }) : await tx.supplierCreditNote.findFirst({ where: { id, ...scope }, include: INCLUDE });
    if (!note) throw new NotFoundException("Credit note not found"); return note;
  }
  private async lockNote(tx: Prisma.TransactionClient, scope: CompanyScope, kind: CreditNoteKind, id: string) {
    const rows = kind === "CUSTOMER"
      ? await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "customer_credit_notes" WHERE "id" = ${id} AND "organizationId" = ${scope.organizationId} AND "companyId" = ${scope.companyId} FOR UPDATE`
      : await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "supplier_credit_notes" WHERE "id" = ${id} AND "organizationId" = ${scope.organizationId} AND "companyId" = ${scope.companyId} FOR UPDATE`;
    if (!rows.length) throw new NotFoundException("Credit note not found"); return this.findNote(tx, scope, kind, id);
  }
  private async lockSource(tx: Prisma.TransactionClient, scope: CompanyScope, kind: CreditNoteKind, id: string): Promise<Source> {
    if (kind === "CUSTOMER") {
      const invoice = await tx.customerInvoice.findFirst({ where: { id, ...scope }, select: { contractId: true } });
      if (!invoice) throw new NotFoundException("Source invoice not found");
      if (invoice.contractId) await tx.$queryRaw`SELECT "id" FROM "contracts" WHERE "id" = ${invoice.contractId} AND "organizationId" = ${scope.organizationId} AND "companyId" = ${scope.companyId} FOR UPDATE`;
    }
    const rows = kind === "CUSTOMER"
      ? await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "customer_invoices" WHERE "id" = ${id} AND "organizationId" = ${scope.organizationId} AND "companyId" = ${scope.companyId} FOR UPDATE`
      : await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "supplier_invoices" WHERE "id" = ${id} AND "organizationId" = ${scope.organizationId} AND "companyId" = ${scope.companyId} FOR UPDATE`;
    if (!rows.length) throw new NotFoundException("Source invoice not found");
    return kind === "CUSTOMER" ? tx.customerInvoice.findUniqueOrThrow({ where: { id }, include: { lines: true } }) : tx.supplierInvoice.findUniqueOrThrow({ where: { id }, include: { lines: true } });
  }
  private async buildLines(tx: Prisma.TransactionClient, scope: CompanyScope, kind: CreditNoteKind, source: Source, requested: LineInput[]) {
    const where = { ...scope, sourceInvoiceId: source.id, creditNote: { status: "ISSUED" as const } };
    const previous = kind === "CUSTOMER"
      ? await tx.customerCreditNoteLine.groupBy({ by: ["sourceInvoiceLineId"], where, _sum: { quantity: true, lineTotal: true, lineTax: true } })
      : await tx.supplierCreditNoteLine.groupBy({ by: ["sourceInvoiceLineId"], where, _sum: { quantity: true, lineTotal: true, lineTax: true } });
    const map = new Map(previous.map((entry) => [entry.sourceInvoiceLineId, entry._sum]));
    return requested.map((entry) => {
      const original = source.lines.find((line) => line.id === entry.sourceInvoiceLineId);
      if (!original) throw new BadRequestException("Every credit line must belong to the selected source invoice");
      const already = map.get(original.id);
      const allocation = creditAllocation(original, { quantity: dec(already?.quantity), lineTotal: dec(already?.lineTotal), lineTax: dec(already?.lineTax) }, entry.quantity);
      return { ...scope, sourceInvoiceId: source.id, sourceInvoiceLineId: original.id, position: original.position,
        description: original.description, quantity: entry.quantity, unitPrice: original.unitPrice, taxRate: original.taxRate, ...allocation };
    });
  }
  private async replaceLines(tx: Prisma.TransactionClient, scope: CompanyScope, kind: CreditNoteKind, id: string, lines: Awaited<ReturnType<CreditNotesService["buildLines"]>>) {
    const data = lines.map((line) => ({ ...line, creditNoteId: id }));
    if (kind === "CUSTOMER") {
      await tx.customerCreditNoteLine.deleteMany({ where: { creditNoteId: id, ...scope } });
      await tx.customerCreditNoteLine.createMany({ data });
    } else {
      await tx.supplierCreditNoteLine.deleteMany({ where: { creditNoteId: id, ...scope } });
      await tx.supplierCreditNoteLine.createMany({ data });
    }
  }
  private view(note: Note, kind: CreditNoteKind, invoice: CreditNoteView["invoice"], suppliers: Map<string, string>): CreditNoteView {
    return { id: note.id, companyId: note.companyId, kind, code: note.code, sourceInvoiceId: note.sourceInvoiceId, sourceInvoiceCode: note.sourceInvoice.code,
      sourceInvoiceName: "customerName" in note.sourceInvoice ? note.sourceInvoice.customerName : suppliers.get(note.sourceInvoice.supplierId) ?? "Fournisseur",
      currency: note.currency.trim(), reason: note.reason, status: note.status, version: note.version, issueDate: note.issueDate?.toISOString() ?? null,
      subtotal: money(note.subtotal), taxTotal: money(note.taxTotal), total: money(note.total), cancelReason: note.cancelReason,
      createdAt: note.createdAt.toISOString(), updatedAt: note.updatedAt.toISOString(), invoice,
      lines: note.lines.map((line) => ({ id: line.id, sourceInvoiceLineId: line.sourceInvoiceLineId, position: line.position, description: line.description,
        quantity: line.quantity.toFixed(6), unitPrice: line.unitPrice.toFixed(6), taxRate: line.taxRate.toFixed(2), lineTotal: money(line.lineTotal), lineTax: money(line.lineTax) })),
      refunds: note.refunds.map(refundView) };
  }
}

function inputFields(body: unknown, allowed: string[]): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new BadRequestException("A JSON object is required");
  const input = body as Record<string, unknown>;
  const unknown = Object.keys(input).find((key) => !allowed.includes(key));
  if (unknown) throw new BadRequestException(`Unknown field: ${unknown}`); return input;
}
function parseLines(value: unknown, kind: CreditNoteKind): LineInput[] {
  if (!Array.isArray(value) || !value.length || value.length > 500) throw new BadRequestException("Provide between one and 500 source invoice lines");
  const ids = new Set<string>();
  return value.map((entry, index) => {
    const line = inputFields(entry, ["sourceInvoiceLineId", "quantity"]);
    const sourceInvoiceLineId = requiredId(line.sourceInvoiceLineId, `lines[${index}].sourceInvoiceLineId`);
    if (ids.has(sourceInvoiceLineId)) throw new BadRequestException("A source invoice line may appear only once per credit note"); ids.add(sourceInvoiceLineId);
    const quantity = requiredDecimal(line.quantity, `lines[${index}].quantity`, { positive: true });
    if (quantity.decimalPlaces() > (kind === "SUPPLIER" ? 3 : 6)) throw new BadRequestException("Credit quantity exceeds source precision");
    return { sourceInvoiceLineId, quantity };
  });
}
function versionInput(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new BadRequestException("expectedVersion must be a positive integer"); return value;
}
function dateInput(value: unknown, field: string): Date {
  const result = optionalDate(value, field); if (!result) throw new BadRequestException(`${field} is required`); return result;
}
function assertSource(source: Source, kind: CreditNoteKind) {
  const allowed = kind === "CUSTOMER" ? ["ISSUED", "PARTIALLY_PAID", "PAID"] : ["APPROVED", "PARTIALLY_PAID", "PAID"];
  if (!allowed.includes(source.status)) throw new BadRequestException("The source invoice must already be issued or approved");
}
function checkNote(note: Note, version: number, status: string) {
  if (note.status !== status) throw new BadRequestException("Issued and cancelled credit notes are immutable");
  if (note.version !== version) throw new ConflictException("Credit note was changed by another user. Reload before saving.");
}
function lineTotals(lines: Array<{ lineTotal: Prisma.Decimal; lineTax: Prisma.Decimal }>) {
  const subtotal = sumDecimals(lines.map((line) => line.lineTotal)); const taxTotal = sumDecimals(lines.map((line) => line.lineTax));
  return { subtotal, taxTotal, total: subtotal.plus(taxTotal) };
}
type Refund = Prisma.CreditRefundGetPayload<Record<string, never>>;
function refundView(refund: Refund): CreditRefundView {
  return { id: refund.id, code: refund.code, creditNoteId: refund.customerCreditNoteId ?? refund.supplierCreditNoteId!, direction: refund.direction,
    bankAccountId: refund.bankAccountId, amount: money(refund.amount), currency: refund.currency.trim(), refundedAt: refund.refundedAt.toISOString(),
    method: refund.method, reference: refund.reference, createdAt: refund.createdAt.toISOString() };
}
function checkReplay(refund: Refund, kind: CreditNoteKind, id: string, amount: Prisma.Decimal, bankAccountId: string, refundedAt: Date, method: string, reference: string | null) {
  if ((kind === "CUSTOMER" ? refund.customerCreditNoteId : refund.supplierCreditNoteId) !== id || !refund.amount.equals(amount)
    || refund.bankAccountId !== bankAccountId || refund.refundedAt.getTime() !== refundedAt.getTime() || refund.method !== method || refund.reference !== reference) {
    throw new ConflictException("idempotencyKey was already used for a different refund");
  }
}
