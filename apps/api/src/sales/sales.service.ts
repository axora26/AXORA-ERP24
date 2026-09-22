import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@axora24/database";
import { PrismaService } from "../core/prisma.service.js";
import type { CompanyScope } from "../crm/company-scope.service.js";
import {
  requiredText,
  type AcceptQuoteDto,
  type CreateContractDto,
  type CreateQuoteDto,
  type RejectQuoteDto,
} from "./sales.dto.js";

/**
 * INC-04 — Devis (Quote) -> Contrat.
 *
 * Toutes les lectures et mutations portent le double filtre organizationId +
 * companyId issu de CompanyScopeService. Les lignes de devis et de contrat
 * sont des copies immuables (append-only) prises au moment de la creation,
 * jamais une reference live vers le DQE ou le devis source.
 */
@Injectable()
export class SalesService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------
  // Devis
  // ---------------------------------------------------------------------

  async listQuotes(scope: CompanyScope) {
    const quotes = await this.prisma.quote.findMany({
      where: scope,
      include: { lines: { orderBy: { position: "asc" } } },
      orderBy: { createdAt: "desc" },
    });
    const dqeCodes = await this.dqeCodeMap(scope, quotes.map((quote) => quote.dqeId));
    return quotes.map((quote) => toQuoteView(quote, dqeCodes.get(quote.dqeId) ?? ""));
  }

  async getQuote(scope: CompanyScope, id: string) {
    const quote = await this.prisma.quote.findFirst({
      where: { id, ...scope },
      include: { lines: { orderBy: { position: "asc" } } },
    });
    if (!quote) throw new NotFoundException("Quote not found");
    const dqeCodes = await this.dqeCodeMap(scope, [quote.dqeId]);
    return toQuoteView(quote, dqeCodes.get(quote.dqeId) ?? "");
  }

  private async dqeCodeMap(scope: CompanyScope, dqeIds: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(dqeIds)];
    if (unique.length === 0) return new Map();
    const dqes = await this.prisma.dqeDocument.findMany({
      where: { id: { in: unique }, ...scope },
      select: { id: true, code: true },
    });
    return new Map(dqes.map((dqe) => [dqe.id, dqe.code]));
  }

  private async quoteCodeMap(scope: CompanyScope, quoteIds: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(quoteIds)];
    if (unique.length === 0) return new Map();
    const quotes = await this.prisma.quote.findMany({
      where: { id: { in: unique }, ...scope },
      select: { id: true, code: true },
    });
    return new Map(quotes.map((quote) => [quote.id, quote.code]));
  }

  async createQuote(scope: CompanyScope, input: CreateQuoteDto, actorUserId: string) {
    const dqeId = requiredText(input.dqeId, "dqeId", 120);
    const code = requiredText(input.code, "code", 80);
    const title = requiredText(input.title, "title", 180);

    const duplicate = await this.prisma.quote.findFirst({
      where: { companyId: scope.companyId, code },
      select: { id: true },
    });
    if (duplicate) throw new BadRequestException(`A Quote with code "${code}" already exists`);

    const createdId = await this.prisma.$transaction(async (tx) => {
      const dqe = await tx.dqeDocument.findFirst({
        where: { id: dqeId, ...scope },
        include: { lines: { orderBy: { position: "asc" } } },
      });
      if (!dqe) throw new NotFoundException("DQE not found");
      if (dqe.status !== "FINALIZED") {
        throw new BadRequestException("Quote can only be created from a FINALIZED DQE");
      }
      if (!dqe.opportunityId) {
        throw new BadRequestException("DQE has no opportunity to quote against");
      }

      let subtotal = new Prisma.Decimal(0);
      for (const line of dqe.lines) {
        subtotal = subtotal.plus(new Prisma.Decimal(line.quantity).mul(line.unitPrice));
      }

      const quote = await tx.quote.create({
        data: {
          ...scope,
          opportunityId: dqe.opportunityId,
          dqeId: dqe.id,
          code,
          title,
          currency: dqe.currency,
          subtotal,
        },
      });

      if (dqe.lines.length > 0) {
        await tx.quoteLine.createMany({
          data: dqe.lines.map((line) => ({
            ...scope,
            quoteId: quote.id,
            position: line.position,
            reference: line.reference,
            designation: line.designation,
            unitCode: line.unitCode,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
          })),
        });
      }

      await tx.auditLog.create({
        data: {
          organizationId: scope.organizationId,
          actorUserId,
          action: "sales.quote.created",
          resourceType: "Quote",
          resourceId: quote.id,
          metadata: { companyId: scope.companyId, dqeId: dqe.id, code, lineCount: dqe.lines.length },
        },
      });

      return quote.id;
    });

    return this.getQuote(scope, createdId);
  }

  async submitQuote(scope: CompanyScope, quoteId: string, actorUserId: string) {
    await this.prisma.$transaction(async (tx) => {
      const quote = await tx.quote.findFirst({ where: { id: quoteId, ...scope }, select: { id: true, status: true } });
      if (!quote) throw new NotFoundException("Quote not found");
      if (quote.status !== "DRAFT") {
        throw new BadRequestException("Only a draft Quote can be submitted");
      }

      const updated = await tx.quote.updateMany({
        where: { id: quoteId, ...scope, status: "DRAFT" },
        data: { status: "SUBMITTED", submittedAt: new Date() },
      });
      if (updated.count !== 1) {
        throw new BadRequestException("Quote was submitted concurrently");
      }

      await tx.auditLog.create({
        data: {
          organizationId: scope.organizationId,
          actorUserId,
          action: "sales.quote.submitted",
          resourceType: "Quote",
          resourceId: quoteId,
          metadata: { companyId: scope.companyId },
        },
      });
    });

    return this.getQuote(scope, quoteId);
  }

  async acceptQuote(scope: CompanyScope, quoteId: string, _input: AcceptQuoteDto, actorUserId: string) {
    await this.prisma.$transaction(async (tx) => {
      const quote = await tx.quote.findFirst({ where: { id: quoteId, ...scope }, select: { id: true, status: true } });
      if (!quote) throw new NotFoundException("Quote not found");
      if (quote.status !== "SUBMITTED") {
        throw new BadRequestException("Only a submitted Quote can be accepted");
      }

      const updated = await tx.quote.updateMany({
        where: { id: quoteId, ...scope, status: "SUBMITTED" },
        data: { status: "ACCEPTED", acceptedAt: new Date() },
      });
      if (updated.count !== 1) {
        throw new BadRequestException("Quote was accepted concurrently");
      }

      await tx.auditLog.create({
        data: {
          organizationId: scope.organizationId,
          actorUserId,
          action: "sales.quote.accepted",
          resourceType: "Quote",
          resourceId: quoteId,
          metadata: { companyId: scope.companyId },
        },
      });
    });

    return this.getQuote(scope, quoteId);
  }

  async rejectQuote(scope: CompanyScope, quoteId: string, input: RejectQuoteDto, actorUserId: string) {
    const reason = requiredText(input.reason, "reason", 500);

    await this.prisma.$transaction(async (tx) => {
      const quote = await tx.quote.findFirst({ where: { id: quoteId, ...scope }, select: { id: true, status: true } });
      if (!quote) throw new NotFoundException("Quote not found");
      if (quote.status !== "SUBMITTED") {
        throw new BadRequestException("Only a submitted Quote can be rejected");
      }

      const updated = await tx.quote.updateMany({
        where: { id: quoteId, ...scope, status: "SUBMITTED" },
        data: { status: "REJECTED", rejectedAt: new Date(), rejectionReason: reason },
      });
      if (updated.count !== 1) {
        throw new BadRequestException("Quote was rejected concurrently");
      }

      await tx.auditLog.create({
        data: {
          organizationId: scope.organizationId,
          actorUserId,
          action: "sales.quote.rejected",
          resourceType: "Quote",
          resourceId: quoteId,
          metadata: { companyId: scope.companyId, reason },
        },
      });
    });

    return this.getQuote(scope, quoteId);
  }

  // ---------------------------------------------------------------------
  // Contrat
  // ---------------------------------------------------------------------

  async listContracts(scope: CompanyScope) {
    const contracts = await this.prisma.contract.findMany({
      where: scope,
      include: { lines: { orderBy: { position: "asc" } } },
      orderBy: { createdAt: "desc" },
    });
    const quoteCodes = await this.quoteCodeMap(scope, contracts.map((contract) => contract.quoteId));
    return contracts.map((contract) => toContractView(contract, quoteCodes.get(contract.quoteId) ?? ""));
  }

  async getContract(scope: CompanyScope, id: string) {
    const contract = await this.prisma.contract.findFirst({
      where: { id, ...scope },
      include: { lines: { orderBy: { position: "asc" } } },
    });
    if (!contract) throw new NotFoundException("Contract not found");
    const quoteCodes = await this.quoteCodeMap(scope, [contract.quoteId]);
    return toContractView(contract, quoteCodes.get(contract.quoteId) ?? "");
  }

  async createContract(scope: CompanyScope, input: CreateContractDto, actorUserId: string) {
    const quoteId = requiredText(input.quoteId, "quoteId", 120);
    const code = requiredText(input.code, "code", 80);
    const title = requiredText(input.title, "title", 180);

    const duplicate = await this.prisma.contract.findFirst({
      where: { companyId: scope.companyId, code },
      select: { id: true },
    });
    if (duplicate) throw new BadRequestException(`A Contract with code "${code}" already exists`);

    const existingForQuote = await this.prisma.contract.findFirst({
      where: { quoteId, ...scope },
      select: { id: true },
    });
    if (existingForQuote) {
      throw new BadRequestException("This Quote already has a Contract");
    }

    const createdId = await this.prisma.$transaction(async (tx) => {
      const quote = await tx.quote.findFirst({
        where: { id: quoteId, ...scope },
        include: { lines: { orderBy: { position: "asc" } } },
      });
      if (!quote) throw new NotFoundException("Quote not found");
      if (quote.status !== "ACCEPTED") {
        throw new BadRequestException("Contract can only be created from an ACCEPTED Quote");
      }

      const contract = await tx.contract.create({
        data: {
          ...scope,
          opportunityId: quote.opportunityId,
          quoteId: quote.id,
          code,
          title,
          currency: quote.currency,
          subtotal: quote.subtotal,
        },
      });

      if (quote.lines.length > 0) {
        await tx.contractLine.createMany({
          data: quote.lines.map((line) => ({
            ...scope,
            contractId: contract.id,
            position: line.position,
            reference: line.reference,
            designation: line.designation,
            unitCode: line.unitCode,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
          })),
        });
      }

      await tx.auditLog.create({
        data: {
          organizationId: scope.organizationId,
          actorUserId,
          action: "sales.contract.created",
          resourceType: "Contract",
          resourceId: contract.id,
          metadata: {
            companyId: scope.companyId,
            quoteId: quote.id,
            code,
            lineCount: quote.lines.length,
          },
        },
      });

      return contract.id;
    });

    return this.getContract(scope, createdId);
  }
}

