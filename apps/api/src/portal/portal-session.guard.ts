import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, createParamDecorator } from "@nestjs/common";
import type { Request } from "express";
import { hashSessionToken } from "@axora24/security";
import { PrismaService } from "../core/prisma.service.js";

export const PORTAL_COOKIE = "axora_portal_session";

export interface PortalContext {
  sessionId: string;
  id: string;
  organizationId: string;
  companyId: string;
  kind: "CLIENT" | "SUPPLIER";
  email: string;
  fullName: string;
  crmAccountId: string | null;
  supplierId: string | null;
}

declare module "express" {
  interface Request {
    portalPrincipal?: PortalContext;
  }
}

export function readCookie(request: Request, name: string): string | undefined {
  const part = (request.headers.cookie ?? "")
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${name}=`));
  return part ? decodeURIComponent(part.slice(name.length + 1)) : undefined;
}

/**
 * Garde du plan d'identite EXTERNE : lit uniquement le cookie portail et la
 * table portal_sessions. Un cookie de session interne n'authentifie jamais
 * une route portail (et la garde interne ignore le cookie portail).
 */
@Injectable()
export class PortalSessionGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = readCookie(request, PORTAL_COOKIE);
    if (!token) throw new UnauthorizedException("No portal session");
    const session = await this.prisma.portalSession.findUnique({ where: { tokenHash: hashSessionToken(token) }, include: { principal: true } });
    if (!session || session.revokedAt || session.expiresAt < new Date() || session.principal.status !== "ACTIVE") throw new UnauthorizedException("Invalid or expired portal session");
    const principal = session.principal;
    request.portalPrincipal = {
      sessionId: session.id,
      id: principal.id,
      organizationId: principal.organizationId,
      companyId: principal.companyId,
      kind: principal.kind,
      email: principal.email,
      fullName: principal.fullName,
      crmAccountId: principal.crmAccountId,
      supplierId: principal.supplierId,
    };
    return true;
  }
}

export const Principal = createParamDecorator((_data: unknown, context: ExecutionContext): PortalContext => {
  const request = context.switchToHttp().getRequest<Request>();
  if (!request.portalPrincipal) throw new UnauthorizedException("Portal principal not authenticated");
  return request.portalPrincipal;
});
