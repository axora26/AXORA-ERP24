import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateRecoveryCodes, loginThrottleKey, totpCode } from "@axora24/security";
import { as, createHarness, registerTenant, type Harness, type Tenant } from "./support/harness.js";
import { createUserWith } from "./support/fixtures.js";
import { signWebhook } from "../src/workflow/engine.js";
import { AdminService } from "../src/admin/admin.service.js";

describe("Identity and delegated credentials hardening", () => {
  let harness: Harness;
  const previousLimit = process.env.REGISTRATION_LIMIT;
  const clientIp = () => `2001:db8:${randomBytes(12).toString("hex").match(/.{4}/g)!.join(":")}`;
  beforeAll(async () => {
    process.env.REGISTRATION_LIMIT = "5";
    process.env.MFA_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
    harness = await createHarness();
  });
  afterAll(async () => {
    if (previousLimit === undefined) delete process.env.REGISTRATION_LIMIT; else process.env.REGISTRATION_LIMIT = previousLimit;
    await harness.close();
  });

  async function enroll(label: string) {
    const tenant = await registerTenant(harness, label);
    const setup = await as(harness, tenant).post("/auth/mfa/setup", { password: tenant.password });
    expect(setup.status).toBe(201);
    const enabled = await as(harness, tenant).post("/auth/mfa/enable", { password: tenant.password, code: totpCode(setup.body.secret) });
    expect(enabled.status).toBe(201);
    return { tenant, secret: setup.body.secret as string, codes: enabled.body.recoveryCodes as string[] };
  }
  async function challenge(tenant: Tenant) {
    const login = await harness.http().post("/api/v1/auth/login").send({ email: tenant.email, password: tenant.password });
    expect(login.status).toBe(201);
    expect(login.body.mfaRequired).toBe(true);
    return login.body.challengeToken as string;
  }
  const recover = (challengeToken: string, recoveryCode: string) => harness.http().post("/api/v1/auth/mfa/verify").send({ challengeToken, recoveryCode });

  it("setup and enable require fresh password, expose ten codes once and audit no secrets", async () => {
    const tenant = await registerTenant(harness, "reauth-enrollment");
    expect((await as(harness, tenant).post("/auth/mfa/setup")).status).toBe(400);
    expect((await as(harness, tenant).post("/auth/mfa/setup", { password: "WrongPassword2026!" })).status).toBe(401);
    expect((await harness.prisma.user.findUniqueOrThrow({ where: { id: tenant.userId } })).mfaPendingSecretEnc).toBeNull();
    const setup = await as(harness, tenant).post("/auth/mfa/setup", { password: tenant.password });
    const code = totpCode(setup.body.secret);
    expect((await as(harness, tenant).post("/auth/mfa/enable", { password: "WrongPassword2026!", code })).status).toBe(401);
    const enabled = await as(harness, tenant).post("/auth/mfa/enable", { password: tenant.password, code });
    expect(enabled.status).toBe(201);
    expect(enabled.body.recoveryCodes).toHaveLength(10);
    const stored = await harness.prisma.user.findUniqueOrThrow({ where: { id: tenant.userId } });
    expect(stored.mfaRecoveryCodeHashes).toHaveLength(10);
    expect(stored.mfaRecoveryCodeHashes.every((hash) => /^[a-f0-9]{64}$/.test(hash))).toBe(true);
    const status = await as(harness, tenant).get("/auth/mfa");
    expect(status.body.recoveryCodesRemaining).toBe(10);
    expect(status.body.recoveryCodes).toBeUndefined();
    const audit = await harness.prisma.auditLog.findMany({ where: { organizationId: tenant.organizationId } });
    expect(audit.map((entry) => entry.action)).toEqual(expect.arrayContaining(["auth.reauthentication.failed", "auth.mfa.setup.started", "auth.mfa.enabled"]));
    const serialized = JSON.stringify(audit);
    for (const value of [setup.body.secret, tenant.password, ...enabled.body.recoveryCodes]) expect(serialized).not.toContain(value);
  });

  it("the same recovery code opens one login under concurrent separate challenges", async () => {
    const { tenant, codes } = await enroll("recovery-race");
    const challenges = await Promise.all([challenge(tenant), challenge(tenant)]);
    const attempts = await Promise.all(challenges.map((token) => recover(token, codes[0]!)));
    expect(attempts.map((response) => response.status).sort()).toEqual([201, 401]);
    const recoveredSession = attempts.find((response) => response.status === 201)!;
    const protectedMutation = await as(harness, { cookie: recoveredSession.headers["set-cookie"] as unknown as string[] })
      .post("/admin/roles", { name: "Recovery must not elevate", permissions: [] });
    expect(protectedMutation.status).toBe(403);
    expect(protectedMutation.body.code).toBe("MFA_STEP_UP_REQUIRED");
    expect((await as(harness, tenant).get("/auth/mfa")).body.recoveryCodesRemaining).toBe(9);
    expect((await recover(await challenge(tenant), codes[0]!)).status).toBe(401);
    expect((await recover(await challenge(tenant), codes[1]!.toLowerCase().replaceAll("-", " "))).status).toBe(201);
    const audit = await harness.prisma.auditLog.findMany({ where: { organizationId: tenant.organizationId, action: "auth.mfa.recovery.used" } });
    expect(audit).toHaveLength(2);
    expect(JSON.stringify(audit)).not.toContain(codes[0]);
  });

  it("regeneration needs password plus unreplayed TOTP, invalidates old codes and other sessions", async () => {
    const { tenant, codes, secret } = await enroll("recovery-regenerate");
    const login = await recover(await challenge(tenant), codes[0]!);
    const oldSession = { cookie: login.headers["set-cookie"] as unknown as string[] };
    expect((await as(harness, tenant).post("/auth/mfa/recovery-codes", { password: "WrongPassword2026!", code: totpCode(secret) })).status).toBe(401);
    expect((await as(harness, tenant).post("/auth/mfa/recovery-codes", { password: tenant.password, code: "invalid" })).status).toBe(400);
    const updated = await as(harness, tenant).post("/auth/mfa/recovery-codes", { password: tenant.password, code: totpCode(secret, Date.now() + 30_000) });
    expect(updated.status).toBe(201);
    expect(updated.body.recoveryCodes).toHaveLength(10);
    expect((await as(harness, oldSession).get("/auth/me")).status).toBe(401);
    expect((await recover(await challenge(tenant), codes[1]!)).status).toBe(401);
    expect((await recover(await challenge(tenant), updated.body.recoveryCodes[0])).status).toBe(201);
    expect(await harness.prisma.auditLog.count({ where: { organizationId: tenant.organizationId, action: "auth.mfa.recovery.regenerated" } })).toBe(1);
  });

  it("invalid recovery codes consume the shared MFA budget across newly issued challenges", async () => {
    const { tenant } = await enroll("recovery-budget");
    const wrong = generateRecoveryCodes().codes[0]!;
    for (let index = 0; index < 6; index++) expect((await recover(await challenge(tenant), wrong)).status).toBe(index < 5 ? 401 : 429);
    expect((await harness.prisma.user.findUniqueOrThrow({ where: { id: tenant.userId } })).mfaRecoveryCodeHashes).toHaveLength(10);
  });

  it("disabling with a recovery code requires password and removes the entire recovery batch", async () => {
    const { tenant, codes } = await enroll("recovery-disable");
    expect((await as(harness, tenant).post("/auth/mfa/disable", { password: "WrongPassword2026!", recoveryCode: codes[0] })).status).toBe(401);
    expect((await as(harness, tenant).post("/auth/mfa/disable", { password: tenant.password, recoveryCode: codes[0] })).status).toBe(201);
    expect((await harness.prisma.user.findUniqueOrThrow({ where: { id: tenant.userId } })).mfaRecoveryCodeHashes).toEqual([]);
    expect((await as(harness, tenant).get("/auth/mfa")).body).toMatchObject({ enabled: false, recoveryCodesRemaining: 0 });
  });

  it("registration reserves its persistent budget atomically and counts successful signups", async () => {
    const ip = clientIp();
    const request = () => harness.http().post("/api/v1/auth/register-organization").set("X-Forwarded-For", ip);
    const slug = `budget-${Date.now()}`;
    expect((await request().send({ organizationName: "Budget", organizationSlug: slug, companyName: "Budget", ownerFullName: "Owner", ownerEmail: `${slug}@test.com`, ownerPassword: "StrongBudgetPass2026!" })).status).toBe(201);
    for (let index = 0; index < 4; index++) expect((await request().send({})).status).toBe(400);
    const blocked = await request().send({});
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
    const burstIp = clientIp();
    const burst = await Promise.all(Array.from({ length: 10 }, () => harness.http().post("/api/v1/auth/register-organization").set("X-Forwarded-For", burstIp).send({})));
    expect(burst.filter((response) => response.status === 400)).toHaveLength(5);
    expect(burst.filter((response) => response.status === 429)).toHaveLength(5);
    expect((await harness.prisma.loginThrottle.findUniqueOrThrow({ where: { keyHash: loginThrottleKey("register-organization", burstIp) } })).failureCount).toBe(5);
    expect((await harness.http().post("/api/v1/auth/register-organization").set("X-Forwarded-For", clientIp()).send({})).status).toBe(400);
  });

  it("untrusted forwarded addresses cannot evade the production peer-IP policy", async () => {
    const express = harness.app.getHttpAdapter().getInstance();
    express.set("trust proxy", false);
    await harness.prisma.loginThrottle.deleteMany({ where: { keyHash: { in: ["127.0.0.1", "::ffff:127.0.0.1"].map((ip) => loginThrottleKey("register-organization", ip)) } } });
    try {
      for (let index = 0; index < 6; index++) {
        const response = await harness.http().post("/api/v1/auth/register-organization").set("X-Forwarded-For", clientIp()).send({});
        expect(response.status).toBe(index < 5 ? 400 : 429);
      }
    } finally {
      express.set("trust proxy", "loopback");
      await harness.prisma.loginThrottle.deleteMany({ where: { keyHash: { in: ["127.0.0.1", "::ffff:127.0.0.1"].map((ip) => loginThrottleKey("register-organization", ip)) } } });
    }
  });

  it("API keys and inbound endpoints cannot reuse another company's or a project's grants", async () => {
    const owner = await registerTenant(harness, "delegation-scope");
    const other = await as(harness, owner).post("/admin/companies", { name: "Other delegation company" });
    const actor = await createUserWith(harness, owner, ["integrations.apikey.manage", "integrations.inbound.manage", "projects.project.read", "crm.lead.manage"], "delegator");
    await harness.prisma.companyMembership.create({ data: { userId: actor.userId, companyId: other.body.id } });
    await harness.prisma.roleAssignment.updateMany({ where: { userId: actor.userId }, data: { companyId: owner.companyId } });
    const issued = await as(harness, actor).post(`/integrations/api-keys?companyId=${owner.companyId}`, { name: "Scoped key", permissions: ["projects.project.read"] });
    expect(issued.status).toBe(201);
    const endpoint = await as(harness, actor).post(`/integrations/inbound?companyId=${owner.companyId}`, { name: "Scoped inbound" });
    expect(endpoint.status).toBe(201);
    const projects = () => harness.http().get("/api/v1/public/projects").set("Authorization", `Bearer ${issued.body.secret}`);
    const inbound = (id: string) => {
      const raw = JSON.stringify({ id, type: "crm.lead", data: { contactName: "Scoped", companyName: "Webhook" } });
      const timestamp = String(Math.floor(Date.now() / 1000));
      return harness.http().post(endpoint.body.endpoint.path).set("Content-Type", "application/json").set("X-Axora-Timestamp", timestamp).set("X-Axora-Signature", signWebhook(endpoint.body.secret, timestamp, raw)).send(raw);
    };
    expect((await projects()).status).toBe(200);
    expect((await inbound("initial")).status).toBe(201);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const arrayWebhook = (secret: string) => harness.http().post(endpoint.body.endpoint.path).set("Content-Type", "application/json").set("X-Axora-Timestamp", timestamp).set("X-Axora-Signature", signWebhook(secret, timestamp, "[]")).send("[]");
    expect((await arrayWebhook("invalid-secret")).status).toBe(401);
    expect((await arrayWebhook(endpoint.body.secret)).status).toBe(400);
    await harness.prisma.roleAssignment.updateMany({ where: { userId: actor.userId }, data: { companyId: other.body.id } });
    expect((await projects()).status).toBe(403);
    expect((await inbound("other-company")).status).toBe(401);
    await harness.prisma.roleAssignment.updateMany({ where: { userId: actor.userId }, data: { companyId: owner.companyId, projectId: "qualification-project-scope" } });
    expect((await projects()).status).toBe(403);
    expect((await inbound("project-only")).status).toBe(401);
    await harness.prisma.roleAssignment.updateMany({ where: { userId: actor.userId }, data: { projectId: null } });
    const role = await harness.prisma.roleAssignment.findFirstOrThrow({ where: { userId: actor.userId } });
    await as(harness, owner).put(`/admin/roles/${role.roleId}/permissions`, { permissions: ["integrations.apikey.manage", "integrations.inbound.manage"] });
    expect((await projects()).status).toBe(403);
    expect((await inbound("revoked-grant")).status).toBe(401);
    expect(await harness.prisma.crmLead.count({ where: { organizationId: owner.organizationId, source: "Webhook : Scoped inbound" } })).toBe(1);
  });

  it("CRM and auth reject malformed JSON shapes before handlers while bodyless actions stay valid", async () => {
    const tenant = await registerTenant(harness, "json-shape");
    const lead = await as(harness, tenant).post("/crm/leads", { contactName: "JSON", companyName: "JSON validation" });
    expect(lead.status).toBe(201);
    for (const body of ["null", "[]", '"text"', "3", "false"]) {
      expect((await harness.http().post("/api/v1/crm/leads").set("Cookie", tenant.cookie).set("Content-Type", "application/json").send(body)).status).toBe(400);
      expect((await harness.http().patch(`/api/v1/crm/leads/${lead.body.id}/status`).set("Cookie", tenant.cookie).set("Content-Type", "application/json").send(body)).status).toBe(400);
      expect((await harness.http().post("/api/v1/auth/login").set("Content-Type", "application/json").send(body)).status).toBe(400);
    }
    expect((await as(harness, tenant).post("/crm/leads")).status).toBe(400);
    expect((await as(harness, tenant).post("/auth/logout")).status).toBe(201);
  });

  it("an admin request authorized before revocation cannot reactivate itself or mutate with stale grants", async () => {
    const owner = await registerTenant(harness, "admin-revocation");
    const actor = await createUserWith(harness, owner, ["core.user.manage", "core.company.manage"], "revoked-admin");
    // Snapshot models the identity already attached by SessionGuard before an
    // in-flight mutation waits for the organization's governance transaction.
    const snapshot = await harness.prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
    const admin = harness.app.get(AdminService);
    expect((await as(harness, owner).patch(`/admin/users/${actor.userId}`, { isActive: false })).status).toBe(200);
    await expect(admin.updateUser(snapshot, actor.userId, { isActive: true })).rejects.toMatchObject({ status: 403 });
    await expect(admin.createCompany(snapshot, { name: `Revoked company ${Date.now()}` })).rejects.toMatchObject({ status: 403 });
    expect((await harness.prisma.user.findUniqueOrThrow({ where: { id: actor.userId } })).isActive).toBe(false);
    expect((await as(harness, owner).patch(`/admin/users/${actor.userId}`, { isActive: true })).status).toBe(200);
    const assignment = await harness.prisma.roleAssignment.findFirstOrThrow({ where: { userId: actor.userId } });
    expect((await as(harness, owner).put(`/admin/roles/${assignment.roleId}/permissions`, { permissions: [] })).status).toBe(200);
    await expect(admin.updateUser(snapshot, owner.userId, { fullName: "Unauthorized mutation" })).rejects.toMatchObject({ status: 403 });
    expect((await harness.prisma.user.findUniqueOrThrow({ where: { id: owner.userId } })).fullName).not.toBe("Unauthorized mutation");
  });

  it("query and body company IDs cannot authorize one company while creating data in another", async () => {
    const owner = await registerTenant(harness, "mixed-company-scope");
    const second = await as(harness, owner).post("/admin/companies", { name: "Mixed company second" });
    const actor = await createUserWith(harness, owner, ["crm.lead.manage"], "mixed-scope-creator");
    await harness.prisma.companyMembership.create({ data: { userId: actor.userId, companyId: second.body.id } });
    await harness.prisma.roleAssignment.updateMany({ where: { userId: actor.userId }, data: { companyId: owner.companyId } });
    const payload = { contactName: "Scoped", companyName: "Forbidden mixed scope" };
    expect((await as(harness, actor).post(`/crm/leads?companyId=${owner.companyId}`, { ...payload, companyId: second.body.id })).status).toBe(400);
    expect((await as(harness, actor).post(`/crm/leads?companyId=${second.body.id}`, { ...payload, companyId: second.body.id })).status).toBe(403);
    expect((await as(harness, actor).post(`/crm/leads?companyId=${owner.companyId}`, { ...payload, companyId: owner.companyId })).status).toBe(201);
    expect(await harness.prisma.crmLead.count({ where: { companyId: second.body.id, companyName: payload.companyName } })).toBe(0);
  });
});
