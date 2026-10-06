import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashSessionToken, loginThrottleKey, totpCode } from "@axora24/security";
import { as, createHarness, registerTenant, type Harness, type Tenant } from "./support/harness.js";
import { createUserWith } from "./support/fixtures.js";
import { LoginThrottleService } from "../src/auth/login-throttle.service.js";

describe("Security qualification against PostgreSQL", () => {
  let harness: Harness; let owner: Tenant;
  const password = "QualificationPass2026!";
  beforeAll(async () => { process.env.MFA_ENCRYPTION_KEY ??= randomBytes(32).toString("base64"); harness = await createHarness(); owner = await registerTenant(harness, "security-qualification"); });
  afterAll(async () => { await harness?.close(); });

  it("company-scoped grants cannot access another member company or organization admin", async () => {
    const second = await as(harness, owner).post("/admin/companies", { name: `Scoped second ${Date.now()}` });
    expect(second.status).toBe(201);
    const reader = await createUserWith(harness, owner, ["crm.lead.read", "core.user.manage"], "scoped-reader");
    await harness.prisma.companyMembership.create({ data: { userId: reader.userId, companyId: second.body.id } });
    await harness.prisma.roleAssignment.updateMany({ where: { userId: reader.userId }, data: { companyId: owner.companyId } });
    expect((await as(harness, reader).get(`/crm/leads?companyId=${owner.companyId}`)).status).toBe(200);
    expect((await as(harness, reader).get(`/crm/leads?companyId=${second.body.id}`)).status).toBe(403);
    expect((await as(harness, reader).get("/admin/users")).status).toBe(403);
  });
  it("user administration cannot assign OWNER without role administration", async () => {
    const staffAdmin = await createUserWith(harness, owner, ["core.user.manage"], "user-admin");
    const ownerRole = await harness.prisma.role.findFirstOrThrow({ where: { organizationId: owner.organizationId, name: "OWNER" } });
    const created = await as(harness, staffAdmin).post("/admin/users", { email: `escalation-${Date.now()}@test.com`, fullName: "Escalation", password, companyIds: [owner.companyId], roleIds: [ownerRole.id] });
    expect(created.status).toBe(403);
    const changed = await as(harness, staffAdmin).patch(`/admin/users/${staffAdmin.userId}`, { roleIds: [ownerRole.id] });
    expect(changed.status).toBe(403);
    expect(await harness.prisma.roleAssignment.count({ where: { userId: staffAdmin.userId, roleId: ownerRole.id } })).toBe(0);
  });
  it("role administrators cannot manufacture permissions they do not hold", async () => {
    const roleAdmin = await createUserWith(harness, owner, ["core.role.manage"], "role-admin");
    const created = await as(harness, roleAdmin).post("/admin/roles", { name: `Escalated ${Date.now()}`, permissions: ["finance.invoice.manage"] });
    expect(created.status).toBe(403);
  });
  it("concurrent removal of two OWNERs retains at least one active OWNER", async () => {
    const tenant = await registerTenant(harness, "owner-race");
    const ownerRole = await harness.prisma.role.findFirstOrThrow({ where: { organizationId: tenant.organizationId, name: "OWNER" } });
    const email = `second-owner-${Date.now()}@test.com`;
    const created = await as(harness, tenant).post("/admin/users", { email, fullName: "Second owner", password, companyIds: [tenant.companyId], roleIds: [ownerRole.id] });
    expect(created.status).toBe(201);
    const login = await harness.http().post("/api/v1/auth/login").send({ email, password });
    const other = { cookie: login.headers["set-cookie"] as unknown as string[] };
    const results = await Promise.all([as(harness, tenant).patch(`/admin/users/${created.body.id}`, { isActive: false }), as(harness, other).patch(`/admin/users/${tenant.userId}`, { isActive: false })]);
    expect(results.filter((response) => response.status === 200)).toHaveLength(1);
    expect(await harness.prisma.user.count({ where: { organizationId: tenant.organizationId, isActive: true, roleAssignments: { some: { roleId: ownerRole.id } } } })).toBe(1);
  });
  it("malformed auth input returns 400 and ambiguous email requires a tenant slug", async () => {
    expect((await harness.http().post("/api/v1/auth/login").send({ email: 123, password: null })).status).toBe(400);
    expect((await harness.http().post("/api/v1/auth/register-organization").send({})).status).toBe(400);
    const a = await registerTenant(harness, "ambiguous-a"); const b = await registerTenant(harness, "ambiguous-b");
    const email = `shared-${Date.now()}@test.com`;
    for (const tenant of [a, b]) expect((await as(harness, tenant).post("/admin/users", { email, fullName: "Shared email", password, companyIds: [tenant.companyId] })).status).toBe(201);
    expect((await harness.http().post("/api/v1/auth/login").send({ email, password })).status).toBe(401);
    const org = await harness.prisma.organization.findUniqueOrThrow({ where: { id: a.organizationId } });
    const selected = await harness.http().post("/api/v1/auth/login").send({ email: email.toUpperCase(), password, organizationSlug: org.slug });
    expect(selected.status).toBe(201); expect(selected.body.user.organizationId).toBe(a.organizationId);
  });
  it("cookies reject untrusted origins and non-JSON mutation bodies", async () => {
    const denied = await harness.http().post("/api/v1/admin/companies").set("Cookie", owner.cookie).set("Origin", "https://attacker.example").send({ name: "forbidden" });
    expect(denied.status).toBe(403);
    const simple = await harness.http().post("/api/v1/admin/companies").set("Cookie", owner.cookie).set("Content-Type", "text/plain").send('{"name":"forbidden"}');
    expect(simple.status).toBe(403);
    expect((await harness.http().get("/api/v1/auth/me").set("Cookie", "axora_erp24_session=%E0%A4%A")).status).toBe(401);
    expect((await harness.http().get("/api/v1/portal/me").set("Cookie", "axora_portal_session=%E0%A4%A")).status).toBe(401);
  });
  it("MFA counter competes atomically across separate challenges and invalidates old sessions", async () => {
    const tenant = await registerTenant(harness, "mfa-race");
    const oldLogin = await harness.http().post("/api/v1/auth/login").send({ email: tenant.email, password: tenant.password });
    const oldCookie = oldLogin.headers["set-cookie"] as unknown as string[];
    const setup = await as(harness, tenant).post("/auth/mfa/setup", { password: tenant.password }); const secret = setup.body.secret;
    expect((await as(harness, tenant).post("/auth/mfa/enable", { password: tenant.password, code: totpCode(secret) })).status).toBe(201);
    expect((await as(harness, { cookie: oldCookie }).get("/auth/me")).status).toBe(401);
    const challenges = [];
    for (let index = 0; index < 2; index++) challenges.push((await harness.http().post("/api/v1/auth/login").send({ email: tenant.email, password: tenant.password })).body.challengeToken);
    const code = totpCode(secret, Date.now() + 30_000);
    const verified = await Promise.all(challenges.map((challengeToken) => harness.http().post("/api/v1/auth/mfa/verify").send({ challengeToken, code })));
    expect(verified.map((response) => response.status).sort()).toEqual([201, 401]);
    const pending = (await harness.http().post("/api/v1/auth/login").send({ email: tenant.email, password: tenant.password })).body.challengeToken;
    expect((await as(harness, tenant).post("/auth/password", { currentPassword: tenant.password, newPassword: password })).status).toBe(201);
    expect((await harness.http().post("/api/v1/auth/mfa/verify").send({ challengeToken: pending, code })).status).toBe(401);
  });
  it("new MFA challenges share the same failed-code budget", async () => {
    const tenant = await registerTenant(harness, "mfa-budget");
    const setup = await as(harness, tenant).post("/auth/mfa/setup", { password: tenant.password });
    expect((await as(harness, tenant).post("/auth/mfa/enable", { password: tenant.password, code: totpCode(setup.body.secret) })).status).toBe(201);
    for (let index = 0; index < 6; index++) {
      const challenge = await harness.http().post("/api/v1/auth/login").send({ email: tenant.email, password: tenant.password });
      expect(challenge.status).toBe(201);
      const rejected = await harness.http().post("/api/v1/auth/mfa/verify").send({ challengeToken: challenge.body.challengeToken, code: "invalid-code" });
      expect(rejected.status).toBe(index < 5 ? 401 : 429);
    }
  });
  it("portal invitation is single-use under concurrent activation and reset revokes old sessions", async () => {
    const tenant = await registerTenant(harness, "portal-race");
    const account = await as(harness, tenant).post("/crm/accounts", { name: "Portal concurrency account" });
    const invited = await as(harness, tenant).post("/portal-admin/principals", { kind: "CLIENT", email: `portal-race-${Date.now()}@test.com`, fullName: "Portal user", crmAccountId: account.body.id });
    expect(invited.status).toBe(201);
    const activation = () => harness.http().post("/api/v1/portal/auth/activate").send({ token: invited.body.token, password });
    const results = await Promise.all([activation(), activation()]);
    expect(results.map((response) => response.status).sort()).toEqual([200, 401]);
    const cookie = results.find((response) => response.status === 200)!.headers["set-cookie"] as unknown as string[];
    const reinvited = await as(harness, tenant).post(`/portal-admin/principals/${invited.body.principal.id}/invitations`);
    expect(reinvited.status).toBe(201);
    expect((await harness.http().post("/api/v1/portal/auth/activate").send({ token: reinvited.body.token, password: "ResetQualification2026!" })).status).toBe(200);
    expect((await harness.http().get("/api/v1/portal/me").set("Cookie", cookie)).status).toBe(401);
  });
  it("an absolute session age cannot be extended by an active cookie", async () => {
    const tenant = await registerTenant(harness, "session-age");
    const cookie = tenant.cookie.join(";"); const rawToken = cookie.match(/axora_erp24_session=([^;]+)/)![1]!;
    const tokenHash = hashSessionToken(decodeURIComponent(rawToken));
    await harness.prisma.session.update({ where: { tokenHash }, data: { createdAt: new Date(Date.now() - 25 * 3_600_000), expiresAt: new Date(Date.now() + 3_600_000) } });
    expect((await as(harness, tenant).get("/auth/me")).status).toBe(401);
  });
  it("theme preferences are strict, private to the signed-in user and audited", async () => {
    const tenant = await registerTenant(harness, "theme-preference");
    expect((await as(harness, tenant).get("/auth/preferences")).body).toEqual({ theme: "system" });
    const updated = await as(harness, tenant).patch("/auth/preferences", { theme: "dark" });
    expect(updated.status).toBe(200); expect(updated.body).toEqual({ theme: "dark" });
    expect((await as(harness, tenant).get("/auth/preferences")).body).toEqual({ theme: "dark" });
    expect((await as(harness, owner).get("/auth/preferences")).body).toEqual({ theme: "system" });
    expect((await as(harness, tenant).patch("/auth/preferences", { theme: "DARK" })).status).toBe(400);
    expect((await as(harness, tenant).patch("/auth/preferences", { theme: "light", userId: owner.userId })).status).toBe(400);
    expect((await harness.http().get("/api/v1/auth/preferences")).status).toBe(401);
    expect(await harness.prisma.auditLog.count({ where: { organizationId: tenant.organizationId, actorUserId: tenant.userId, action: "auth.preferences.updated" } })).toBe(1);
  });
  it("concurrent failed credentials are all counted without serialization errors", async () => {
    const limiter = new LoginThrottleService(harness.prisma); const subject = `concurrent-${Date.now()}@test.com`;
    await Promise.all(Array.from({ length: 10 }, () => limiter.recordFailure(subject, "qualification-test-address")));
    const record = await harness.prisma.loginThrottle.findUniqueOrThrow({ where: { keyHash: loginThrottleKey(subject, "qualification-test-address") } });
    expect(record.failureCount).toBe(10);
    await expect(limiter.enforce(subject, "qualification-test-address")).rejects.toMatchObject({ status: 429 });
  });
});
