import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { isAuthorized, type ResolvedGrant } from "@axora24/security";
import { PrismaService } from "../core/prisma.service.js";
import { PERMISSION_KEY } from "./require-permission.decorator.js";

/**
 * Garde d'autorisation deny-by-default (docs/foundation/03-security.md).
 * DOIT s'executer APRES SessionGuard (le user doit deja etre attache a la requete).
 *
 * Les grants sont resolus EXCLUSIVEMENT depuis la base de donnees a partir de
 * l'utilisateur de la session — jamais depuis un champ transmis par le client.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermission = this.reflector.get<string | undefined>(
      PERMISSION_KEY,
      context.getHandler(),
    );

    // Pas de permission declaree explicitement -> deny-by-default.
    if (!requiredPermission) {
      throw new ForbiddenException("No permission declared for this route (deny-by-default)");
    }

    const request = context.switchToHttp().getRequest<Request>();
    const user = request.axoraUser;
    if (!user) {
      throw new UnauthorizedException("SessionGuard must run before PermissionGuard");
    }

    const assignments = await this.prisma.roleAssignment.findMany({
      where: { userId: user.id },
      include: { role: { include: { permissions: { include: { permission: true } } } } },
    });

    const grants: ResolvedGrant[] = assignments.flatMap((assignment) =>
      assignment.role.permissions.map((rolePermission) => ({
        permissionKey: rolePermission.permission.key,
        organizationId: assignment.role.organizationId,
        companyId: assignment.companyId ?? undefined,
        projectId: assignment.projectId ?? undefined,
      })),
    );

    const authorized = isAuthorized(
      { key: requiredPermission, organizationId: user.organizationId },
      grants,
    );

    if (!authorized) {
      throw new ForbiddenException(`Missing permission: ${requiredPermission}`);
    }

    return true;
  }
}
