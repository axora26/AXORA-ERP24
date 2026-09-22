import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@axora24/database";
import { PrismaService } from "../core/prisma.service.js";
import type { CompanyScope } from "../crm/company-scope.service.js";
import {
  currencyCode,
  decimal6,
  optionalText,
  positiveInteger,
  requiredText,
  requirementCategory,
  type CreateDqeDto,
  type CreateDqeLineDto,
  type CreateStudyDto,
  type CreateStudyRequirementDto,
} from "./estimation.dto.js";

/**
 * INC-03 — première tranche verticale Study -> DQE.
 *
 * Toutes les lectures et mutations portent le double filtre organizationId +
 * companyId issu de CompanyScopeService. Les quantités/prix restent des
 * Prisma.Decimal et sont sérialisés en chaînes fixes à six décimales.
 */
@Injectable()
export class EstimationService {
  constructor(private readonly prisma: PrismaService) {}

  async listStudies(scope: CompanyScope) {
    const studies = await this.prisma.estimationStudy.findMany({
      where: scope,
      include: { requirements: { orderBy: { position: "asc" } } },
      orderBy: { createdAt: "desc" },
    });
    return studies.map(toStudyView);
  }

  async getStudy(scope: CompanyScope, id: string) {
    const study = await this.prisma.estimationStudy.findFirst({
      where: { id, ...scope },
      include: { requirements: { orderBy: { position: "asc" } } },
    });
    if (!study) throw new NotFoundException("Study not found");
    return toStudyView(study);
  }

  async createStudy(scope: CompanyScope, input: CreateStudyDto, actorUserId: string) {
    const opportunityId = requiredText(input.opportunityId, "opportunityId", 120);
    const opportunity = await this.prisma.crmOpportunity.findFirst({
      where: { id: opportunityId, ...scope },
      select: { id: true, status: true },
    });
    if (!opportunity) throw new NotFoundException("Opportunity not found");
    if (opportunity.status !== "OPEN") {
      throw new BadRequestException("Only an open opportunity can start a Study");
    }

    const code = requiredText(input.code, "code", 80);
    const duplicate = await this.prisma.estimationStudy.findFirst({
      where: { companyId: scope.companyId, code },
      select: { id: true },
    });
    if (duplicate) throw new BadRequestException(`A Study with code "${code}" already exists`);

    const study = await this.prisma.$transaction(async (tx) => {
      const created = await tx.estimationStudy.create({
        data: {
          ...scope,
          opportunityId,
          code,
          title: requiredText(input.title, "title", 180),
          objective: requiredText(input.objective, "objective", 2_000),
          sourceReference: optionalText(input.sourceReference, "sourceReference", 180),
        },
        include: { requirements: true },
      });
      await tx.auditLog.create({
        data: {
          organizationId: scope.organizationId,
          actorUserId,
          action: "estimation.study.created",
          resourceType: "EstimationStudy",
          resourceId: created.id,
          metadata: { companyId: scope.companyId, opportunityId, code },
        },
      });
      return created;
    });

    return toStudyView(study);
  }

  async addRequirement(
    scope: CompanyScope,
    studyId: string,
    input: CreateStudyRequirementDto,
  ) {
    const study = await this.prisma.estimationStudy.findFirst({
      where: { id: studyId, ...scope },
      select: { id: true, status: true },
    });
    if (!study) throw new NotFoundException("Study not found");
    if (study.status !== "DRAFT") {
      throw new BadRequestException("Requirements can only be added to a draft Study");
    }

    return this.prisma.estimationStudyRequirement.create({
      data: {
        ...scope,
        studyId,
        position: positiveInteger(input.position, "position"),
        category: requirementCategory(input.category),
        statement: requiredText(input.statement, "statement", 2_000),
        sourceReference: optionalText(input.sourceReference, "sourceReference", 180),
      },
    });
  }

