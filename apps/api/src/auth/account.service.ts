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
  generateRecoveryCodes,
  hashPassword,
  hashSessionToken,
  otpauthUri,
  parseEncryptionKey,
  verifyPassword,
  verifyTotp,
  recoveryCodeIndex,
} from "@axora24/security";
import type { Prisma } from "@axora24/database";
import { PrismaService } from "../core/prisma.service.js";
import { assertBody, requiredText } from "../common/validation.js";
import { credentialPassword } from "./credentials.js";
import type { AuthenticatedUser } from "./session.guard.js";
import type { RequestMetadata } from "./auth.service.js";
import { SESSION_MAX_AGE_MS, SESSION_IDLE_MS } from "./session-policy.js";
import { LoginThrottleService } from "./login-throttle.service.js";

const MFA_ISSUER = "AXORA-ERP24";
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const CHALLENGE_MAX_ATTEMPTS = 5;
const SESSION_TTL_MS = SESSION_MAX_AGE_MS;

type SecondFactor = { method: "TOTP" | "RECOVERY"; value: string };
function secondFactor(input: Record<string, unknown>): SecondFactor {
  if ((input.code !== undefined) === (input.recoveryCode !== undefined)) throw new BadRequestException("Provide exactly one authentication code or recovery code");
  return input.recoveryCode !== undefined
    ? { method: "RECOVERY", value: requiredText(input.recoveryCode, "recoveryCode", 128) }
    : { method: "TOTP", value: requiredText(input.code, "code", 12) };
}

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
  constructor(private readonly prisma: PrismaService, private readonly throttle: LoginThrottleService) {}

  async preferences(user: AuthenticatedUser) {
    const record = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { themePreference: true } });
    return { theme: record.themePreference };
  }

  async updatePreferences(user: AuthenticatedUser, body: unknown) {
    const input = assertBody(body);
    if (Object.keys(input).some((key) => key !== "theme")) throw new BadRequestException("Unknown preference");
    // This contract is deliberately case-sensitive; do not silently accept other values.
    if (!["light", "dark", "system"].includes(String(input.theme))) throw new BadRequestException("Invalid theme preference");
    const theme = requiredText(input.theme, "theme", 6);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: user.id }, data: { themePreference: theme } }),
      this.prisma.auditLog.create({ data: { organizationId: user.organizationId, actorUserId: user.id, action: "auth.preferences.updated", resourceType: "User", resourceId: user.id, metadata: { theme } } }),
    ]);
    return { theme };
  }

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

  private async reauthenticate(user: AuthenticatedUser, input: Record<string, unknown>, metadata: RequestMetadata) {
    const password = credentialPassword(input.password, "password");
    const subject = `reauth:mfa:${user.id}`;
    await this.throttle.enforce(subject, metadata.ipAddress);
    const record = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!(await verifyPassword(password, record.passwordHash))) {
      await this.throttle.recordFailure(subject, metadata.ipAddress);
      await this.prisma.auditLog.create({ data: { organizationId: user.organizationId, actorUserId: user.id, action: "auth.reauthentication.failed", resourceType: "User", resourceId: user.id, metadata: { ipAddress: metadata.ipAddress } } });
      throw new UnauthorizedException("Password is incorrect");
    }
    await this.throttle.recordSuccess(subject, metadata.ipAddress);
    return record;
  }

  /** Lock user before challenges/sessions everywhere, including recovery-code consumption. */
  private async lockedUser(tx: Prisma.TransactionClient, userId: string) {
    await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${userId} FOR UPDATE`;
    return tx.user.findUniqueOrThrow({ where: { id: userId } });
  }

  private factorUpdate(record: Awaited<ReturnType<AccountService["lockedUser"]>>, factor: SecondFactor): Prisma.UserUpdateInput | null {
    if (!record.isActive || !record.mfaEnabled) return null;
    if (factor.method === "RECOVERY") {
      const index = recoveryCodeIndex(factor.value, record.mfaRecoveryCodeHashes);
      return index < 0 ? null : { mfaRecoveryCodeHashes: record.mfaRecoveryCodeHashes.filter((_hash, position) => position !== index) };
    }
    if (!record.mfaSecretEnc) return null;
    const counter = verifyTotp(decryptSecret(record.mfaSecretEnc, this.requireKey()), factor.value, { lastAcceptedCounter: record.mfaLastCounter });
    return counter === null ? null : { mfaLastCounter: counter };
  }

  private async recordFactorFailure(user: AuthenticatedUser, metadata: RequestMetadata) {
    await this.throttle.recordFailure(`mfa:${user.id}`, metadata.ipAddress);
    await this.prisma.auditLog.create({ data: { organizationId: user.organizationId, actorUserId: user.id, action: "auth.mfa.failed", resourceType: "User", resourceId: user.id, metadata: { ipAddress: metadata.ipAddress } } });
  }

  async changePassword(user: AuthenticatedUser, body: unknown, currentTokenHash: string | null) {
    const input = assertBody(body);
    const currentPassword = credentialPassword(input.currentPassword, "currentPassword");
    const newPassword = credentialPassword(input.newPassword, "newPassword", 12);
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
      this.prisma.mfaChallenge.updateMany({ where: { userId: user.id, consumedAt: null }, data: { consumedAt: new Date() } }),
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
      select: { mfaEnabled: true, mfaPendingSecretEnc: true, mfaRecoveryCodeHashes: true },
    });
    return {
      enabled: record.mfaEnabled,
      pendingSetup: record.mfaPendingSecretEnc !== null,
      available: this.key() !== null,
      recoveryCodesRemaining: record.mfaRecoveryCodeHashes.length,
    };
  }

  /** Genere un secret en attente ; il n'est affiche qu'une fois, puis seulement stocke chiffre. */
  async startMfaSetup(user: AuthenticatedUser, body: unknown, metadata: RequestMetadata) {
    const key = this.requireKey();
    const record = await this.reauthenticate(user, assertBody(body), metadata);
    if (record.mfaEnabled) throw new BadRequestException("MFA is already enabled");
    const secret = generateTotpSecret();
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.user.updateMany({ where: { id: user.id, isActive: true, mfaEnabled: false, passwordHash: record.passwordHash }, data: { mfaPendingSecretEnc: encryptSecret(secret, key) } });
      if (changed.count !== 1) throw new UnauthorizedException("Account changed; authenticate again");
      await tx.auditLog.create({ data: { organizationId: user.organizationId, actorUserId: user.id, action: "auth.mfa.setup.started", resourceType: "User", resourceId: user.id, metadata: { passwordReauthenticated: true } } });
    });
    return { secret, otpauthUri: otpauthUri(MFA_ISSUER, record.email, secret) };
  }

  async enableMfa(user: AuthenticatedUser, body: unknown, metadata: RequestMetadata, currentTokenHash: string | null = null) {
    const key = this.requireKey();
    const input = assertBody(body);
    const code = requiredText(input.code, "code", 12);
    const record = await this.reauthenticate(user, input, metadata);
    await this.throttle.enforce(`mfa:${user.id}`, metadata.ipAddress);
    if (record.mfaEnabled) throw new BadRequestException("MFA is already enabled");
    if (!record.mfaPendingSecretEnc) throw new BadRequestException("Start the MFA setup first");

    const secret = decryptSecret(record.mfaPendingSecretEnc, key);
    const counter = verifyTotp(secret, code);
    if (counter === null) {
      await this.recordFactorFailure(user, metadata);
      throw new BadRequestException("Invalid authentication code");
    }
    const recovery = generateRecoveryCodes();

    await this.prisma.$transaction(async (tx) => {
      const enabled = await tx.user.updateMany({
        where: { id: user.id, isActive: true, passwordHash: record.passwordHash, mfaEnabled: false, mfaPendingSecretEnc: record.mfaPendingSecretEnc },
        data: { mfaEnabled: true, mfaSecretEnc: record.mfaPendingSecretEnc, mfaPendingSecretEnc: null, mfaLastCounter: counter, mfaRecoveryCodeHashes: recovery.hashes },
      });
      if (enabled.count !== 1) throw new BadRequestException("MFA setup changed; start again");
      await tx.session.updateMany({ where: { userId: user.id, revokedAt: null, ...(currentTokenHash ? { NOT: { tokenHash: currentTokenHash } } : {}) }, data: { revokedAt: new Date() } });
      await tx.mfaChallenge.updateMany({ where: { userId: user.id, consumedAt: null }, data: { consumedAt: new Date() } });
      await tx.auditLog.create({
        data: {
          organizationId: user.organizationId,
          actorUserId: user.id,
          action: "auth.mfa.enabled",
          resourceType: "User",
          resourceId: user.id,
          metadata: { method: "TOTP", recoveryCodes: recovery.hashes.length, passwordReauthenticated: true },
        },
      });
    });
    await this.throttle.recordSuccess(`mfa:${user.id}`, metadata.ipAddress);
    return { enabled: true, recoveryCodes: recovery.codes };
  }

  async disableMfa(user: AuthenticatedUser, body: unknown, metadata: RequestMetadata, currentTokenHash: string | null = null) {
    const input = assertBody(body);
    const factor = secondFactor(input);
    const authenticated = await this.reauthenticate(user, input, metadata);
    if (!authenticated.mfaEnabled) throw new BadRequestException("MFA is not enabled");
    await this.throttle.enforce(`mfa:${user.id}`, metadata.ipAddress);
    const disabled = await this.prisma.$transaction(async (tx) => {
      const record = await this.lockedUser(tx, user.id);
      if (record.passwordHash !== authenticated.passwordHash) throw new UnauthorizedException("Account changed; authenticate again");
      if (!this.factorUpdate(record, factor)) return false;
      await tx.user.update({ where: { id: user.id }, data: { mfaEnabled: false, mfaSecretEnc: null, mfaPendingSecretEnc: null, mfaLastCounter: null, mfaRecoveryCodeHashes: [] } });
      await tx.session.updateMany({ where: { userId: user.id, revokedAt: null, ...(currentTokenHash ? { NOT: { tokenHash: currentTokenHash } } : {}) }, data: { revokedAt: new Date() } });
      await tx.mfaChallenge.updateMany({ where: { userId: user.id, consumedAt: null }, data: { consumedAt: new Date() } });
      await tx.auditLog.create({
        data: {
          organizationId: user.organizationId,
          actorUserId: user.id,
          action: "auth.mfa.disabled",
          resourceType: "User",
          resourceId: user.id,
          metadata: { method: factor.method, passwordReauthenticated: true },
        },
      });
      return true;
    });
    if (!disabled) {
      await this.recordFactorFailure(user, metadata);
      throw new BadRequestException("Invalid authentication code");
    }
    await this.throttle.recordSuccess(`mfa:${user.id}`, metadata.ipAddress);
    return { enabled: false };
  }

  async regenerateRecoveryCodes(user: AuthenticatedUser, body: unknown, metadata: RequestMetadata, currentTokenHash: string | null = null) {
    const input = assertBody(body);
    // A current TOTP, together with password reauthentication, protects replacing the recovery factor.
    const factor: SecondFactor = { method: "TOTP", value: requiredText(input.code, "code", 12) };
    const authenticated = await this.reauthenticate(user, input, metadata);
    if (!authenticated.mfaEnabled) throw new BadRequestException("MFA is not enabled");
    await this.throttle.enforce(`mfa:${user.id}`, metadata.ipAddress);
    const recovery = generateRecoveryCodes();
    const regenerated = await this.prisma.$transaction(async (tx) => {
      const record = await this.lockedUser(tx, user.id);
      if (record.passwordHash !== authenticated.passwordHash) throw new UnauthorizedException("Account changed; authenticate again");
      const factorData = this.factorUpdate(record, factor);
      if (!factorData) return false;
      await tx.user.update({ where: { id: user.id }, data: { ...factorData, mfaRecoveryCodeHashes: recovery.hashes } });
      await tx.session.updateMany({ where: { userId: user.id, revokedAt: null, ...(currentTokenHash ? { NOT: { tokenHash: currentTokenHash } } : {}) }, data: { revokedAt: new Date() } });
      await tx.mfaChallenge.updateMany({ where: { userId: user.id, consumedAt: null }, data: { consumedAt: new Date() } });
      await tx.auditLog.create({ data: { organizationId: user.organizationId, actorUserId: user.id, action: "auth.mfa.recovery.regenerated", resourceType: "User", resourceId: user.id, metadata: { count: recovery.hashes.length, passwordReauthenticated: true } } });
      return true;
    });
    if (!regenerated) {
      await this.recordFactorFailure(user, metadata);
      throw new BadRequestException("Invalid authentication code");
    }
    await this.throttle.recordSuccess(`mfa:${user.id}`, metadata.ipAddress);
    return { recoveryCodes: recovery.codes };
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
    const input = assertBody(body);
    const token = requiredText(input.challengeToken, "challengeToken", 200);
    const factor = secondFactor(input);
    const challenge = await this.prisma.mfaChallenge.findUnique({
      where: { tokenHash: hashSessionToken(token) },
      include: { user: true },
    });
    if (!challenge || challenge.consumedAt || challenge.expiresAt <= new Date() || !challenge.user.isActive) {
      throw new UnauthorizedException("MFA challenge is invalid or expired");
    }
    if (challenge.attempts >= CHALLENGE_MAX_ATTEMPTS) {
      throw new HttpException("Too many invalid codes. Sign in again.", HttpStatus.TOO_MANY_REQUESTS);
    }
    const user = challenge.user;
    if (!user.mfaEnabled) throw new UnauthorizedException("MFA challenge is invalid");
    // Reissuing a fresh password challenge must not reset the second-factor
    // failure budget. This counter is shared across all challenges for a user.
    const throttleSubject = `mfa:${user.id}`;
    await this.throttle.enforce(throttleSubject, metadata.ipAddress);

    const { plainToken, tokenHash } = createSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    const opened = await this.prisma.$transaction(async (tx) => {
      const current = await this.lockedUser(tx, user.id);
      const factorData = this.factorUpdate(current, factor);
      if (!factorData) return false;
      // Consommation atomique : un defi ne peut ouvrir qu'une seule session.
      const consumed = await tx.mfaChallenge.updateMany({
        where: { id: challenge.id, consumedAt: null, expiresAt: { gt: new Date() }, attempts: { lt: CHALLENGE_MAX_ATTEMPTS } },
        data: { consumedAt: new Date() },
      });
      if (consumed.count !== 1) throw new UnauthorizedException("MFA challenge already used");
      // The same locked user row serializes different challenges, TOTP counters
      // and recovery batches so each factor can authorize one login only.
      await tx.user.update({ where: { id: user.id }, data: { ...factorData, lastLoginAt: new Date() } });
      await tx.session.create({
        data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + SESSION_IDLE_MS), ipAddress: metadata.ipAddress, userAgent: metadata.userAgent },
      });
      await tx.auditLog.create({
        data: {
          organizationId: user.organizationId,
          actorUserId: user.id,
          action: "auth.login.succeeded",
          resourceType: "Session",
          resourceId: tokenHash,
          metadata: { outcome: "SUCCESS", mfa: factor.method, ipAddress: metadata.ipAddress, userAgent: metadata.userAgent },
        },
      });
      if (factor.method === "RECOVERY") await tx.auditLog.create({ data: { organizationId: user.organizationId, actorUserId: user.id, action: "auth.mfa.recovery.used", resourceType: "User", resourceId: user.id, metadata: { remaining: current.mfaRecoveryCodeHashes.length - 1, ipAddress: metadata.ipAddress } } });
      return true;
    });

    if (!opened) {
      await this.prisma.mfaChallenge.updateMany({ where: { id: challenge.id, consumedAt: null, attempts: { lt: CHALLENGE_MAX_ATTEMPTS } }, data: { attempts: { increment: 1 } } });
      await this.recordFactorFailure(user, metadata);
      throw new UnauthorizedException("Invalid authentication code");
    }

    await this.throttle.recordSuccess(throttleSubject, metadata.ipAddress);

    return {
      plainToken,
      expiresAt,
      user: { id: user.id, email: user.email, fullName: user.fullName, organizationId: user.organizationId },
    };
  }
}
