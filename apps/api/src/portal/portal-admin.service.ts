import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { PortalGrantCandidate, PortalGrantView, PortalInvitationIssued, PortalPrincipalView } from "@axora24/contracts";
import { Prisma } from "@axora24/database";
import { createSessionToken } from "@axora24/security";
import { PrismaService } from "../core/prisma.service.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import { writeAudit } from "../common/audit.js";
import { assertBody, optionalId, requiredEnum, requiredId, requiredText } from "../common/validation.js";
import { TYPES_BY_KIND, exposableResources } from "./portal-exposure.js";

const INVITATION_TTL_MS = 7 * 86_400_000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESOURCE_TYPES = ["PROJECT", "CUSTOMER_INVOICE", "DOCUMENT", "PURCHASE_ORDER", "SUPPLIER_INVOICE"] as const;

type Principal = Prisma.PortalPrincipalGetPayload<object>;

/**
 * INC-20 — administration interne des portails : identites externes,
 * invitations a usage unique, autorisations explicites par ressource.
 */
@Injectable()
export class PortalAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async list(scope: CompanyScope): Promise<PortalPrincipalView[]> {
    const principals = await this.prisma.portalPrincipal.findMany({ where: scope, orderBy: { createdAt: "desc" } });
    return this.views(scope, principals, false);
  }

  async get(scope: CompanyScope, principalId: string): Promise<PortalPrincipalView> {
    const principal = await this.prisma.portalPrincipal.findFirst({ where: { id: principalId, ...scope } });
    if (!principal) throw new NotFoundException("Portal principal not found");
    const [view] = await this.views(scope, [principal], true);
    return view!;
  }

  /** Nouvelle identite externe rattachee a UN enregistrement racine de la societe ; invitation emise. */
  async create(scope: CompanyScope, body: unknown, actorUserId: string): Promise<PortalInvitationIssued> {
    const input = assertBody(body);
    const kind = requiredEnum(input.kind, "kind", ["CLIENT", "SUPPLIER"] as const);
    const email = requiredText(input.email, "email", 200).toLowerCase();
    if (!EMAIL.test(email)) throw new BadRequestException("email is invalid");
    const crmAccountId = kind === "CLIENT" ? requiredId(input.crmAccountId, "crmAccountId") : null;
    const supplierId = kind === "SUPPLIER" ? requiredId(input.supplierId, "supplierId") : null;
    if (kind === "CLIENT" && optionalId(input.supplierId, "supplierId")) throw new BadRequestException("A client principal has no supplier");
    const token = createSessionToken();
    const id = await this.prisma.$transaction(async (tx) => {
      if (crmAccountId && !(await tx.crmAccount.findFirst({ where: { id: crmAccountId, ...scope }, select: { id: true } }))) throw new NotFoundException("CRM account not found");
      if (supplierId && !(await tx.supplier.findFirst({ where: { id: supplierId, ...scope }, select: { id: true } }))) throw new NotFoundException("Supplier not found");
      if (await tx.portalPrincipal.findFirst({ where: { companyId: scope.companyId, email }, select: { id: true } })) throw new ConflictException("This email already has a portal access in this company");
      const principal = await tx.portalPrincipal.create({
        data: { ...scope, kind, email, fullName: requiredText(input.fullName, "fullName", 160), crmAccountId, supplierId, createdByUserId: actorUserId },
      });
      await tx.portalInvitation.create({ data: { principalId: principal.id, tokenHash: token.tokenHash, expiresAt: new Date(Date.now() + INVITATION_TTL_MS), createdByUserId: actorUserId } });
      await writeAudit(tx, scope, actorUserId, "portal.principal.invited", "PortalPrincipal", principal.id, { kind, email });
      return principal.id;
    });
    return this.issued(scope, id, token.plainToken);
  }

  /** Nouvelle invitation (activation ou reinitialisation du mot de passe) : les precedentes sont revoquees. */
  async reinvite(scope: CompanyScope, principalId: string, actorUserId: string): Promise<PortalInvitationIssued> {
    const token = createSessionToken();
    await this.prisma.$transaction(async (tx) => {
      const principal = await tx.portalPrincipal.findFirst({ where: { id: principalId, ...scope } });
      if (!principal) throw new NotFoundException("Portal principal not found");
      if (principal.status === "SUSPENDED" || principal.status === "REVOKED") throw new BadRequestException(`The access is ${principal.status}`);
      await tx.portalInvitation.updateMany({ where: { principalId, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.portalInvitation.create({ data: { principalId, tokenHash: token.tokenHash, expiresAt: new Date(Date.now() + INVITATION_TTL_MS), createdByUserId: actorUserId } });
      await writeAudit(tx, scope, actorUserId, "portal.principal.reinvited", "PortalPrincipal", principalId, {});
    });
    return this.issued(scope, principalId, token.plainToken);
  }

  /** Suspension / revocation : sessions et invitations invalidees immediatement (trigger en base). */
  async setStatus(scope: CompanyScope, principalId: string, body: unknown, actorUserId: string): Promise<PortalPrincipalView> {
    const input = assertBody(body);
    const status = requiredEnum(input.status, "status", ["ACTIVE", "SUSPENDED", "REVOKED"] as const);
    const reason = requiredText(input.reason, "reason", 500);
    await this.prisma.$transaction(async (tx) => {
      const principal = await tx.portalPrincipal.findFirst({ where: { id: principalId, ...scope } });
      if (!principal) throw new NotFoundException("Portal principal not found");
      if (principal.status === "REVOKED") throw new BadRequestException("A revoked access stays revoked");
      if (status === "ACTIVE" && principal.status !== "SUSPENDED") throw new BadRequestException("Only a suspended access can be reactivated");
      if (status === "ACTIVE" && !principal.passwordHash) throw new BadRequestException("The access was never activated: send an invitation");
      await tx.portalPrincipal.update({ where: { id: principalId }, data: { status, statusChangedAt: new Date(), statusChangedBy: actorUserId, statusReason: reason } });
      await writeAudit(tx, scope, actorUserId, `portal.principal.${status.toLowerCase()}`, "PortalPrincipal", principalId, { reason });
    });
    return this.get(scope, principalId);
  }

  async candidates(scope: CompanyScope, principalId: string): Promise<PortalGrantCandidate[]> {
    const principal = await this.prisma.portalPrincipal.findFirst({ where: { id: principalId, ...scope } });
    if (!principal) throw new NotFoundException("Portal principal not found");
    const [exposable, grants] = await Promise.all([exposableResources(this.prisma, principal), this.prisma.portalResourceGrant.findMany({ where: { principalId, revokedAt: null } })]);
    return exposable.map((row) => ({ ...row, granted: grants.some((grant) => grant.resourceType === row.resourceType && grant.resourceId === row.resourceId) }));
  }

  /** Exposition explicite : la ressource doit appartenir a l'enregistrement racine du principal et etre exposable. */
  async grant(scope: CompanyScope, principalId: string, body: unknown, actorUserId: string): Promise<PortalPrincipalView> {
    const input = assertBody(body);
    const resourceType = requiredEnum(input.resourceType, "resourceType", RESOURCE_TYPES);
    const resourceId = requiredId(input.resourceId, "resourceId");
    await this.prisma.$transaction(async (tx) => {
      const principal = await tx.portalPrincipal.findFirst({ where: { id: principalId, ...scope } });
      if (!principal) throw new NotFoundException("Portal principal not found");
      if (principal.status === "REVOKED") throw new BadRequestException("The access is revoked");
      if (!TYPES_BY_KIND[principal.kind].includes(resourceType)) throw new BadRequestException(`A ${principal.kind} portal cannot expose a ${resourceType}`);
      const exposable = await exposableResources(this.prisma, principal);
      if (!exposable.some((row) => row.resourceType === resourceType && row.resourceId === resourceId)) {
        throw new BadRequestException("This resource does not belong to the portal account (or is not in an exposable state)");
      }
      if (await tx.portalResourceGrant.findFirst({ where: { principalId, resourceType, resourceId, revokedAt: null }, select: { id: true } })) throw new ConflictException("Already exposed");
      const grant = await tx.portalResourceGrant.create({ data: { ...scope, principalId, resourceType, resourceId, grantedByUserId: actorUserId } });
      await writeAudit(tx, scope, actorUserId, "portal.grant.created", "PortalResourceGrant", grant.id, { principalId, resourceType, resourceId });
    });
    return this.get(scope, principalId);
  }

  async revokeGrant(scope: CompanyScope, grantId: string, actorUserId: string): Promise<PortalPrincipalView> {
    const grant = await this.prisma.$transaction(async (tx) => {
      const found = await tx.portalResourceGrant.findFirst({ where: { id: grantId, ...scope } });
      if (!found) throw new NotFoundException("Grant not found");
      if (found.revokedAt) throw new BadRequestException("Grant already revoked");
      await tx.portalResourceGrant.update({ where: { id: grantId }, data: { revokedAt: new Date(), revokedByUserId: actorUserId } });
      await writeAudit(tx, scope, actorUserId, "portal.grant.revoked", "PortalResourceGrant", grantId, { principalId: found.principalId, resourceType: found.resourceType });
      return found;
    });
    return this.get(scope, grant.principalId);
  }

  private async issued(scope: CompanyScope, principalId: string, token: string): Promise<PortalInvitationIssued> {
    const invitation = await this.prisma.portalInvitation.findFirstOrThrow({ where: { principalId, usedAt: null, revokedAt: null }, orderBy: { createdAt: "desc" } });
    return {
      principal: await this.get(scope, principalId),
      token,
      activationPath: `/portal/activate?c=${encodeURIComponent(scope.companyId)}#${token}`,
      expiresAt: invitation.expiresAt.toISOString(),
    };
  }

  private async views(scope: CompanyScope, principals: Principal[], detailed: boolean): Promise<PortalPrincipalView[]> {
    const ids = principals.map((principal) => principal.id);
    const [accounts, suppliers, grants, sessions, invitations] = await Promise.all([
      this.prisma.crmAccount.findMany({ where: { id: { in: principals.map((principal) => principal.crmAccountId).filter((id): id is string => Boolean(id)) }, ...scope }, select: { id: true, name: true } }),
      this.prisma.supplier.findMany({ where: { id: { in: principals.map((principal) => principal.supplierId).filter((id): id is string => Boolean(id)) }, ...scope }, select: { id: true, name: true } }),
      this.prisma.portalResourceGrant.findMany({ where: { principalId: { in: ids } }, orderBy: { grantedAt: "desc" } }),
      this.prisma.portalSession.groupBy({ by: ["principalId"], where: { principalId: { in: ids } }, _max: { createdAt: true } }),
      this.prisma.portalInvitation.findMany({ where: { principalId: { in: ids }, usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, select: { principalId: true } }),
    ]);
    const labels = new Map<string, string>();
    if (detailed) {
      for (const principal of principals) for (const row of await exposableResources(this.prisma, principal)) labels.set(`${row.resourceType}|${row.resourceId}`, row.label);
    }
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(grants.map((grant) => grant.grantedByUserId))] }, organizationId: scope.organizationId }, select: { id: true, fullName: true } });
    return principals.map((principal) => {
      const mine = grants.filter((grant) => grant.principalId === principal.id);
      const view: PortalPrincipalView = {
        id: principal.id,
        kind: principal.kind,
        email: principal.email,
        fullName: principal.fullName,
        rootId: (principal.crmAccountId ?? principal.supplierId)!,
        rootName: (principal.kind === "CLIENT" ? accounts.find((account) => account.id === principal.crmAccountId)?.name : suppliers.find((supplier) => supplier.id === principal.supplierId)?.name) ?? "—",
        status: principal.status,
        activatedAt: principal.activatedAt?.toISOString() ?? null,
        statusReason: principal.statusReason,
        activeGrants: mine.filter((grant) => !grant.revokedAt).length,
        lastLoginAt: sessions.find((row) => row.principalId === principal.id)?._max.createdAt?.toISOString() ?? null,
        pendingInvitation: invitations.some((row) => row.principalId === principal.id),
        createdAt: principal.createdAt.toISOString(),
      };
      if (detailed) {
        view.grants = mine.map(
          (grant): PortalGrantView => ({
            id: grant.id,
            resourceType: grant.resourceType,
            resourceId: grant.resourceId,
            label: labels.get(`${grant.resourceType}|${grant.resourceId}`) ?? `${grant.resourceType} ${grant.resourceId} (plus exposable)`,
            grantedByName: users.find((user) => user.id === grant.grantedByUserId)?.fullName ?? "—",
            grantedAt: grant.grantedAt.toISOString(),
            revokedAt: grant.revokedAt?.toISOString() ?? null,
          }),
        );
      }
      return view;
    });
  }
}
