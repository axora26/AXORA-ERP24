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
    const body = request.body as { companyId?: unknown } | undefined;
    const fromBody = typeof body?.companyId === "string" ? body.companyId : undefined;

    // Legacy handlers may read the body while @Scope handlers use the query.
    // A request must never authorize one company and operate on another.
    if (fromQuery !== undefined && fromBody !== undefined && fromQuery !== fromBody) throw new BadRequestException("Conflicting companyId values");

    request.axoraScope = await this.companyScope.resolve(user, fromQuery ?? fromBody);
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
