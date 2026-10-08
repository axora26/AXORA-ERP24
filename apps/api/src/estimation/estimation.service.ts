import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@axora24/database";
import { PrismaService } from "../core/prisma.service.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import {
  currencyCode,
  costCategory,
  decimal6,
  optionalText,
  positiveInteger,
  requiredText,
  rate6,
  requirementCategory,
  assertDraftFields,
  draftVersion,
  type CreateDqeDto,
  type CreateDqeLineDto,
  type CreateDqeLotDto,
  type CreateDqeVariantDto,
  type CreateDqeLibraryItemDto,
  type CreateStudyDto,
  type CreateStudyRequirementDto,
  type DraftVersionDto,
  type UpdateStudyRequirementDto,
  type UpdateDqeLineDto,
  type UpdateDqePricingDto,
  type UpdateDqeLibraryItemDto,
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
    actorUserId: string,
  ) {
    assertDraftFields(input, ["companyId", "expectedVersion", "position", "category", "statement", "sourceReference"]);
    const version = draftVersion(input.expectedVersion, false);
    return this.prisma.$transaction(async (tx) => {
      const study = await this.lockStudy(tx, scope, studyId);
      checkDraft(study.status, study.version, version, "Study");
      const position = positiveInteger(input.position, "position");
      await this.requirementPosition(tx, scope, studyId, position);
      const created = await tx.estimationStudyRequirement.create({ data: { ...scope, studyId, position,
        category: requirementCategory(input.category), statement: requiredText(input.statement, "statement", 2_000),
        sourceReference: optionalText(input.sourceReference, "sourceReference", 180) } });
      await this.bumpStudy(tx, scope, studyId, study.version);
      await this.draftAudit(tx, scope, actorUserId, "study.requirement.created", "EstimationStudyRequirement", created.id, studyId, study.version + 1);
      return created;
    });
  }

  async updateRequirement(scope: CompanyScope, studyId: string, requirementId: string, input: UpdateStudyRequirementDto, actorUserId: string) {
    assertDraftFields(input, ["companyId", "expectedVersion", "position", "category", "statement", "sourceReference"]);
    const version = draftVersion(input.expectedVersion)!;
    const data: Prisma.EstimationStudyRequirementUpdateInput = {};
    if (input.position !== undefined) data.position = positiveInteger(input.position, "position");
    if (input.category !== undefined) data.category = requirementCategory(input.category);
    if (input.statement !== undefined) data.statement = requiredText(input.statement, "statement", 2_000);
    if (input.sourceReference !== undefined) data.sourceReference = optionalText(input.sourceReference, "sourceReference", 180);
    if (!Object.keys(data).length) throw new BadRequestException("Provide at least one requirement field to update");
    return this.prisma.$transaction(async (tx) => {
      const study = await this.lockStudy(tx, scope, studyId);
      checkDraft(study.status, study.version, version, "Study");
      const current = await tx.estimationStudyRequirement.findFirst({ where: { id: requirementId, studyId, ...scope } });
      if (!current) throw new NotFoundException("Study requirement not found");
      if (typeof data.position === "number") await this.requirementPosition(tx, scope, studyId, data.position, requirementId);
      await tx.estimationStudyRequirement.update({ where: { id: requirementId }, data });
      await this.bumpStudy(tx, scope, studyId, study.version);
      await this.draftAudit(tx, scope, actorUserId, "study.requirement.updated", "EstimationStudyRequirement", requirementId, studyId, study.version + 1, Object.keys(data));
      return toStudyView(await tx.estimationStudy.findUniqueOrThrow({ where: { id: studyId }, include: { requirements: { orderBy: { position: "asc" } } } }));
    });
  }

  async deleteRequirement(scope: CompanyScope, studyId: string, requirementId: string, input: DraftVersionDto, actorUserId: string) {
    assertDraftFields(input, ["companyId", "expectedVersion"]);
    const version = draftVersion(input.expectedVersion)!;
    return this.prisma.$transaction(async (tx) => {
      const study = await this.lockStudy(tx, scope, studyId);
      checkDraft(study.status, study.version, version, "Study");
      const current = await tx.estimationStudyRequirement.findFirst({ where: { id: requirementId, studyId, ...scope } });
      if (!current) throw new NotFoundException("Study requirement not found");
      await tx.estimationStudyRequirement.delete({ where: { id: requirementId } });
      await this.bumpStudy(tx, scope, studyId, study.version);
      await this.draftAudit(tx, scope, actorUserId, "study.requirement.deleted", "EstimationStudyRequirement", requirementId, studyId, study.version + 1, [],
        { position: current.position, category: current.category, statement: current.statement, sourceReference: current.sourceReference });
      return toStudyView(await tx.estimationStudy.findUniqueOrThrow({ where: { id: studyId }, include: { requirements: { orderBy: { position: "asc" } } } }));
    });
  }

  async markStudyReady(scope: CompanyScope, studyId: string, actorUserId: string, input: DraftVersionDto = {}) {
    assertDraftFields(input, ["companyId", "expectedVersion"]);
    const version = draftVersion(input.expectedVersion, false);
    return this.prisma.$transaction(async (tx) => {
      await this.lockStudy(tx, scope, studyId);
      const study = await tx.estimationStudy.findFirst({
        where: { id: studyId, ...scope },
        include: { requirements: { orderBy: { position: "asc" } } },
      });
      if (!study) throw new NotFoundException("Study not found");
      if (study.status !== "DRAFT") {
        throw new BadRequestException("Only a draft Study can be marked ready");
      }
      checkDraft(study.status, study.version, version, "Study");
      if (study.requirements.length === 0) {
        throw new BadRequestException("At least one immutable requirement is required");
      }

      const result = await tx.estimationStudy.updateMany({
        where: { id: study.id, ...scope, status: "DRAFT", version: study.version },
        data: { status: "READY_FOR_DQE", version: { increment: 1 } },
      });
      if (result.count !== 1) throw new ConflictException("Study was changed concurrently; reload before saving");
      const updated = await tx.estimationStudy.findUniqueOrThrow({ where: { id: study.id }, include: { requirements: { orderBy: { position: "asc" } } } });
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

  async addDqeLine(scope: CompanyScope, dqeId: string, input: CreateDqeLineDto, actorUserId: string) {
    assertDraftFields(input, ["companyId", "expectedVersion", "lotId", "position", "reference", "designation", "unitCode", "costCategory", "quantity", "unitPrice"]);
    const version = draftVersion(input.expectedVersion, false);
    return this.prisma.$transaction(async (tx) => {
      const document = await this.lockDqe(tx, scope, dqeId);
      checkDraft(document.status, document.version, version, "DQE");
      const position = positiveInteger(input.position, "position");
      await this.linePosition(tx, scope, dqeId, position);
      const lotId = input.lotId === undefined ? null : requiredText(input.lotId, "lotId", 120);
      if (lotId) await this.requireLot(tx, scope, dqeId, lotId);
      const line = await tx.dqeLine.create({ data: { ...scope, dqeId, lotId, position,
        reference: optionalText(input.reference, "reference", 120), designation: requiredText(input.designation, "designation", 500),
        unitCode: requiredText(input.unitCode, "unitCode", 32), costCategory: costCategory(input.costCategory), quantity: new Prisma.Decimal(decimal6(input.quantity, "quantity", false)),
        unitPrice: new Prisma.Decimal(decimal6(input.unitPrice, "unitPrice", true)) } });
      await this.bumpDqe(tx, scope, dqeId, document.version);
      await this.draftAudit(tx, scope, actorUserId, "dqe.line.created", "DqeLine", line.id, dqeId, document.version + 1);
      return toDqeLineView(line);
    });
  }

  async updateDqeLine(scope: CompanyScope, dqeId: string, lineId: string, input: UpdateDqeLineDto, actorUserId: string) {
    assertDraftFields(input, ["companyId", "expectedVersion", "lotId", "position", "reference", "designation", "unitCode", "costCategory", "quantity", "unitPrice"]);
    const version = draftVersion(input.expectedVersion)!;
    const data: Prisma.DqeLineUncheckedUpdateInput = {};
    if (input.position !== undefined) data.position = positiveInteger(input.position, "position");
    if (input.reference !== undefined) data.reference = optionalText(input.reference, "reference", 120);
    if (input.designation !== undefined) data.designation = requiredText(input.designation, "designation", 500);
    if (input.unitCode !== undefined) data.unitCode = requiredText(input.unitCode, "unitCode", 32);
    if (input.costCategory !== undefined) data.costCategory = costCategory(input.costCategory);
    if (input.quantity !== undefined) data.quantity = new Prisma.Decimal(decimal6(input.quantity, "quantity", false));
    if (input.unitPrice !== undefined) data.unitPrice = new Prisma.Decimal(decimal6(input.unitPrice, "unitPrice", true));
    if (!Object.keys(data).length && input.lotId === undefined) throw new BadRequestException("Provide at least one DQE line field to update");
    return this.prisma.$transaction(async (tx) => {
      const document = await this.lockDqe(tx, scope, dqeId);
      checkDraft(document.status, document.version, version, "DQE");
      const current = await tx.dqeLine.findFirst({ where: { id: lineId, dqeId, ...scope } });
      if (!current) throw new NotFoundException("DQE line not found");
      if (input.lotId !== undefined) {
        // The composite lot relation shares tenant/document keys: change only lotId,
        // never disconnect the relation (which would also clear those scope keys).
        if (input.lotId === null || input.lotId === "") data.lotId = null;
        else {
          const lotId = requiredText(input.lotId, "lotId", 120);
          await this.requireLot(tx, scope, dqeId, lotId);
          data.lotId = lotId;
        }
      }
      if (typeof data.position === "number") await this.linePosition(tx, scope, dqeId, data.position, lineId);
      await tx.dqeLine.update({ where: { id: lineId }, data });
      await this.bumpDqe(tx, scope, dqeId, document.version);
      await this.draftAudit(tx, scope, actorUserId, "dqe.line.updated", "DqeLine", lineId, dqeId, document.version + 1, Object.keys(data));
      return toDqeView(await tx.dqeDocument.findUniqueOrThrow({ where: { id: dqeId }, include: dqeInclude }));
    });
  }

  async createDqeLot(scope: CompanyScope, dqeId: string, input: CreateDqeLotDto, actorUserId: string) {
    assertDraftFields(input, ["companyId", "expectedVersion", "position", "code", "designation"]);
    const version = draftVersion(input.expectedVersion)!;
    return this.prisma.$transaction(async (tx) => {
      const document = await this.lockDqe(tx, scope, dqeId);
      checkDraft(document.status, document.version, version, "DQE");
      const position = positiveInteger(input.position, "position");
      const code = requiredText(input.code, "code", 80).toUpperCase();
      const duplicate = await tx.dqeLot.findFirst({
        where: { ...scope, dqeId, OR: [{ position }, { code }] },
        select: { position: true, code: true },
      });
      if (duplicate) {
        throw new ConflictException(duplicate.position === position ? "This DQE lot position already exists" : "This DQE lot code already exists");
      }
      const lot = await tx.dqeLot.create({
        data: { ...scope, dqeId, position, code, designation: requiredText(input.designation, "designation", 180) },
      });
      await this.bumpDqe(tx, scope, dqeId, document.version);
      await this.draftAudit(tx, scope, actorUserId, "dqe.lot.created", "DqeLot", lot.id, dqeId, document.version + 1);
      return toDqeView(await tx.dqeDocument.findUniqueOrThrow({ where: { id: dqeId }, include: dqeInclude }));
    });
  }

  async updateDqePricing(scope: CompanyScope, dqeId: string, input: UpdateDqePricingDto, actorUserId: string) {
    assertDraftFields(input, ["companyId", "expectedVersion", "overheadRate", "marginRate", "taxRate"]);
    const version = draftVersion(input.expectedVersion)!;
    const data: Prisma.DqeDocumentUpdateInput = {};
    if (input.overheadRate !== undefined) data.overheadRate = new Prisma.Decimal(rate6(input.overheadRate, "overheadRate"));
    if (input.marginRate !== undefined) data.marginRate = new Prisma.Decimal(rate6(input.marginRate, "marginRate"));
    if (input.taxRate !== undefined) data.taxRate = new Prisma.Decimal(rate6(input.taxRate, "taxRate"));
    if (!Object.keys(data).length) throw new BadRequestException("Provide at least one pricing field to update");
    return this.prisma.$transaction(async (tx) => {
      const document = await this.lockDqe(tx, scope, dqeId);
      checkDraft(document.status, document.version, version, "DQE");
      await tx.dqeDocument.update({ where: { id: dqeId }, data: { ...data, version: { increment: 1 } } });
      await this.draftAudit(tx, scope, actorUserId, "dqe.pricing.updated", "DqeDocument", dqeId, dqeId, document.version + 1, Object.keys(data));
      return toDqeView(await tx.dqeDocument.findUniqueOrThrow({ where: { id: dqeId }, include: dqeInclude }));
    });
  }

  async createDqeVariant(scope: CompanyScope, dqeId: string, input: CreateDqeVariantDto, actorUserId: string) {
    assertDraftFields(input, ["companyId", "expectedVersion", "code", "title"]);
    const version = draftVersion(input.expectedVersion)!;
    const code = requiredText(input.code, "code", 80).toUpperCase();
    const title = requiredText(input.title, "title", 180);
    return this.prisma.$transaction(async (tx) => {
      const locked = await this.lockDqe(tx, scope, dqeId);
      if (locked.version !== version) throw new ConflictException("DQE changed since it was loaded");
      const document = await tx.dqeDocument.findUniqueOrThrow({ where: { id: dqeId }, include: dqeInclude });
      const duplicate = await tx.dqeVariant.findFirst({ where: { dqeId, ...scope, code }, select: { id: true } });
      if (duplicate) throw new ConflictException("A DQE variant with this code already exists");
      const current = toDqeView(document);
      const created = await tx.dqeVariant.create({
        data: {
          ...scope,
          dqeId,
          code,
          title,
          currency: current.currency,
          revision: current.revision,
          overheadRate: new Prisma.Decimal(current.overheadRate),
          marginRate: new Prisma.Decimal(current.marginRate),
          taxRate: new Prisma.Decimal(current.taxRate),
          subtotal: new Prisma.Decimal(current.subtotal),
          total: new Prisma.Decimal(current.total),
          snapshot: {
            lots: current.lots.map((lot) => ({ id: lot.id, position: lot.position, code: lot.code, designation: lot.designation, lineCount: lot.lineCount, subtotal: lot.subtotal })),
            lines: current.lines.map((line) => ({ lotId: line.lotId, position: line.position, reference: line.reference, designation: line.designation, unitCode: line.unitCode, costCategory: line.costCategory ?? "MATERIAL", quantity: line.quantity, unitPrice: line.unitPrice, lineTotal: line.lineTotal })),
            overheadRate: current.overheadRate,
            marginRate: current.marginRate,
            taxRate: current.taxRate,
            subtotal: current.subtotal,
            total: current.total,
          } as Prisma.InputJsonValue,
        },
      });
      await this.draftAudit(tx, scope, actorUserId, "dqe.variant.created", "DqeVariant", created.id, dqeId, document.version, [], { code, revision: document.revision, subtotal: current.subtotal, total: current.total });
      return toDqeVariantView(created, current.subtotal, current.total);
    });
  }

  async listDqeVariants(scope: CompanyScope, dqeId: string) {
    const document = await this.prisma.dqeDocument.findFirst({ where: { id: dqeId, ...scope }, include: dqeInclude });
    if (!document) throw new NotFoundException("DQE not found");
    const current = toDqeView(document);
    const variants = await this.prisma.dqeVariant.findMany({ where: { dqeId, ...scope }, orderBy: [{ createdAt: "desc" }, { code: "asc" }] });
    return variants.map((variant) => toDqeVariantView(variant, current.subtotal, current.total));
  }

  async listDqeLibrary(scope: CompanyScope) {
    const items = await this.prisma.dqeLibraryItem.findMany({ where: scope, orderBy: [{ isActive: "desc" }, { code: "asc" }] });
    return items.map(toDqeLibraryItemView);
  }

  async createDqeLibraryItem(scope: CompanyScope, input: CreateDqeLibraryItemDto, actorUserId: string) {
    assertDraftFields(input, ["companyId", "code", "designation", "unitCode", "costCategory", "unitPrice"]);
    const code = requiredText(input.code, "code", 80).toUpperCase();
    const designation = requiredText(input.designation, "designation", 500);
    const unitCode = requiredText(input.unitCode, "unitCode", 32);
    const item = await this.prisma.$transaction(async (tx) => {
      const duplicate = await tx.dqeLibraryItem.findFirst({ where: { ...scope, code }, select: { id: true } });
      if (duplicate) throw new ConflictException("A library item with this code already exists");
      const created = await tx.dqeLibraryItem.create({ data: { ...scope, code, designation, unitCode, costCategory: costCategory(input.costCategory), unitPrice: new Prisma.Decimal(decimal6(input.unitPrice, "unitPrice", true)) } });
      await this.draftAudit(tx, scope, actorUserId, "dqe.library.created", "DqeLibraryItem", created.id, created.id, 1, [], { code, designation, unitCode, costCategory: created.costCategory, unitPrice: created.unitPrice.toFixed(6) });
      return created;
    });
    return toDqeLibraryItemView(item);
  }

  async updateDqeLibraryItem(scope: CompanyScope, itemId: string, input: UpdateDqeLibraryItemDto, actorUserId: string) {
    assertDraftFields(input, ["companyId", "designation", "unitCode", "costCategory", "unitPrice", "isActive"]);
    const data: Prisma.DqeLibraryItemUpdateInput = {};
    if (input.designation !== undefined) data.designation = requiredText(input.designation, "designation", 500);
    if (input.unitCode !== undefined) data.unitCode = requiredText(input.unitCode, "unitCode", 32);
    if (input.costCategory !== undefined) data.costCategory = costCategory(input.costCategory);
    if (input.unitPrice !== undefined) data.unitPrice = new Prisma.Decimal(decimal6(input.unitPrice, "unitPrice", true));
    if (input.isActive !== undefined) {
      if (typeof input.isActive !== "boolean") throw new BadRequestException("isActive must be a boolean");
      data.isActive = input.isActive;
    }
    if (!Object.keys(data).length) throw new BadRequestException("Provide at least one library field to update");
    const updated = await this.prisma.$transaction(async (tx) => {
      const current = await tx.dqeLibraryItem.findFirst({ where: { id: itemId, ...scope } });
      if (!current) throw new NotFoundException("DQE library item not found");
      const next = await tx.dqeLibraryItem.update({ where: { id: itemId }, data });
      await this.draftAudit(tx, scope, actorUserId, "dqe.library.updated", "DqeLibraryItem", itemId, itemId, 1, Object.keys(data));
      return next;
    });
    return toDqeLibraryItemView(updated);
  }

  async deleteDqeLine(scope: CompanyScope, dqeId: string, lineId: string, input: DraftVersionDto, actorUserId: string) {
    assertDraftFields(input, ["companyId", "expectedVersion"]);
    const version = draftVersion(input.expectedVersion)!;
    return this.prisma.$transaction(async (tx) => {
      const document = await this.lockDqe(tx, scope, dqeId);
      checkDraft(document.status, document.version, version, "DQE");
      const current = await tx.dqeLine.findFirst({ where: { id: lineId, dqeId, ...scope } });
      if (!current) throw new NotFoundException("DQE line not found");
      await tx.dqeLine.delete({ where: { id: lineId } });
      await this.bumpDqe(tx, scope, dqeId, document.version);
      await this.draftAudit(tx, scope, actorUserId, "dqe.line.deleted", "DqeLine", lineId, dqeId, document.version + 1, [],
        { position: current.position, reference: current.reference, designation: current.designation, unitCode: current.unitCode,
          costCategory: current.costCategory,
          quantity: current.quantity.toFixed(6), unitPrice: current.unitPrice.toFixed(6) });
      return toDqeView(await tx.dqeDocument.findUniqueOrThrow({ where: { id: dqeId }, include: dqeInclude }));
    });
  }

  async finalizeDqe(scope: CompanyScope, dqeId: string, actorUserId: string, input: DraftVersionDto = {}) {
    assertDraftFields(input, ["companyId", "expectedVersion"]);
    const version = draftVersion(input.expectedVersion, false);
    await this.prisma.$transaction(async (tx) => {
      await this.lockDqe(tx, scope, dqeId);
      const document = await tx.dqeDocument.findFirst({
        where: { id: dqeId, ...scope },
        select: { id: true, status: true, version: true },
      });
      if (!document) throw new NotFoundException("DQE not found");
      if (document.status !== "DRAFT") {
        throw new BadRequestException("Only a draft DQE can be finalized");
      }
      checkDraft(document.status, document.version, version, "DQE");

      const lineCount = await tx.dqeLine.count({ where: { dqeId, ...scope } });
      if (lineCount === 0) throw new BadRequestException("A DQE needs at least one line");

      const updated = await tx.dqeDocument.updateMany({
        where: { id: dqeId, ...scope, status: "DRAFT", version: document.version },
        data: { status: "FINALIZED", finalizedAt: new Date(), version: { increment: 1 } },
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

  private async lockStudy(tx: Prisma.TransactionClient, scope: CompanyScope, studyId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "estimation_studies"
      WHERE "id" = ${studyId} AND "organizationId" = ${scope.organizationId} AND "companyId" = ${scope.companyId}
      FOR UPDATE
    `;
    if (!rows.length) throw new NotFoundException("Study not found");
    return tx.estimationStudy.findUniqueOrThrow({ where: { id: studyId } });
  }

  private async lockDqe(tx: Prisma.TransactionClient, scope: CompanyScope, dqeId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "dqe_documents"
      WHERE "id" = ${dqeId} AND "organizationId" = ${scope.organizationId} AND "companyId" = ${scope.companyId}
      FOR UPDATE
    `;
    if (!rows.length) throw new NotFoundException("DQE not found");
    return tx.dqeDocument.findUniqueOrThrow({ where: { id: dqeId } });
  }

  private async requirementPosition(tx: Prisma.TransactionClient, scope: CompanyScope, studyId: string, position: number, exceptId?: string) {
    if (await tx.estimationStudyRequirement.findFirst({ where: { ...scope, studyId, position, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } })) {
      throw new ConflictException("This requirement position already exists");
    }
  }
  private async linePosition(tx: Prisma.TransactionClient, scope: CompanyScope, dqeId: string, position: number, exceptId?: string) {
    if (await tx.dqeLine.findFirst({ where: { ...scope, dqeId, position, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } })) {
      throw new ConflictException("This DQE line position already exists");
    }
  }
  private async requireLot(tx: Prisma.TransactionClient, scope: CompanyScope, dqeId: string, lotId: string) {
    const lot = await tx.dqeLot.findFirst({ where: { id: lotId, dqeId, ...scope }, select: { id: true } });
    if (!lot) throw new NotFoundException("DQE lot not found");
  }
  private async bumpStudy(tx: Prisma.TransactionClient, scope: CompanyScope, id: string, version: number) {
    const result = await tx.estimationStudy.updateMany({ where: { id, ...scope, status: "DRAFT", version }, data: { version: { increment: 1 } } });
    if (result.count !== 1) throw new ConflictException("Study was changed concurrently; reload before saving");
  }
  private async bumpDqe(tx: Prisma.TransactionClient, scope: CompanyScope, id: string, version: number) {
    const result = await tx.dqeDocument.updateMany({ where: { id, ...scope, status: "DRAFT", version }, data: { version: { increment: 1 } } });
    if (result.count !== 1) throw new ConflictException("DQE was changed concurrently; reload before saving");
  }
  private async draftAudit(tx: Prisma.TransactionClient, scope: CompanyScope, actorUserId: string,
    action: string, resourceType: string, resourceId: string, parentId: string, version: number, fields: string[] = [], deletedSnapshot?: Prisma.InputJsonValue) {
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, actorUserId, action: `estimation.${action}`,
      resourceType, resourceId, metadata: { companyId: scope.companyId, parentId, version, fields, ...(deletedSnapshot ? { deletedSnapshot } : {}) } } });
  }
}

function checkDraft(status: string, current: number, expected: number | undefined, resource: string) {
  if (status !== "DRAFT") throw new BadRequestException(`${resource} is frozen; only draft content can be modified`);
  if (expected !== undefined && current !== expected) throw new ConflictException(`${resource} was changed by another user. Reload before saving.`);
}

const dqeInclude = {
  lines: { orderBy: { position: "asc" as const } },
  lots: { orderBy: { position: "asc" as const } },
  source: true,
} as const;

type StudyWithRequirements = Prisma.EstimationStudyGetPayload<{
  include: { requirements: true };
}>;

type DqeWithDetails = Prisma.DqeDocumentGetPayload<{
  include: typeof dqeInclude;
}>;

type DqeLineRecord = Prisma.DqeLineGetPayload<Record<string, never>>;
type DqeVariantRecord = Prisma.DqeVariantGetPayload<Record<string, never>>;
type DqeLibraryItemRecord = Prisma.DqeLibraryItemGetPayload<Record<string, never>>;

function toDqeLibraryItemView(item: DqeLibraryItemRecord) {
  return {
    id: item.id,
    code: item.code,
    designation: item.designation,
    unitCode: item.unitCode,
    costCategory: item.costCategory,
    unitPrice: item.unitPrice.toFixed(6),
    isActive: item.isActive,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

function toDqeVariantView(variant: DqeVariantRecord, currentSubtotal: string, currentTotal: string) {
  return {
    id: variant.id,
    dqeId: variant.dqeId,
    code: variant.code,
    title: variant.title,
    currency: variant.currency.trim(),
    revision: variant.revision,
    overheadRate: variant.overheadRate.toFixed(6),
    marginRate: variant.marginRate.toFixed(6),
    taxRate: variant.taxRate.toFixed(6),
    subtotal: variant.subtotal.toFixed(6),
    total: variant.total.toFixed(6),
    createdAt: variant.createdAt.toISOString(),
    deltaSubtotal: new Prisma.Decimal(variant.subtotal).minus(currentSubtotal).toFixed(6),
    deltaTotal: new Prisma.Decimal(variant.total).minus(currentTotal).toFixed(6),
  };
}

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
    version: study.version,
    updatedAt: study.updatedAt.toISOString(),
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
    lotId: line.lotId,
    position: line.position,
    reference: line.reference,
    designation: line.designation,
    unitCode: line.unitCode,
    costCategory: line.costCategory,
    quantity: quantity.toFixed(6),
    unitPrice: unitPrice.toFixed(6),
    lineTotal: quantity.mul(unitPrice).toFixed(6),
  };
}

function toDqeView(document: DqeWithDetails) {
  let subtotal = new Prisma.Decimal(0);
  const categoryTotals: Record<string, Prisma.Decimal> = {
    MATERIAL: new Prisma.Decimal(0), LABOR: new Prisma.Decimal(0), EQUIPMENT: new Prisma.Decimal(0), SUBCONTRACTING: new Prisma.Decimal(0), OTHER: new Prisma.Decimal(0),
  };
  const lines = document.lines.map((line) => {
    const view = toDqeLineView(line);
    const lineTotal = new Prisma.Decimal(view.lineTotal);
    subtotal = subtotal.plus(lineTotal);
    categoryTotals[view.costCategory] = (categoryTotals[view.costCategory] ?? new Prisma.Decimal(0)).plus(lineTotal);
    return view;
  });
  const lotTotals = new Map<string, { lineCount: number; subtotal: Prisma.Decimal }>();
  for (const line of lines) {
    if (!line.lotId) continue;
    const current = lotTotals.get(line.lotId) ?? { lineCount: 0, subtotal: new Prisma.Decimal(0) };
    current.lineCount += 1;
    current.subtotal = current.subtotal.plus(line.lineTotal);
    lotTotals.set(line.lotId, current);
  }
  const overheadRate = new Prisma.Decimal(document.overheadRate);
  const marginRate = new Prisma.Decimal(document.marginRate);
  const taxRate = new Prisma.Decimal(document.taxRate);
  const overheadAmount = subtotal.mul(overheadRate).div(100);
  const costBase = subtotal.plus(overheadAmount);
  const marginAmount = costBase.mul(marginRate).div(100);
  const taxableTotal = costBase.plus(marginAmount);
  const taxAmount = taxableTotal.mul(taxRate).div(100);
  const totalFor = (key: string) => categoryTotals[key] ?? new Prisma.Decimal(0);

  return {
    id: document.id,
    companyId: document.companyId,
    opportunityId: document.opportunityId,
    code: document.code,
    title: document.title,
    currency: document.currency.trim(),
    status: document.status,
    overheadRate: overheadRate.toFixed(6),
    marginRate: marginRate.toFixed(6),
    taxRate: taxRate.toFixed(6),
    revision: document.revision,
    version: document.version,
    updatedAt: document.updatedAt.toISOString(),
    finalizedAt: document.finalizedAt?.toISOString() ?? null,
    createdAt: document.createdAt.toISOString(),
    subtotal: subtotal.toFixed(6),
    overheadAmount: overheadAmount.toFixed(6),
    costBase: costBase.toFixed(6),
    marginAmount: marginAmount.toFixed(6),
    taxableTotal: taxableTotal.toFixed(6),
    taxAmount: taxAmount.toFixed(6),
    total: taxableTotal.plus(taxAmount).toFixed(6),
    categoryTotals: {
      MATERIAL: totalFor("MATERIAL").toFixed(6),
      LABOR: totalFor("LABOR").toFixed(6),
      EQUIPMENT: totalFor("EQUIPMENT").toFixed(6),
      SUBCONTRACTING: totalFor("SUBCONTRACTING").toFixed(6),
      OTHER: totalFor("OTHER").toFixed(6),
    },
    lots: document.lots.map((lot) => {
      const totals = lotTotals.get(lot.id) ?? { lineCount: 0, subtotal: new Prisma.Decimal(0) };
      return {
        id: lot.id,
        position: lot.position,
        code: lot.code,
        designation: lot.designation,
        lineCount: totals.lineCount,
        subtotal: totals.subtotal.toFixed(6),
      };
    }),
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
