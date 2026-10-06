import { BadRequestException, Injectable } from "@nestjs/common";
import type { TreasuryForecastView } from "@axora24/contracts";
import type { CompanyScope } from "../common/company-scope.service.js";
import { PrismaService } from "../core/prisma.service.js";
import { dec, money } from "../common/decimal.js";

@Injectable()
export class TreasuryForecastService {
  constructor(private readonly prisma: PrismaService) {}

  async forecast(scope: CompanyScope, requestedDays: unknown): Promise<TreasuryForecastView> {
    const days = requestedDays === undefined ? 30 : Number(requestedDays);
    if (!Number.isInteger(days) || days < 7 || days > 180) throw new BadRequestException("L'horizon doit être compris entre 7 et 180 jours");
    const now = new Date();
    const end = new Date(now);
    end.setUTCDate(end.getUTCDate() + days);
    const [accounts, payments, receivables, payables] = await Promise.all([
      this.prisma.bankAccount.findMany({ where: { organizationId: scope.organizationId, companyId: scope.companyId, isActive: true }, select: { openingBalance: true, currency: true } }),
      this.prisma.payment.findMany({ where: { organizationId: scope.organizationId, companyId: scope.companyId, paidAt: { lte: now } }, select: { direction: true, amount: true } }),
      this.prisma.customerInvoice.findMany({ where: { organizationId: scope.organizationId, companyId: scope.companyId, status: { in: ["ISSUED", "PARTIALLY_PAID"] }, dueDate: { gte: now, lte: end } }, select: { dueDate: true, total: true, paidAmount: true } }),
      this.prisma.supplierInvoice.findMany({ where: { organizationId: scope.organizationId, companyId: scope.companyId, status: { in: ["APPROVED", "PARTIALLY_PAID"] }, dueDate: { gte: now, lte: end } }, select: { dueDate: true, total: true, paidAmount: true } }),
    ]);
    const openingBalance = accounts.reduce((sum, account) => sum.plus(dec(account.openingBalance)), dec(0));
    const actualIn = payments.filter((payment) => payment.direction === "IN").reduce((sum, payment) => sum.plus(dec(payment.amount)), dec(0));
    const actualOut = payments.filter((payment) => payment.direction === "OUT").reduce((sum, payment) => sum.plus(dec(payment.amount)), dec(0));
    let running = openingBalance.plus(actualIn).minus(actualOut);
    const points: TreasuryForecastView["points"] = [];
    for (let offset = 0; offset < days; offset += 1) {
      const date = new Date(now);
      date.setUTCHours(0, 0, 0, 0);
      date.setUTCDate(date.getUTCDate() + offset);
      const next = new Date(date);
      next.setUTCDate(next.getUTCDate() + 1);
      const expectedIn = receivables.filter((invoice) => invoice.dueDate !== null && invoice.dueDate >= date && invoice.dueDate < next).reduce((sum, invoice) => sum.plus(dec(invoice.total).minus(dec(invoice.paidAmount))), dec(0));
      const expectedOut = payables.filter((invoice) => invoice.dueDate !== null && invoice.dueDate >= date && invoice.dueDate < next).reduce((sum, invoice) => sum.plus(dec(invoice.total).minus(dec(invoice.paidAmount))), dec(0));
      running = running.plus(expectedIn).minus(expectedOut);
      points.push({ date: date.toISOString().slice(0, 10), expectedIn: money(expectedIn), expectedOut: money(expectedOut), projectedBalance: money(running) });
    }
    return {
      currency: accounts[0]?.currency.trim() ?? "CDF",
      horizonDays: days,
      openingBalance: money(openingBalance.plus(actualIn).minus(actualOut)),
      points,
      assumptions: ["Les factures sont projetées à leur échéance contractuelle.", "Les retards, impôts, salaires et dépenses non saisis ne sont pas extrapolés.", "Les montants de devises différentes sont présentés dans une même vue : configurez une trésorerie séparée par devise pour un pilotage consolidé."],
    };
  }
}
