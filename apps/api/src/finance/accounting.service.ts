import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@axora24/database";
import type {
  AccountingAccountView,
  AccountingEntryView,
  AccountingFinancialStatementsView,
  AccountingJournalView,
  AccountingTrialBalanceView,
} from "@axora24/contracts";
import { PrismaService } from "../core/prisma.service.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import { NumberingService } from "../common/numbering.service.js";
import { writeAudit } from "../common/audit.js";
import { assertBody, optionalId, requiredDate, requiredDecimal, requiredEnum, requiredId, requiredText } from "../common/validation.js";
import { dec, money, sumDecimals } from "../common/decimal.js";

type Tx = Prisma.TransactionClient;
type EntryWithLines = Prisma.AccountingEntryGetPayload<{ include: { journal: true; lines: { include: { account: true } } } }>;

const DEFAULT_ACCOUNTS = [
  { code: "411000", name: "Clients", type: "ASSET" as const, systemKey: "CUSTOMER_RECEIVABLE" },
  { code: "401000", name: "Fournisseurs", type: "LIABILITY" as const, systemKey: "SUPPLIER_PAYABLE" },
  { code: "512000", name: "Banques", type: "ASSET" as const, systemKey: "BANK" },
  { code: "530000", name: "Caisses", type: "ASSET" as const, systemKey: "CASH" },
  { code: "706000", name: "Ventes de services et travaux", type: "REVENUE" as const, systemKey: "SALES_REVENUE" },
  { code: "607000", name: "Achats et charges de production", type: "EXPENSE" as const, systemKey: "PURCHASE_EXPENSE" },
  { code: "445710", name: "TVA collectée", type: "LIABILITY" as const, systemKey: "OUTPUT_TAX" },
  { code: "445660", name: "TVA déductible", type: "ASSET" as const, systemKey: "INPUT_TAX" },
  { code: "101000", name: "Capital et réserves", type: "EQUITY" as const, systemKey: "EQUITY" },
];

@Injectable()
export class AccountingService {
  constructor(private readonly prisma: PrismaService, private readonly numbering: NumberingService) {}

  async bootstrap(scope: CompanyScope, actorUserId: string) {
    await this.prisma.$transaction(async (tx) => {
      await this.ensureDefaults(tx, scope);
      await writeAudit(tx, scope, actorUserId, "finance.accounting.bootstrapped", "Accounting", scope.companyId, {
        accounts: DEFAULT_ACCOUNTS.length,
        journal: "VE",
      });
    });
    // Reprise idempotente des faits Finance déjà présents avant l'activation
    // de la comptabilité : aucun doublon grâce à (sourceType, sourceId).
    const [customerInvoices, supplierInvoices, payments] = await Promise.all([
      this.prisma.customerInvoice.findMany({ where: { ...scope, status: { in: ["ISSUED", "PARTIALLY_PAID", "PAID"] } }, select: { id: true } }),
      this.prisma.supplierInvoice.findMany({ where: { ...scope, status: { in: ["APPROVED", "PARTIALLY_PAID", "PAID"] } }, select: { id: true } }),
      this.prisma.payment.findMany({ where: scope, select: { id: true } }),
    ]);
    for (const invoice of customerInvoices) await this.postCustomerInvoice(scope, invoice.id, actorUserId);
    for (const invoice of supplierInvoices) await this.postSupplierInvoice(scope, invoice.id, actorUserId);
    for (const payment of payments) await this.postPayment(scope, payment.id, actorUserId);
    return this.configuration(scope);
  }

  async configuration(scope: CompanyScope) {
    const [accounts, journals] = await Promise.all([this.listAccounts(scope), this.listJournals(scope)]);
    return { accounts, journals };
  }

