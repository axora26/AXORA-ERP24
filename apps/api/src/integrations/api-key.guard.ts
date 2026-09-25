import { CanActivate, ExecutionContext, ForbiddenException, HttpException, HttpStatus, Injectable, SetMetadata, UnauthorizedException, createParamDecorator } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request, Response } from "express";
import { Prisma } from "@axora24/database";
import { PrismaService } from "../core/prisma.service.js";
import { LoginThrottleService } from "../auth/login-throttle.service.js";
import { bearerKey, hashApiKey, ipAllowed, normalizeIp, rateWindows } from "./api-key.js";

export interface ApiKeyContext {
  id: string;
  name: string;
  organizationId: string;
  companyId: string;
  createdByUserId: string;
  /** Permissions effectives : celles de la cle ENCORE detenues par son createur. */
  permissions: Set<string>;
}

declare module "express" {
  interface Request {
    axoraApiKey?: ApiKeyContext;
  }
}

const API_PERMISSION = "axora:api-permission";
/** Permission exigee de la cle pour cette route (deny-by-default : route sans permission = refus ; « * » = cle authentifiee seulement). */
export const ApiPermission = (permission: string) => SetMetadata(API_PERMISSION, permission);
export const ApiKey = createParamDecorator((_data: unknown, context: ExecutionContext): ApiKeyContext => {
  const key = context.switchToHttp().getRequest<Request>().axoraApiKey;
  if (!key) throw new UnauthorizedException("Clé d'API requise");
  return key;
});

const THROTTLE_SUBJECT = "api-key";

/**
 * Authentification machine de l'API publique. Ordre : limitation des essais
 * par IP -> cle valide (empreinte), non revoquee, non expiree -> IP autorisee
 * -> createur toujours actif et membre -> comptage debit/quota (toute requete
 * authentifiee compte) -> permission de la route.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
    private readonly throttle: LoginThrottleService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const ip = normalizeIp(request.ip);
    await this.throttle.enforce(THROTTLE_SUBJECT, ip).catch(() => {
      throw new HttpException("Trop de clés invalides présentées depuis cette adresse : réessayez dans 15 minutes", HttpStatus.TOO_MANY_REQUESTS);
    });

    const secret = bearerKey(request.headers.authorization);
    if (!secret) throw new UnauthorizedException("Clé d'API requise (en-tête Authorization: Bearer axk_…)");
    const key = await this.prisma.apiKey.findUnique({ where: { keyHash: hashApiKey(secret) } });
    if (!key) {
      await this.throttle.recordFailure(THROTTLE_SUBJECT, ip);
      throw new UnauthorizedException("Clé d'API invalide");
    }
    if (key.revokedAt) throw new UnauthorizedException("Clé d'API révoquée");
    if (key.expiresAt && key.expiresAt.getTime() <= Date.now()) throw new UnauthorizedException("Clé d'API expirée");
    if (!ipAllowed(ip, key.allowedIps)) throw new ForbiddenException("Adresse IP non autorisée pour cette clé");

    // La cle n'est jamais plus puissante que son createur, a chaque requete.
    const creator = await this.prisma.user.findFirst({
      where: { id: key.createdByUserId, organizationId: key.organizationId, isActive: true, companyMemberships: { some: { companyId: key.companyId } } },
      select: { roleAssignments: { select: { role: { select: { organizationId: true, permissions: { select: { permission: { select: { key: true } } } } } } } } },
    });
    if (!creator) throw new UnauthorizedException("Clé suspendue : son créateur n'a plus accès à cette entreprise");
    const held = new Set(creator.roleAssignments.filter((assignment) => assignment.role.organizationId === key.organizationId).flatMap((assignment) => assignment.role.permissions.map((entry) => entry.permission.key)));
    const permissions = new Set(key.permissions.filter((permission) => held.has(permission)));
    request.axoraApiKey = { id: key.id, name: key.name, organizationId: key.organizationId, companyId: key.companyId, createdByUserId: key.createdByUserId, permissions };

    const windows = rateWindows(new Date());
    const minute = await this.increment(key.id, windows.minute);
    const day = await this.increment(key.id, windows.day);
    response.setHeader("X-RateLimit-Limit", String(key.rateLimitPerMinute));
    response.setHeader("X-RateLimit-Remaining", String(Math.max(0, key.rateLimitPerMinute - minute)));
    if (minute > key.rateLimitPerMinute) {
      response.setHeader("Retry-After", String(windows.minuteResetSeconds));
      throw new HttpException(`Limite de débit dépassée (${key.rateLimitPerMinute} requêtes par minute)`, HttpStatus.TOO_MANY_REQUESTS);
    }
    if (day > key.dailyQuota) {
      response.setHeader("Retry-After", String(windows.dayResetSeconds));
      throw new HttpException(`Quota journalier atteint (${key.dailyQuota} requêtes)`, HttpStatus.TOO_MANY_REQUESTS);
    }
    await this.prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });

    const required = this.reflector.get<string | undefined>(API_PERMISSION, context.getHandler());
    if (!required) throw new ForbiddenException("Aucune permission déclarée pour cette route (deny-by-default)");
    // « * » : route d'introspection de la cle elle-meme, aucune donnee metier.
    if (required !== "*" && !permissions.has(required)) throw new ForbiddenException(`Permission ${required} non accordée à cette clé`);
    return true;
  }

  /** Compteur atomique (INSERT ... ON CONFLICT) : aucune perte sous concurrence. */
  private async increment(keyId: string, window: string): Promise<number> {
    const [row] = await this.prisma.$queryRaw<Array<{ count: number }>>(Prisma.sql`
      INSERT INTO "api_key_usage" ("keyId", "window", "count") VALUES (${keyId}, ${window}, 1)
      ON CONFLICT ("keyId", "window") DO UPDATE SET "count" = "api_key_usage"."count" + 1
      RETURNING "count"`);
    return row!.count;
  }
}
