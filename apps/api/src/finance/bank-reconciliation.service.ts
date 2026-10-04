import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { BankStatementEntryView } from "@axora24/contracts";
import { Prisma } from "@axora24/database";
import type { CompanyScope } from "../common/company-scope.service.js";
import { PrismaService } from "../core/prisma.service.js";
import { writeAudit } from "../common/audit.js";
import { dec, money } from "../common/decimal.js";
import { currencyCode, optionalDate, requiredDate, requiredDecimal, requiredId, requiredText } from "../common/validation.js";

type EntryInput = { externalId?: unknown; bookedAt?: unknown; valueDate?: unknown; description?: unknown; amount?: unknown; currency?: unknown };
type ImportBody = { bankAccountId?: unknown; entries?: unknown };

@Injectable()
export class BankReconciliationService {
  constructor(private readonly prisma: PrismaService) {}

  async list(scope: CompanyScope, bankAccountId?: string): Promise<BankStatementEntryView[]> {
    const rows = await this.prisma.bankStatementEntry.findMany({ where: { organizationId: scope.organizationId, companyId: scope.companyId, ...(bankAccountId ? { bankAccountId } : {}) }, orderBy: [{ bookedAt: "desc" }, { createdAt: "desc" }], take: 500 });
    return rows.map((row) => this.view(row));
  }

  async importEntries(scope: CompanyScope, body: unknown, userId: string): Promise<{ imported: number; skipped: number; entries: BankStatementEntryView[] }> {
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new BadRequestException("Import de relevé invalide");
    const input = body as ImportBody;
    const bankAccountId = requiredId(input.bankAccountId, "bankAccountId");
    const entries = Array.isArray(input.entries) ? input.entries : [];
    if (entries.length === 0 || entries.length > 1000) throw new BadRequestException("Le relevé doit contenir entre 1 et 1000 lignes");
    const account = await this.prisma.bankAccount.findFirst({ where: { id: bankAccountId, organizationId: scope.organizationId, companyId: scope.companyId, isActive: true } });
    if (!account) throw new NotFoundException("Compte bancaire introuvable");
    let imported = 0;
    let skipped = 0;
    await this.prisma.$transaction(async (tx) => {
      for (const raw of entries) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new BadRequestException("Ligne de relevé invalide");
        const entry = raw as EntryInput;
        const externalId = requiredText(entry.externalId, "externalId", 180);
        const amount = requiredDecimal(entry.amount, "amount");
        if (amount.isZero()) throw new BadRequestException("Le montant d'un relevé ne peut pas être nul");
        const currency = currencyCode(entry.currency ?? account.currency);
        const bookedAt = requiredDate(entry.bookedAt, "bookedAt");
        const valueDate = optionalDate(entry.valueDate, "valueDate");
        const description = requiredText(entry.description, "description", 500);
        const existing = await tx.bankStatementEntry.findFirst({ where: { companyId: scope.companyId, bankAccountId, externalId } });
        if (existing) { skipped += 1; continue; }
        await tx.bankStatementEntry.create({ data: { organizationId: scope.organizationId, companyId: scope.companyId, bankAccountId, externalId, bookedAt, valueDate, description, amount: amount.toDecimalPlaces(2), currency } });
        imported += 1;
      }
      await writeAudit(tx, scope, userId, "finance.bank.statement.imported", "BankAccount", bankAccountId, { imported, skipped });
    });
    return { imported, skipped, entries: await this.list(scope, bankAccountId) };
  }

  async match(scope: CompanyScope, entryId: string, paymentId: string, userId: string): Promise<BankStatementEntryView> {
    const [entry, payment] = await Promise.all([
      this.prisma.bankStatementEntry.findFirst({ where: { id: entryId, organizationId: scope.organizationId, companyId: scope.companyId } }),
      this.prisma.payment.findFirst({ where: { id: paymentId, organizationId: scope.organizationId, companyId: scope.companyId } }),
    ]);
    if (!entry) throw new NotFoundException("Ligne de relevé introuvable");
    if (!payment) throw new NotFoundException("Paiement introuvable");
    if (entry.status !== "UNMATCHED") throw new ConflictException("Cette ligne est déjà rapprochée ou ignorée");
    if (entry.bankAccountId !== payment.bankAccountId || !dec(entry.amount).abs().equals(dec(payment.amount))) throw new BadRequestException("Le compte et le montant du relevé doivent correspondre au paiement");
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.bankStatementEntry.update({ where: { id: entry.id }, data: { status: "MATCHED", matchedPaymentId: payment.id, matchedAt: new Date(), matchedByUserId: userId } });
      await writeAudit(tx, scope, userId, "finance.bank.statement.matched", "BankStatementEntry", entry.id, { paymentId });
      return row;
    });
    return this.view(updated);
  }

  private view(row: Prisma.BankStatementEntryGetPayload<Record<string, never>>): BankStatementEntryView {
    return { id: row.id, bankAccountId: row.bankAccountId, externalId: row.externalId, bookedAt: row.bookedAt.toISOString(), valueDate: row.valueDate?.toISOString() ?? null, description: row.description, amount: money(row.amount), currency: row.currency.trim(), status: row.status, matchedPaymentId: row.matchedPaymentId, matchedAt: row.matchedAt?.toISOString() ?? null };
  }
}
