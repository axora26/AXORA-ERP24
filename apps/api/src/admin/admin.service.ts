import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { hashPassword } from "@axora24/security";
import { isKnownPermission, permissionCatalog, type AuditLogPage } from "@axora24/contracts";
import type { Prisma } from "@axora24/database";
import { PrismaService } from "../core/prisma.service.js";
import type { AuthenticatedUser } from "../auth/session.guard.js";
import { writeAudit } from "../common/audit.js";
import { DEFAULT_PIPELINE_STAGES } from "../crm/pipeline.defaults.js";
import {
  assertBody,
  currencyCode,
  optionalBoolean,
  optionalDate,
  optionalText,
  requiredEmail,
  requiredText,
} from "../common/validation.js";

const OWNER_ROLE = "OWNER";

/**
 * Administration de l'organisation (INC-01).
 *
 * INVARIANTS :
 * - toute lecture/ecriture est filtree par l'organisation de la SESSION ;
 *   un identifiant d'un autre tenant renvoie 404 (pas de divulgation) ;
 * - le role systeme OWNER est immuable (permissions synchronisees par
 *   PermissionSyncService) ;
 * - l'organisation conserve toujours au moins un OWNER actif ;
 * - un administrateur ne peut pas se desactiver lui-meme ;
 * - toute modification RBAC est auditee dans la meme transaction.
 */
