import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@axora24/database";
import { PrismaService } from "../core/prisma.service.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import {
  requiredText,
  type AcceptQuoteDto,
  type ContractVariationTransitionDto,
  type CreateContractDto,
  type CreateContractVariationDto,
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
      include: quoteInclude,
      orderBy: { createdAt: "desc" },
    });
    const dqeCodes = await this.dqeCodeMap(
      scope,
      quotes.map((quote) => quote.dqeId),
    );
    return quotes.map((quote) =>
      toQuoteView(quote, dqeCodes.get(quote.dqeId) ?? ""),
    );
  }

  async getQuote(scope: CompanyScope, id: string) {
    const quote = await this.prisma.quote.findFirst({
      where: { id, ...scope },
      include: quoteInclude,
    });
    if (!quote) throw new NotFoundException("Quote not found");
    const dqeCodes = await this.dqeCodeMap(scope, [quote.dqeId]);
    return toQuoteView(quote, dqeCodes.get(quote.dqeId) ?? "");
  }

  private async dqeCodeMap(
    scope: CompanyScope,
    dqeIds: string[],
  ): Promise<Map<string, string>> {
    const unique = [...new Set(dqeIds)];
    if (unique.length === 0) return new Map();
    const dqes = await this.prisma.dqeDocument.findMany({
      where: { id: { in: unique }, ...scope },
      select: { id: true, code: true },
    });
    return new Map(dqes.map((dqe) => [dqe.id, dqe.code]));
  }

  private async quoteCodeMap(
    scope: CompanyScope,
    quoteIds: string[],
  ): Promise<Map<string, string>> {
    const unique = [...new Set(quoteIds)];
    if (unique.length === 0) return new Map();
    const quotes = await this.prisma.quote.findMany({
      where: { id: { in: unique }, ...scope },
      select: { id: true, code: true },
    });
    return new Map(quotes.map((quote) => [quote.id, quote.code]));
  }

  async createQuote(
    scope: CompanyScope,
    input: CreateQuoteDto,
    actorUserId: string,
  ) {
    const dqeId = requiredText(input.dqeId, "dqeId", 120);
    const code = requiredText(input.code, "code", 80);
    const title = requiredText(input.title, "title", 180);

    const duplicate = await this.prisma.quote.findFirst({
      where: { companyId: scope.companyId, code },
      select: { id: true },
    });
    if (duplicate)
      throw new BadRequestException(
        `A Quote with code "${code}" already exists`,
      );

    const createdId = await this.prisma.$transaction(async (tx) => {
      const dqe = await tx.dqeDocument.findFirst({
        where: { id: dqeId, ...scope },
        include: {
          lines: { orderBy: { position: "asc" } },
          lots: { orderBy: { position: "asc" } },
        },
      });
      if (!dqe) throw new NotFoundException("DQE not found");
      if (dqe.status !== "FINALIZED") {
        throw new BadRequestException(
          "Quote can only be created from a FINALIZED DQE",
        );
      }
      if (!dqe.opportunityId) {
        throw new BadRequestException(
          "DQE has no opportunity to quote against",
        );
      }

      let subtotal = new Prisma.Decimal(0);
      for (const line of dqe.lines) {
        subtotal = subtotal.plus(
          new Prisma.Decimal(line.quantity)
            .mul(line.unitPrice)
            .toDecimalPlaces(6),
        );
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

      const quoteLotIds = new Map<string, string>();
      for (const lot of dqe.lots) {
        const copied = await tx.quoteLot.create({
          data: {
            ...scope,
            quoteId: quote.id,
            position: lot.position,
            code: lot.code,
            designation: lot.designation,
          },
        });
        quoteLotIds.set(lot.id, copied.id);
      }

      if (dqe.lines.length > 0) {
        await tx.quoteLine.createMany({
          data: dqe.lines.map((line) => ({
            ...scope,
            quoteId: quote.id,
            lotId: line.lotId ? (quoteLotIds.get(line.lotId) ?? null) : null,
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
          metadata: {
            companyId: scope.companyId,
            dqeId: dqe.id,
            code,
            lineCount: dqe.lines.length,
          },
        },
      });

      return quote.id;
    });

    return this.getQuote(scope, createdId);
  }

  async submitQuote(scope: CompanyScope, quoteId: string, actorUserId: string) {
    await this.prisma.$transaction(async (tx) => {
      const quote = await tx.quote.findFirst({
        where: { id: quoteId, ...scope },
        select: { id: true, status: true },
      });
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

  async acceptQuote(
    scope: CompanyScope,
    quoteId: string,
    _input: AcceptQuoteDto,
    actorUserId: string,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const quote = await tx.quote.findFirst({
        where: { id: quoteId, ...scope },
        select: { id: true, status: true },
      });
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

  async rejectQuote(
    scope: CompanyScope,
    quoteId: string,
    input: RejectQuoteDto,
    actorUserId: string,
  ) {
    const reason = requiredText(input.reason, "reason", 500);

    await this.prisma.$transaction(async (tx) => {
      const quote = await tx.quote.findFirst({
        where: { id: quoteId, ...scope },
        select: { id: true, status: true },
      });
      if (!quote) throw new NotFoundException("Quote not found");
      if (quote.status !== "SUBMITTED") {
        throw new BadRequestException("Only a submitted Quote can be rejected");
      }

      const updated = await tx.quote.updateMany({
        where: { id: quoteId, ...scope, status: "SUBMITTED" },
        data: {
          status: "REJECTED",
          rejectedAt: new Date(),
          rejectionReason: reason,
        },
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
      include: contractInclude,
      orderBy: { createdAt: "desc" },
    });
    const quoteCodes = await this.quoteCodeMap(
      scope,
      contracts.map((contract) => contract.quoteId),
    );
    return contracts.map((contract) =>
      toContractView(contract, quoteCodes.get(contract.quoteId) ?? ""),
    );
  }

  async listVariationContracts(scope: CompanyScope) {
    const contracts = await this.prisma.contract.findMany({
      where: scope,
      select: {
        id: true,
        companyId: true,
        code: true,
        title: true,
        currency: true,
        status: true,
        subtotal: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
    return contracts.map((contract) => ({
      ...contract,
      currency: contract.currency.trim(),
      subtotal: new Prisma.Decimal(contract.subtotal).toFixed(6),
      createdAt: contract.createdAt.toISOString(),
    }));
  }

  async getContract(scope: CompanyScope, id: string) {
    const contract = await this.prisma.contract.findFirst({
      where: { id, ...scope },
      include: contractInclude,
    });
    if (!contract) throw new NotFoundException("Contract not found");
    const quoteCodes = await this.quoteCodeMap(scope, [contract.quoteId]);
    return toContractView(contract, quoteCodes.get(contract.quoteId) ?? "");
  }

  async createContract(
    scope: CompanyScope,
    input: CreateContractDto,
    actorUserId: string,
  ) {
    const quoteId = requiredText(input.quoteId, "quoteId", 120);
    const code = requiredText(input.code, "code", 80);
    const title = requiredText(input.title, "title", 180);

    const duplicate = await this.prisma.contract.findFirst({
      where: { companyId: scope.companyId, code },
      select: { id: true },
    });
    if (duplicate)
      throw new BadRequestException(
        `A Contract with code "${code}" already exists`,
      );

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
        include: quoteInclude,
      });
      if (!quote) throw new NotFoundException("Quote not found");
      if (quote.status !== "ACCEPTED") {
        throw new BadRequestException(
          "Contract can only be created from an ACCEPTED Quote",
        );
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

      const contractLotIds = new Map<string, string>();
      for (const lot of quote.lots) {
        const copied = await tx.contractLot.create({
          data: {
            ...scope,
            contractId: contract.id,
            position: lot.position,
            code: lot.code,
            designation: lot.designation,
          },
        });
        contractLotIds.set(lot.id, copied.id);
      }

      if (quote.lines.length > 0) {
        await tx.contractLine.createMany({
          data: quote.lines.map((line) => ({
            ...scope,
            contractId: contract.id,
            lotId: line.lotId ? (contractLotIds.get(line.lotId) ?? null) : null,
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

  // ---------------------------------------------------------------------
  // Avenants contractuels
  // ---------------------------------------------------------------------

  async listContractVariations(scope: CompanyScope, contractId: string) {
    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, ...scope },
      select: { id: true, subtotal: true, currency: true },
    });
    if (!contract) throw new NotFoundException("Contract not found");
    const variations = await this.prisma.contractVariation.findMany({
      where: { contractId, ...scope },
      include: variationInclude,
      orderBy: { revisionNumber: "desc" },
    });
    const approvedTotal = variations
      .filter((variation) => variation.status === "APPROVED")
      .reduce(
        (sum, variation) => sum.plus(variation.amountDelta),
        new Prisma.Decimal(0),
      );
    return variations.map((variation) =>
      toContractVariationView(variation, contract.subtotal, approvedTotal),
    );
  }

  async getContractVariation(
    scope: CompanyScope,
    contractId: string,
    variationId: string,
  ) {
    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, ...scope },
      select: { id: true, subtotal: true },
    });
    if (!contract) throw new NotFoundException("Contract not found");
    const variation = await this.prisma.contractVariation.findFirst({
      where: { id: variationId, contractId, ...scope },
      include: variationInclude,
    });
    if (!variation) throw new NotFoundException("Contract variation not found");
    const approved = await this.prisma.contractVariation.aggregate({
      where: {
        contractId,
        ...scope,
        status: "APPROVED",
        id: { not: variationId },
      },
      _sum: { amountDelta: true },
    });
    const approvedTotal = new Prisma.Decimal(
      approved._sum.amountDelta ?? 0,
    ).plus(variation.status === "APPROVED" ? variation.amountDelta : 0);
    return toContractVariationView(variation, contract.subtotal, approvedTotal);
  }

  async createContractVariation(
    scope: CompanyScope,
    contractId: string,
    input: CreateContractVariationDto,
    actorUserId: string,
  ) {
    const code = requiredText(input.code, "code", 80);
    const title = requiredText(input.title, "title", 180);
    const reason = requiredText(input.reason, "reason", 1000);
    if (
      !Array.isArray(input.lines) ||
      input.lines.length === 0 ||
      input.lines.length > 500
    ) {
      throw new BadRequestException(
        "lines must contain between 1 and 500 entries",
      );
    }
    const positions = new Set<number>();
    const lines = input.lines.map((line, index) => {
      if (
        !Number.isInteger(line.position) ||
        line.position < 1 ||
        line.position > 2147483647 ||
        positions.has(line.position)
      ) {
        throw new BadRequestException(
          `lines[${index}].position must be a unique positive integer`,
        );
      }
      positions.add(line.position);
      const quantity = contractVariationDecimal(
        line.quantity,
        `lines[${index}].quantity`,
      );
      const unitPrice = contractVariationDecimal(
        line.unitPrice,
        `lines[${index}].unitPrice`,
      );
      if (quantity.isZero())
        throw new BadRequestException(
          `lines[${index}].quantity must not be zero`,
        );
      if (unitPrice.isNegative())
        throw new BadRequestException(
          `lines[${index}].unitPrice must be positive or zero`,
        );
      const lineTotal = quantity.mul(unitPrice).toDecimalPlaces(6);
      assertContractVariationDecimalFits(
        lineTotal,
        `lines[${index}].lineTotal`,
      );
      return {
        position: line.position,
        sourceContractLotId: optionalVariationText(
          line.sourceContractLotId,
          120,
        ),
        reference: optionalVariationText(line.reference, 120),
        designation: requiredText(
          line.designation,
          `lines[${index}].designation`,
          500,
        ),
        unitCode: requiredText(line.unitCode, `lines[${index}].unitCode`, 30),
        quantity,
        unitPrice,
        lineTotal,
      };
    });
    const amountDelta = lines.reduce(
      (sum, line) => sum.plus(line.lineTotal),
      new Prisma.Decimal(0),
    );
    assertContractVariationDecimalFits(
      amountDelta,
      "Contract variation amount",
    );
    if (amountDelta.isZero())
      throw new BadRequestException(
        "Contract variation amount must not be zero",
      );

    let createdId: string;
    try {
      createdId = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`
        SELECT "id" FROM "sales_contracts"
        WHERE "id" = ${contractId}
          AND "organizationId" = ${scope.organizationId}
          AND "companyId" = ${scope.companyId}
        FOR UPDATE
      `;
        const contract = await tx.contract.findFirst({
          where: { id: contractId, ...scope },
          select: { id: true, status: true, currency: true },
        });
        if (!contract) throw new NotFoundException("Contract not found");
        if (contract.status !== "ACTIVE")
          throw new BadRequestException(
            "Variations require an ACTIVE Contract",
          );

        const sourceLotIds = [
          ...new Set(
            lines
              .map((line) => line.sourceContractLotId)
              .filter((id): id is string => Boolean(id)),
          ),
        ];
        if (sourceLotIds.length > 0) {
          const matchingLots = await tx.contractLot.count({
            where: { id: { in: sourceLotIds }, contractId, ...scope },
          });
          if (matchingLots !== sourceLotIds.length) {
            throw new BadRequestException(
              "A variation line references a Contract lot outside this Contract",
            );
          }
        }

        const latest = await tx.contractVariation.aggregate({
          where: { contractId, ...scope },
          _max: { revisionNumber: true },
        });
        const variation = await tx.contractVariation.create({
          data: {
            ...scope,
            contractId,
            revisionNumber: (latest._max.revisionNumber ?? 0) + 1,
            code,
            title,
            reason,
            currency: contract.currency,
            amountDelta,
            createdByUserId: actorUserId,
          },
        });
        await tx.contractVariationLine.createMany({
          data: lines.map((line) => ({
            ...scope,
            contractId,
            variationId: variation.id,
            sourceContractLotId: line.sourceContractLotId,
            position: line.position,
            reference: line.reference,
            designation: line.designation,
            unitCode: line.unitCode,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
          })),
        });
        await tx.auditLog.create({
          data: {
            organizationId: scope.organizationId,
            actorUserId,
            action: "sales.contract.variation.created",
            resourceType: "ContractVariation",
            resourceId: variation.id,
            metadata: {
              companyId: scope.companyId,
              contractId,
              code,
              amountDelta: amountDelta.toFixed(6),
              lineCount: lines.length,
            },
          },
        });
        return variation.id;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException(
          "Un avenant avec ce code ou ce numéro de révision existe déjà",
        );
      }
      throw error;
    }
    return this.getContractVariation(scope, contractId, createdId);
  }

  async submitContractVariation(
    scope: CompanyScope,
    contractId: string,
    variationId: string,
    input: ContractVariationTransitionDto,
    actorUserId: string,
  ) {
    return this.transitionContractVariation(
      scope,
      contractId,
      variationId,
      input,
      actorUserId,
      "DRAFT",
      "SUBMITTED",
      "sales.contract.variation.submitted",
    );
  }

  async approveContractVariation(
    scope: CompanyScope,
    contractId: string,
    variationId: string,
    input: ContractVariationTransitionDto,
    actorUserId: string,
  ) {
    return this.transitionContractVariation(
      scope,
      contractId,
      variationId,
      input,
      actorUserId,
      "SUBMITTED",
      "APPROVED",
      "sales.contract.variation.approved",
    );
  }

  async rejectContractVariation(
    scope: CompanyScope,
    contractId: string,
    variationId: string,
    input: ContractVariationTransitionDto,
    actorUserId: string,
  ) {
    requiredText(input.note, "note", 1000);
    return this.transitionContractVariation(
      scope,
      contractId,
      variationId,
      input,
      actorUserId,
      "SUBMITTED",
      "REJECTED",
      "sales.contract.variation.rejected",
    );
  }

  private async transitionContractVariation(
    scope: CompanyScope,
    contractId: string,
    variationId: string,
    input: ContractVariationTransitionDto,
    actorUserId: string,
    from: "DRAFT" | "SUBMITTED",
    to: "SUBMITTED" | "APPROVED" | "REJECTED",
    action: string,
  ) {
    if (
      !Number.isSafeInteger(input.expectedVersion) ||
      input.expectedVersion < 1 ||
      input.expectedVersion > 2_147_483_647
    ) {
      throw new BadRequestException(
        "expectedVersion must be a positive 32-bit integer",
      );
    }
    const note = optionalVariationText(input.note, 1000);
    await this.prisma.$transaction(async (tx) => {
      const variation = await tx.contractVariation.findFirst({
        where: { id: variationId, contractId, ...scope },
        select: {
          id: true,
          status: true,
          version: true,
          createdByUserId: true,
        },
      });
      if (!variation)
        throw new NotFoundException("Contract variation not found");
      if (variation.version !== input.expectedVersion) {
        throw new ConflictException(
          "L’avenant a été modifié ; rechargez sa version actuelle",
        );
      }
      const decided = to === "APPROVED" || to === "REJECTED";
      if (decided && variation.createdByUserId === actorUserId) {
        throw new ForbiddenException(
          "Le créateur ne peut ni approuver ni refuser son propre avenant",
        );
      }
      if (variation.status !== from)
        throw new BadRequestException(
          `Only a ${from} Contract variation can become ${to}`,
        );
      const updated = await tx.contractVariation.updateMany({
        where: {
          id: variationId,
          contractId,
          ...scope,
          status: from,
          version: input.expectedVersion,
        },
        data: {
          status: to,
          version: { increment: 1 },
          submittedAt: to === "SUBMITTED" ? new Date() : undefined,
          decidedAt: decided ? new Date() : undefined,
          decidedByUserId: decided ? actorUserId : undefined,
          decisionNote: decided ? note : undefined,
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException(
          "L’avenant a été modifié ; rechargez sa version actuelle",
        );
      }
      await tx.auditLog.create({
        data: {
          organizationId: scope.organizationId,
          actorUserId,
          action,
          resourceType: "ContractVariation",
          resourceId: variationId,
          metadata: {
            companyId: scope.companyId,
            contractId,
            from,
            to,
            expectedVersion: input.expectedVersion,
            note,
          },
        },
      });
    });
    return this.getContractVariation(scope, contractId, variationId);
  }
}

const variationInclude = {
  lines: { orderBy: { position: "asc" as const } },
} as const;
const quoteInclude = {
  lines: { orderBy: { position: "asc" as const } },
  lots: { orderBy: { position: "asc" as const } },
} as const;
const contractInclude = {
  lines: { orderBy: { position: "asc" as const } },
  lots: { orderBy: { position: "asc" as const } },
} as const;

type QuoteWithLines = Prisma.QuoteGetPayload<{ include: typeof quoteInclude }>;
type ContractWithLines = Prisma.ContractGetPayload<{
  include: typeof contractInclude;
}>;
type ContractVariationWithLines = Prisma.ContractVariationGetPayload<{
  include: typeof variationInclude;
}>;

function toLineView(line: {
  id: string;
  lotId: string | null;
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
    lotId: line.lotId,
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
  const lines = quote.lines.map(toLineView);
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
    lots: toLotViews(quote.lots, lines),
    lines,
    source: { dqeId: quote.dqeId, dqeCode },
  };
}

function toContractView(contract: ContractWithLines, quoteCode: string) {
  const lines = contract.lines.map(toLineView);
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
    lots: toLotViews(contract.lots, lines),
    lines,
    source: { quoteId: contract.quoteId, quoteCode },
  };
}

function toContractVariationView(
  variation: ContractVariationWithLines,
  contractSubtotal: Prisma.Decimal,
  approvedTotal: Prisma.Decimal,
) {
  const amountDelta = new Prisma.Decimal(variation.amountDelta);
  const approvedContractAmount = new Prisma.Decimal(contractSubtotal).plus(
    approvedTotal,
  );
  const revisedContractAmount = ["DRAFT", "SUBMITTED"].includes(
    variation.status,
  )
    ? approvedContractAmount.plus(amountDelta)
    : approvedContractAmount;
  return {
    id: variation.id,
    companyId: variation.companyId,
    contractId: variation.contractId,
    revisionNumber: variation.revisionNumber,
    code: variation.code,
    title: variation.title,
    reason: variation.reason,
    currency: variation.currency.trim(),
    amountDelta: amountDelta.toFixed(6),
    revisedContractAmount: revisedContractAmount.toFixed(6),
    status: variation.status,
    version: variation.version,
    submittedAt: variation.submittedAt?.toISOString() ?? null,
    decidedAt: variation.decidedAt?.toISOString() ?? null,
    decisionNote: variation.decisionNote,
    createdAt: variation.createdAt.toISOString(),
    lines: variation.lines.map((line) => {
      const quantity = new Prisma.Decimal(line.quantity);
      const unitPrice = new Prisma.Decimal(line.unitPrice);
      return {
        id: line.id,
        sourceContractLotId: line.sourceContractLotId,
        position: line.position,
        reference: line.reference,
        designation: line.designation,
        unitCode: line.unitCode,
        quantity: quantity.toFixed(6),
        unitPrice: unitPrice.toFixed(6),
        lineTotal: quantity.mul(unitPrice).toDecimalPlaces(6).toFixed(6),
      };
    }),
  };
}

function contractVariationDecimal(
  value: unknown,
  field: string,
): Prisma.Decimal {
  if (
    typeof value !== "string" ||
    !/^-?\d{1,18}(\.\d{1,6})?$/.test(value.trim())
  ) {
    throw new BadRequestException(
      `${field} must be a decimal string with at most 6 decimals`,
    );
  }
  try {
    const decimal = new Prisma.Decimal(value.trim());
    assertContractVariationDecimalFits(decimal, field);
    return decimal;
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    throw new BadRequestException(
      `${field} must be a decimal string with at most 6 decimals`,
    );
  }
}

function assertContractVariationDecimalFits(
  value: Prisma.Decimal,
  field: string,
): void {
  if (
    !value.isFinite() ||
    value.decimalPlaces() > 6 ||
    value.abs().gte("1000000000000000000")
  ) {
    throw new BadRequestException(`${field} exceeds DECIMAL(24,6)`);
  }
}

function optionalVariationText(
  value: unknown,
  maxLength: number,
): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new BadRequestException("Optional text fields must be strings");
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > maxLength) {
    throw new BadRequestException(
      `Optional text exceeds ${maxLength} characters`,
    );
  }
  return trimmed;
}

function toLotViews(
  lots: Array<{
    id: string;
    position: number;
    code: string;
    designation: string;
  }>,
  lines: Array<{ lotId: string | null; lineTotal: string }>,
) {
  return lots.map((lot) => {
    const assigned = lines.filter((line) => line.lotId === lot.id);
    const subtotal = assigned.reduce(
      (sum, line) => sum.plus(line.lineTotal),
      new Prisma.Decimal(0),
    );
    return {
      id: lot.id,
      position: lot.position,
      code: lot.code,
      designation: lot.designation,
      lineCount: assigned.length,
      subtotal: subtotal.toFixed(6),
    };
  });
}