type QuoteWithLines = Prisma.QuoteGetPayload<{ include: { lines: true } }>;
type ContractWithLines = Prisma.ContractGetPayload<{ include: { lines: true } }>;

function toLineView(line: {
  id: string;
  position: number;
  reference: string | null;
  designation: string;
  unitCode: string;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
}) {
  const quantity = new Prisma.Decimal(line.quantity);
  const unitPrice = new Prisma.Decimal(line.unitPrice);
  return {
    id: line.id,
    position: line.position,
    reference: line.reference,
    designation: line.designation,
    unitCode: line.unitCode,
    quantity: quantity.toFixed(6),
    unitPrice: unitPrice.toFixed(6),
    lineTotal: quantity.mul(unitPrice).toFixed(6),
  };
}

function toQuoteView(quote: QuoteWithLines, dqeCode: string) {
  return {
    id: quote.id,
    companyId: quote.companyId,
    opportunityId: quote.opportunityId,
    code: quote.code,
    title: quote.title,
    currency: quote.currency.trim(),
    version: quote.version,
    status: quote.status,
    subtotal: new Prisma.Decimal(quote.subtotal).toFixed(6),
    submittedAt: quote.submittedAt?.toISOString() ?? null,
    acceptedAt: quote.acceptedAt?.toISOString() ?? null,
    rejectedAt: quote.rejectedAt?.toISOString() ?? null,
    rejectionReason: quote.rejectionReason,
    createdAt: quote.createdAt.toISOString(),
    lines: quote.lines.map(toLineView),
    source: { dqeId: quote.dqeId, dqeCode },
  };
}

function toContractView(contract: ContractWithLines, quoteCode: string) {
  return {
    id: contract.id,
    companyId: contract.companyId,
    opportunityId: contract.opportunityId,
    code: contract.code,
    title: contract.title,
    currency: contract.currency.trim(),
    status: contract.status,
    subtotal: new Prisma.Decimal(contract.subtotal).toFixed(6),
    createdAt: contract.createdAt.toISOString(),
    lines: contract.lines.map(toLineView),
    source: { quoteId: contract.quoteId, quoteCode },
  };
}
