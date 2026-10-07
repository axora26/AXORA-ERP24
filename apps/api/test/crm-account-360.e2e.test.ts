import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createHarness, registerTenant, type Harness, type Tenant } from "./support/harness.js";

describe("CRM Account 360 and next actions (e2e)", () => {
  let harness: Harness;
  let tenantA: Tenant;
  let tenantB: Tenant;
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  beforeAll(async () => {
    const database = new URL(process.env.DATABASE_URL!);
    if (!database.pathname.endsWith("_test")) throw new Error("CRM Account 360 tests require an isolated _test database");
    harness = await createHarness();
    tenantA = await registerTenant(harness, `crm-360-a-${suffix}`);
    tenantB = await registerTenant(harness, `crm-360-b-${suffix}`);
  }, 30_000);

  afterAll(async () => {
    await harness?.close();
  });

  it("creates, updates and completes a versioned next action with immutable activity and audit trails", async () => {
    const account = (await as(harness, tenantA).post("/crm/accounts", { name: `Lifecycle ${suffix}` })).body;
    const dueAt = new Date(Date.now() + 2 * 86_400_000).toISOString();

    const created = await as(harness, tenantA).post("/crm/next-actions", {
      accountId: account.id,
      title: " Prepare executive follow-up ",
      details: "Confirm the decision committee",
      dueAt,
      priority: "HIGH",
      assigneeUserId: tenantA.userId,
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      accountId: account.id,
      title: "Prepare executive follow-up",
      priority: "HIGH",
      status: "OPEN",
      assigneeUserId: tenantA.userId,
      version: 1,
      completedAt: null,
      cancelledAt: null,
    });

    const updated = await as(harness, tenantA).patch(`/crm/next-actions/${created.body.id}`, {
      expectedVersion: 1,
      title: "Executive follow-up",
      priority: "URGENT",
      details: null,
    });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ title: "Executive follow-up", priority: "URGENT", details: null, version: 2 });

    const completed = await as(harness, tenantA).post(`/crm/next-actions/${created.body.id}/complete`, { expectedVersion: 2 });
    expect(completed.status).toBe(201);
    expect(completed.body).toMatchObject({ status: "COMPLETED", version: 3 });
    expect(completed.body.completedAt).toMatch(/^\d{4}-/);
    expect((await as(harness, tenantA).patch(`/crm/next-actions/${created.body.id}`, { expectedVersion: 3, title: "Too late" })).status).toBe(409);
    expect((await as(harness, tenantA).post(`/crm/next-actions/${created.body.id}/cancel`, { expectedVersion: 3 })).status).toBe(409);

    const audits = await harness.prisma.auditLog.findMany({
      where: { organizationId: tenantA.organizationId, resourceId: created.body.id },
      orderBy: { createdAt: "asc" },
      select: { action: true },
    });
    expect(audits.map((entry) => entry.action)).toEqual([
      "crm.next_action.created",
      "crm.next_action.updated",
      "crm.next_action.completed",
    ]);

    const activities = await as(harness, tenantA).get(`/crm/activities?relatedType=Account&relatedId=${account.id}`);
    expect(activities.status).toBe(200);
    expect(activities.body.map((activity: { type: string }) => activity.type)).toEqual(expect.arrayContaining([
      "NEXT_ACTION_CREATED",
      "NEXT_ACTION_UPDATED",
      "NEXT_ACTION_COMPLETED",
    ]));
  });

  it("filters open actions by overdue, today and the next seven UTC calendar days", async () => {
    const account = (await as(harness, tenantA).post("/crm/accounts", { name: `Filters ${suffix}` })).body;
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const tomorrow = new Date(start.getTime() + 86_400_000);
    const dates = {
      overdue: new Date(start.getTime() - 1).toISOString(),
      today: new Date(Math.min(Date.now() + 3_600_000, tomorrow.getTime() - 1)).toISOString(),
      soon: new Date(start.getTime() + 3 * 86_400_000).toISOString(),
      later: new Date(start.getTime() + 8 * 86_400_000).toISOString(),
    };
    const ids: Record<string, string> = {};
    for (const [key, dueAt] of Object.entries(dates)) {
      const response = await as(harness, tenantA).post("/crm/next-actions", {
        accountId: account.id,
        title: `Action ${key}`,
        dueAt,
        priority: "MEDIUM",
        assigneeUserId: tenantA.userId,
      });
      expect(response.status).toBe(201);
      ids[key] = response.body.id;
    }

    const overdue = await as(harness, tenantA).get(`/crm/next-actions?accountId=${account.id}&filter=overdue`);
    expect(overdue.body.map((item: { id: string }) => item.id)).toEqual([ids.overdue]);
    const today = await as(harness, tenantA).get(`/crm/next-actions?accountId=${account.id}&filter=today`);
    expect(today.body.map((item: { id: string }) => item.id)).toEqual([ids.today]);
    const next7days = await as(harness, tenantA).get(`/crm/next-actions?accountId=${account.id}&filter=next7days`);
    expect(next7days.body.map((item: { id: string }) => item.id).sort()).toEqual([ids.soon, ids.today].sort());

    for (const type of ["NEXT_ACTION_CREATED", "NEXT_ACTION_UPDATED", "NEXT_ACTION_COMPLETED", "NEXT_ACTION_CANCELLED"]) {
      const forged = await as(harness, tenantA).post("/crm/activities", {
        type,
        subject: "Forged system event",
        relatedType: "Account",
        relatedId: account.id,
      });
      expect(forged.status).toBe(400);
    }
  });

  it("accepts only active assignees who are members of the scoped company", async () => {
    const account = (await as(harness, tenantA).post("/crm/accounts", { name: `Assignees ${suffix}` })).body;
    const inactive = await harness.prisma.user.create({
      data: {
        organizationId: tenantA.organizationId,
        email: `inactive-${suffix}@test.example`,
        fullName: "Inactive assignee",
        passwordHash: "not-used",
        isActive: false,
        companyMemberships: { create: { companyId: tenantA.companyId } },
      },
    });
    const payload = { accountId: account.id, title: "Restricted assignment", dueAt: new Date(Date.now() + 86_400_000).toISOString() };
    expect((await as(harness, tenantA).post("/crm/next-actions", { ...payload, assigneeUserId: inactive.id })).status).toBe(400);
    expect((await as(harness, tenantA).post("/crm/next-actions", { ...payload, assigneeUserId: tenantB.userId })).status).toBe(400);
    expect((await as(harness, tenantA).post("/crm/next-actions", { ...payload, assigneeUserId: tenantA.userId })).status).toBe(201);
  });

  it("blocks account archival while an open action exists and preserves the account version on rejection", async () => {
    const account = (await as(harness, tenantA).post("/crm/accounts", { name: `Archive guard ${suffix}` })).body;
    const action = (await as(harness, tenantA).post("/crm/next-actions", {
      accountId: account.id,
      title: "Resolve before archive",
      dueAt: new Date(Date.now() + 86_400_000).toISOString(),
      assigneeUserId: tenantA.userId,
    })).body;

    const blocked = await as(harness, tenantA).post(`/crm/accounts/${account.id}/archive`, { expectedVersion: 1 });
    expect(blocked.status).toBe(409);
    expect((await as(harness, tenantA).get(`/crm/accounts/${account.id}`)).body).toMatchObject({ version: 1, archivedAt: null });

    expect((await as(harness, tenantA).post(`/crm/next-actions/${action.id}/cancel`, { expectedVersion: 1 })).status).toBe(201);
    const archived = await as(harness, tenantA).post(`/crm/accounts/${account.id}/archive`, { expectedVersion: 1 });
    expect(archived.status).toBe(201);
    expect(archived.body).toMatchObject({ version: 2 });
    expect(archived.body.archivedAt).not.toBeNull();
  });

  it("rejects cross-tenant account and user references at the database boundary", async () => {
    const accountA = (await as(harness, tenantA).post("/crm/accounts", { name: `DB scope A ${suffix}` })).body;
    const accountB = (await as(harness, tenantB).post("/crm/accounts", { name: `DB scope B ${suffix}` })).body;
    const attempt = async (accountId: string, assigneeUserId: string) => {
      let insertedId: string | undefined;
      try {
        const inserted = await harness.prisma.crmNextAction.create({ data: {
          organizationId: tenantA.organizationId, companyId: tenantA.companyId, accountId,
          title: "Invalid cross-tenant relation", dueAt: new Date(Date.now() + 86_400_000),
          assigneeUserId, createdByUserId: tenantA.userId, updatedByUserId: tenantA.userId,
        } });
        insertedId = inserted.id;
        throw new Error("database accepted a cross-tenant CRM next action");
      } finally {
        if (insertedId) await harness.prisma.crmNextAction.delete({ where: { id: insertedId } });
      }
    };
    await expect(attempt(accountB.id, tenantA.userId)).rejects.toMatchObject({ code: "P2003" });
    await expect(attempt(accountA.id, tenantB.userId)).rejects.toThrow(/CRM next-action users must belong to the scoped organization/);
  });

  it("rolls back the action and immutable activity when audit insertion fails", async () => {
    const account = (await as(harness, tenantA).post("/crm/accounts", { name: `Audit rollback ${suffix}` })).body;
    const activityWhere = { organizationId: tenantA.organizationId, companyId: tenantA.companyId, relatedType: "Account", relatedId: account.id };
    const activitiesBefore = await harness.prisma.crmActivity.count({ where: activityWhere });
    await harness.prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION reject_wave2_audit() RETURNS trigger AS $$ BEGIN
      IF NEW."actorUserId" = '${tenantA.userId}' AND NEW."action" = 'crm.next_action.created' THEN RAISE EXCEPTION 'forced audit failure'; END IF;
      RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await harness.prisma.$executeRawUnsafe(`CREATE TRIGGER reject_wave2_audit_trigger BEFORE INSERT ON "audit_logs" FOR EACH ROW EXECUTE FUNCTION reject_wave2_audit()`);
    try {
      const failed = await as(harness, tenantA).post("/crm/next-actions", {
        accountId: account.id, title: "Must rollback completely",
        dueAt: new Date(Date.now() + 86_400_000).toISOString(), assigneeUserId: tenantA.userId,
      });
      expect(failed.status).toBe(500);
      expect(await harness.prisma.crmNextAction.count({ where: { accountId: account.id } })).toBe(0);
      expect(await harness.prisma.crmActivity.count({ where: activityWhere })).toBe(activitiesBefore);
    } finally {
      await harness.prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS reject_wave2_audit_trigger ON "audit_logs"`);
      await harness.prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS reject_wave2_audit()`);
    }
  });

  it("returns a tenant-scoped Account 360 with related records and an aggregated immutable timeline", async () => {
    const account = (await as(harness, tenantA).post("/crm/accounts", { name: `Account 360 ${suffix}` })).body;
    const contact = (await as(harness, tenantA).post("/crm/contacts", { accountId: account.id, fullName: "Account 360 contact" })).body;
    const opportunity = (await as(harness, tenantA).post("/crm/opportunities", { accountId: account.id, contactId: contact.id, name: "Account 360 opportunity", amount: "42.00" })).body;
    const contactActivity = (await as(harness, tenantA).post("/crm/activities", { type: "CALL", subject: "Contact call", relatedType: "Contact", relatedId: contact.id })).body;
    const opportunityActivity = (await as(harness, tenantA).post("/crm/activities", { type: "MEETING", subject: "Opportunity meeting", relatedType: "Opportunity", relatedId: opportunity.id })).body;
    const action = (await as(harness, tenantA).post("/crm/next-actions", { accountId: account.id, title: "360 follow-up", dueAt: new Date(Date.now() + 86_400_000).toISOString(), assigneeUserId: tenantA.userId })).body;

    const response = await as(harness, tenantA).get(`/crm/accounts/${account.id}/360`);
    expect(response.status).toBe(200);
    expect(response.body.account.id).toBe(account.id);
    expect(response.body.contacts).toMatchObject({ available: true });
    expect(response.body.contacts.items.map((item: { id: string }) => item.id)).toContain(contact.id);
    expect(response.body.opportunities).toMatchObject({ available: true });
    expect(response.body.opportunities.items.map((item: { id: string }) => item.id)).toContain(opportunity.id);
    expect(response.body.nextActions).toMatchObject({ available: true });
    expect(response.body.nextActions.items.map((item: { id: string }) => item.id)).toContain(action.id);
    expect(response.body.timeline).toMatchObject({ available: true });
    expect(response.body.timeline.items.map((item: { id: string }) => item.id)).toEqual(expect.arrayContaining([contactActivity.id, opportunityActivity.id]));
    const timeline = await as(harness, tenantA).get(`/crm/accounts/${account.id}/timeline`);
    expect(timeline.status).toBe(200);
    expect(timeline.body.map((item: { id: string }) => item.id)).toEqual(expect.arrayContaining([contactActivity.id, opportunityActivity.id]));
    const assignees = await as(harness, tenantA).get("/crm/assignees");
    expect(assignees.status).toBe(200);
    expect(assignees.body).toContainEqual({ id: tenantA.userId, fullName: expect.any(String) });
    expect((await as(harness, tenantB).get(`/crm/accounts/${account.id}/360`)).status).toBe(404);
  });

  it("enforces next-action RBAC and redacts Account 360 sections without their read permissions", async () => {
    const owner = as(harness, tenantA);
    const account = (await owner.post("/crm/accounts", { name: `RBAC 360 ${suffix}` })).body;
    await owner.post("/crm/next-actions", { accountId: account.id, title: "Visible read-only action", dueAt: new Date(Date.now() + 86_400_000).toISOString(), assigneeUserId: tenantA.userId });

    const catalogue = await owner.get("/admin/permissions");
    const crm = catalogue.body.find((group: { module: string }) => group.module === "crm");
    expect(crm.permissions).toContainEqual({ key: "crm.nextaction.read", label: "Consulter les prochaines actions" });
    expect(crm.permissions).toContainEqual({ key: "crm.nextaction.manage", label: "Gérer les prochaines actions" });

    const role = await owner.post("/admin/roles", {
      name: `CRM next action reader ${suffix}`,
      permissions: ["crm.account.read", "crm.nextaction.read"],
    });
    expect(role.status).toBe(201);
    const password = "StrongPass123!";
    const email = `next-action-reader-${suffix}@test.example`;
    const user = await owner.post("/admin/users", {
      email,
      fullName: "Next action reader",
      password,
      roleIds: [role.body.id],
      companyIds: [tenantA.companyId],
    });
    expect(user.status).toBe(201);
    const login = await harness.http().post("/api/v1/auth/login").send({ email, password });
    expect(login.status).toBe(201);
    const reader = as(harness, { cookie: login.headers["set-cookie"] as unknown as string[] });

    expect((await reader.get(`/crm/next-actions?accountId=${account.id}`)).status).toBe(200);
    expect((await reader.get("/crm/assignees")).status).toBe(403);
    expect((await reader.get(`/crm/accounts/${account.id}/timeline`)).status).toBe(403);
    expect((await reader.post("/crm/next-actions", { accountId: account.id, title: "Forbidden write", dueAt: new Date(Date.now() + 86_400_000).toISOString(), assigneeUserId: user.body.id })).status).toBe(403);
    const account360 = await reader.get(`/crm/accounts/${account.id}/360`);
    expect(account360.status).toBe(200);
    expect(account360.body.account.id).toBe(account.id);
    expect(account360.body.nextActions).toMatchObject({ available: true });
    expect(account360.body.contacts).toEqual({ available: false, items: [] });
    expect(account360.body.opportunities).toEqual({ available: false, items: [] });
    expect(account360.body.timeline).toEqual({ available: false, items: [] });
  });
});