@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------
  // Catalogue des permissions
  // ---------------------------------------------------------------------

  permissions() {
    return permissionCatalog();
  }

  // ---------------------------------------------------------------------
  // Utilisateurs
  // ---------------------------------------------------------------------

  async listUsers(actor: AuthenticatedUser) {
    const users = await this.prisma.user.findMany({
      where: { organizationId: actor.organizationId },
      include: {
        roleAssignments: { include: { role: { select: { id: true, name: true } } } },
        companyMemberships: { include: { company: { select: { id: true, name: true } } } },
      },
      orderBy: [{ isActive: "desc" }, { fullName: "asc" }],
    });
    return users.map(toUserView);
  }

  async createUser(actor: AuthenticatedUser, body: unknown) {
    const input = assertBody(body);
    const email = requiredEmail(input.email, "email");
    const fullName = requiredText(input.fullName, "fullName", 120);
    const password = requiredText(input.password, "password", 128);
    if (password.length < 8) throw new BadRequestException("password must be at least 8 characters");
    const roleIds = idList(input.roleIds, "roleIds");
    const companyIds = idList(input.companyIds, "companyIds");
    if (companyIds.length === 0) throw new BadRequestException("companyIds must contain at least one company");

    const existing = await this.prisma.user.findFirst({
      where: { organizationId: actor.organizationId, email },
      select: { id: true },
    });
    if (existing) throw new ConflictException(`A user with e-mail "${email}" already exists`);

    await this.assertRolesInOrganization(actor.organizationId, roleIds);
    await this.assertCompaniesInOrganization(actor.organizationId, companyIds);
    const passwordHash = await hashPassword(password);

    const userId = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { organizationId: actor.organizationId, email, fullName, passwordHash },
      });
      if (companyIds.length > 0) {
        await tx.companyMembership.createMany({
          data: companyIds.map((companyId) => ({ userId: user.id, companyId })),
        });
      }
      if (roleIds.length > 0) {
        await tx.roleAssignment.createMany({ data: roleIds.map((roleId) => ({ userId: user.id, roleId })) });
      }
      await writeAudit(tx, actor, actor.id, "core.user.created", "User", user.id, {
        email,
        roleIds,
        companyIds,
      });
      return user.id;
    });
    return this.getUser(actor, userId);
  }

  async updateUser(actor: AuthenticatedUser, userId: string, body: unknown) {
    const input = assertBody(body);
    const target = await this.prisma.user.findFirst({
      where: { id: userId, organizationId: actor.organizationId },
      include: { roleAssignments: { include: { role: true } } },
    });
    if (!target) throw new NotFoundException("User not found");

    const fullName = input.fullName === undefined ? undefined : requiredText(input.fullName, "fullName", 120);
    const isActive = optionalBoolean(input.isActive, "isActive");
    const roleIds = input.roleIds === undefined ? undefined : idList(input.roleIds, "roleIds");
    const companyIds = input.companyIds === undefined ? undefined : idList(input.companyIds, "companyIds");

    if (isActive === false && target.id === actor.id) {
      throw new ForbiddenException("You cannot deactivate your own account");
    }
    if (companyIds !== undefined && companyIds.length === 0) {
      throw new BadRequestException("companyIds must contain at least one company");
    }
    if (roleIds !== undefined) await this.assertRolesInOrganization(actor.organizationId, roleIds);
    if (companyIds !== undefined) await this.assertCompaniesInOrganization(actor.organizationId, companyIds);

    await this.prisma.$transaction(async (tx) => {
      if (fullName !== undefined || isActive !== null) {
        await tx.user.update({
          where: { id: target.id },
          data: {
            ...(fullName !== undefined ? { fullName } : {}),
            ...(isActive !== null ? { isActive } : {}),
          },
        });
      }
      if (isActive === false) {
        // Une desactivation coupe immediatement toutes les sessions ouvertes.
        await tx.session.updateMany({
          where: { userId: target.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      if (roleIds !== undefined) {
        await tx.roleAssignment.deleteMany({ where: { userId: target.id } });
        if (roleIds.length > 0) {
          await tx.roleAssignment.createMany({ data: roleIds.map((roleId) => ({ userId: target.id, roleId })) });
        }
      }
      if (companyIds !== undefined) {
        await tx.companyMembership.deleteMany({ where: { userId: target.id } });
        await tx.companyMembership.createMany({
          data: companyIds.map((companyId) => ({ userId: target.id, companyId })),
        });
      }
      await this.assertOwnerRemains(tx, actor.organizationId);
      await writeAudit(tx, actor, actor.id, "core.user.updated", "User", target.id, {
        fullName,
        isActive,
        roleIds,
        companyIds,
      });
    });
    return this.getUser(actor, target.id);
  }

  private async getUser(actor: AuthenticatedUser, userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, organizationId: actor.organizationId },
      include: {
        roleAssignments: { include: { role: { select: { id: true, name: true } } } },
        companyMemberships: { include: { company: { select: { id: true, name: true } } } },
      },
    });
    if (!user) throw new NotFoundException("User not found");
    return toUserView(user);
  }

  // ---------------------------------------------------------------------
  // Roles
  // ---------------------------------------------------------------------

  async listRoles(actor: AuthenticatedUser) {
    const roles = await this.prisma.role.findMany({
      where: { organizationId: actor.organizationId },
      include: {
        permissions: { include: { permission: { select: { key: true } } } },
        _count: { select: { assignments: true } },
      },
      orderBy: [{ isSystem: "desc" }, { name: "asc" }],
    });
    return roles.map((role) => ({
      id: role.id,
      name: role.name,
      isSystem: role.isSystem,
      permissions: role.permissions.map((grant) => grant.permission.key).sort(),
      memberCount: role._count.assignments,
      createdAt: role.createdAt.toISOString(),
    }));
  }

  async createRole(actor: AuthenticatedUser, body: unknown) {
    const input = assertBody(body);
    const name = requiredText(input.name, "name", 60);
    if (name.toUpperCase() === OWNER_ROLE) throw new BadRequestException("OWNER is a reserved system role name");
    const keys = permissionKeys(input.permissions);

    const duplicate = await this.prisma.role.findFirst({
      where: { organizationId: actor.organizationId, name },
      select: { id: true },
    });
    if (duplicate) throw new ConflictException(`A role named "${name}" already exists`);

    const roleId = await this.prisma.$transaction(async (tx) => {
      const role = await tx.role.create({ data: { organizationId: actor.organizationId, name } });
      await this.replacePermissions(tx, role.id, keys);
      await writeAudit(tx, actor, actor.id, "core.role.created", "Role", role.id, { name, permissions: keys });
      return role.id;
    });
    return (await this.listRoles(actor)).find((role) => role.id === roleId);
  }

  async setRolePermissions(actor: AuthenticatedUser, roleId: string, body: unknown) {
    const input = assertBody(body);
    const keys = permissionKeys(input.permissions);
    const role = await this.findMutableRole(actor, roleId);

    await this.prisma.$transaction(async (tx) => {
      const before = await tx.rolePermission.findMany({
        where: { roleId: role.id },
        include: { permission: { select: { key: true } } },
      });
      await this.replacePermissions(tx, role.id, keys);
      const previous = before.map((grant) => grant.permission.key);
      await writeAudit(tx, actor, actor.id, "core.role.permissions_changed", "Role", role.id, {
        added: keys.filter((key) => !previous.includes(key)),
        removed: previous.filter((key) => !keys.includes(key)),
      });
    });
    return (await this.listRoles(actor)).find((candidate) => candidate.id === role.id);
  }

  async deleteRole(actor: AuthenticatedUser, roleId: string) {
    const role = await this.findMutableRole(actor, roleId);
    const members = await this.prisma.roleAssignment.count({ where: { roleId: role.id } });
    if (members > 0) {
      throw new BadRequestException("This role is still assigned to users; remove the assignments first");
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.role.delete({ where: { id: role.id } });
      await writeAudit(tx, actor, actor.id, "core.role.deleted", "Role", role.id, { name: role.name });
    });
    return { success: true };
  }

  private async findMutableRole(actor: AuthenticatedUser, roleId: string) {
    const role = await this.prisma.role.findFirst({ where: { id: roleId, organizationId: actor.organizationId } });
    if (!role) throw new NotFoundException("Role not found");
    if (role.isSystem) throw new ForbiddenException("System roles cannot be modified");
    return role;
  }

  private async replacePermissions(tx: Prisma.TransactionClient, roleId: string, keys: string[]) {
    await tx.rolePermission.deleteMany({ where: { roleId } });
    if (keys.length === 0) return;
    for (const key of keys) {
      await tx.permission.upsert({
        where: { key },
        update: {},
        create: { key, description: `Permission systeme: ${key}` },
      });
    }
    const permissions = await tx.permission.findMany({ where: { key: { in: keys } }, select: { id: true } });
    await tx.rolePermission.createMany({
      data: permissions.map((permission) => ({ roleId, permissionId: permission.id })),
    });
  }

  // ---------------------------------------------------------------------
  // Entreprises
  // ---------------------------------------------------------------------

  async listCompanies(actor: AuthenticatedUser) {
    const companies = await this.prisma.company.findMany({
      where: { organizationId: actor.organizationId },
      include: { _count: { select: { users: true } } },
      orderBy: { createdAt: "asc" },
    });
    return companies.map((company) => ({
      id: company.id,
      name: company.name,
      legalName: company.legalName,
      currency: company.currency.trim(),
      memberCount: company._count.users,
      createdAt: company.createdAt.toISOString(),
    }));
  }

  async createCompany(actor: AuthenticatedUser, body: unknown) {
    const input = assertBody(body);
    const name = requiredText(input.name, "name", 120);
    const legalName = optionalText(input.legalName, "legalName", 180);
    const currency = input.currency === undefined ? "USD" : currencyCode(input.currency);
    const duplicate = await this.prisma.company.findFirst({
      where: { organizationId: actor.organizationId, name },
      select: { id: true },
    });
    if (duplicate) throw new ConflictException(`A company named "${name}" already exists`);

    const companyId = await this.prisma.$transaction(async (tx) => {
      const company = await tx.company.create({
        data: { organizationId: actor.organizationId, name, legalName, currency },
      });
      // Le createur en devient membre pour pouvoir y travailler immediatement.
      await tx.companyMembership.create({ data: { userId: actor.id, companyId: company.id } });
      await tx.crmPipelineStage.createMany({
        data: DEFAULT_PIPELINE_STAGES.map((stage) => ({
          organizationId: actor.organizationId,
          companyId: company.id,
          name: stage.name,
          position: stage.position,
          probability: stage.probability,
          isWon: stage.isWon,
          isLost: stage.isLost,
        })),
      });
      await writeAudit(tx, actor, actor.id, "core.company.created", "Company", company.id, { name });
      return company.id;
    });
    return (await this.listCompanies(actor)).find((company) => company.id === companyId);
  }

  // ---------------------------------------------------------------------
  // Journal d'audit (lecture seule)
  // ---------------------------------------------------------------------

  async listAudit(actor: AuthenticatedUser, query: Record<string, unknown>): Promise<AuditLogPage> {
    const page = Math.max(1, Number.parseInt(String(query.page ?? "1"), 10) || 1);
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(query.pageSize ?? "25"), 10) || 25));
    const action = optionalText(query.action, "action", 120);
    const resourceType = optionalText(query.resourceType, "resourceType", 80);
    const from = optionalDate(query.from, "from");
    const to = optionalDate(query.to, "to");

    const where: Prisma.AuditLogWhereInput = {
      organizationId: actor.organizationId,
      ...(action ? { action: { startsWith: action } } : {}),
      ...(resourceType ? { resourceType } : {}),
      ...(from || to
        ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: endOfDay(to) } : {}) } }
        : {}),
    };

    const [total, logs] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        include: { actor: { select: { fullName: true, email: true } } },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      total,
      page,
      pageSize,
      items: logs.map((log) => ({
        id: log.id,
        action: log.action,
        resourceType: log.resourceType,
        resourceId: log.resourceId,
        actorName: log.actor?.fullName ?? null,
        actorEmail: log.actor?.email ?? null,
        metadata: (log.metadata as Record<string, unknown> | null) ?? null,
        createdAt: log.createdAt.toISOString(),
      })),
    };
  }

  // ---------------------------------------------------------------------
  // Gardes
  // ---------------------------------------------------------------------

  private async assertRolesInOrganization(organizationId: string, roleIds: string[]) {
    if (roleIds.length === 0) return;
    const count = await this.prisma.role.count({ where: { id: { in: roleIds }, organizationId } });
    if (count !== roleIds.length) throw new BadRequestException("One or more roles do not exist");
  }

  private async assertCompaniesInOrganization(organizationId: string, companyIds: string[]) {
    if (companyIds.length === 0) return;
    const count = await this.prisma.company.count({ where: { id: { in: companyIds }, organizationId } });
    if (count !== companyIds.length) throw new BadRequestException("One or more companies do not exist");
  }

  private async assertOwnerRemains(tx: Prisma.TransactionClient, organizationId: string) {
    const activeOwners = await tx.roleAssignment.count({
      where: {
        role: { organizationId, name: OWNER_ROLE, isSystem: true },
        user: { isActive: true },
      },
    });
    if (activeOwners === 0) {
      throw new BadRequestException("The organization must keep at least one active OWNER");
    }
  }
}

function idList(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw new BadRequestException(`${field} must be an array of identifiers`);
  }
  return [...new Set(value.map((item: string) => item.trim()))];
}

function permissionKeys(value: unknown): string[] {
  const keys = idList(value, "permissions");
  const unknown = keys.filter((key) => !isKnownPermission(key));
  if (unknown.length > 0) throw new BadRequestException(`Unknown permission(s): ${unknown.join(", ")}`);
  return keys.sort();
}

function endOfDay(date: Date): Date {
  const end = new Date(date);
  end.setUTCHours(23, 59, 59, 999);
  return end;
}

type UserWithRelations = Prisma.UserGetPayload<{
  include: {
    roleAssignments: { include: { role: { select: { id: true; name: true } } } };
    companyMemberships: { include: { company: { select: { id: true; name: true } } } };
  };
}>;

function toUserView(user: UserWithRelations) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    isActive: user.isActive,
    mfaEnabled: user.mfaEnabled,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    roles: user.roleAssignments.map((assignment) => assignment.role),
    companies: user.companyMemberships.map((membership) => membership.company),
  };
}
