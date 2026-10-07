import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { PrismaService } from "../core/prisma.service.js";

const MFA_STEP_UP_KEY = "axora:mfa-step-up";
interface MfaStepUpOptions { always?: boolean }

export const MFA_STEP_UP_MAX_AGE_MS = 5 * 60 * 1000;

@Injectable()
export class MfaStepUpGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService, private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<MfaStepUpOptions>(MFA_STEP_UP_KEY, [context.getHandler(), context.getClass()]) ?? {};
    const request = context.switchToHttp().getRequest<Request>();
    const user = request.axoraUser;
    const session = request.axoraSession;

    if (!user || !session) throw new ForbiddenException("Recent MFA verification required");
    if (!options.always) {
      const account = await this.prisma.user.findUnique({
        where: { id: user.id },
        select: { mfaEnabled: true, organization: { select: { mfaRequired: true } } },
      });
      // Tant que la politique ne l'impose pas, un compte non enrôlé conserve
      // les parcours historiques. Dès qu'un facteur existe, les mutations
      // critiques bénéficient toujours du step-up.
      if (!account?.mfaEnabled && !account?.organization.mfaRequired) return true;
    }

    const verifiedAt = session.mfaVerifiedAt?.getTime();
    const age = verifiedAt === undefined ? Number.POSITIVE_INFINITY : Date.now() - verifiedAt;
    if (age >= 0 && age <= MFA_STEP_UP_MAX_AGE_MS) return true;

    throw new ForbiddenException({
      statusCode: 403,
      code: "MFA_STEP_UP_REQUIRED",
      message: "Recent MFA verification required",
      maxAgeSeconds: MFA_STEP_UP_MAX_AGE_MS / 1000,
    });
  }
}
