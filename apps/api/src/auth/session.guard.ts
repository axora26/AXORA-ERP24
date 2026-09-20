import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { hashSessionToken } from "@axora24/security";
import { PrismaService } from "../core/prisma.service.js";

export interface AuthenticatedUser {
  id: string;
  organizationId: string;
  email: string;
}

declare module "express" {
  interface Request {
    axoraUser?: AuthenticatedUser;
  }
}

/**
 * Garde de session — INVARIANT (docs/foundation/03-security.md) :
 * le cookie est un token opaque, jamais un JWT auto-porteur. Toute
 * validite est recalculee cote serveur a partir du hash stocke en base
 * (jamais fait confiance a une donnee transmise par le client seule).
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const cookieName = process.env.SESSION_COOKIE_NAME ?? "axora_erp24_session";
    const rawCookie = request.headers.cookie ?? "";
    const plainToken = parseCookie(rawCookie, cookieName);

    if (!plainToken) {
      throw new UnauthorizedException("No session cookie");
    }

    const tokenHash = hashSessionToken(plainToken);
    const session = await this.prisma.session.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedException("Invalid or expired session");
    }

    if (!session.user.isActive) {
      throw new UnauthorizedException("User is disabled");
    }

    request.axoraUser = {
      id: session.user.id,
      organizationId: session.user.organizationId,
      email: session.user.email,
    };
    return true;
  }
}

function parseCookie(rawCookie: string, name: string): string | undefined {
  const parts = rawCookie.split(";").map((part) => part.trim());
  for (const part of parts) {
    const [key, ...rest] = part.split("=");
    if (key === name) {
      return decodeURIComponent(rest.join("="));
    }
  }
  return undefined;
}
