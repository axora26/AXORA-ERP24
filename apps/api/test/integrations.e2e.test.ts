import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createHarness, registerTenant, type Harness, type Tenant } from "./support/harness.js";
import { createStartedProject, createUserWith } from "./support/fixtures.js";
import { signWebhook } from "../src/workflow/engine.js";
import { loginThrottleKey } from "@axora24/security";

/**
 * INC-23 — API publique & integrations, via l'API reelle et PostgreSQL :
 * cles a permissions explicites bornees par le createur, debit, quota, IP,
 * revocation, journal, webhooks entrants signes et idempotents, isolation.
 */
describe("INC-23 API publique & integrations (e2e)", () => {
  let harness: Harness;
  let owner: Tenant;
  let other: Tenant;
  let integrator: Tenant;
  let integratorRoleId = "";
  let projectIds: string[] = [];
  let foreignProjectId = "";
  let secret = "";
  let keyId = "";

  const bearer = (key: string) => ({ Authorization: `Bearer ${key}` });
  const call = (key: string, path: string) => harness.http().get(`/api/v1${path}`).set(bearer(key));
  async function issue(tenant: Tenant, body: Record<string, unknown>) {
    const response = await as(harness, tenant).post("/integrations/api-keys", body);
    return response;
  }
  async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const value = await read();
      if (done(value)) return value;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return read();
  }

  beforeAll(async () => {
    harness = await createHarness();
    // Le limiteur d'essais par IP persiste en base : etat propre pour l'IP de bouclage du test.
    await harness.prisma.loginThrottle.deleteMany({ where: { keyHash: { in: ["127.0.0.1", "::1"].map((ip) => loginThrottleKey("api-key", ip)) } } });
    owner = await registerTenant(harness, "api");
    other = await registerTenant(harness, "api-other");
    integrator = await createUserWith(harness, owner, ["integrations.apikey.read", "integrations.apikey.manage", "integrations.inbound.manage", "projects.project.read", "crm.lead.manage", "crm.lead.read"], "integrateur");
    integratorRoleId = (await harness.prisma.roleAssignment.findFirstOrThrow({ where: { userId: integrator.userId } })).roleId;
    projectIds = [(await createStartedProject(harness, owner)).projectId, (await createStartedProject(harness, owner)).projectId].sort();
    foreignProjectId = (await createStartedProject(harness, other)).projectId;
  });

  afterAll(async () => {
    await harness?.close();
  });

  it("emission : permissions explicites du catalogue public, jamais au-dela des droits de l'emetteur", async () => {
    expect((await issue(integrator, { name: "Vide", permissions: [] })).status).toBe(400);
    expect((await issue(integrator, { name: "Admin", permissions: ["core.user.manage"] })).status).toBe(400);
    const escalation = await issue(integrator, { name: "Finance", permissions: ["finance.invoice.read"] });
    expect(escalation.status).toBe(403);
    expect(escalation.body.message).toContain("finance.invoice.read");
    expect((await issue(integrator, { name: "IP", permissions: ["projects.project.read"], allowedIps: ["999.1.1.1"] })).status).toBe(400);
    expect((await issue(integrator, { name: "Passée", permissions: ["projects.project.read"], expiresAt: "2020-01-01" })).status).toBe(400);
    expect((await as(harness, owner).get("/integrations/api-keys")).status).toBe(200);

    const issued = await issue(integrator, { name: "ERP groupe", permissions: ["projects.project.read", "crm.lead.manage"] });
    expect(issued.status).toBe(201);
    secret = issued.body.secret;
    keyId = issued.body.key.id;
    expect(secret).toMatch(/^axk_/);
    expect(issued.body.key).toMatchObject({ prefix: secret.slice(0, 12), status: "ACTIVE", rateLimitPerMinute: 60, dailyQuota: 10000, permissions: ["crm.lead.manage", "projects.project.read"] });
    const stored = await harness.prisma.apiKey.findUniqueOrThrow({ where: { id: keyId } });
    expect(stored.keyHash).not.toContain(secret);
    expect(JSON.stringify((await as(harness, integrator).get("/integrations/api-keys")).body)).not.toContain(secret);
    const audit = await harness.prisma.auditLog.findFirstOrThrow({ where: { resourceId: keyId, action: "integrations.apikey.issued" } });
    expect(JSON.stringify(audit.metadata)).not.toContain(secret);
  });

  it("authentification, perimetre entreprise, permission par route, pagination", async () => {
    expect((await harness.http().get("/api/v1/public/projects")).status).toBe(401);
    expect((await call("axk_" + "x".repeat(43), "/public/projects")).status).toBe(401);
    const me = await call(secret, "/public/me");
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ name: "ERP groupe", companyId: owner.companyId, permissions: ["crm.lead.manage", "projects.project.read"] });
    expect(me.headers["x-ratelimit-limit"]).toBe("60");

    const first = await call(secret, "/public/projects?limit=1");
    expect(first.status).toBe(200);
    expect(first.body.data.map((project: { id: string }) => project.id)).toEqual([projectIds[0]]);
    expect(first.body.nextCursor).toBe(projectIds[0]);
    const second = await call(secret, `/public/projects?limit=1&cursor=${first.body.nextCursor}`);
    expect(second.body.data.map((project: { id: string }) => project.id)).toEqual([projectIds[1]]);
    expect(second.body.nextCursor).toBeNull();
    const all = await call(secret, "/public/projects");
    expect(all.body.data.map((project: { id: string }) => project.id)).not.toContain(foreignProjectId);
    expect(all.body.data[0]).toMatchObject({ code: expect.any(String), contractAmount: expect.stringMatching(/^\d+\.\d{2}$/) });

    const refused = await call(secret, "/public/customer-invoices");
    expect(refused.status).toBe(403);
    expect(refused.body.message).toContain("finance.invoice.read");
    const spec = await harness.http().get("/api/v1/public/openapi.json");
    expect(spec.status).toBe(200);
    expect(Object.keys(spec.body.paths)).toContain("/public/projects");
  });

  it("creation de prospect par l'API : memes regles que l'interface, tracee", async () => {
    expect((await harness.http().post("/api/v1/public/crm/leads").set(bearer(secret)).send({ contactName: "" })).status).toBe(400);
    const lead = await harness.http().post("/api/v1/public/crm/leads").set(bearer(secret)).send({ contactName: "Awa Diallo", companyName: "Hôtel du Fleuve", email: "awa@example.org" });
    expect(lead.status).toBe(201);
    expect(lead.body.source).toBe("API : ERP groupe");
    const leads = (await as(harness, owner).get("/crm/leads")).body as Array<{ id: string }>;
    expect(leads.map((entry) => entry.id)).toContain(lead.body.id);
    expect(await harness.prisma.auditLog.count({ where: { resourceId: lead.body.id, action: "integrations.api.lead.created" } })).toBe(1);
  });

  it("la cle perd immediatement les droits retires a son createur, et s'arrete s'il est desactive", async () => {
    const role = await harness.prisma.role.findUniqueOrThrow({ where: { id: integratorRoleId }, include: { permissions: { include: { permission: true } } } });
    const keys = role.permissions.map((entry) => entry.permission.key);
    expect((await as(harness, owner).put(`/admin/roles/${integratorRoleId}/permissions`, { permissions: keys.filter((key) => key !== "projects.project.read") })).status).toBe(200);
    const lost = await call(secret, "/public/projects");
    expect(lost.status).toBe(403);
    expect((await call(secret, "/public/me")).body.permissions).toEqual(["crm.lead.manage"]);
    expect((await as(harness, owner).put(`/admin/roles/${integratorRoleId}/permissions`, { permissions: keys })).status).toBe(200);
    expect((await call(secret, "/public/projects")).status).toBe(200);

    expect((await as(harness, owner).patch(`/admin/users/${integrator.userId}`, { isActive: false })).status).toBe(200);
    const suspended = await call(secret, "/public/me");
    expect(suspended.status).toBe(401);
    expect(suspended.body.message).toContain("suspendue");
    expect((await as(harness, owner).patch(`/admin/users/${integrator.userId}`, { isActive: true })).status).toBe(200);
    expect((await call(secret, "/public/me")).status).toBe(200);
    // La desactivation a aussi revoque les sessions de l'integrateur : nouvelle connexion.
    const login = await harness.http().post("/api/v1/auth/login").send({ email: integrator.email, password: integrator.password });
    expect(login.status).toBe(201);
    integrator = { ...integrator, cookie: login.headers["set-cookie"] as unknown as string[] };
  });

  it("limitation de debit par minute, quota journalier et liste d'adresses IP", async () => {
    // Eviter une frontiere de minute pendant le test.
    const seconds = new Date().getUTCSeconds();
    if (seconds > 50) await new Promise((resolve) => setTimeout(resolve, (61 - seconds) * 1000));
    const limited = (await issue(integrator, { name: "Débit", permissions: ["projects.project.read"], rateLimitPerMinute: 3 })).body.secret;
    for (let index = 0; index < 3; index += 1) expect((await call(limited, "/public/projects")).status).toBe(200);
    const throttled = await call(limited, "/public/projects");
    expect(throttled.status).toBe(429);
    expect(Number(throttled.headers["retry-after"])).toBeGreaterThan(0);
    expect(throttled.headers["x-ratelimit-remaining"]).toBe("0");

    const quota = (await issue(integrator, { name: "Quota", permissions: ["projects.project.read"], dailyQuota: 2 })).body.secret;
    expect((await call(quota, "/public/me")).status).toBe(200);
    expect((await call(quota, "/public/me")).status).toBe(200);
    const exhausted = await call(quota, "/public/me");
    expect(exhausted.status).toBe(429);
    expect(exhausted.body.message).toContain("Quota journalier");

    const elsewhere = (await issue(integrator, { name: "IP distante", permissions: ["projects.project.read"], allowedIps: ["203.0.113.9"] })).body.secret;
    expect((await call(elsewhere, "/public/me")).status).toBe(403);
    const local = (await issue(integrator, { name: "IP locale", permissions: ["projects.project.read"], allowedIps: ["127.0.0.1", "::1"] })).body.secret;
    expect((await call(local, "/public/me")).status).toBe(200);
  });

  it("revocation definitive, cle figee en base, journal append-only des requetes", async () => {
    const log = await waitFor(
      async () => (await as(harness, integrator).get(`/integrations/api-keys/${keyId}/requests`)).body as Array<{ status: number; path: string }>,
      (rows) => rows.some((row) => row.status === 403),
    );
    expect(log.some((row) => row.path === "/api/v1/public/projects" && row.status === 200)).toBe(true);
    expect(log.some((row) => row.status === 403)).toBe(true);
    const entry = await harness.prisma.apiRequestLog.findFirstOrThrow({ where: { keyId } });
    await expect(harness.prisma.apiRequestLog.update({ where: { id: entry.id }, data: { status: 200 } })).rejects.toThrow();

    await expect(harness.prisma.apiKey.update({ where: { id: keyId }, data: { permissions: ["projects.project.read", "finance.invoice.read"] } })).rejects.toThrow();
    expect((await as(harness, integrator).post(`/integrations/api-keys/${keyId}/revoke`, {})).status).toBe(400);
    const revoked = await as(harness, integrator).post(`/integrations/api-keys/${keyId}/revoke`, { reason: "Fin du contrat d'intégration" });
    expect(revoked.body.status).toBe("REVOKED");
    const denied = await call(secret, "/public/me");
    expect(denied.status).toBe(401);
    expect(denied.body.message).toContain("révoquée");
    expect((await as(harness, integrator).post(`/integrations/api-keys/${keyId}/revoke`, { reason: "bis" })).status).toBe(409);
    await expect(harness.prisma.apiKey.update({ where: { id: keyId }, data: { revokedAt: null } })).rejects.toThrow();
  });

  it("webhook entrant : signature sur le corps brut, anti-rejeu, idempotence, contenu refuse trace", async () => {
    const created = await as(harness, integrator).post("/integrations/inbound", { name: "Formulaire site web" });
    expect(created.status).toBe(201);
    const endpointSecret = created.body.secret as string;
    expect(endpointSecret).toMatch(/^whin_/);
    const path = created.body.endpoint.path as string;
    const send = (body: string, timestamp = String(Math.floor(Date.now() / 1000)), key = endpointSecret) =>
      harness.http().post(path).set("Content-Type", "application/json").set("X-Axora-Timestamp", timestamp).set("X-Axora-Signature", signWebhook(key, timestamp, body)).send(body);

    const body = JSON.stringify({ id: "form-0001", type: "crm.lead", data: { contactName: "Jean Kabila", companyName: "Clinique du Lac", email: "jean@example.org", message: "Devis climatisation" } });
    const accepted = await send(body);
    expect(accepted.status).toBe(201);
    expect(accepted.body).toMatchObject({ duplicate: false, status: "ACCEPTED", resourceType: "CrmLead" });
    const replay = await send(body);
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({ duplicate: true, resourceId: accepted.body.resourceId });
    expect(await harness.prisma.crmLead.count({ where: { companyName: "Clinique du Lac", organizationId: owner.organizationId } })).toBe(1);

    // Signature fausse, corps altere, horodatage perime : rejet sans aucune trace ni effet.
    expect((await send(body, undefined, "whin_mauvais")).status).toBe(401);
    const tampered = await harness.http().post(path).set("Content-Type", "application/json").set("X-Axora-Timestamp", String(Math.floor(Date.now() / 1000))).set("X-Axora-Signature", signWebhook(endpointSecret, String(Math.floor(Date.now() / 1000)), body)).send(body.replace("Clinique", "Clinik"));
    expect(tampered.status).toBe(401);
    const stale = String(Math.floor(Date.now() / 1000) - 600);
    expect((await send(JSON.stringify({ id: "form-0002", type: "crm.lead", data: { contactName: "A", companyName: "B" } }), stale)).status).toBe(401);
    expect(await harness.prisma.inboundEvent.count({ where: { endpointId: created.body.endpoint.id } })).toBe(1);

    const invalid = await send(JSON.stringify({ id: "form-0003", type: "crm.lead", data: { contactName: "Sans société", admin: true } }));
    expect(invalid.status).toBe(422);
    expect(invalid.body).toMatchObject({ status: "REJECTED" });
    expect(invalid.body.error).toContain("Champs inconnus");
    expect((await send(JSON.stringify({ id: "form-0003", type: "crm.lead", data: {} }))).status).toBe(422);

    const events = (await as(harness, integrator).get(`/integrations/inbound/${created.body.endpoint.id}/events`)).body as Array<{ status: string }>;
    expect(events.map((event) => event.status).sort()).toEqual(["ACCEPTED", "REJECTED"]);
    const stored = await harness.prisma.inboundEvent.findFirstOrThrow({ where: { endpointId: created.body.endpoint.id } });
    await expect(harness.prisma.inboundEvent.update({ where: { id: stored.id }, data: { status: "REJECTED" } })).rejects.toThrow();
    await expect(harness.prisma.inboundEvent.create({ data: { organizationId: owner.organizationId, companyId: owner.companyId, endpointId: created.body.endpoint.id, externalId: "form-0001", status: "ACCEPTED", resourceId: "x", payloadSha256: "0".repeat(64) } })).rejects.toThrow();

    expect((await as(harness, integrator).post(`/integrations/inbound/${created.body.endpoint.id}/active`, { active: false })).body.active).toBe(false);
    expect((await send(JSON.stringify({ id: "form-0004", type: "crm.lead", data: { contactName: "A", companyName: "B" } }))).status).toBe(404);
  });

  it("signatures invalides : blocage par point d'entree, sans effet sur les autres", async () => {
    const attacked = (await as(harness, integrator).post("/integrations/inbound", { name: "Cible" })).body;
    const healthy = (await as(harness, integrator).post("/integrations/inbound", { name: "Sain" })).body;
    const body = JSON.stringify({ id: "evt-1", type: "crm.lead", data: { contactName: "Paul", companyName: "Atelier" } });
    const post = (endpoint: { endpoint: { path: string } }, key: string) => {
      const timestamp = String(Math.floor(Date.now() / 1000));
      return harness.http().post(endpoint.endpoint.path).set("Content-Type", "application/json").set("X-Axora-Timestamp", timestamp).set("X-Axora-Signature", signWebhook(key, timestamp, body)).send(body);
    };
    for (let attempt = 0; attempt < 5; attempt += 1) expect((await post(attacked, "whin_faux")).status).toBe(401);
    const blocked = await post(attacked, attacked.secret);
    expect(blocked.status).toBe(429);
    expect(blocked.body.message).toContain("Trop de signatures invalides");
    expect((await post(healthy, healthy.secret)).status).toBe(201);
  });

  it("isolation et registre des connecteurs", async () => {
    expect((await as(harness, other).get("/integrations/api-keys")).body).toEqual([]);
    expect((await as(harness, other).get("/integrations/inbound")).body).toEqual([]);
    expect((await as(harness, other).post(`/integrations/api-keys/${keyId}/revoke`, { reason: "x" })).status).toBe(404);
    expect((await as(harness, other).get(`/integrations/api-keys/${keyId}/requests`)).status).toBe(404);
    const connectors = (await as(harness, owner).get("/integrations/connectors")).body as Array<{ key: string; status: string }>;
    expect(connectors.find((connector) => connector.key === "public-api")?.status).toBe("IMPLEMENTED_NOT_VERIFIED");
    expect(connectors.find((connector) => connector.key === "webhook-out")?.status).toBe("NOT_TESTED");
    expect(connectors.find((connector) => connector.key === "bacnet")?.status).toBe("NOT_IMPLEMENTED");
    expect((await as(harness, integrator).get("/integrations/delegable")).body).toEqual(expect.arrayContaining([{ permission: "finance.invoice.read", granted: false }, { permission: "projects.project.read", granted: true }]));
  });
});
