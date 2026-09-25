import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, createParamDecorator } from "@nestjs/common";
import type { Request } from "express";
import { hashSessionToken } from "@axora24/security";
import { PrismaService } from "../core/prisma.service.js";

export interface GatewayContext {
  id: string;
  code: string;
  organizationId: string;
  companyId: string;
}

declare module "express" {
  interface Request {
    smartGateway?: GatewayContext;
  }
}

/**
 * Authentification machine des passerelles GTB : jeton porteur opaque dont
 * seule l'empreinte SHA-256 est stockee. Aucun cookie, aucune session
 * utilisateur : une passerelle ne peut qu'envoyer ses lectures et traiter
 * les consignes de SES points (perimetre entreprise porte par la passerelle).
 */
@Injectable()
export class GatewayTokenGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization ?? "";
    const match = /^Bearer\s+(axgw_[A-Za-z0-9_-]{20,})$/.exec(header.trim());
    if (!match) throw new UnauthorizedException("Gateway bearer token required");
    const gateway = await this.prisma.smartGateway.findUnique({
      where: { tokenHash: hashSessionToken(match[1]!) },
      select: { id: true, code: true, organizationId: true, companyId: true, active: true },
    });
    if (!gateway || !gateway.active) throw new UnauthorizedException("Unknown or disabled gateway");
    request.smartGateway = { id: gateway.id, code: gateway.code, organizationId: gateway.organizationId, companyId: gateway.companyId };
    return true;
  }
}

export const Gateway = createParamDecorator((_data: unknown, context: ExecutionContext): GatewayContext => {
  const request = context.switchToHttp().getRequest<Request>();
  if (!request.smartGateway) throw new UnauthorizedException("Gateway not authenticated");
  return request.smartGateway;
});