  async markStudyReady(scope: CompanyScope, studyId: string, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const study = await tx.estimationStudy.findFirst({
        where: { id: studyId, ...scope },
        include: { requirements: { orderBy: { position: "asc" } } },
      });
      if (!study) throw new NotFoundException("Study not found");
      if (study.status !== "DRAFT") {
        throw new BadRequestException("Only a draft Study can be marked ready");
      }
      if (study.requirements.length === 0) {
        throw new BadRequestException("At least one immutable requirement is required");
      }

      const updated = await tx.estimationStudy.update({
        where: { id: study.id },
        data: { status: "READY_FOR_DQE" },
        include: { requirements: { orderBy: { position: "asc" } } },
      });
      await tx.auditLog.create({
        data: {
          organizationId: scope.organizationId,
          actorUserId,
          action: "estimation.study.ready",
          resourceType: "EstimationStudy",
          resourceId: study.id,
          metadata: { companyId: scope.companyId, requirementCount: study.requirements.length },
        },
      });
      return toStudyView(updated);
    });
  }

  async listDqes(scope: CompanyScope) {
    const documents = await this.prisma.dqeDocument.findMany({
      where: scope,
      include: dqeInclude,
      orderBy: { createdAt: "desc" },
    });
    return documents.map(toDqeView);
  }

  async getDqe(scope: CompanyScope, id: string) {
    const document = await this.prisma.dqeDocument.findFirst({
      where: { id, ...scope },
      include: dqeInclude,
    });
    if (!document) throw new NotFoundException("DQE not found");
    return toDqeView(document);
  }

  async createDqe(scope: CompanyScope, input: CreateDqeDto, actorUserId: string) {
    const studyId = requiredText(input.studyId, "studyId", 120);
    const code = requiredText(input.code, "code", 80);
    const title = requiredText(input.title, "title", 180);
    const currency = currencyCode(input.currency);

    const duplicate = await this.prisma.dqeDocument.findFirst({
      where: { companyId: scope.companyId, code },
      select: { id: true },
    });
    if (duplicate) throw new BadRequestException(`A DQE with code "${code}" already exists`);

    const createdId = await this.prisma.$transaction(async (tx) => {
      const study = await tx.estimationStudy.findFirst({
        where: { id: studyId, ...scope },
        select: { id: true, code: true, opportunityId: true, status: true },
      });
      if (!study) throw new NotFoundException("Study not found");
      if (study.status !== "READY_FOR_DQE") {
        throw new BadRequestException("Study must be READY_FOR_DQE");
      }

      const dqe = await tx.dqeDocument.create({
        data: {
          ...scope,
          opportunityId: study.opportunityId,
          code,
          title,
          currency,
        },
      });
      await tx.dqeStudySource.create({
        data: {
          ...scope,
          dqeId: dqe.id,
          studyId: study.id,
          studyCode: study.code,
          studyOpportunityId: study.opportunityId,
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: scope.organizationId,
          actorUserId,
          action: "estimation.dqe.created",
          resourceType: "DqeDocument",
          resourceId: dqe.id,
          metadata: { companyId: scope.companyId, studyId: study.id, code },
        },
      });
      return dqe.id;
    });

    return this.getDqe(scope, createdId);
  }

  async addDqeLine(scope: CompanyScope, dqeId: string, input: CreateDqeLineDto) {
    const document = await this.prisma.dqeDocument.findFirst({
      where: { id: dqeId, ...scope },
      select: { id: true, status: true },
    });
    if (!document) throw new NotFoundException("DQE not found");
    if (document.status !== "DRAFT") {
      throw new BadRequestException("Lines can only be added to a draft DQE");
    }

    const line = await this.prisma.dqeLine.create({
      data: {
        ...scope,
        dqeId,
        position: positiveInteger(input.position, "position"),
        reference: optionalText(input.reference, "reference", 120),
        designation: requiredText(input.designation, "designation", 500),
        unitCode: requiredText(input.unitCode, "unitCode", 32),
        quantity: new Prisma.Decimal(decimal6(input.quantity, "quantity", false)),
        unitPrice: new Prisma.Decimal(decimal6(input.unitPrice, "unitPrice", true)),
      },
    });
    return toDqeLineView(line);
  }

  async finalizeDqe(scope: CompanyScope, dqeId: string, actorUserId: string) {
    await this.prisma.$transaction(async (tx) => {
      const document = await tx.dqeDocument.findFirst({
        where: { id: dqeId, ...scope },
        select: { id: true, status: true },
      });
      if (!document) throw new NotFoundException("DQE not found");
      if (document.status !== "DRAFT") {
        throw new BadRequestException("Only a draft DQE can be finalized");
      }

      const lineCount = await tx.dqeLine.count({ where: { dqeId, ...scope } });
      if (lineCount === 0) throw new BadRequestException("A DQE needs at least one line");

      const updated = await tx.dqeDocument.updateMany({
        where: { id: dqeId, ...scope, status: "DRAFT" },
        data: { status: "FINALIZED", finalizedAt: new Date() },
      });
      if (updated.count !== 1) {
        throw new BadRequestException("DQE was finalized concurrently");
      }

      await tx.auditLog.create({
        data: {
          organizationId: scope.organizationId,
          actorUserId,
          action: "estimation.dqe.finalized",
          resourceType: "DqeDocument",
          resourceId: dqeId,
          metadata: { companyId: scope.companyId, status: "FINALIZED", lineCount },
        },
      });
    });

    return this.getDqe(scope, dqeId);
  }
}

const dqeInclude = {
  lines: { orderBy: { position: "asc" as const } },
  source: true,
} as const;

type StudyWithRequirements = Prisma.EstimationStudyGetPayload<{
  include: { requirements: true };
}>;

type DqeWithDetails = Prisma.DqeDocumentGetPayload<{
  include: typeof dqeInclude;
}>;

type DqeLineRecord = Prisma.DqeLineGetPayload<Record<string, never>>;

function toStudyView(study: StudyWithRequirements) {
  return {
    id: study.id,
    companyId: study.companyId,
    opportunityId: study.opportunityId,
    code: study.code,
    title: study.title,
    objective: study.objective,
    sourceReference: study.sourceReference,
    status: study.status,
    createdAt: study.createdAt.toISOString(),
    requirements: study.requirements.map((requirement) => ({
      id: requirement.id,
      position: requirement.position,
      category: requirement.category,
      statement: requirement.statement,
      sourceReference: requirement.sourceReference,
      createdAt: requirement.createdAt.toISOString(),
    })),
  };
}

function toDqeLineView(line: DqeLineRecord) {
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

function toDqeView(document: DqeWithDetails) {
  let subtotal = new Prisma.Decimal(0);
  const lines = document.lines.map((line) => {
    const view = toDqeLineView(line);
    subtotal = subtotal.plus(new Prisma.Decimal(view.lineTotal));
    return view;
  });

  return {
    id: document.id,
    companyId: document.companyId,
    opportunityId: document.opportunityId,
    code: document.code,
    title: document.title,
    currency: document.currency.trim(),
    status: document.status,
    revision: document.revision,
    finalizedAt: document.finalizedAt?.toISOString() ?? null,
    createdAt: document.createdAt.toISOString(),
    subtotal: subtotal.toFixed(6),
    lines,
    source: document.source
      ? {
          studyId: document.source.studyId,
          studyCode: document.source.studyCode,
          studyOpportunityId: document.source.studyOpportunityId,
          createdAt: document.source.createdAt.toISOString(),
        }
      : null,
  };
}