  async listAccounts(scope: CompanyScope): Promise<AccountingAccountView[]> {
    const [accounts, lines] = await Promise.all([
      this.prisma.accountingAccount.findMany({ where: scope, orderBy: { code: "asc" } }),
      this.prisma.accountingEntryLine.findMany({
        where: scope,
        select: { accountId: true, debit: true, credit: true, entry: { select: { status: true } } },
      }),
    ]);
    const totals = new Map<string, { debit: Prisma.Decimal; credit: Prisma.Decimal }>();
    for (const line of lines) {
      if (line.entry.status !== "POSTED") continue;
      const total = totals.get(line.accountId) ?? { debit: new Prisma.Decimal(0), credit: new Prisma.Decimal(0) };
      total.debit = total.debit.plus(line.debit);
      total.credit = total.credit.plus(line.credit);
      totals.set(line.accountId, total);
    }
    return accounts.map((account) => {
      const total = totals.get(account.id) ?? { debit: new Prisma.Decimal(0), credit: new Prisma.Decimal(0) };
      return {
        id: account.id,
        code: account.code,
        name: account.name,
        type: account.type,
        systemKey: account.systemKey,
        parentId: account.parentId,
        isActive: account.isActive,
        debit: money(total.debit),
        credit: money(total.credit),
        balance: money(total.debit.minus(total.credit)),
      };
    });
  }

  async listJournals(scope: CompanyScope): Promise<AccountingJournalView[]> {
    const journals = await this.prisma.accountingJournal.findMany({ where: scope, orderBy: { code: "asc" } });
    return journals.map((journal) => ({ id: journal.id, code: journal.code, name: journal.name, type: journal.type, isActive: journal.isActive }));
  }

