import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { hashSessionToken } from "@axora24/security";
import { PrismaService } from "../core/prisma.service.js";
import { SESSION_MAX_AGE_MS, nextSessionExpiry } from "./session-policy.js";

export interface AuthenticatedUser {
  id: string;
  organizationId: string;
  email: string;
  /**
   * INVARIANT DE CONTRAT : GET /auth/me doit exposer exactement la meme forme
   * d'utilisateur que POST /auth/login. Sans fullName ici, le client recevait
   * un profil incomplet au rechargement de page et plantait (regression
   * couverte par test/auth-contract.e2e.test.ts).
   */
  fullName: string;
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

    if (!plainToken || !/^[A-Za-z0-9_-]{43}$/.test(plainToken)) {
      throw new UnauthorizedException("No session cookie");
    }

    const tokenHash = hashSessionToken(plainToken);
    const session = await this.prisma.session.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    const now = Date.now();
    if (!session || session.revokedAt || session.expiresAt.getTime() <= now || session.createdAt.getTime() + SESSION_MAX_AGE_MS <= now) {
      throw new UnauthorizedException("Invalid or expired session");
    }

    if (!session.user.isActive) {
      throw new UnauthorizedException("User is disabled");
    }
    const extended = await this.prisma.session.updateMany({ where: { id: session.id, revokedAt: null, expiresAt: { gt: new Date(now) } }, data: { expiresAt: nextSessionExpiry(session.createdAt, now) } });
    if (extended.count !== 1) throw new UnauthorizedException("Invalid or expired session");

    request.axoraUser = {
      id: session.user.id,
      organizationId: session.user.organizationId,
      email: session.user.email,
      fullName: session.user.fullName,
    };
    return true;
  }
}

function parseCookie(rawCookie: string, name: string): string | undefined {
  const parts = rawCookie.split(";").map((part) => part.trim());
  for (const part of parts) {
    const [key, ...rest] = part.split("=");
    if (key === name) {
      try { return decodeURIComponent(rest.join("=")); } catch { return undefined; }
    }
  }
  return undefined;
}
