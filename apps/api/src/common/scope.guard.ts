import {
  CanActivate,
  BadRequestException,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  UseGuards,
  applyDecorators,
  createParamDecorator,
} from "@nestjs/common";
import type { Request } from "express";
import { SessionGuard, type AuthenticatedUser } from "../auth/session.guard.js";
import { PermissionGuard } from "../auth/permission.guard.js";
import { CompanyScopeService, type CompanyScope } from "./company-scope.service.js";

declare module "express" {
  interface Request {
    axoraScope?: CompanyScope;
  }
}

/**
 * Resout le perimetre entreprise AVANT le handler, a partir de la session
 * uniquement (le `companyId` eventuel de la requete est revalide contre les
 * CompanyMembership de l'utilisateur — voir CompanyScopeService).
 *
 * Doit s'executer apres SessionGuard et avant PermissionGuard pour que les
 * droits soient evalues dans l'entreprise effectivement demandee.
 */
@Injectable()
export class CompanyScopeGuard implements CanActivate {
  constructor(private readonly companyScope: CompanyScopeService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const user = request.axoraUser;
    if (!user) throw new UnauthorizedException("SessionGuard must run before CompanyScopeGuard");

    const fromQuery = typeof request.query.companyId === "string" ? request.query.companyId : undefined;
    const body = request.body as { companyId?: unknown; projectId?: unknown } | undefined;
    const fromBody = typeof body?.companyId === "string" ? body.companyId : undefined;

    // Legacy handlers may read the body while @Scope handlers use the query.
    // A request must never authorize one company and operate on another.
    if (fromQuery !== undefined && fromBody !== undefined && fromQuery !== fromBody) throw new BadRequestException("Conflicting companyId values");

    const projectFromQuery = typeof request.query.projectId === "string" ? request.query.projectId : undefined;
    const projectFromBody = typeof body?.projectId === "string" ? body.projectId : undefined;
    const projectFromParam = typeof request.params?.projectId === "string" ? request.params.projectId : undefined;
    // Les routes /projects/:id/... portent naturellement l'identifiant du
    // chantier dans `id`. Les autres ressources ne déduisent jamais un projet
    // depuis un identifiant générique afin d'éviter un mauvais périmètre.
    const projectFromProjectRoute = /\/projects\/[^/]+/.test(request.path) && typeof request.params?.id === "string"
      ? request.params.id
      : undefined;
    const projectIds = [projectFromQuery, projectFromBody, projectFromParam, projectFromProjectRoute].filter(
      (value): value is string => value !== undefined && value !== "",
    );
    const requestedProjectId = projectIds[0];
    if (projectIds.some((value) => value !== requestedProjectId)) {
      throw new BadRequestException("Conflicting projectId values");
    }

    request.axoraScope = await this.companyScope.resolve(user, fromQuery ?? fromBody, requestedProjectId);
    return true;
  }
}

/**
 * Controleur metier securise : session obligatoire, permission explicite
 * par route (deny-by-default), perimetre entreprise resolu cote serveur.
 */
export const ScopedController = () => applyDecorators(UseGuards(SessionGuard, CompanyScopeGuard, PermissionGuard));

/** Perimetre entreprise resolu par CompanyScopeGuard. */
export const Scope = createParamDecorator((_data: unknown, context: ExecutionContext): CompanyScope => {
  const request = context.switchToHttp().getRequest<Request>();
  if (!request.axoraScope) throw new UnauthorizedException("Company scope not resolved");
  return request.axoraScope;
});

/** Utilisateur authentifie de la session. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const request = context.switchToHttp().getRequest<Request>();
    if (!request.axoraUser) throw new UnauthorizedException("No authenticated user");
    return request.axoraUser;
  },
);
