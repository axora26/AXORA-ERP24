import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import {
  createSessionToken,
  decryptSecret,
  encryptSecret,
  generateTotpSecret,
  hashPassword,
  hashSessionToken,
  otpauthUri,
  parseEncryptionKey,
  verifyPassword,
  verifyTotp,
} from "@axora24/security";
import { PrismaService } from "../core/prisma.service.js";
import { assertBody, requiredText } from "../common/validation.js";
import type { AuthenticatedUser } from "./session.guard.js";
import type { RequestMetadata } from "./auth.service.js";

const MFA_ISSUER = "AXORA-ERP24";
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const CHALLENGE_MAX_ATTEMPTS = 5;
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

/**
 * Securite du compte en libre-service : mot de passe et MFA TOTP
 * (docs/foundation/03-security.md §3).
 *
 * - Le secret TOTP est chiffre au repos (AES-256-GCM, MFA_ENCRYPTION_KEY).
 * - Sans cle configuree, la MFA est indisponible (503 explicite) mais jamais
 *   bloquante : aucun compte ne peut l'activer, la connexion reste possible.
 * - Anti-rejeu : un pas TOTP deja accepte est refuse.
 * - Chaque evenement est audite, sans aucun secret dans les metadonnees.
 */
@Injectable()
export class AccountService {
  constructor(private readonly prisma: PrismaService) {}

  private key(): Buffer | null {
    return parseEncryptionKey(process.env.MFA_ENCRYPTION_KEY);
  }

  private requireKey(): Buffer {
    const key = this.key();
    if (!key) {
      throw new ServiceUnavailableException(
        "MFA is not configured on this server (MFA_ENCRYPTION_KEY missing or invalid)",
      );
    }
    return key;
  }

