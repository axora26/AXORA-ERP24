import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { loginThrottleKey } from "@axora24/security";
import { PrismaService } from "../core/prisma.service.js";

const WINDOW_MS = 15 * 60 * 1000;
const BLOCK_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

@Injectable()
export class LoginThrottleService {
  constructor(private readonly prisma: PrismaService) {}

  async enforce(normalizedEmail: string, ipAddress: string): Promise<void> {
    const keyHash = loginThrottleKey(normalizedEmail, ipAddress);
    const record = await this.prisma.loginThrottle.findUnique({ where: { keyHash } });

    if (record?.blockedUntil && record.blockedUntil.getTime() > Date.now()) {
      throw new HttpException(
        "Too many failed login attempts. Try again later.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async recordFailure(normalizedEmail: string, ipAddress: string): Promise<void> {
    const keyHash = loginThrottleKey(normalizedEmail, ipAddress);
    const now = new Date();
    const cutoff = new Date(now.getTime() - WINDOW_MS);

    await this.prisma.$transaction(
      async (tx) => {
        const current = await tx.loginThrottle.findUnique({ where: { keyHash } });

        if (!current || current.windowStartedAt < cutoff) {
          await tx.loginThrottle.upsert({
            where: { keyHash },
            update: {
              failureCount: 1,
              windowStartedAt: now,
              blockedUntil: null,
            },
            create: {
              keyHash,
              failureCount: 1,
              windowStartedAt: now,
            },
          });
          return;
        }

        const failureCount = current.failureCount + 1;
        await tx.loginThrottle.update({
          where: { keyHash },
          data: {
            failureCount,
            blockedUntil:
              failureCount >= MAX_FAILURES
                ? new Date(now.getTime() + BLOCK_MS)
                : current.blockedUntil,
          },
        });
      },
      { isolationLevel: "Serializable" },
    );
  }

  async recordSuccess(normalizedEmail: string, ipAddress: string): Promise<void> {
    const keyHash = loginThrottleKey(normalizedEmail, ipAddress);
    await this.prisma.loginThrottle.deleteMany({ where: { keyHash } });
  }
}