  async createAccount(scope: CompanyScope, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const code = requiredText(input.code, "code", 30).toUpperCase();
    if (!/^[0-9A-Z._-]+$/.test(code)) throw new BadRequestException("code contains invalid characters");
    const name = requiredText(input.name, "name", 160);
    const type = requiredEnum(input.type, "type", ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"] as const);
    const parentId = optionalId(input.parentId, "parentId");
    await this.prisma.$transaction(async (tx) => {
      if (parentId && !(await tx.accountingAccount.findFirst({ where: { id: parentId, ...scope } }))) throw new NotFoundException("Parent account not found");
      const duplicate = await tx.accountingAccount.findFirst({ where: { companyId: scope.companyId, code }, select: { id: true } });
      if (duplicate) throw new ConflictException(`Account ${code} already exists`);
      const account = await tx.accountingAccount.create({ data: { ...scope, code, name, type, parentId } });
      await writeAudit(tx, scope, actorUserId, "finance.accounting.account.created", "AccountingAccount", account.id, { code, type });
    });
    return this.listAccounts(scope);
  }

  async createJournal(scope: CompanyScope, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const code = requiredText(input.code, "code", 20).toUpperCase();
    const name = requiredText(input.name, "name", 120);
    const type = requiredEnum(input.type ?? "GENERAL", "type", ["SALES", "PURCHASES", "BANK", "CASH", "GENERAL"] as const);
    await this.prisma.$transaction(async (tx) => {
      const duplicate = await tx.accountingJournal.findFirst({ where: { companyId: scope.companyId, code }, select: { id: true } });
      if (duplicate) throw new ConflictException(`Journal ${code} already exists`);
      const journal = await tx.accountingJournal.create({ data: { ...scope, code, name, type } });
      await writeAudit(tx, scope, actorUserId, "finance.accounting.journal.created", "AccountingJournal", journal.id, { code, type });
    });
    return this.listJournals(scope);
  }

  async listEntries(scope: CompanyScope, query: Record<string, unknown>): Promise<AccountingEntryView[]> {
    const from = query.from ? requiredDate(query.from, "from") : null;
    const to = query.to ? requiredDate(query.to, "to") : null;
    const journalId = optionalId(query.journalId, "journalId");
    const entries = await this.prisma.accountingEntry.findMany({
      where: { ...scope, ...(journalId ? { journalId } : {}), ...(from || to ? { entryDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: new Date(to.getTime() + 86_399_999) } : {}) } } : {}) },
      include: { journal: true, lines: { include: { account: true }, orderBy: { createdAt: "asc" } } },
      orderBy: [{ entryDate: "desc" }, { number: "desc" }],
      take: 500,
    });
    return entries.map((entry) => this.toEntryView(entry));
  }

  async trialBalance(scope: CompanyScope, query: Record<string, unknown>): Promise<AccountingTrialBalanceView> {
    const from = query.from ? requiredDate(query.from, "from") : null;
    const to = query.to ? requiredDate(query.to, "to") : null;
    const lines = await this.prisma.accountingEntryLine.findMany({
      where: { ...scope, entry: { status: "POSTED", ...(from || to ? { entryDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: new Date(to.getTime() + 86_399_999) } : {}) } } : {}) } },
      include: { account: true },
    });
    const totals = new Map<string, { account: (typeof lines)[number]["account"]; debit: Prisma.Decimal; credit: Prisma.Decimal }>();
    for (const line of lines) {
      const total = totals.get(line.accountId) ?? { account: line.account, debit: new Prisma.Decimal(0), credit: new Prisma.Decimal(0) };
      total.debit = total.debit.plus(line.debit);
      total.credit = total.credit.plus(line.credit);
      totals.set(line.accountId, total);
    }
    const rows = [...totals.values()].sort((a, b) => a.account.code.localeCompare(b.account.code)).map((row) => ({
      accountId: row.account.id,
      code: row.account.code,
      name: row.account.name,
      type: row.account.type,
      debit: money(row.debit),
      credit: money(row.credit),
      balance: money(row.debit.minus(row.credit)),
    }));
    return {
      currency: (await this.prisma.company.findUniqueOrThrow({ where: { id: scope.companyId }, select: { currency: true } })).currency.trim(),
      from: from?.toISOString() ?? null,
      to: to?.toISOString() ?? null,
      totalDebit: money(sumDecimals(rows.map((row) => row.debit))),
      totalCredit: money(sumDecimals(rows.map((row) => row.credit))),
      rows,
    };
  }

  async financialStatements(scope: CompanyScope, query: Record<string, unknown>): Promise<AccountingFinancialStatementsView> {
    const from = query.from ? requiredDate(query.from, "from") : null;
    const to = query.to ? requiredDate(query.to, "to") : null;
    const lines = await this.prisma.accountingEntryLine.findMany({
      where: { ...scope, entry: { status: "POSTED", ...(from || to ? { entryDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: new Date(to.getTime() + 86_399_999) } : {}) } } : {}) } },
      include: { account: true },
    });
    const totals = new Map<string, { account: (typeof lines)[number]["account"]; debit: Prisma.Decimal; credit: Prisma.Decimal }>();
    for (const line of lines) {
      const total = totals.get(line.accountId) ?? { account: line.account, debit: new Prisma.Decimal(0), credit: new Prisma.Decimal(0) };
      total.debit = total.debit.plus(line.debit);
      total.credit = total.credit.plus(line.credit);
      totals.set(line.accountId, total);
    }
    const revenueRows = [...totals.values()].filter((row) => row.account.type === "REVENUE").map((row) => ({ accountId: row.account.id, code: row.account.code, name: row.account.name, amount: row.credit.minus(row.debit) })).filter((row) => !row.amount.isZero()).sort((a, b) => a.code.localeCompare(b.code));
    const expenseRows = [...totals.values()].filter((row) => row.account.type === "EXPENSE").map((row) => ({ accountId: row.account.id, code: row.account.code, name: row.account.name, amount: row.debit.minus(row.credit) })).filter((row) => !row.amount.isZero()).sort((a, b) => a.code.localeCompare(b.code));
    const assetRows = [...totals.values()].filter((row) => row.account.type === "ASSET").map((row) => ({ accountId: row.account.id, code: row.account.code, name: row.account.name, amount: row.debit.minus(row.credit) })).filter((row) => !row.amount.isZero()).sort((a, b) => a.code.localeCompare(b.code));
    const liabilityRows = [...totals.values()].filter((row) => row.account.type === "LIABILITY").map((row) => ({ accountId: row.account.id, code: row.account.code, name: row.account.name, amount: row.credit.minus(row.debit) })).filter((row) => !row.amount.isZero()).sort((a, b) => a.code.localeCompare(b.code));
    const equityRows = [...totals.values()].filter((row) => row.account.type === "EQUITY").map((row) => ({ accountId: row.account.id, code: row.account.code, name: row.account.name, amount: row.credit.minus(row.debit) })).filter((row) => !row.amount.isZero()).sort((a, b) => a.code.localeCompare(b.code));
    const totalRevenue = sumDecimals(revenueRows.map((row) => row.amount));
    const totalExpenses = sumDecimals(expenseRows.map((row) => row.amount));
    const netIncome = totalRevenue.minus(totalExpenses);
    const totalAssets = sumDecimals(assetRows.map((row) => row.amount));
    const totalLiabilities = sumDecimals(liabilityRows.map((row) => row.amount));
    const totalEquity = sumDecimals(equityRows.map((row) => row.amount)).plus(netIncome);
    return {
      currency: (await this.prisma.company.findUniqueOrThrow({ where: { id: scope.companyId }, select: { currency: true } })).currency.trim(),
      from: from?.toISOString() ?? null,
      to: to?.toISOString() ?? null,
      incomeStatement: [...revenueRows, ...expenseRows].map((row) => ({ ...row, amount: money(row.amount) })),
      balanceSheet: [...assetRows, ...liabilityRows, ...equityRows, ...(netIncome.isZero() ? [] : [{ accountId: "net-income", code: "RESULTAT", name: "Résultat de la période", amount: netIncome }])].map((row) => ({ ...row, amount: money(row.amount) })),
      totalRevenue: money(totalRevenue),
      totalExpenses: money(totalExpenses),
      netIncome: money(netIncome),
      totalAssets: money(totalAssets),
      totalLiabilities: money(totalLiabilities),
      totalEquity: money(totalEquity),
    };
  }

  async createManualEntry(scope: CompanyScope, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const journalId = requiredId(input.journalId, "journalId");
    const entryDate = requiredDate(input.entryDate, "entryDate");
    const description = requiredText(input.description, "description", 500);
    const currency = requiredText(input.currency, "currency", 3).toUpperCase();
    const lines = this.parseLines(input.lines);
    return this.createEntry(scope, { journalId, entryDate, description, currency, lines }, actorUserId);
  }

  async postCustomerInvoice(scope: CompanyScope, invoiceId: string, actorUserId: string) {
    const invoice = await this.prisma.customerInvoice.findFirst({ where: { id: invoiceId, ...scope }, include: { lines: true } });
    if (!invoice) throw new NotFoundException("Customer invoice not found");
    if (!["ISSUED", "PARTIALLY_PAID", "PAID"].includes(invoice.status)) return null;
    const existing = await this.prisma.accountingEntry.findFirst({ where: { ...scope, sourceType: "CUSTOMER_INVOICE", sourceId: invoice.id } });
    if (existing) return this.toEntryView(await this.getEntry(this.prisma, existing.id));
    const accounts = await this.ensureDefaultsInTransaction(scope);
    return this.createEntry(scope, {
      journalId: accounts.journalId,
      entryDate: invoice.issueDate ?? invoice.createdAt,
      description: `Facture client ${invoice.code ?? invoice.id}`,
      currency: invoice.currency.trim(),
      sourceType: "CUSTOMER_INVOICE",
      sourceId: invoice.id,
      lines: [
        { accountId: accounts.customerReceivable.id, label: invoice.customerName, debit: invoice.total, credit: new Prisma.Decimal(0), projectId: invoice.projectId },
        { accountId: accounts.salesRevenue.id, label: "Produits facturés", debit: new Prisma.Decimal(0), credit: invoice.subtotal, projectId: invoice.projectId },
        ...(dec(invoice.taxTotal).isZero() ? [] : [{ accountId: accounts.outputTax.id, label: "Taxes facturées", debit: new Prisma.Decimal(0), credit: invoice.taxTotal, projectId: invoice.projectId }]),
      ],
    }, actorUserId);
  }

  async postSupplierInvoice(scope: CompanyScope, invoiceId: string, actorUserId: string) {
    const invoice = await this.prisma.supplierInvoice.findFirst({ where: { id: invoiceId, ...scope } });
    if (!invoice) throw new NotFoundException("Supplier invoice not found");
    if (!["APPROVED", "PARTIALLY_PAID", "PAID"].includes(invoice.status)) return null;
    const existing = await this.prisma.accountingEntry.findFirst({ where: { ...scope, sourceType: "SUPPLIER_INVOICE", sourceId: invoice.id } });
    if (existing) return this.toEntryView(await this.getEntry(this.prisma, existing.id));
    const accounts = await this.ensureDefaultsInTransaction(scope);
    return this.createEntry(scope, {
      journalId: accounts.journalId,
      entryDate: invoice.invoiceDate,
      description: `Facture fournisseur ${invoice.code}`,
      currency: invoice.currency.trim(),
      sourceType: "SUPPLIER_INVOICE",
      sourceId: invoice.id,
      lines: [
        { accountId: accounts.purchaseExpense.id, label: "Achats et charges", debit: invoice.subtotal, credit: new Prisma.Decimal(0), projectId: invoice.projectId },
        ...(dec(invoice.taxTotal).isZero() ? [] : [{ accountId: accounts.inputTax.id, label: "Taxes déductibles", debit: invoice.taxTotal, credit: new Prisma.Decimal(0), projectId: invoice.projectId }]),
        { accountId: accounts.supplierPayable.id, label: "Dette fournisseur", debit: new Prisma.Decimal(0), credit: invoice.total, projectId: invoice.projectId },
      ],
    }, actorUserId);
  }

  async postPayment(scope: CompanyScope, paymentId: string, actorUserId: string) {
    const payment = await this.prisma.payment.findFirst({ where: { id: paymentId, ...scope }, include: { bankAccount: true } });
    if (!payment) throw new NotFoundException("Payment not found");
    const sourceType = payment.customerInvoiceId ? "CUSTOMER_PAYMENT" : "SUPPLIER_PAYMENT";
    const existing = await this.prisma.accountingEntry.findFirst({ where: { ...scope, sourceType, sourceId: payment.id } });
    if (existing) return this.toEntryView(await this.getEntry(this.prisma, existing.id));
    const accounts = await this.ensureDefaultsInTransaction(scope);
    const cash = payment.bankAccount.kind === "CASH" ? accounts.cash : accounts.bank;
    const customer = Boolean(payment.customerInvoiceId);
    return this.createEntry(scope, {
      journalId: payment.bankAccount.kind === "CASH" ? accounts.cashJournalId : accounts.bankJournalId,
      entryDate: payment.paidAt,
      description: `${customer ? "Encaissement" : "Décaissement"} ${payment.code}`,
      currency: payment.currency.trim(),
      sourceType,
      sourceId: payment.id,
      lines: customer
        ? [{ accountId: cash.id, label: payment.bankAccount.name, debit: payment.amount, credit: new Prisma.Decimal(0), projectId: null }, { accountId: accounts.customerReceivable.id, label: "Règlement client", debit: new Prisma.Decimal(0), credit: payment.amount, projectId: null }]
        : [{ accountId: accounts.supplierPayable.id, label: "Règlement fournisseur", debit: payment.amount, credit: new Prisma.Decimal(0), projectId: null }, { accountId: cash.id, label: payment.bankAccount.name, debit: new Prisma.Decimal(0), credit: payment.amount, projectId: null }],
    }, actorUserId);
  }

  private parseLines(value: unknown) {
    if (!Array.isArray(value) || value.length < 2 || value.length > 100) throw new BadRequestException("lines must contain between 2 and 100 lines");
    const lines = value.map((raw, index) => {
      const line = assertBody(raw);
      const debit = requiredDecimal(line.debit ?? "0", `lines[${index}].debit`, { allowNegative: false });
      const credit = requiredDecimal(line.credit ?? "0", `lines[${index}].credit`, { allowNegative: false });
      if (debit.isZero() === credit.isZero()) throw new BadRequestException(`lines[${index}] must contain either a debit or a credit`);
      return { accountId: requiredId(line.accountId, `lines[${index}].accountId`), label: requiredText(line.label, `lines[${index}].label`, 240), debit, credit, projectId: optionalId(line.projectId, `lines[${index}].projectId`) };
    });
    if (!sumDecimals(lines.map((line) => line.debit)).equals(sumDecimals(lines.map((line) => line.credit)))) throw new BadRequestException("Accounting entry must be balanced");
    return lines;
  }

  private async createEntry(scope: CompanyScope, input: { journalId: string; entryDate: Date; description: string; currency: string; sourceType?: string; sourceId?: string; lines: Array<{ accountId: string; label: string; debit: Prisma.Decimal; credit: Prisma.Decimal; projectId: string | null }> }, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const journal = await tx.accountingJournal.findFirst({ where: { id: input.journalId, ...scope, isActive: true } });
      if (!journal) throw new NotFoundException("Accounting journal not found or inactive");
      const accounts = await tx.accountingAccount.findMany({ where: { id: { in: input.lines.map((line) => line.accountId) }, ...scope, isActive: true } });
      if (accounts.length !== new Set(input.lines.map((line) => line.accountId)).size) throw new BadRequestException("Every accounting account must exist and be active");
      const duplicate = input.sourceType && input.sourceId ? await tx.accountingEntry.findFirst({ where: { ...scope, sourceType: input.sourceType, sourceId: input.sourceId } }) : null;
      if (duplicate) return this.toEntryView(await this.getEntry(tx, duplicate.id));
      const number = await this.numbering.next(tx, scope, "ECR", input.entryDate);
      const entry = await tx.accountingEntry.create({ data: { ...scope, journalId: journal.id, number, entryDate: input.entryDate, description: input.description, currency: input.currency, sourceType: input.sourceType, sourceId: input.sourceId, postedByUserId: actorUserId, lines: { create: input.lines.map((line) => ({ ...scope, accountId: line.accountId, label: line.label, debit: line.debit, credit: line.credit, projectId: line.projectId })) } }, include: { journal: true, lines: { include: { account: true }, orderBy: { createdAt: "asc" } } } });
      await writeAudit(tx, scope, actorUserId, "finance.accounting.entry.posted", "AccountingEntry", entry.id, { number, sourceType: input.sourceType ?? null, sourceId: input.sourceId ?? null, total: money(input.lines.reduce((sum, line) => sum.plus(line.debit), new Prisma.Decimal(0))) });
      return this.toEntryView(entry);
    });
  }

  private async ensureDefaultsInTransaction(scope: CompanyScope) {
    return this.prisma.$transaction((tx) => this.ensureDefaults(tx, scope));
  }

  private async ensureDefaults(tx: Tx, scope: CompanyScope) {
    const accounts: Record<string, { id: string }> = {};
    for (const item of DEFAULT_ACCOUNTS) {
      const existing = await tx.accountingAccount.findFirst({ where: { companyId: scope.companyId, systemKey: item.systemKey } });
      const account = existing ?? await tx.accountingAccount.create({ data: { ...scope, ...item } });
      accounts[item.systemKey] = account;
    }
    const journals: Record<string, { id: string }> = {};
    for (const item of [
      { code: "VE", name: "Ventes", type: "SALES" as const },
      { code: "AC", name: "Achats", type: "PURCHASES" as const },
      { code: "BQ", name: "Banque", type: "BANK" as const },
      { code: "CA", name: "Caisse", type: "CASH" as const },
      { code: "OD", name: "Opérations diverses", type: "GENERAL" as const },
    ]) {
      const existing = await tx.accountingJournal.findFirst({ where: { companyId: scope.companyId, code: item.code } });
      journals[item.code] = existing ?? await tx.accountingJournal.create({ data: { ...scope, ...item } });
    }
    return { customerReceivable: accounts.CUSTOMER_RECEIVABLE!, supplierPayable: accounts.SUPPLIER_PAYABLE!, bank: accounts.BANK!, cash: accounts.CASH!, salesRevenue: accounts.SALES_REVENUE!, purchaseExpense: accounts.PURCHASE_EXPENSE!, outputTax: accounts.OUTPUT_TAX!, inputTax: accounts.INPUT_TAX!, equity: accounts.EQUITY!, journalId: journals.VE!.id, bankJournalId: journals.BQ!.id, cashJournalId: journals.CA!.id };
  }

  private async getEntry(client: Pick<PrismaService, "accountingEntry"> | Tx, id: string) {
    return client.accountingEntry.findUniqueOrThrow({ where: { id }, include: { journal: true, lines: { include: { account: true }, orderBy: { createdAt: "asc" } } } });
  }

  private toEntryView(entry: EntryWithLines): AccountingEntryView {
    const totalDebit = sumDecimals(entry.lines.map((line) => line.debit));
    const totalCredit = sumDecimals(entry.lines.map((line) => line.credit));
    return { id: entry.id, number: entry.number, journalId: entry.journalId, journalCode: entry.journal.code, journalName: entry.journal.name, entryDate: entry.entryDate.toISOString(), description: entry.description, currency: entry.currency.trim(), status: entry.status, sourceType: entry.sourceType, sourceId: entry.sourceId, postedByUserId: entry.postedByUserId, postedAt: entry.postedAt.toISOString(), totalDebit: money(totalDebit), totalCredit: money(totalCredit), lines: entry.lines.map((line) => ({ id: line.id, accountId: line.accountId, accountCode: line.account.code, accountName: line.account.name, label: line.label, debit: money(line.debit), credit: money(line.credit), projectId: line.projectId })) };
  }
}