  async changePassword(user: AuthenticatedUser, body: unknown, currentTokenHash: string | null) {
    const input = assertBody(body);
    const currentPassword = requiredText(input.currentPassword, "currentPassword", 128);
    const newPassword = requiredText(input.newPassword, "newPassword", 128);
    if (newPassword.length < 8) throw new BadRequestException("newPassword must be at least 8 characters");
    if (newPassword === currentPassword) throw new BadRequestException("newPassword must differ from the current one");

    const record = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!(await verifyPassword(currentPassword, record.passwordHash))) {
      throw new UnauthorizedException("Current password is incorrect");
    }
    const passwordHash = await hashPassword(newPassword);

    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
      // Les autres sessions sont revoquees ; la session courante reste ouverte.
      this.prisma.session.updateMany({
        where: { userId: user.id, revokedAt: null, ...(currentTokenHash ? { NOT: { tokenHash: currentTokenHash } } : {}) },
        data: { revokedAt: new Date() },
      }),
      this.prisma.auditLog.create({
        data: {
          organizationId: user.organizationId,
          actorUserId: user.id,
          action: "auth.password.changed",
          resourceType: "User",
          resourceId: user.id,
          metadata: { otherSessionsRevoked: true },
        },
      }),
    ]);
    return { success: true };
  }

  async mfaStatus(user: AuthenticatedUser) {
    const record = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { mfaEnabled: true, mfaPendingSecretEnc: true },
    });
    return {
      enabled: record.mfaEnabled,
      pendingSetup: record.mfaPendingSecretEnc !== null,
      available: this.key() !== null,
    };
  }

  /** Genere un secret en attente ; il n'est affiche qu'une fois, puis seulement stocke chiffre. */
  async startMfaSetup(user: AuthenticatedUser) {
    const key = this.requireKey();
    const record = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (record.mfaEnabled) throw new BadRequestException("MFA is already enabled");
    const secret = generateTotpSecret();
    await this.prisma.user.update({
      where: { id: user.id },
      data: { mfaPendingSecretEnc: encryptSecret(secret, key) },
    });
    return { secret, otpauthUri: otpauthUri(MFA_ISSUER, record.email, secret) };
  }

  async enableMfa(user: AuthenticatedUser, body: unknown) {
    const key = this.requireKey();
    const code = requiredText(assertBody(body).code, "code", 12);
    const record = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (record.mfaEnabled) throw new BadRequestException("MFA is already enabled");
    if (!record.mfaPendingSecretEnc) throw new BadRequestException("Start the MFA setup first");

    const secret = decryptSecret(record.mfaPendingSecretEnc, key);
    const counter = verifyTotp(secret, code);
    if (counter === null) throw new BadRequestException("Invalid authentication code");

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: {
          mfaEnabled: true,
          mfaSecretEnc: record.mfaPendingSecretEnc,
          mfaPendingSecretEnc: null,
          mfaLastCounter: counter,
        },
      }),
      this.prisma.auditLog.create({
        data: {
          organizationId: user.organizationId,
          actorUserId: user.id,
          action: "auth.mfa.enabled",
          resourceType: "User",
          resourceId: user.id,
          metadata: { method: "TOTP" },
        },
      }),
    ]);
    return { enabled: true };
  }

  async disableMfa(user: AuthenticatedUser, body: unknown) {
    const key = this.requireKey();
    const input = assertBody(body);
    const password = requiredText(input.password, "password", 128);
    const code = requiredText(input.code, "code", 12);
    const record = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!record.mfaEnabled || !record.mfaSecretEnc) throw new BadRequestException("MFA is not enabled");
    if (!(await verifyPassword(password, record.passwordHash))) {
      throw new UnauthorizedException("Password is incorrect");
    }
    const counter = verifyTotp(decryptSecret(record.mfaSecretEnc, key), code, {
      lastAcceptedCounter: record.mfaLastCounter,
    });
    if (counter === null) throw new BadRequestException("Invalid authentication code");

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: { mfaEnabled: false, mfaSecretEnc: null, mfaPendingSecretEnc: null, mfaLastCounter: null },
      }),
      this.prisma.auditLog.create({
        data: {
          organizationId: user.organizationId,
          actorUserId: user.id,
          action: "auth.mfa.disabled",
          resourceType: "User",
          resourceId: user.id,
          metadata: { method: "TOTP" },
        },
      }),
    ]);
    return { enabled: false };
  }

  /** Emis par AuthService.login pour un compte MFA active : aucun cookie de session avant le code. */
  async issueChallenge(userId: string, metadata: RequestMetadata): Promise<string> {
    const { plainToken, tokenHash } = createSessionToken();
    await this.prisma.mfaChallenge.create({
      data: {
        userId,
        tokenHash,
        expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
      },
    });
    return plainToken;
  }

  /** Verifie le code du defi et ouvre la session (usage unique, 5 essais max). */
  async completeChallenge(body: unknown, metadata: RequestMetadata) {
    const key = this.requireKey();
    const input = assertBody(body);
    const token = requiredText(input.challengeToken, "challengeToken", 200);
    const code = requiredText(input.code, "code", 12);
    const challenge = await this.prisma.mfaChallenge.findUnique({
      where: { tokenHash: hashSessionToken(token) },
      include: { user: true },
    });
    if (!challenge || challenge.consumedAt || challenge.expiresAt < new Date() || !challenge.user.isActive) {
      throw new UnauthorizedException("MFA challenge is invalid or expired");
    }
    if (challenge.attempts >= CHALLENGE_MAX_ATTEMPTS) {
      throw new HttpException("Too many invalid codes. Sign in again.", HttpStatus.TOO_MANY_REQUESTS);
    }
    const user = challenge.user;
    if (!user.mfaEnabled || !user.mfaSecretEnc) throw new UnauthorizedException("MFA challenge is invalid");

    const counter = verifyTotp(decryptSecret(user.mfaSecretEnc, key), code, {
      lastAcceptedCounter: user.mfaLastCounter,
    });
    if (counter === null) {
      await this.prisma.$transaction([
        this.prisma.mfaChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } }),
        this.prisma.auditLog.create({
          data: {
            organizationId: user.organizationId,
            actorUserId: user.id,
            action: "auth.mfa.failed",
            resourceType: "User",
            resourceId: user.id,
            metadata: { ipAddress: metadata.ipAddress },
          },
        }),
      ]);
      throw new UnauthorizedException("Invalid authentication code");
    }

    const { plainToken, tokenHash } = createSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await this.prisma.$transaction(async (tx) => {
      // Consommation atomique : un defi ne peut ouvrir qu'une seule session.
      const consumed = await tx.mfaChallenge.updateMany({
        where: { id: challenge.id, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      if (consumed.count !== 1) throw new UnauthorizedException("MFA challenge already used");
      await tx.user.update({ where: { id: user.id }, data: { mfaLastCounter: counter, lastLoginAt: new Date() } });
      await tx.session.create({
        data: { userId: user.id, tokenHash, expiresAt, ipAddress: metadata.ipAddress, userAgent: metadata.userAgent },
      });
      await tx.auditLog.create({
        data: {
          organizationId: user.organizationId,
          actorUserId: user.id,
          action: "auth.login.succeeded",
          resourceType: "Session",
          resourceId: tokenHash,
          metadata: { outcome: "SUCCESS", mfa: "TOTP", ipAddress: metadata.ipAddress, userAgent: metadata.userAgent },
        },
      });
    });

    return {
      plainToken,
      expiresAt,
      user: { id: user.id, email: user.email, fullName: user.fullName, organizationId: user.organizationId },
    };
  }
}
