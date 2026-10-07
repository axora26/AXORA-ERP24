import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CORE_PERMISSIONS } from "@axora24/contracts";
import { totpCode } from "@axora24/security";
import { as, createHarness, registerTenant, type Harness, type Tenant } from "./support/harness.js";
import { createUserWith } from "./support/fixtures.js";

describe("MFA step-up et politique d'organisation (e2e)", () => {
  let harness: Harness;
  let tenant: Tenant;
  let secret = "";

  beforeAll(async () => {
    process.env.MFA_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
    harness = await createHarness();
    tenant = await registerTenant(harness, "mfa-step-up");
    const setup = await as(harness, tenant).post("/auth/mfa/setup", { password: tenant.password });
    expect(setup.status).toBe(201);
    secret = setup.body.secret as string;
    const enabled = await as(harness, tenant).post("/auth/mfa/enable", {
      password: tenant.password,
      code: totpCode(secret),
    });
    expect(enabled.status).toBe(201);
  });

  afterAll(async () => {
    await harness.close();
  });

  it("élève uniquement la session courante après un nouveau TOTP valide", async () => {
    const code = totpCode(secret, Date.now() + 30_000);
    const response = await as(harness, tenant).post("/auth/mfa/step-up", { code });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ verified: true });
    expect(Date.parse(response.body.verifiedAt)).not.toBeNaN();

    const sessions = await harness.prisma.$queryRaw<Array<{ mfaVerifiedAt: Date | null }>>`
      SELECT "mfaVerifiedAt" FROM "sessions"
      WHERE "userId" = ${tenant.userId} AND "revokedAt" IS NULL
    `;
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.mfaVerifiedAt).toBeInstanceOf(Date);

    const audit = await harness.prisma.auditLog.findMany({
      where: { organizationId: tenant.organizationId, action: "auth.mfa.step_up.succeeded" },
    });
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain(code);
    expect(JSON.stringify(audit)).not.toContain(secret);
  });

  it("protège les mutations critiques même avant qu'une politique MFA soit obligatoire", async () => {
    await harness.prisma.session.updateMany({ where: { userId: tenant.userId }, data: { mfaVerifiedAt: null } });
    const denied = await as(harness, tenant).post("/admin/roles", { name: "Rôle critique", permissions: [] });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("MFA_STEP_UP_REQUIRED");
  });

  it("sérialise l'activation de la politique avec la désactivation MFA du même administrateur", async () => {
    const enrolled = await harness.prisma.user.findUniqueOrThrow({ where: { id: tenant.userId } });
    await harness.prisma.organization.update({ where: { id: tenant.organizationId }, data: { mfaRequired: false } });
    await harness.prisma.user.update({
      where: { id: tenant.userId },
      data: { mfaEnabled: true, mfaSecretEnc: enrolled.mfaSecretEnc, mfaLastCounter: Math.floor(Date.now() / 30_000) - 2 },
    });
    await harness.prisma.session.updateMany({ where: { userId: tenant.userId }, data: { mfaVerifiedAt: new Date() } });

    let invariant: { mfaRequired: boolean; mfaEnabled: boolean } | undefined;
    try {
      await Promise.all([
        as(harness, tenant).patch("/organizations/me/security-policy", { mfaRequired: true }),
        as(harness, tenant).post("/auth/mfa/disable", { password: tenant.password, code: totpCode(secret) }),
      ]);
      const organization = await harness.prisma.organization.findUniqueOrThrow({ where: { id: tenant.organizationId } });
      const actor = await harness.prisma.user.findUniqueOrThrow({ where: { id: tenant.userId } });
      invariant = { mfaRequired: organization.mfaRequired, mfaEnabled: actor.mfaEnabled };
    } finally {
      await harness.prisma.organization.update({ where: { id: tenant.organizationId }, data: { mfaRequired: false } });
      await harness.prisma.user.update({
        where: { id: tenant.userId },
        data: {
          mfaEnabled: true,
          mfaSecretEnc: enrolled.mfaSecretEnc,
          mfaLastCounter: Math.floor(Date.now() / 30_000) - 2,
          mfaRecoveryCodeHashes: enrolled.mfaRecoveryCodeHashes,
        },
      });
    }

    expect(invariant).not.toEqual({ mfaRequired: true, mfaEnabled: false });
  });

  it("exige un step-up pour activer la politique MFA de l'organisation", async () => {
    const auditBefore = await harness.prisma.auditLog.count({
      where: { organizationId: tenant.organizationId, action: "organization.security.mfa_policy.updated" },
    });
    await harness.prisma.session.updateMany({ where: { userId: tenant.userId }, data: { mfaVerifiedAt: null } });

    const denied = await as(harness, tenant).patch("/organizations/me/security-policy", { mfaRequired: true });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("MFA_STEP_UP_REQUIRED");

    // Préparation de test : libérer un pas TOTP frais après le tracer précédent.
    await harness.prisma.user.update({ where: { id: tenant.userId }, data: { mfaLastCounter: Math.floor(Date.now() / 30_000) - 2 } });
    expect((await as(harness, tenant).post("/auth/mfa/step-up", { code: totpCode(secret) })).status).toBe(201);

    const updated = await as(harness, tenant).patch("/organizations/me/security-policy", { mfaRequired: true });
    expect(updated.status).toBe(200);
    expect(updated.body.mfaRequired).toBe(true);
    expect((await as(harness, tenant).get("/organizations/me")).body.mfaRequired).toBe(true);
    expect((await as(harness, tenant).get("/auth/mfa")).body.requiredByOrganization).toBe(true);
    expect(await harness.prisma.auditLog.count({
      where: { organizationId: tenant.organizationId, action: "organization.security.mfa_policy.updated" },
    })).toBe(auditBefore + 1);
  });

  it("protège les mutations RBAC et interdit de désactiver la MFA obligatoire", async () => {
    await harness.prisma.session.updateMany({ where: { userId: tenant.userId }, data: { mfaVerifiedAt: null } });
    const denied = await as(harness, tenant).post("/admin/roles", { name: "Sécurité sensible", permissions: [] });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("MFA_STEP_UP_REQUIRED");

    const disable = await as(harness, tenant).post("/auth/mfa/disable", {
      password: tenant.password,
      code: totpCode(secret),
    });
    expect(disable.status).toBe(409);

    await harness.prisma.user.update({ where: { id: tenant.userId }, data: { mfaLastCounter: Math.floor(Date.now() / 30_000) - 2 } });
    expect((await as(harness, tenant).post("/auth/mfa/step-up", { code: totpCode(secret) })).status).toBe(201);
    const allowed = await as(harness, tenant).post("/admin/roles", { name: "Sécurité sensible", permissions: [] });
    expect(allowed.status).toBe(201);
  });

  it("limite un compte non enrôlé aux routes nécessaires à son enrôlement", async () => {
    const collaborator = await createUserWith(harness, tenant, [CORE_PERMISSIONS.COMPANY_MANAGE], "mfa-required");

    const contextBefore = await as(harness, collaborator).get("/auth/context");
    expect(contextBefore.status).toBe(200);
    expect(contextBefore.body.mfaEnrollmentRequired).toBe(true);
    expect((await as(harness, collaborator).get("/auth/me")).status).toBe(200);
    expect((await as(harness, collaborator).get("/auth/mfa")).status).toBe(200);
    const blocked = await as(harness, collaborator).get("/admin/companies");
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("MFA_ENROLLMENT_REQUIRED");

    const setup = await as(harness, collaborator).post("/auth/mfa/setup", { password: collaborator.password });
    expect(setup.status).toBe(201);
    const enabled = await as(harness, collaborator).post("/auth/mfa/enable", {
      password: collaborator.password,
      code: totpCode(setup.body.secret),
    });
    expect(enabled.status).toBe(201);
    expect((await as(harness, collaborator).get("/auth/context")).body.mfaEnrollmentRequired).toBe(false);
    expect((await as(harness, collaborator).get("/admin/companies")).status).toBe(200);
  });
});
