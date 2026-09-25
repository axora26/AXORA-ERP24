import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { totpCode } from "@axora24/security";
import { as, createHarness, registerTenant, type Harness, type Tenant } from "./support/harness.js";

/** INC-01 — MFA TOTP : enrolement, defi de connexion, anti-rejeu, desactivation. */
describe("MFA TOTP (e2e)", () => {
  let harness: Harness;
  let tenant: Tenant;
  let secret = "";

  beforeAll(async () => {
    process.env.MFA_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
    harness = await createHarness();
    tenant = await registerTenant(harness, "mfa");
  });

  afterAll(async () => {
    await harness.close();
  });

  function login() {
    return harness.http().post("/api/v1/auth/login").send({ email: tenant.email, password: tenant.password });
  }

  it("etat initial : MFA disponible mais non activee", async () => {
    const response = await as(harness, tenant).get("/auth/mfa");
    expect(response.body).toEqual({ enabled: false, pendingSetup: false, available: true });
  });

  it("enrolement : secret affiche une fois, stocke chiffre, active par un premier code valide", async () => {
    const setup = await as(harness, tenant).post("/auth/mfa/setup");
    expect(setup.status).toBe(201);
    secret = setup.body.secret;
    expect(setup.body.otpauthUri).toContain(`secret=${secret}`);

    const stored = await harness.prisma.user.findUniqueOrThrow({ where: { id: tenant.userId } });
    expect(stored.mfaPendingSecretEnc).toMatch(/^aes-256-gcm-v1\$/);
    expect(stored.mfaPendingSecretEnc).not.toContain(secret);

    const wrong = await as(harness, tenant).post("/auth/mfa/enable", { code: "000000" });
    expect(wrong.status).toBe(400);
    const enabled = await as(harness, tenant).post("/auth/mfa/enable", { code: totpCode(secret) });
    expect(enabled.status).toBe(201);
    expect(enabled.body.enabled).toBe(true);
  });

  it("connexion : le mot de passe seul n'ouvre aucune session", async () => {
    const response = await login();
    expect(response.status).toBe(201);
    expect(response.body.mfaRequired).toBe(true);
    expect(response.body.challengeToken).toBeTruthy();
    expect(response.headers["set-cookie"]).toBeUndefined();
  });

  it("code errone refuse et audite ; code valide ouvre la session ; defi a usage unique", async () => {
    const challenge = (await login()).body.challengeToken;
    const wrong = await harness.http().post("/api/v1/auth/mfa/verify").send({ challengeToken: challenge, code: "123456" });
    expect(wrong.status).toBe(401);

    const code = totpCode(secret, Date.now() + 30_000);
    const ok = await harness.http().post("/api/v1/auth/mfa/verify").send({ challengeToken: challenge, code });
    expect(ok.status).toBe(201);
    const cookie = ok.headers["set-cookie"] as unknown as string[];
    expect((await as(harness, { cookie }).get("/auth/me")).status).toBe(200);

    const reuse = await harness.http().post("/api/v1/auth/mfa/verify").send({ challengeToken: challenge, code });
    expect(reuse.status).toBe(401);

    // Anti-rejeu : le meme code sur un nouveau defi est refuse.
    const replayChallenge = (await login()).body.challengeToken;
    const replay = await harness.http().post("/api/v1/auth/mfa/verify").send({ challengeToken: replayChallenge, code });
    expect(replay.status).toBe(401);

    const audit = await harness.prisma.auditLog.findMany({
      where: { organizationId: tenant.organizationId, action: { startsWith: "auth.mfa" } },
      select: { action: true, metadata: true },
    });
    expect(audit.map((entry) => entry.action)).toEqual(expect.arrayContaining(["auth.mfa.enabled", "auth.mfa.failed"]));
    expect(JSON.stringify(audit)).not.toContain(secret);
  });

  it("le defi est bloque apres 5 codes errones", async () => {
    const challenge = (await login()).body.challengeToken;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await harness.http().post("/api/v1/auth/mfa/verify").send({ challengeToken: challenge, code: "000000" });
    }
    const blocked = await harness.http().post("/api/v1/auth/mfa/verify").send({ challengeToken: challenge, code: "000000" });
    expect(blocked.status).toBe(429);
  });

  it("desactivation : exige mot de passe ET code valide", async () => {
    const noPassword = await as(harness, tenant).post("/auth/mfa/disable", { password: "wrong-pass", code: "000000" });
    expect(noPassword.status).toBe(401);
    const disabled = await as(harness, tenant).post("/auth/mfa/disable", {
      password: tenant.password,
      code: totpCode(secret, Date.now() + 60_000),
    });
    // +60 s sort de la fenetre +/-1 pas : le code est refuse.
    expect(disabled.status).toBe(400);

    // Les pas deja consommes par les tests precedents sont "liberes" en
    // reculant le compteur anti-rejeu (preparation de test, pas de contournement produit).
    await harness.prisma.user.update({
      where: { id: tenant.userId },
      data: { mfaLastCounter: Math.floor(Date.now() / 30_000) - 2 },
    });
    const code = totpCode(secret);
    const ok = await as(harness, tenant).post("/auth/mfa/disable", { password: tenant.password, code });
    expect(ok.status).toBe(201);
    expect(ok.body.enabled).toBe(false);

    const plain = await login();
    expect(plain.body.user).toBeDefined();
    expect(plain.headers["set-cookie"]).toBeDefined();
  });
});
