import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createHarness, registerTenant, type Harness, type Tenant } from "./support/harness.js";

/**
 * INC-01 — Administration RBAC : roles personnalises, utilisateurs, garde du
 * dernier OWNER, isolation tenant, journal d'audit en lecture seule.
 */
describe("Administration RBAC (e2e)", () => {
  let harness: Harness;
  let tenantA: Tenant;
  let tenantB: Tenant;
  let salesRoleId = "";
  let ownerRoleId = "";
  let createdUserId = "";
  const createdEmail = `commercial-${Date.now()}@test.com`;
  const createdPassword = "Commercial2026!";
  let createdCookie: string[] = [];

  beforeAll(async () => {
    harness = await createHarness();
    tenantA = await registerTenant(harness, "admin-a");
    tenantB = await registerTenant(harness, "admin-b");
  });

  afterAll(async () => {
    await harness.close();
  });

  it("expose le catalogue des permissions groupe par module", async () => {
    const response = await as(harness, tenantA).get("/admin/permissions");
    expect(response.status).toBe(200);
    const crm = response.body.find((group: { module: string }) => group.module === "crm");
    expect(crm.label).toBe("CRM");
    expect(crm.permissions).toContainEqual({ key: "crm.lead.read", label: "Consulter les prospects" });
  });

  it("liste les roles : OWNER systeme porte toutes les permissions", async () => {
    const response = await as(harness, tenantA).get("/admin/roles");
    expect(response.status).toBe(200);
    const owner = response.body.find((role: { name: string }) => role.name === "OWNER");
    ownerRoleId = owner.id;
    expect(owner.isSystem).toBe(true);
    expect(owner.memberCount).toBe(1);
    expect(owner.permissions).toContain("core.role.manage");
  });

  it("refuse une permission inconnue et le nom reserve OWNER", async () => {
    const unknown = await as(harness, tenantA).post("/admin/roles", { name: "X", permissions: ["crm.lead.hack"] });
    expect(unknown.status).toBe(400);
    const reserved = await as(harness, tenantA).post("/admin/roles", { name: "owner", permissions: [] });
    expect(reserved.status).toBe(400);
  });

  it("cree un role personnalise en lecture CRM seule (audite)", async () => {
    const response = await as(harness, tenantA).post("/admin/roles", {
      name: "Commercial lecture",
      permissions: ["crm.lead.read", "crm.opportunity.read", "dashboard.overview.read"],
    });
    expect(response.status).toBe(201);
    salesRoleId = response.body.id;
    expect(response.body.permissions).toEqual(["crm.lead.read", "crm.opportunity.read", "dashboard.overview.read"]);
  });

  it("le role systeme OWNER est immuable", async () => {
    const response = await as(harness, tenantA).put(`/admin/roles/${ownerRoleId}/permissions`, { permissions: [] });
    expect(response.status).toBe(403);
    const removal = await as(harness, tenantA).delete(`/admin/roles/${ownerRoleId}`);
    expect(removal.status).toBe(403);
  });

  it("cree un utilisateur rattache au role et a l'entreprise", async () => {
    const response = await as(harness, tenantA).post("/admin/users", {
      email: createdEmail.toUpperCase(),
      fullName: "Carine Commerciale",
      password: createdPassword,
      roleIds: [salesRoleId],
      companyIds: [tenantA.companyId],
    });
    expect(response.status).toBe(201);
    createdUserId = response.body.id;
    expect(response.body.email).toBe(createdEmail);
    expect(response.body.roles).toEqual([{ id: salesRoleId, name: "Commercial lecture" }]);

    const duplicate = await as(harness, tenantA).post("/admin/users", {
      email: createdEmail,
      fullName: "Doublon",
      password: createdPassword,
      companyIds: [tenantA.companyId],
    });
    expect(duplicate.status).toBe(409);
  });

  it("refuse une entreprise d'un autre tenant a la creation d'utilisateur", async () => {
    const response = await as(harness, tenantA).post("/admin/users", {
      email: `intrus-${Date.now()}@test.com`,
      fullName: "Intrus",
      password: createdPassword,
      companyIds: [tenantB.companyId],
    });
    expect(response.status).toBe(400);
  });

  it("RBAC deny-by-default : lecture CRM autorisee, ecriture et administration refusees", async () => {
    const login = await harness.http().post("/api/v1/auth/login").send({ email: createdEmail, password: createdPassword });
    expect(login.status).toBe(201);
    createdCookie = login.headers["set-cookie"] as unknown as string[];
    const user = as(harness, { cookie: createdCookie });

    const context = await user.get("/auth/context");
    expect(context.body.permissions).toEqual(["crm.lead.read", "crm.opportunity.read", "dashboard.overview.read"]);

    expect((await user.get("/crm/leads")).status).toBe(200);
    expect((await user.post("/crm/leads", { contactName: "A", companyName: "B" })).status).toBe(403);
    expect((await user.get("/sales/quotes")).status).toBe(403);
    expect((await user.get("/admin/users")).status).toBe(403);
    expect((await user.get("/admin/audit")).status).toBe(403);

    // La vue d'ensemble ne calcule que les sections autorisees.
    const overview = await user.get("/dashboard/overview");
    expect(overview.status).toBe(200);
    expect(overview.body.kpis.map((kpi: { key: string }) => kpi.key)).toEqual(["crm.pipeline"]);
    expect(overview.body.activity).toBeNull();
  });

  it("isolation tenant : un autre tenant ne voit ni ne modifie les utilisateurs de A", async () => {
    const listB = await as(harness, tenantB).get("/admin/users");
    expect(listB.body.map((user: { id: string }) => user.id)).not.toContain(createdUserId);
    const patch = await as(harness, tenantB).patch(`/admin/users/${createdUserId}`, { isActive: false });
    expect(patch.status).toBe(404);
    const role = await as(harness, tenantB).put(`/admin/roles/${salesRoleId}/permissions`, { permissions: [] });
    expect(role.status).toBe(404);
  });

  it("garde-fous : pas d'auto-desactivation, toujours un OWNER actif", async () => {
    const self = await as(harness, tenantA).patch(`/admin/users/${tenantA.userId}`, { isActive: false });
    expect(self.status).toBe(403);
    const lastOwner = await as(harness, tenantA).patch(`/admin/users/${tenantA.userId}`, { roleIds: [salesRoleId] });
    expect(lastOwner.status).toBe(400);
    const roles = await as(harness, tenantA).get("/admin/roles");
    const owner = roles.body.find((role: { name: string }) => role.name === "OWNER");
    expect(owner.memberCount).toBe(1);
  });

  it("modifier les permissions d'un role s'applique immediatement", async () => {
    const response = await as(harness, tenantA).put(`/admin/roles/${salesRoleId}/permissions`, {
      permissions: ["crm.lead.read", "crm.lead.manage", "crm.opportunity.read", "dashboard.overview.read"],
    });
    expect(response.status).toBe(200);
    const user = as(harness, { cookie: createdCookie });
    const created = await user.post("/crm/leads", { contactName: "Jean Test", companyName: "Societe Test" });
    expect(created.status).toBe(201);
  });

  it("desactiver un utilisateur revoque ses sessions ouvertes", async () => {
    const response = await as(harness, tenantA).patch(`/admin/users/${createdUserId}`, { isActive: false });
    expect(response.status).toBe(200);
    expect(response.body.isActive).toBe(false);
    const after = await as(harness, { cookie: createdCookie }).get("/auth/me");
    expect(after.status).toBe(401);
    const relogin = await harness.http().post("/api/v1/auth/login").send({ email: createdEmail, password: createdPassword });
    expect(relogin.status).toBe(401);
  });

  it("un role encore attribue ne peut pas etre supprime", async () => {
    const blocked = await as(harness, tenantA).delete(`/admin/roles/${salesRoleId}`);
    expect(blocked.status).toBe(400);
    await as(harness, tenantA).patch(`/admin/users/${createdUserId}`, { roleIds: [] });
    const removed = await as(harness, tenantA).delete(`/admin/roles/${salesRoleId}`);
    expect(removed.status).toBe(200);
  });

  it("cree une entreprise : le createur en devient membre, avec un pipeline par defaut", async () => {
    const response = await as(harness, tenantA).post("/admin/companies", { name: "Filiale Kinshasa" });
    expect(response.status).toBe(201);
    const context = await as(harness, tenantA).get("/auth/context");
    expect(context.body.companies).toHaveLength(2);
    // Deux entreprises : le perimetre doit desormais etre explicite.
    expect((await as(harness, tenantA).get("/crm/leads")).status).toBe(400);
    const stages = await as(harness, tenantA).get(`/crm/pipeline/stages?companyId=${response.body.id}`);
    expect(stages.status).toBe(200);
    expect(stages.body.length).toBeGreaterThan(0);
  });

  it("journal d'audit : filtre, pagine, limite au tenant et sans route de modification", async () => {
    const response = await as(harness, tenantA).get("/admin/audit?action=core.&pageSize=50");
    expect(response.status).toBe(200);
    const actions = response.body.items.map((item: { action: string }) => item.action);
    expect(actions).toEqual(expect.arrayContaining(["core.user.created", "core.role.created", "core.role.deleted"]));
    expect(actions.every((action: string) => action.startsWith("core."))).toBe(true);

    const other = await as(harness, tenantB).get("/admin/audit?action=core.");
    expect(other.body.items.map((item: { resourceId: string }) => item.resourceId)).not.toContain(createdUserId);

    const firstId = response.body.items[0].id;
    expect((await as(harness, tenantA).delete(`/admin/audit/${firstId}`)).status).toBe(404);
    expect((await as(harness, tenantA).patch(`/admin/audit/${firstId}`, {})).status).toBe(404);
  });

  it("changement de mot de passe : ancien requis, autres sessions revoquees", async () => {
    const secondLogin = await harness.http().post("/api/v1/auth/login").send({ email: tenantB.email, password: tenantB.password });
    const otherSession = secondLogin.headers["set-cookie"] as unknown as string[];

    const wrong = await as(harness, tenantB).post("/auth/password", { currentPassword: "nope-nope", newPassword: "NewPass2026!" });
    expect(wrong.status).toBe(401);
    const changed = await as(harness, tenantB).post("/auth/password", {
      currentPassword: tenantB.password,
      newPassword: "NewPass2026!",
    });
    expect(changed.status).toBe(201);

    expect((await as(harness, tenantB).get("/auth/me")).status).toBe(200);
    expect((await as(harness, { cookie: otherSession }).get("/auth/me")).status).toBe(401);
    const relogin = await harness.http().post("/api/v1/auth/login").send({ email: tenantB.email, password: "NewPass2026!" });
    expect(relogin.status).toBe(201);
  });
});
