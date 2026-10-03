import { isAuthorized, type ResolvedGrant } from "@axora24/security";
import type { Prisma } from "@axora24/database";
import type { CompanyScope } from "../common/company-scope.service.js";
import type { PrismaService } from "../core/prisma.service.js";

/** Machine credentials remain bounded by the creator's current, scoped grants. */
export async function resolveDelegatedPermissions(
  prisma: PrismaService | Prisma.TransactionClient,
  scope: CompanyScope,
  userId: string,
): Promise<Set<string> | null> {
  const creator = await prisma.user.findFirst({
    where: { id: userId, organizationId: scope.organizationId, isActive: true, companyMemberships: { some: { companyId: scope.companyId } } },
    select: { roleAssignments: { where: { role: { organizationId: scope.organizationId } }, select: { companyId: true, projectId: true, role: { select: { organizationId: true, permissions: { select: { permission: { select: { key: true } } } } } } } } },
  });
  if (!creator) return null;
  const grants: ResolvedGrant[] = creator.roleAssignments.flatMap((assignment) => assignment.role.permissions.map((entry) => ({
    permissionKey: entry.permission.key,
    organizationId: assignment.role.organizationId,
    companyId: assignment.companyId ?? undefined,
    projectId: assignment.projectId ?? undefined,
  })));
  return new Set(grants.filter((grant) => isAuthorized({ key: grant.permissionKey, ...scope }, [grant])).map((grant) => grant.permissionKey));
}
