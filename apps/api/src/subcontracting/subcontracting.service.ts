import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type {
  SubcontractPackageView,
  SubcontractRetentionView,
  SubcontractStatementView,
  SubcontractingSummaryView,
  SubcontractorComplianceItem,
  SubcontractorDocumentKind,
  SubcontractorView,
} from "@axora24/contracts";
import { Prisma } from "@axora24/database";
import { PrismaService } from "../core/prisma.service.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import { NumberingService } from "../common/numbering.service.js";
import { writeAudit } from "../common/audit.js";
import { dec, money, sumDecimals } from "../common/decimal.js";
import { assertBody, optionalDecimal, optionalId, optionalInt, optionalText, requiredDate, requiredDecimal, requiredEnum, requiredId, requiredInt, requiredText } from "../common/validation.js";

type Tx = Prisma.TransactionClient;
type Client = Tx | PrismaService;

const DOCUMENT_KINDS = ["RCCM", "TAX_CERTIFICATE", "SOCIAL_CERTIFICATE", "LIABILITY_INSURANCE", "DECENNIAL_INSURANCE", "OTHER"] as const;
/** Pieces de l'obligation de vigilance : exigees pour qualifier, confier un lot et approuver une situation. */
export const REQUIRED_SUBCONTRACTOR_DOCUMENTS: SubcontractorDocumentKind[] = ["RCCM", "TAX_CERTIFICATE", "SOCIAL_CERTIFICATE", "LIABILITY_INSURANCE"];
const DOCUMENT_LABEL: Record<string, string> = {
  RCCM: "RCCM",
  TAX_CERTIFICATE: "attestation fiscale",
  SOCIAL_CERTIFICATE: "attestation sociale (CNSS)",
  LIABILITY_INSURANCE: "assurance RC",
  DECENNIAL_INSURANCE: "assurance décennale",
  OTHER: "document",
};
const DAY_MS = 86_400_000;

function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function subcontractorCompliance(documents: Array<{ kind: SubcontractorDocumentKind; reference: string; validFrom: Date; validUntil: Date }>, at: Date): SubcontractorComplianceItem[] {
  const day = startOfDay(at);
  const kinds = [...new Set<SubcontractorDocumentKind>([...REQUIRED_SUBCONTRACTOR_DOCUMENTS, ...documents.map((document) => document.kind)])];
  return kinds.map((kind) => {
    const best = documents.filter((document) => document.kind === kind && document.validFrom <= day).sort((a, b) => b.validUntil.getTime() - a.validUntil.getTime())[0];
    const required = REQUIRED_SUBCONTRACTOR_DOCUMENTS.includes(kind);
    if (!best) return { kind, state: "MISSING", validUntil: null, reference: null, required };
    const days = (best.validUntil.getTime() - day.getTime()) / DAY_MS;
    return { kind, state: days < 0 ? "EXPIRED" : days <= 30 ? "EXPIRING" : "VALID", validUntil: best.validUntil.toISOString().slice(0, 10), reference: best.reference, required };
  });
}

function blocking(items: SubcontractorComplianceItem[]): string[] {
  return items.filter((item) => item.required && (item.state === "EXPIRED" || item.state === "MISSING")).map((item) => `${DOCUMENT_LABEL[item.kind]} ${item.state === "MISSING" ? "absente" : "échue"}`);
}

/**
 * INC-19 — Sous-traitants (BC-19). Le sous-traitant est un fournisseur
 * qualifie ; le lot reference une commande emise ; l'avancement des
 * situations vient des taches du lot WBS ; les factures sont des factures
 * fournisseurs de la Finance ; la retenue de garantie est tracee a part.
 */
