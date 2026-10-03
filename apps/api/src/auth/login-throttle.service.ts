import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { loginThrottleKey } from "@axora24/security";
import { PrismaService } from "../core/prisma.service.js";

const WINDOW_MS = 15 * 60 * 1000;
const BLOCK_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

@Injectable()
export class LoginThrottleService {
  constructor(private readonly prisma: PrismaService) {}

  /** Reserve a request before expensive work. Success never resets this action/IP budget. */
  async reserveAttempt(subject: string, ipAddress: string, maxAttempts = MAX_FAILURES): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 1000) throw new Error("Invalid request budget");
    const keyHash = loginThrottleKey(subject, ipAddress);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${keyHash}, 0))`;
      const now = new Date();
      const current = await tx.loginThrottle.findUnique({ where: { keyHash } });
      if (current?.blockedUntil && current.blockedUntil > now) return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((current.blockedUntil.getTime() - now.getTime()) / 1000)) };
      const expired = !current || current.windowStartedAt.getTime() <= now.getTime() - WINDOW_MS;
      const failureCount = expired ? 1 : current.failureCount + 1;
      const blockedUntil = failureCount >= maxAttempts ? new Date(now.getTime() + BLOCK_MS) : null;
      await tx.loginThrottle.upsert({
        where: { keyHash },
        create: { keyHash, failureCount, windowStartedAt: now, blockedUntil },
        update: { failureCount, windowStartedAt: expired ? now : current.windowStartedAt, blockedUntil },
      });
      return { allowed: failureCount <= maxAttempts, retryAfterSeconds: failureCount > maxAttempts ? Math.ceil(BLOCK_MS / 1000) : 0 };
    }, { isolationLevel: "ReadCommitted" });
  }

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
        // One counter per subject/IP, including concurrent first failures.
        // Serializable transactions without retries could otherwise throw
        // P2034 and silently lose attempts instead of updating the limiter.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${keyHash}, 0))`;
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
      { isolationLevel: "ReadCommitted" },
    );
  }

  async recordSuccess(normalizedEmail: string, ipAddress: string): Promise<void> {
    const keyHash = loginThrottleKey(normalizedEmail, ipAddress);
    await this.prisma.loginThrottle.deleteMany({ where: { keyHash } });
  }
}
