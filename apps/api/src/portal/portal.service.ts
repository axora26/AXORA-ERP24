import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import type { PortalHomeView, PortalMeView } from "@axora24/contracts";
import { createSessionToken, hashPassword, hashSessionToken, verifyPassword } from "@axora24/security";
import { PrismaService } from "../core/prisma.service.js";
import { LoginThrottleService } from "../auth/login-throttle.service.js";
import { writeAudit } from "../common/audit.js";
import { dec, money, sumDecimals } from "../common/decimal.js";
import { FilesService } from "../files/files.service.js";
import { assertBody, optionalText, requiredDate, requiredId, requiredText } from "../common/validation.js";
import { visibleIds } from "./portal-exposure.js";
import type { PortalContext } from "./portal-session.guard.js";

const SESSION_TTL_MS = 12 * 3_600_000;
const MIN_PASSWORD = 12;
// Empreinte factice : un email inconnu coute le meme temps qu'un mot de passe faux (pas d'enumeration par chronometrage).
const DUMMY_HASH = "00000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000";

/**
 * INC-20 — plan d'identite externe : activation par invitation a usage
 * unique, connexion, session dediee ; lecture des SEULES ressources
 * explicitement exposees et toujours rattachees a l'enregistrement racine.
 */
@Injectable()
export class PortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly throttle: LoginThrottleService,
    private readonly files: FilesService,
  ) {}

  async activate(body: unknown, ipAddress: string | undefined) {
    const input = assertBody(body);
    const token = requiredText(input.token, "token", 200);
    const password = requiredText(input.password, "password", 200);
    if (password.length < MIN_PASSWORD) throw new BadRequestException(`password must be at least ${MIN_PASSWORD} characters`);
    const passwordHash = await hashPassword(password);
    const session = createSessionToken();
    const principal = await this.prisma.$transaction(async (tx) => {
      const invitation = await tx.portalInvitation.findUnique({ where: { tokenHash: hashSessionToken(token) }, include: { principal: true } });
      if (!invitation || invitation.usedAt || invitation.revokedAt || invitation.expiresAt < new Date()) throw new UnauthorizedException("Invalid or expired invitation");
      if (invitation.principal.status === "SUSPENDED" || invitation.principal.status === "REVOKED") throw new UnauthorizedException("Invalid or expired invitation");
      await tx.portalInvitation.update({ where: { id: invitation.id }, data: { usedAt: new Date() } });
      await tx.portalPrincipal.update({ where: { id: invitation.principalId }, data: { passwordHash, status: "ACTIVE", activatedAt: invitation.principal.activatedAt ?? new Date() } });
      await tx.portalSession.create({ data: { principalId: invitation.principalId, tokenHash: session.tokenHash, expiresAt: new Date(Date.now() + SESSION_TTL_MS), ipAddress: ipAddress ?? null } });
      await writeAudit(tx, invitation.principal, null, "portal.principal.activated", "PortalPrincipal", invitation.principalId, { portalPrincipalId: invitation.principalId });
      return invitation.principal;
    });
    return { token: session.plainToken, expiresAt: new Date(Date.now() + SESSION_TTL_MS), me: await this.me(principal.id) };
  }

  async login(body: unknown, ipAddress: string | undefined) {
    const input = assertBody(body);
    const companyId = requiredId(input.companyId, "companyId");
    const email = requiredText(input.email, "email", 200).toLowerCase();
    const password = requiredText(input.password, "password", 200);
    const key = `portal:${companyId}:${email}`;
    const ip = ipAddress ?? "unknown";
    await this.throttle.enforce(key, ip);
    const principal = await this.prisma.portalPrincipal.findFirst({ where: { companyId, email } });
    const valid = await verifyPassword(password, principal?.passwordHash ?? DUMMY_HASH);
    if (!principal || !valid || principal.status !== "ACTIVE") {
      await this.throttle.recordFailure(key, ip);
      throw new UnauthorizedException("Invalid credentials");
    }
    await this.throttle.recordSuccess(key, ip);
    const session = createSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await this.prisma.$transaction(async (tx) => {
      await tx.portalSession.create({ data: { principalId: principal.id, tokenHash: session.tokenHash, expiresAt, ipAddress: ipAddress ?? null } });
      await writeAudit(tx, principal, null, "portal.session.opened", "PortalPrincipal", principal.id, { portalPrincipalId: principal.id });
    });
    return { token: session.plainToken, expiresAt, me: await this.me(principal.id) };
  }

  async logout(principal: PortalContext): Promise<void> {
    await this.prisma.portalSession.update({ where: { id: principal.sessionId }, data: { revokedAt: new Date() } });
  }

  async me(principalId: string): Promise<PortalMeView> {
    const principal = await this.prisma.portalPrincipal.findUniqueOrThrow({ where: { id: principalId } });
    const [company, account, supplier] = await Promise.all([
      this.prisma.company.findUniqueOrThrow({ where: { id: principal.companyId }, select: { name: true } }),
      principal.crmAccountId ? this.prisma.crmAccount.findUnique({ where: { id: principal.crmAccountId }, select: { name: true } }) : null,
      principal.supplierId ? this.prisma.supplier.findUnique({ where: { id: principal.supplierId }, select: { name: true } }) : null,
    ]);
    return { id: principal.id, kind: principal.kind, email: principal.email, fullName: principal.fullName, companyName: company.name, rootName: account?.name ?? supplier?.name ?? "—" };
  }

  /** Vue d'ensemble du principal : uniquement les ressources autorisees ET toujours rattachees. Aucun cout interne. */
  async home(principal: PortalContext): Promise<PortalHomeView> {
    const scope = { organizationId: principal.organizationId, companyId: principal.companyId };
    const visible = await visibleIds(this.prisma, principal);
    const [projects, customerInvoices, documents, orders, supplierInvoices] = await Promise.all([
      this.prisma.project.findMany({ where: { ...scope, id: { in: [...visible.PROJECT] } }, include: { tasks: { select: { status: true, weight: true } }, milestones: { orderBy: { dueDate: "asc" } } } }),
      this.prisma.customerInvoice.findMany({ where: { ...scope, id: { in: [...visible.CUSTOMER_INVOICE] } }, orderBy: { issueDate: "desc" } }),
      this.prisma.managedDocument.findMany({ where: { ...scope, id: { in: [...visible.DOCUMENT] } }, include: { versions: { where: { status: "APPROVED" }, orderBy: { versionNumber: "desc" }, take: 1 } } }),
      this.prisma.purchaseOrder.findMany({ where: { ...scope, id: { in: [...visible.PURCHASE_ORDER] } }, include: { lines: { orderBy: { position: "asc" } } }, orderBy: { issuedAt: "desc" } }),
      this.prisma.supplierInvoice.findMany({ where: { ...scope, id: { in: [...visible.SUPPLIER_INVOICE] } }, orderBy: { invoiceDate: "desc" } }),
    ]);
    const projectCodes = await this.prisma.project.findMany({ where: { ...scope, id: { in: customerInvoices.map((invoice) => invoice.projectId).filter((id): id is string => Boolean(id)) } }, select: { id: true, code: true } });
    const acknowledgements = await this.prisma.portalOrderAcknowledgement.findMany({ where: { orderId: { in: orders.map((order) => order.id) }, principalId: principal.id }, orderBy: { createdAt: "desc" } });
    return {
      me: await this.me(principal.id),
      projects: projects.map((project) => {
        const total = sumDecimals(project.tasks.map((task) => dec(task.weight)));
        const done = sumDecimals(project.tasks.filter((task) => task.status === "DONE").map((task) => dec(task.weight)));
        return {
          id: project.id,
          code: project.code,
          name: project.name,
          status: project.status,
          progressPercent: total.isZero() ? "0.0" : done.mul(100).div(total).toFixed(1),
          plannedStart: project.plannedStart?.toISOString().slice(0, 10) ?? null,
          plannedEnd: project.plannedEnd?.toISOString().slice(0, 10) ?? null,
          milestones: project.milestones.map((milestone) => ({ name: milestone.name, dueDate: milestone.dueDate.toISOString().slice(0, 10), status: milestone.status, achievedAt: milestone.achievedAt?.toISOString() ?? null })),
        };
      }),
      customerInvoices: customerInvoices.map((invoice) => ({
        id: invoice.id,
        code: invoice.code,
        projectCode: projectCodes.find((project) => project.id === invoice.projectId)?.code ?? null,
        issueDate: invoice.issueDate?.toISOString().slice(0, 10) ?? null,
        dueDate: invoice.dueDate?.toISOString().slice(0, 10) ?? null,
        total: money(invoice.total),
        paidAmount: money(invoice.paidAmount),
        balance: money(dec(invoice.total).minus(invoice.paidAmount)),
        currency: invoice.currency.trim(),
        status: invoice.status,
      })),
      documents: documents
        .filter((document) => document.versions.length > 0)
        .map((document) => ({
          id: document.id,
          code: document.code,
          title: document.title,
          category: document.category,
          revision: document.versions[0]!.revision,
          fileName: document.versions[0]!.fileName,
          contentUrl: `/api/v1/portal/documents/${document.id}/content`,
        })),
      orders: orders.map((order) => {
        const ack = acknowledgements.find((row) => row.orderId === order.id);
        return {
          id: order.id,
          code: order.code,
          status: order.status,
          issuedAt: order.issuedAt?.toISOString() ?? null,
          expectedDate: order.expectedDate?.toISOString().slice(0, 10) ?? null,
          total: money(order.total),
          currency: order.currency.trim(),
          lines: order.lines.map((line) => ({ description: line.description, quantity: dec(line.quantity).toFixed(3), unitCode: line.unitCode, unitPrice: money(line.unitPrice), receivedQuantity: dec(line.receivedQuantity).toFixed(3) })),
          acknowledgement: ack ? { confirmedDate: ack.confirmedDate.toISOString().slice(0, 10), note: ack.note, at: ack.createdAt.toISOString() } : null,
        };
      }),
      supplierInvoices: supplierInvoices.map((invoice) => ({
        id: invoice.id,
        code: invoice.code,
        supplierReference: invoice.supplierReference,
        invoiceDate: invoice.invoiceDate.toISOString().slice(0, 10),
        dueDate: invoice.dueDate.toISOString().slice(0, 10),
        total: money(invoice.total),
        paidAmount: money(invoice.paidAmount),
        currency: invoice.currency.trim(),
        status: invoice.status,
      })),
    };
  }

  /** Le fournisseur accuse reception d'une commande exposee et confirme sa date de livraison (append-only). */
  async acknowledgeOrder(principal: PortalContext, orderId: string, body: unknown) {
    const input = assertBody(body);
    const confirmedDate = requiredDate(input.confirmedDate, "confirmedDate");
    const note = optionalText(input.note, "note", 1000);
    if (principal.kind !== "SUPPLIER") throw new NotFoundException("Order not found");
    const visible = await visibleIds(this.prisma, principal);
    if (!visible.PURCHASE_ORDER.has(orderId)) throw new NotFoundException("Order not found");
    await this.prisma.$transaction(async (tx) => {
      const order = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: orderId } });
      if (order.status === "RECEIVED") throw new BadRequestException("The order is fully received");
      const ack = await tx.portalOrderAcknowledgement.create({ data: { principalId: principal.id, orderId, confirmedDate, note } });
      await writeAudit(tx, principal, null, "portal.order.acknowledged", "PurchaseOrder", orderId, { portalPrincipalId: principal.id, confirmedDate: confirmedDate.toISOString().slice(0, 10), acknowledgementId: ack.id });
    });
    return this.home(principal);
  }

  /** Contenu de la derniere version APPROUVEE d'un document expose. */
  async documentContent(principal: PortalContext, documentId: string) {
    const visible = await visibleIds(this.prisma, principal);
    if (!visible.DOCUMENT.has(documentId)) throw new NotFoundException("Document not found");
    const version = await this.prisma.documentVersion.findFirst({ where: { documentId, status: "APPROVED" }, orderBy: { versionNumber: "desc" } });
    if (!version) throw new NotFoundException("Document not found");
    await this.prisma.$transaction((tx) => writeAudit(tx, principal, null, "portal.document.downloaded", "ManagedDocument", documentId, { portalPrincipalId: principal.id, version: version.versionNumber }));
    return this.files.content({ organizationId: principal.organizationId, companyId: principal.companyId }, version.fileId);
  }
}