@Injectable()
export class SubcontractingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
  ) {}

  async summary(scope: CompanyScope): Promise<SubcontractingSummaryView> {
    const [subcontractors, packages, statements, retentions, company] = await Promise.all([
      this.listSubcontractors(scope),
      this.prisma.subcontractPackage.findMany({ where: { ...scope, status: "ACTIVE" }, select: { amount: true } }),
      this.prisma.subcontractStatement.findMany({ where: scope, select: { status: true, grossAmount: true } }),
      this.prisma.subcontractRetention.findMany({ where: { ...scope, status: "HELD" }, select: { amount: true, releaseDueDate: true } }),
      this.company(scope),
    ]);
    const today = startOfDay(new Date());
    return {
      subcontractors: subcontractors.length,
      qualified: subcontractors.filter((row) => row.status === "QUALIFIED").length,
      nonCompliant: subcontractors.filter((row) => !row.compliant).length,
      activePackages: packages.length,
      contracted: money(sumDecimals(packages.map((row) => dec(row.amount)))),
      certified: money(sumDecimals(statements.filter((row) => row.status === "APPROVED").map((row) => dec(row.grossAmount)))),
      pendingStatements: statements.filter((row) => row.status === "DRAFT").length,
      retentionHeld: money(sumDecimals(retentions.map((row) => dec(row.amount)))),
      retentionDue: retentions.filter((row) => row.releaseDueDate <= today).length,
      currency: company,
    };
  }

  // -------------------------------------------------------------------
  // Sous-traitants (fournisseurs qualifies)
  // -------------------------------------------------------------------

  async listSubcontractors(scope: CompanyScope): Promise<SubcontractorView[]> {
    const profiles = await this.prisma.subcontractorProfile.findMany({ where: scope, include: { supplier: true, documents: true }, orderBy: { createdAt: "asc" } });
    return this.subcontractorViews(scope, profiles, false);
  }

  async getSubcontractor(scope: CompanyScope, profileId: string): Promise<SubcontractorView> {
    const profile = await this.prisma.subcontractorProfile.findFirst({ where: { id: profileId, ...scope }, include: { supplier: true, documents: true } });
    if (!profile) throw new NotFoundException("Subcontractor not found");
    const [view] = await this.subcontractorViews(scope, [profile], true);
    return view!;
  }

  /** Un fournisseur existant (Achats) devient sous-traitant : aucune fiche parallele. */
  async createSubcontractor(scope: CompanyScope, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const supplierId = requiredId(input.supplierId, "supplierId");
    const id = await this.prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.findFirst({ where: { id: supplierId, ...scope } });
      if (!supplier) throw new NotFoundException("Supplier not found");
      if (await tx.subcontractorProfile.findFirst({ where: { supplierId, ...scope }, select: { id: true } })) throw new ConflictException("This supplier is already a subcontractor");
      const profile = await tx.subcontractorProfile.create({
        data: { ...scope, supplierId, trades: requiredText(input.trades, "trades", 300), workforce: optionalInt(input.workforce, "workforce", { min: 1, max: 100000 }), createdByUserId: actorUserId },
      });
      await writeAudit(tx, scope, actorUserId, "subcontracting.subcontractor.created", "SubcontractorProfile", profile.id, { supplier: supplier.code });
      return profile.id;
    });
    return this.getSubcontractor(scope, id);
  }

  async addDocument(scope: CompanyScope, profileId: string, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const kind = requiredEnum(input.kind, "kind", DOCUMENT_KINDS);
    const validFrom = requiredDate(input.validFrom, "validFrom");
    const validUntil = requiredDate(input.validUntil, "validUntil");
    if (validUntil < validFrom) throw new BadRequestException("validUntil must be after validFrom");
    const fileId = optionalId(input.fileId, "fileId");
    await this.prisma.$transaction(async (tx) => {
      if (!(await tx.subcontractorProfile.findFirst({ where: { id: profileId, ...scope }, select: { id: true } }))) throw new NotFoundException("Subcontractor not found");
      if (fileId && !(await tx.storedFile.findFirst({ where: { id: fileId, ...scope }, select: { id: true } }))) throw new NotFoundException("File not found");
      const document = await tx.subcontractorDocument.create({
        data: { ...scope, profileId, kind, reference: requiredText(input.reference, "reference", 120), issuer: optionalText(input.issuer, "issuer", 120), validFrom, validUntil, fileId, recordedByUserId: actorUserId },
      });
      await writeAudit(tx, scope, actorUserId, "subcontracting.document.recorded", "SubcontractorDocument", document.id, { kind, validUntil: validUntil.toISOString().slice(0, 10) });
    });
    return this.getSubcontractor(scope, profileId);
  }

  /** Qualification par une autre personne que celle qui a cree la fiche, pieces obligatoires en vigueur. */
  async decide(scope: CompanyScope, profileId: string, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const decision = requiredEnum(input.decision, "decision", ["QUALIFIED", "SUSPENDED"] as const);
    const note = requiredText(input.note, "note", 1000);
    await this.prisma.$transaction(async (tx) => {
      const profile = await tx.subcontractorProfile.findFirst({ where: { id: profileId, ...scope }, include: { documents: true } });
      if (!profile) throw new NotFoundException("Subcontractor not found");
      if (profile.createdByUserId === actorUserId) throw new BadRequestException("The qualification must be decided by someone other than the creator of the file");
      if (decision === "QUALIFIED") {
        const missing = blocking(subcontractorCompliance(profile.documents, new Date()));
        if (missing.length) throw new BadRequestException(`Cannot qualify: ${missing.join(", ")}`);
      }
      await tx.subcontractorProfile.update({ where: { id: profileId }, data: { status: decision, decidedByUserId: actorUserId, decidedAt: new Date(), decisionNote: note } });
      await writeAudit(tx, scope, actorUserId, decision === "QUALIFIED" ? "subcontracting.subcontractor.qualified" : "subcontracting.subcontractor.suspended", "SubcontractorProfile", profileId, { note });
    });
    return this.getSubcontractor(scope, profileId);
  }

  // -------------------------------------------------------------------
  // Lots confies
  // -------------------------------------------------------------------

  async listPackages(scope: CompanyScope, query: Record<string, unknown>): Promise<SubcontractPackageView[]> {
    const projectId = optionalId(query.projectId, "projectId");
    const packages = await this.prisma.subcontractPackage.findMany({ where: { ...scope, ...(projectId ? { projectId } : {}) }, orderBy: { createdAt: "desc" } });
    return this.packageViews(scope, packages, false);
  }

  async getPackage(scope: CompanyScope, packageId: string): Promise<SubcontractPackageView> {
    const found = await this.prisma.subcontractPackage.findFirst({ where: { id: packageId, ...scope } });
    if (!found) throw new NotFoundException("Package not found");
    const [view] = await this.packageViews(scope, [found], true);
    return view!;
  }

  /**
   * Lot confie : commande EMISE du sous-traitant, rattachee au projet ;
   * sous-traitant qualifie et en regle ; lot WBS du meme projet portant des
   * taches (source de l'avancement). Montant fige depuis la commande.
   */
  async createPackage(scope: CompanyScope, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const purchaseOrderId = requiredId(input.purchaseOrderId, "purchaseOrderId");
    const wbsItemId = requiredId(input.wbsItemId, "wbsItemId");
    const retentionRate = requiredDecimal(input.retentionRate ?? "5", "retentionRate");
    if (retentionRate.greaterThan(10)) throw new BadRequestException("retentionRate must be <= 10 %");
    const retentionReleaseDays = requiredInt(input.retentionReleaseDays ?? 365, "retentionReleaseDays", { min: 0, max: 730 });
    const id = await this.prisma.$transaction(async (tx) => {
      const order = await tx.purchaseOrder.findFirst({ where: { id: purchaseOrderId, ...scope } });
      if (!order) throw new NotFoundException("Purchase order not found");
      if (!["ISSUED", "PARTIALLY_RECEIVED"].includes(order.status)) throw new BadRequestException(`A ${order.status} order cannot back a subcontract package`);
      if (!order.projectId) throw new BadRequestException("The order is not attached to a project");
      if (dec(order.total).lessThanOrEqualTo(0)) throw new BadRequestException("The order has no amount");
      if (await tx.subcontractPackage.findFirst({ where: { purchaseOrderId }, select: { code: true } })) throw new ConflictException("This order already backs a package");
      const profile = await tx.subcontractorProfile.findFirst({ where: { supplierId: order.supplierId, ...scope }, include: { documents: true } });
      if (!profile) throw new BadRequestException("The supplier of the order is not registered as a subcontractor");
      if (profile.status !== "QUALIFIED") throw new BadRequestException(`The subcontractor is ${profile.status}`);
      const missing = blocking(subcontractorCompliance(profile.documents, new Date()));
      if (missing.length) throw new BadRequestException(`Subcontractor not compliant: ${missing.join(", ")}`);
      const wbs = await tx.projectWbsItem.findFirst({ where: { id: wbsItemId, projectId: order.projectId, ...scope } });
      if (!wbs) throw new NotFoundException("WBS item not found in the order's project");
      const progress = await this.wbsProgress(tx, scope, order.projectId, wbsItemId);
      if (progress.total === 0) throw new BadRequestException("The WBS item has no task: progress could not be derived");
      const code = await this.numbering.next(tx, scope, "SST");
      const created = await tx.subcontractPackage.create({
        data: {
          ...scope,
          code,
          projectId: order.projectId,
          supplierId: order.supplierId,
          purchaseOrderId,
          wbsItemId,
          title: requiredText(input.title, "title", 200),
          scope: requiredText(input.scope, "scope", 4000),
          amount: order.total,
          retentionRate,
          retentionReleaseDays,
          createdByUserId: actorUserId,
        },
      });
      await writeAudit(tx, scope, actorUserId, "subcontracting.package.created", "SubcontractPackage", created.id, { code, order: order.code, amount: money(order.total), retentionRate: retentionRate.toString() });
      return created.id;
    });
    return this.getPackage(scope, id);
  }

  async closePackage(scope: CompanyScope, packageId: string, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const status = requiredEnum(input.status, "status", ["COMPLETED", "TERMINATED"] as const);
    const note = requiredText(input.note, "note", 1000);
    await this.prisma.$transaction(async (tx) => {
      const found = await tx.subcontractPackage.findFirst({ where: { id: packageId, ...scope } });
      if (!found) throw new NotFoundException("Package not found");
      if (found.status !== "ACTIVE") throw new BadRequestException(`Package is ${found.status}`);
      if (await tx.subcontractStatement.count({ where: { packageId, status: "DRAFT" } })) throw new BadRequestException("Decide the draft statement first");
      await tx.subcontractPackage.update({ where: { id: packageId }, data: { status, closedByUserId: actorUserId, closedAt: new Date(), closureNote: note } });
      await writeAudit(tx, scope, actorUserId, "subcontracting.package.closed", "SubcontractPackage", packageId, { status, note });
    });
    return this.getPackage(scope, packageId);
  }

  // -------------------------------------------------------------------
  // Situations
  // -------------------------------------------------------------------

  async listStatements(scope: CompanyScope, query: Record<string, unknown>): Promise<SubcontractStatementView[]> {
    const packageId = optionalId(query.packageId, "packageId");
    const statements = await this.prisma.subcontractStatement.findMany({ where: { ...scope, ...(packageId ? { packageId } : {}) }, orderBy: [{ createdAt: "desc" }], take: 300 });
    return this.statementViews(scope, statements);
  }

  /**
   * Situation : avancement cumule = poids des taches TERMINEES du lot WBS /
   * poids total, fige a la preparation (jamais saisi). Montant de la periode
   * = montant du lot x (cumul - cumul precedemment certifie) ; retenue =
   * taux x brut ; net = brut - retenue.
   */
  async prepareStatement(scope: CompanyScope, packageId: string, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const periodEnd = requiredDate(input.periodEnd, "periodEnd");
    if (periodEnd.getTime() > Date.now() + DAY_MS) throw new BadRequestException("periodEnd cannot be in the future");
    const id = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "subcontract_packages" WHERE "id" = ${packageId} FOR UPDATE`;
      const found = await tx.subcontractPackage.findFirst({ where: { id: packageId, ...scope } });
      if (!found) throw new NotFoundException("Package not found");
      if (found.status !== "ACTIVE") throw new BadRequestException(`Package is ${found.status}`);
      if (await tx.subcontractStatement.findFirst({ where: { packageId, status: "DRAFT" }, select: { id: true } })) throw new ConflictException("A draft statement already exists for this package");
      const last = await tx.subcontractStatement.findFirst({ where: { packageId, status: "APPROVED" }, orderBy: { number: "desc" } });
      const previousPercent = last ? dec(last.cumulativePercent) : new Prisma.Decimal(0);
      const progress = await this.wbsProgress(tx, scope, found.projectId, found.wbsItemId);
      if (!progress.percent.greaterThan(previousPercent)) {
        throw new BadRequestException(`No new progress: ${progress.percent.toFixed(2)} % of the package tasks are done, ${previousPercent.toFixed(2)} % already certified`);
      }
      const amount = dec(found.amount);
      const certifiedGross = sumDecimals((await tx.subcontractStatement.findMany({ where: { packageId, status: "APPROVED" }, select: { grossAmount: true } })).map((row) => dec(row.grossAmount)));
      // Le cumul certifie reste exactement egal a montant x avancement (pas de derive d'arrondi entre situations).
      const gross = amount.mul(progress.percent).div(100).toDecimalPlaces(2).minus(certifiedGross);
      const retention = gross.mul(found.retentionRate).div(100).toDecimalPlaces(2);
      const number = (await tx.subcontractStatement.count({ where: { packageId } })) + 1;
      const code = await this.numbering.next(tx, scope, "SIT");
      const statement = await tx.subcontractStatement.create({
        data: {
          ...scope,
          code,
          packageId,
          number,
          periodEnd,
          cumulativePercent: progress.percent,
          previousPercent,
          doneTasks: progress.done,
          totalTasks: progress.total,
          grossAmount: gross,
          retentionAmount: retention,
          netAmount: gross.minus(retention),
          preparedByUserId: actorUserId,
        },
      });
      await writeAudit(tx, scope, actorUserId, "subcontracting.statement.prepared", "SubcontractStatement", statement.id, { code, percent: progress.percent.toFixed(4), gross: money(gross) });
      return statement.id;
    });
    return (await this.listStatements(scope, { packageId })).find((statement) => statement.id === id)!;
  }

  /** Approbation par une autre personne que le preparateur, sous-traitant en regle a la date d'approbation. */
  async decideStatement(scope: CompanyScope, statementId: string, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const decision = requiredEnum(input.decision, "decision", ["APPROVED", "REJECTED"] as const);
    const note = optionalText(input.note, "note", 1000);
    if (decision === "REJECTED" && !note) throw new BadRequestException("A rejection needs a note");
    await this.prisma.$transaction(async (tx) => {
      const statement = await tx.subcontractStatement.findFirst({ where: { id: statementId, ...scope }, include: { package: true } });
      if (!statement) throw new NotFoundException("Statement not found");
      if (statement.status !== "DRAFT") throw new BadRequestException(`Statement is ${statement.status}`);
      if (statement.preparedByUserId === actorUserId) throw new BadRequestException("A statement is approved by someone other than its preparer");
      if (decision === "APPROVED") {
        const profile = await tx.subcontractorProfile.findFirst({ where: { supplierId: statement.package.supplierId, ...scope }, include: { documents: true } });
        const missing = profile ? blocking(subcontractorCompliance(profile.documents, new Date())) : ["fiche sous-traitant absente"];
        if (missing.length) throw new BadRequestException(`Vigilance obligation: ${missing.join(", ")}`);
        if (profile?.status !== "QUALIFIED") throw new BadRequestException(`The subcontractor is ${profile?.status}`);
      }
      await tx.subcontractStatement.update({ where: { id: statementId }, data: { status: decision, decidedByUserId: actorUserId, decidedAt: new Date(), decisionNote: note } });
      if (decision === "APPROVED" && dec(statement.retentionAmount).greaterThan(0)) {
        await tx.subcontractRetention.create({
          data: {
            ...scope,
            packageId: statement.packageId,
            statementId,
            amount: statement.retentionAmount,
            releaseCondition: `Libération ${statement.package.retentionReleaseDays} jours après la situation, sans réserve non levée, ou contre caution bancaire`,
            releaseDueDate: new Date(startOfDay(statement.periodEnd).getTime() + statement.package.retentionReleaseDays * DAY_MS),
          },
        });
      }
      await writeAudit(tx, scope, actorUserId, decision === "APPROVED" ? "subcontracting.statement.approved" : "subcontracting.statement.rejected", "SubcontractStatement", statementId, { code: statement.code, note });
    });
    return (await this.listStatements(scope, {})).find((statement) => statement.id === statementId)!;
  }

  /**
   * Facture de situation enregistree dans la Finance (facture fournisseur
   * rattachee a la commande et au projet) pour le NET certifie ; la retenue
   * reste tracee a part. Rapprochement : montant = situation approuvee.
   */
  async invoiceStatement(scope: CompanyScope, statementId: string, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const supplierReference = requiredText(input.supplierReference, "supplierReference", 80);
    const invoiceDate = requiredDate(input.invoiceDate, "invoiceDate");
    const taxRate = optionalDecimal(input.taxRate, "taxRate") ?? new Prisma.Decimal(0);
    await this.prisma.$transaction(async (tx) => {
      const statement = await tx.subcontractStatement.findFirst({ where: { id: statementId, ...scope }, include: { package: { include: { purchaseOrder: true } } } });
      if (!statement) throw new NotFoundException("Statement not found");
      if (statement.status !== "APPROVED") throw new BadRequestException("Only an approved statement is invoiced");
      if (statement.supplierInvoiceId) throw new ConflictException("This statement is already invoiced");
      const invoiceId = await this.recordInvoice(tx, scope, {
        supplierId: statement.package.supplierId,
        order: statement.package.purchaseOrder,
        supplierReference,
        invoiceDate,
        taxRate,
        description: `Situation n°${statement.number} ${statement.code} — lot ${statement.package.code} (${dec(statement.cumulativePercent).toFixed(2)} % cumulé), net de retenue de garantie`,
        amount: dec(statement.netAmount),
        matchNote: `Situation certifiée ${statement.code} (net ${money(statement.netAmount)})`,
        actorUserId,
      });
      await tx.subcontractStatement.update({ where: { id: statementId }, data: { supplierInvoiceId: invoiceId } });
      await writeAudit(tx, scope, actorUserId, "subcontracting.statement.invoiced", "SubcontractStatement", statementId, { invoiceId });
    });
    return (await this.listStatements(scope, {})).find((statement) => statement.id === statementId)!;
  }

  // -------------------------------------------------------------------
  // Retenues de garantie
  // -------------------------------------------------------------------

  async listRetentions(scope: CompanyScope, query: Record<string, unknown>): Promise<SubcontractRetentionView[]> {
    const packageId = optionalId(query.packageId, "packageId");
    const retentions = await this.prisma.subcontractRetention.findMany({ where: { ...scope, ...(packageId ? { packageId } : {}) }, orderBy: { releaseDueDate: "asc" }, include: { package: true, statement: { select: { code: true } } } });
    return this.retentionViews(scope, retentions);
  }

  /** Liberation : a echeance, ou anticipee contre caution bancaire referencee ; la facture de liberation passe par la Finance. */
  async releaseRetention(scope: CompanyScope, retentionId: string, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const note = requiredText(input.note, "note", 1000);
    const guaranteeReference = optionalText(input.guaranteeReference, "guaranteeReference", 120);
    const supplierReference = requiredText(input.supplierReference, "supplierReference", 80);
    const invoiceDate = requiredDate(input.invoiceDate, "invoiceDate");
    await this.prisma.$transaction(async (tx) => {
      const retention = await tx.subcontractRetention.findFirst({ where: { id: retentionId, ...scope }, include: { package: { include: { purchaseOrder: true } }, statement: true } });
      if (!retention) throw new NotFoundException("Retention not found");
      if (retention.status !== "HELD") throw new BadRequestException("Retention already released");
      const now = new Date();
      if (startOfDay(now) < retention.releaseDueDate && !guaranteeReference) {
        throw new BadRequestException(`Retention is due on ${retention.releaseDueDate.toISOString().slice(0, 10)}: an early release needs a bank guarantee reference`);
      }
      const invoiceId = await this.recordInvoice(tx, scope, {
        supplierId: retention.package.supplierId,
        order: retention.package.purchaseOrder,
        supplierReference,
        invoiceDate,
        taxRate: new Prisma.Decimal(0),
        description: `Libération de la retenue de garantie de la situation ${retention.statement.code} — lot ${retention.package.code}${guaranteeReference ? ` (caution ${guaranteeReference})` : ""}`,
        amount: dec(retention.amount),
        matchNote: `Retenue de garantie libérée (${retention.statement.code})`,
        actorUserId,
      });
      await tx.subcontractRetention.update({ where: { id: retentionId }, data: { status: "RELEASED", releasedByUserId: actorUserId, releasedAt: now, releaseNote: note, guaranteeReference, releaseInvoiceId: invoiceId } });
      await writeAudit(tx, scope, actorUserId, "subcontracting.retention.released", "SubcontractRetention", retentionId, { amount: money(retention.amount), guaranteeReference, invoiceId });
    });
    return (await this.listRetentions(scope, {})).find((retention) => retention.id === retentionId)!;
  }

  // -------------------------------------------------------------------
  // Internes
  // -------------------------------------------------------------------

  /** Avancement du lot WBS (et de ses descendants) : poids des taches DONE / poids total. */
  async wbsProgress(client: Client, scope: CompanyScope, projectId: string, wbsItemId: string): Promise<{ percent: Prisma.Decimal; done: number; total: number }> {
    const items = await client.projectWbsItem.findMany({ where: { projectId, ...scope }, select: { id: true, parentId: true } });
    const ids = new Set([wbsItemId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const item of items) {
        if (item.parentId && ids.has(item.parentId) && !ids.has(item.id)) {
          ids.add(item.id);
          grew = true;
        }
      }
    }
    const tasks = await client.projectTask.findMany({ where: { projectId, wbsItemId: { in: [...ids] }, ...scope }, select: { status: true, weight: true } });
    const total = sumDecimals(tasks.map((task) => dec(task.weight)));
    const done = tasks.filter((task) => task.status === "DONE");
    const percent = total.isZero() ? new Prisma.Decimal(0) : sumDecimals(done.map((task) => dec(task.weight))).mul(100).div(total).toDecimalPlaces(4);
    return { percent, done: done.length, total: tasks.length };
  }

  /** Facture fournisseur (Finance) d'un montant certifie : memes tables, memes flux d'approbation et de paiement. */
  private async recordInvoice(
    tx: Tx,
    scope: CompanyScope,
    input: { supplierId: string; order: Prisma.PurchaseOrderGetPayload<object>; supplierReference: string; invoiceDate: Date; taxRate: Prisma.Decimal; description: string; amount: Prisma.Decimal; matchNote: string; actorUserId: string },
  ): Promise<string> {
    const supplier = await tx.supplier.findFirstOrThrow({ where: { id: input.supplierId, ...scope } });
    const duplicate = await tx.supplierInvoice.findFirst({ where: { supplierId: input.supplierId, supplierReference: input.supplierReference }, select: { code: true } });
    if (duplicate) throw new ConflictException(`Invoice "${input.supplierReference}" of this supplier is already recorded (${duplicate.code})`);
    const tax = input.amount.mul(input.taxRate).div(100).toDecimalPlaces(2);
    const code = await this.numbering.next(tx, scope, "FF");
    const invoice = await tx.supplierInvoice.create({
      data: {
        ...scope,
        code,
        supplierId: input.supplierId,
        orderId: input.order.id,
        projectId: input.order.projectId,
        supplierReference: input.supplierReference,
        currency: input.order.currency.trim(),
        invoiceDate: input.invoiceDate,
        dueDate: new Date(input.invoiceDate.getTime() + supplier.paymentTermsDays * DAY_MS),
        matchStatus: "MATCHED",
        matchNotes: input.matchNote,
        subtotal: input.amount,
        taxTotal: tax,
        total: input.amount.plus(tax),
        recordedByUserId: input.actorUserId,
      },
    });
    await tx.supplierInvoiceLine.create({
      data: { ...scope, invoiceId: invoice.id, position: 1, description: input.description, quantity: new Prisma.Decimal(1), unitPrice: input.amount, taxRate: input.taxRate, lineTotal: input.amount, lineTax: tax },
    });
    await writeAudit(tx, scope, input.actorUserId, "finance.payable.recorded", "SupplierInvoice", invoice.id, { code, supplierReference: input.supplierReference, orderId: input.order.id, matchStatus: "MATCHED", total: money(input.amount.plus(tax)), source: "subcontracting" });
    return invoice.id;
  }

  private async company(scope: CompanyScope): Promise<string> {
    return (await this.prisma.company.findUniqueOrThrow({ where: { id: scope.companyId }, select: { currency: true } })).currency.trim();
  }

  private async subcontractorViews(
    scope: CompanyScope,
    profiles: Array<Prisma.SubcontractorProfileGetPayload<{ include: { supplier: true; documents: true } }>>,
    detailed: boolean,
  ): Promise<SubcontractorView[]> {
    const supplierIds = profiles.map((profile) => profile.supplierId);
    const [packages, retentions, users, currency] = await Promise.all([
      this.prisma.subcontractPackage.findMany({ where: { ...scope, supplierId: { in: supplierIds } }, select: { supplierId: true, amount: true, status: true } }),
      this.prisma.subcontractRetention.findMany({ where: { ...scope, status: "HELD", package: { supplierId: { in: supplierIds } } }, select: { amount: true, package: { select: { supplierId: true } } } }),
      this.userNames(scope, profiles.map((profile) => profile.decidedByUserId).filter((id): id is string => Boolean(id))),
      this.company(scope),
    ]);
    const now = new Date();
    return profiles.map((profile) => {
      const compliance = subcontractorCompliance(profile.documents, now);
      const mine = packages.filter((row) => row.supplierId === profile.supplierId);
      const view: SubcontractorView = {
        id: profile.id,
        supplierId: profile.supplierId,
        supplierCode: profile.supplier.code,
        supplierName: profile.supplier.name,
        trades: profile.trades,
        workforce: profile.workforce,
        status: profile.status,
        decidedByName: profile.decidedByUserId ? (users.get(profile.decidedByUserId) ?? "—") : null,
        decidedAt: profile.decidedAt?.toISOString() ?? null,
        decisionNote: profile.decisionNote,
        compliance,
        compliant: blocking(compliance).length === 0,
        packages: mine.length,
        contractedAmount: money(sumDecimals(mine.filter((row) => row.status !== "TERMINATED").map((row) => dec(row.amount)))),
        retentionHeld: money(sumDecimals(retentions.filter((row) => row.package.supplierId === profile.supplierId).map((row) => dec(row.amount)))),
        currency,
      };
      if (detailed) {
        view.documents = [...profile.documents]
          .sort((a, b) => b.validUntil.getTime() - a.validUntil.getTime())
          .map((document) => ({ id: document.id, kind: document.kind, reference: document.reference, issuer: document.issuer, validFrom: document.validFrom.toISOString().slice(0, 10), validUntil: document.validUntil.toISOString().slice(0, 10), fileId: document.fileId }));
      }
      return view;
    });
  }

  private async packageViews(scope: CompanyScope, packages: Array<Prisma.SubcontractPackageGetPayload<object>>, detailed: boolean): Promise<SubcontractPackageView[]> {
    const ids = packages.map((row) => row.id);
    const [projects, suppliers, orders, wbs, statements, retentions, currency] = await Promise.all([
      this.prisma.project.findMany({ where: { id: { in: packages.map((row) => row.projectId) }, ...scope }, select: { id: true, code: true } }),
      this.prisma.supplier.findMany({ where: { id: { in: packages.map((row) => row.supplierId) }, ...scope }, select: { id: true, name: true } }),
      this.prisma.purchaseOrder.findMany({ where: { id: { in: packages.map((row) => row.purchaseOrderId) }, ...scope }, select: { id: true, code: true } }),
      this.prisma.projectWbsItem.findMany({ where: { id: { in: packages.map((row) => row.wbsItemId) }, ...scope }, select: { id: true, code: true, name: true } }),
      this.prisma.subcontractStatement.findMany({ where: { packageId: { in: ids } }, orderBy: { number: "asc" } }),
      this.prisma.subcontractRetention.findMany({ where: { packageId: { in: ids } }, select: { packageId: true, amount: true, status: true } }),
      this.company(scope),
    ]);
    const views: SubcontractPackageView[] = [];
    for (const row of packages) {
      const progress = await this.wbsProgress(this.prisma, scope, row.projectId, row.wbsItemId);
      const approved = statements.filter((statement) => statement.packageId === row.id && statement.status === "APPROVED");
      const last = approved[approved.length - 1];
      const mineRetention = retentions.filter((retention) => retention.packageId === row.id);
      const view: SubcontractPackageView = {
        id: row.id,
        code: row.code,
        projectId: row.projectId,
        projectCode: projects.find((project) => project.id === row.projectId)?.code ?? "—",
        supplierId: row.supplierId,
        supplierName: suppliers.find((supplier) => supplier.id === row.supplierId)?.name ?? "—",
        purchaseOrderId: row.purchaseOrderId,
        purchaseOrderCode: orders.find((order) => order.id === row.purchaseOrderId)?.code ?? "—",
        wbsItemId: row.wbsItemId,
        wbsCode: wbs.find((item) => item.id === row.wbsItemId)?.code ?? "—",
        wbsName: wbs.find((item) => item.id === row.wbsItemId)?.name ?? "—",
        title: row.title,
        scope: row.scope,
        amount: money(row.amount),
        retentionRate: dec(row.retentionRate).toFixed(2),
        retentionReleaseDays: row.retentionReleaseDays,
        status: row.status,
        livePercent: progress.percent.toFixed(2),
        liveDoneTasks: progress.done,
        liveTotalTasks: progress.total,
        certifiedPercent: last ? dec(last.cumulativePercent).toFixed(2) : "0.00",
        certifiedGross: money(sumDecimals(approved.map((statement) => dec(statement.grossAmount)))),
        retentionHeld: money(sumDecimals(mineRetention.filter((retention) => retention.status === "HELD").map((retention) => dec(retention.amount)))),
        retentionReleased: money(sumDecimals(mineRetention.filter((retention) => retention.status === "RELEASED").map((retention) => dec(retention.amount)))),
        currency,
      };
      if (detailed) {
        view.statements = await this.statementViews(scope, statements.filter((statement) => statement.packageId === row.id).reverse());
        view.retentions = await this.listRetentions(scope, { packageId: row.id });
      }
      views.push(view);
    }
    return views;
  }

  private async statementViews(scope: CompanyScope, statements: Array<Prisma.SubcontractStatementGetPayload<object>>): Promise<SubcontractStatementView[]> {
    const [packages, invoices, users] = await Promise.all([
      this.prisma.subcontractPackage.findMany({ where: { id: { in: [...new Set(statements.map((statement) => statement.packageId))] }, ...scope }, select: { id: true, code: true, supplierId: true } }),
      this.prisma.supplierInvoice.findMany({ where: { id: { in: statements.map((statement) => statement.supplierInvoiceId).filter((id): id is string => Boolean(id)) }, ...scope }, select: { id: true, code: true, status: true } }),
      this.userNames(scope, statements.flatMap((statement) => [statement.preparedByUserId, statement.decidedByUserId].filter((id): id is string => Boolean(id)))),
    ]);
    const suppliers = await this.prisma.supplier.findMany({ where: { id: { in: packages.map((row) => row.supplierId) }, ...scope }, select: { id: true, name: true } });
    return statements.map((statement) => {
      const found = packages.find((row) => row.id === statement.packageId);
      const invoice = invoices.find((row) => row.id === statement.supplierInvoiceId);
      return {
        id: statement.id,
        code: statement.code,
        packageId: statement.packageId,
        packageCode: found?.code ?? "—",
        supplierName: suppliers.find((supplier) => supplier.id === found?.supplierId)?.name ?? "—",
        number: statement.number,
        periodEnd: statement.periodEnd.toISOString().slice(0, 10),
        cumulativePercent: dec(statement.cumulativePercent).toFixed(2),
        previousPercent: dec(statement.previousPercent).toFixed(2),
        doneTasks: statement.doneTasks,
        totalTasks: statement.totalTasks,
        grossAmount: money(statement.grossAmount),
        retentionAmount: money(statement.retentionAmount),
        netAmount: money(statement.netAmount),
        status: statement.status,
        preparedByName: users.get(statement.preparedByUserId) ?? "—",
        preparedByUserId: statement.preparedByUserId,
        decidedByName: statement.decidedByUserId ? (users.get(statement.decidedByUserId) ?? "—") : null,
        decidedAt: statement.decidedAt?.toISOString() ?? null,
        decisionNote: statement.decisionNote,
        supplierInvoiceId: statement.supplierInvoiceId,
        supplierInvoiceCode: invoice?.code ?? null,
        supplierInvoiceStatus: invoice?.status ?? null,
      };
    });
  }

  private async retentionViews(
    scope: CompanyScope,
    retentions: Array<Prisma.SubcontractRetentionGetPayload<{ include: { package: true; statement: { select: { code: true } } } }>>,
  ): Promise<SubcontractRetentionView[]> {
    const today = startOfDay(new Date());
    const [suppliers, invoices, users] = await Promise.all([
      this.prisma.supplier.findMany({ where: { id: { in: retentions.map((row) => row.package.supplierId) }, ...scope }, select: { id: true, name: true } }),
      this.prisma.supplierInvoice.findMany({ where: { id: { in: retentions.map((row) => row.releaseInvoiceId).filter((id): id is string => Boolean(id)) }, ...scope }, select: { id: true, code: true } }),
      this.userNames(scope, retentions.map((row) => row.releasedByUserId).filter((id): id is string => Boolean(id))),
    ]);
    return retentions.map((retention) => ({
      id: retention.id,
      packageId: retention.packageId,
      packageCode: retention.package.code,
      statementCode: retention.statement.code,
      supplierName: suppliers.find((supplier) => supplier.id === retention.package.supplierId)?.name ?? "—",
      amount: money(retention.amount),
      releaseCondition: retention.releaseCondition,
      releaseDueDate: retention.releaseDueDate.toISOString().slice(0, 10),
      due: retention.releaseDueDate <= today,
      status: retention.status,
      guaranteeReference: retention.guaranteeReference,
      releasedByName: retention.releasedByUserId ? (users.get(retention.releasedByUserId) ?? "—") : null,
      releasedAt: retention.releasedAt?.toISOString() ?? null,
      releaseNote: retention.releaseNote,
      releaseInvoiceId: retention.releaseInvoiceId,
      releaseInvoiceCode: invoices.find((invoice) => invoice.id === retention.releaseInvoiceId)?.code ?? null,
    }));
  }

  private async userNames(scope: CompanyScope, ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(ids)] }, organizationId: scope.organizationId }, select: { id: true, fullName: true } });
    return new Map(users.map((user) => [user.id, user.fullName]));
  }
}
