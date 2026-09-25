import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ANALYTICS_PERMISSIONS } from "@axora24/contracts";
import { PrismaService } from "../core/prisma.service.js";
import { CrmService } from "../crm/crm.service.js";
import { AnalyticsService } from "../analytics/analytics.service.js";
import { writeAudit } from "../common/audit.js";
import { money } from "../common/decimal.js";
import { assertBody, optionalInt } from "../common/validation.js";
import { ApiKey, ApiKeyGuard, ApiPermission, type ApiKeyContext } from "./api-key.guard.js";
import { OPENAPI_SPEC } from "./openapi.js";

const day = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null);

function pageArgs(query: Record<string, unknown>): { take: number; cursor: string | undefined } {
  const take = optionalInt(query.limit, "limit", { min: 1, max: 100 }) ?? 50;
  const cursor = typeof query.cursor === "string" && query.cursor ? query.cursor.slice(0, 64) : undefined;
  return { take, cursor };
}

function page<T extends { id: string }>(rows: T[], take: number): { data: T[]; nextCursor: string | null } {
  const data = rows.slice(0, take);
  return { data, nextCursor: rows.length > take ? data[data.length - 1]!.id : null };
}

/** Documentation lisible sans cle. */
@Controller("public")
export class PublicMetaController {
  @Get("openapi.json")
  openapi() {
    return OPENAPI_SPEC;
  }
}

/**
 * INC-23 — API publique v1 (authentification par cle). Perimetre : l'entreprise
 * de la cle ; permission explicite par route ; pagination par curseur.
 */
@Controller("public")
@UseGuards(ApiKeyGuard)
export class PublicApiController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crm: CrmService,
    private readonly analytics: AnalyticsService,
  ) {}

  private scope(key: ApiKeyContext) {
    return { organizationId: key.organizationId, companyId: key.companyId };
  }

  @Get("me")
  @ApiPermission("*")
  me(@ApiKey() key: ApiKeyContext) {
    return { name: key.name, companyId: key.companyId, permissions: [...key.permissions].sort() };
  }

  @Get("projects")
  @ApiPermission("projects.project.read")
  async projects(@ApiKey() key: ApiKeyContext, @Query() query: Record<string, unknown>) {
    const { take, cursor } = pageArgs(query);
    const rows = await this.prisma.project.findMany({ where: { ...this.scope(key), ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: "asc" }, take: take + 1 });
    return page(rows.map((row) => ({ id: row.id, code: row.code, name: row.name, status: row.status, currency: row.currency.trim(), contractAmount: money(row.contractAmount), plannedStart: day(row.plannedStart), plannedEnd: day(row.plannedEnd) })), take);
  }

  @Get("customer-invoices")
  @ApiPermission("finance.invoice.read")
  async customerInvoices(@ApiKey() key: ApiKeyContext, @Query() query: Record<string, unknown>) {
    const { take, cursor } = pageArgs(query);
    const rows = await this.prisma.customerInvoice.findMany({ where: { ...this.scope(key), status: { not: "DRAFT" }, ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: "asc" }, take: take + 1 });
    return page(rows.map((row) => ({ id: row.id, code: row.code, customerName: row.customerName, status: row.status, issueDate: day(row.issueDate), dueDate: day(row.dueDate), currency: row.currency.trim(), total: money(row.total), paidAmount: money(row.paidAmount) })), take);
  }

  @Get("supplier-invoices")
  @ApiPermission("finance.payable.read")
  async supplierInvoices(@ApiKey() key: ApiKeyContext, @Query() query: Record<string, unknown>) {
    const { take, cursor } = pageArgs(query);
    const rows = await this.prisma.supplierInvoice.findMany({ where: { ...this.scope(key), ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: "asc" }, take: take + 1 });
    return page(rows.map((row) => ({ id: row.id, code: row.code, supplierReference: row.supplierReference, status: row.status, matchStatus: row.matchStatus, invoiceDate: day(row.invoiceDate), dueDate: day(row.dueDate), currency: row.currency.trim(), total: money(row.total), paidAmount: money(row.paidAmount) })), take);
  }

  @Get("purchase-orders")
  @ApiPermission("procurement.order.read")
  async purchaseOrders(@ApiKey() key: ApiKeyContext, @Query() query: Record<string, unknown>) {
    const { take, cursor } = pageArgs(query);
    const rows = await this.prisma.purchaseOrder.findMany({ where: { ...this.scope(key), status: { not: "DRAFT" }, ...(cursor ? { id: { gt: cursor } } : {}) }, include: { supplier: { select: { name: true } } }, orderBy: { id: "asc" }, take: take + 1 });
    return page(rows.map((row) => ({ id: row.id, code: row.code, supplierName: row.supplier.name, status: row.status, currency: row.currency.trim(), total: money(row.total), issuedAt: row.issuedAt?.toISOString() ?? null, expectedDate: day(row.expectedDate) })), take);
  }

  @Get("work-orders")
  @ApiPermission("assets.asset.read")
  async workOrders(@ApiKey() key: ApiKeyContext, @Query() query: Record<string, unknown>) {
    const { take, cursor } = pageArgs(query);
    const rows = await this.prisma.workOrder.findMany({ where: { ...this.scope(key), ...(cursor ? { id: { gt: cursor } } : {}) }, include: { asset: { select: { code: true } } }, orderBy: { id: "asc" }, take: take + 1 });
    return page(rows.map((row) => ({ id: row.id, code: row.code, title: row.title, type: row.type, status: row.status, priority: row.priority, dueDate: day(row.dueDate), completedAt: row.completedAt?.toISOString() ?? null, assetCode: row.asset.code })), take);
  }

  /** Meme calcul et meme controle par indicateur que l'interface (permissions de la cle). */
  @Get("analytics/:metric")
  @ApiPermission(ANALYTICS_PERMISSIONS.READ)
  analyticsSeries(@ApiKey() key: ApiKeyContext, @Param("metric") metric: string, @Query() query: Record<string, unknown>) {
    return this.analytics.series(this.scope(key), key.permissions, metric, query);
  }

  @Post("crm/leads")
  @ApiPermission("crm.lead.manage")
  async createLead(@ApiKey() key: ApiKeyContext, @Body() body: unknown) {
    const input = assertBody(body);
    const scope = this.scope(key);
    // Meme regle metier que l'interface ; le prospect est attribue au createur de la cle.
    const lead = await this.prisma.$transaction(async (tx) => {
      const created = await this.crm.insertLead(tx, scope, { ...input, source: typeof input.source === "string" && input.source ? input.source : `API : ${key.name}` } as never, key.createdByUserId);
      await writeAudit(tx, scope, null, "integrations.api.lead.created", "CrmLead", created.id, { apiKeyId: key.id, apiKeyName: key.name });
      return created;
    });
    return { id: lead.id, contactName: lead.contactName, companyName: lead.companyName, status: lead.status, source: lead.source, createdAt: lead.createdAt.toISOString() };
  }
}
