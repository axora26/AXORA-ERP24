import { beforeAll, afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import { AppModule } from "../src/app.module.js";
import { PrismaService } from "../src/core/prisma.service.js";

describe("CRM directory, immutable history and conversion (PostgreSQL)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let cookie: string;
  let organizationId: string;
  let companyId: string;
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  beforeAll(async () => {
    const database = new URL(process.env.DATABASE_URL!);
    if (!database.pathname.endsWith("_test")) throw new Error("CRM directory tests require an isolated _test database");
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    prisma = app.get(PrismaService);
    app.use(cookieParser());
    app.setGlobalPrefix("api/v1");
    await app.init();
    const registered = await request(app.getHttpServer()).post("/api/v1/auth/register-organization")
      .set("Origin", "http://localhost:3100").send({ organizationName: `CRM directory ${suffix}`,
        organizationSlug: `crm-directory-${suffix}`, companyName: "CRM directory", ownerFullName: "CRM directory", ownerEmail: `crm-directory-${suffix}@test.example`, ownerPassword: "StrongPass123!" });
    expect(registered.status).toBe(201);
    cookie = registered.headers["set-cookie"] as unknown as string;
    organizationId = registered.body.user.organizationId;
    companyId = (await prisma.company.findFirstOrThrow({ where: { organizationId } })).id;
    await prisma.organization.update({ where: { id: organizationId }, data: { isDemo: true } });
  }, 30_000);
  afterAll(async () => { await app?.close(); });

  const get = (path: string) => request(app.getHttpServer()).get(`/api/v1/crm/${path}`).set("Cookie", cookie);
  const post = (path: string, body: object) => request(app.getHttpServer()).post(`/api/v1/crm/${path}`).set("Cookie", cookie).set("Origin", "http://localhost:3100").send(body);
  const patch = (path: string, body: object) => request(app.getHttpServer()).patch(`/api/v1/crm/${path}`).set("Cookie", cookie).set("Origin", "http://localhost:3100").send(body);

  it("returns editable account fields and commits mutation, version and audit together", async () => {
    const created = await post("accounts", { name: " Account alpha ", email: "alpha@test.example", website: "https://example.com", city: "Lagos" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: "Account alpha", website: "https://example.com", version: 1, archivedAt: null });
    const updated = await patch(`accounts/${created.body.id}`, { expectedVersion: 1, name: "Account alpha edited", email: null, website: null });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ name: "Account alpha edited", email: null, website: null, city: "Lagos", version: 2 });
    expect(updated.body.updatedAt).toMatch(/^\d{4}-/);
    expect(await prisma.auditLog.count({ where: { organizationId, resourceId: created.body.id } })).toBe(2);
    const history = await get(`activities/page?relatedType=Account&relatedId=${created.body.id}`);
    expect(history.status).toBe(200);
    expect(history.body.total).toBe(2);
  });

  it("accepts exactly one simultaneous edit and rejects stale versions without extra history", async () => {
    const created = await post("accounts", { name: "Concurrent account" });
    const results = await Promise.all(Array.from({ length: 8 }, (_, index) => patch(`accounts/${created.body.id}`, { expectedVersion: 1, city: `City ${index}` })));
    expect(results.filter((response) => response.status === 200)).toHaveLength(1);
    expect(results.filter((response) => response.status === 409)).toHaveLength(7);
    expect((await get(`accounts/${created.body.id}`)).body.version).toBe(2);
    expect(await prisma.auditLog.count({ where: { organizationId, resourceId: created.body.id } })).toBe(2);
    expect((await get(`activities/page?relatedType=Account&relatedId=${created.body.id}`)).body.total).toBe(2);
  });

  it("archives and restores accounts while preserving historical contacts and opportunities", async () => {
    const account = (await post("accounts", { name: "Archive account" })).body;
    const contact = (await post("contacts", { accountId: account.id, fullName: "Archive contact" })).body;
    const opportunity = await post("opportunities", { name: "Historical opportunity", amount: "12.34", accountId: account.id, contactId: contact.id });
    expect(opportunity.status).toBe(201);
    const archived = await post(`accounts/${account.id}/archive`, { expectedVersion: 1 });
    expect(archived.status).toBe(201);
    expect(archived.body.version).toBe(2);
    expect(archived.body.archivedAt).not.toBeNull();
    expect((await get("accounts")).body.some((item: { id: string }) => item.id === account.id)).toBe(false);
    const archivedPage = await get("accounts/page?archived=true&q=ARCHIVE");
    expect(archivedPage.body.items.map((item: { id: string }) => item.id)).toEqual([account.id]);
    expect((await get(`contacts/${contact.id}`)).body.accountId).toBe(account.id);
    expect((await prisma.crmOpportunity.findUniqueOrThrow({ where: { id: opportunity.body.id } })).accountId).toBe(account.id);
    expect((await patch(`accounts/${account.id}`, { expectedVersion: 2, city: "Changed" })).status).toBe(409);
    expect((await post("opportunities", { name: "Blocked", amount: "1.00", accountId: account.id })).status).toBe(409);
    expect((await post(`accounts/${account.id}/restore`, { expectedVersion: 1 })).status).toBe(409);
    const restored = await post(`accounts/${account.id}/restore`, { expectedVersion: 2 });
    expect(restored.status).toBe(201);
    expect(restored.body).toMatchObject({ version: 3, archivedAt: null });
    expect(await prisma.auditLog.count({ where: { organizationId, resourceId: account.id } })).toBe(3);
  });

  it("allows only one concurrent primary contact per account", async () => {
    const account = (await post("accounts", { name: "Primary account" })).body;
    const results = await Promise.all(Array.from({ length: 6 }, (_, index) => post("contacts", { accountId: account.id, fullName: `Primary ${index}`, isPrimary: true })));
    expect(results.filter((response) => response.status === 201)).toHaveLength(1);
    expect(results.filter((response) => response.status === 409)).toHaveLength(5);
    expect(await prisma.crmContact.count({ where: { accountId: account.id, isPrimary: true, archivedAt: null } })).toBe(1);
    expect((await post("contacts", { fullName: "Orphan primary", isPrimary: true })).status).toBe(400);
  });

  it("handles contact edits, archive and primary restore conflicts without losing versions", async () => {
    const account = (await post("accounts", { name: "Contact lifecycle" })).body;
    const contact = (await post("contacts", { accountId: account.id, fullName: "First primary", isPrimary: true })).body;
    const edited = await patch(`contacts/${contact.id}`, { expectedVersion: 1, jobTitle: "Director", email: "director@test.example", phone: null });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ version: 2, jobTitle: "Director", email: "director@test.example" });
    expect((await post(`contacts/${contact.id}/archive`, { expectedVersion: 2 })).status).toBe(201);
    expect((await get("contacts")).body.some((item: { id: string }) => item.id === contact.id)).toBe(false);
    expect((await get(`contacts/page?archived=true&accountId=${account.id}`)).body.total).toBe(1);
    const replacement = (await post("contacts", { accountId: account.id, fullName: "Second primary", isPrimary: true })).body;
    expect((await post(`contacts/${contact.id}/restore`, { expectedVersion: 3 })).status).toBe(409);
    expect((await get(`contacts/${contact.id}`)).body.version).toBe(3);
    expect((await patch(`contacts/${replacement.id}`, { expectedVersion: 1, isPrimary: false })).status).toBe(200);
    expect((await post(`contacts/${contact.id}/restore`, { expectedVersion: 3 })).body).toMatchObject({ version: 4, archivedAt: null });
  });

  it("searches and paginates scoped stable account and contact lists", async () => {
    const account = (await post("accounts", { name: "Search marker account" })).body;
    for (const fullName of ["Search marker A", "Search marker B", "Search marker C"]) expect((await post("contacts", { fullName, accountId: account.id })).status).toBe(201);
    const first = await get(`contacts/page?q=SEARCH%20MARKER&pageSize=2&accountId=${account.id}`);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ total: 3, page: 1, pageSize: 2, totalPages: 2 });
    expect(first.body.items.map((item: { fullName: string }) => item.fullName)).toEqual(["Search marker A", "Search marker B"]);
    const second = await get(`contacts/page?q=search%20marker&pageSize=2&page=2&accountId=${account.id}`);
    expect(second.body.items.map((item: { fullName: string }) => item.fullName)).toEqual(["Search marker C"]);
    expect((await get("accounts/page?q=no-such-marker")).body).toMatchObject({ items: [], total: 0, totalPages: 0 });
    expect(Array.isArray((await get("accounts")).body)).toBe(true);
    expect(Array.isArray((await get("contacts")).body)).toBe(true);
  });

  it("serializes competing contact reassignments and emits only the winning audit", async () => {
    const accounts = await Promise.all(["Reassign A", "Reassign B", "Reassign C"].map((name) => post("accounts", { name })));
    const contact = (await post("contacts", { accountId: accounts[0]!.body.id, fullName: "Reassigned contact", isPrimary: true })).body;
    const results = await Promise.all(Array.from({ length: 8 }, (_, index) => patch(`contacts/${contact.id}`, { expectedVersion: 1, accountId: accounts[1 + index % 2]!.body.id })));
    expect(results.filter((response) => response.status === 200)).toHaveLength(1);
    expect(results.filter((response) => response.status === 409)).toHaveLength(7);
    const updated = (await get(`contacts/${contact.id}`)).body;
    expect(updated.version).toBe(2);
    expect([accounts[1]!.body.id, accounts[2]!.body.id]).toContain(updated.accountId);
    expect(await prisma.auditLog.count({ where: { organizationId, resourceId: contact.id } })).toBe(2);
  });

  it("requires active parent and contact identities when restoring and linking opportunities", async () => {
    const account = (await post("accounts", { name: "Archived parent" })).body;
    const contact = (await post("contacts", { accountId: account.id, fullName: "Archived child" })).body;
    expect((await post(`contacts/${contact.id}/archive`, { expectedVersion: 1 })).status).toBe(201);
    expect((await post("opportunities", { name: "Archived contact link", amount: "1.00", accountId: account.id, contactId: contact.id })).status).toBe(409);
    expect((await post(`accounts/${account.id}/archive`, { expectedVersion: 1 })).status).toBe(201);
    expect((await post(`contacts/${contact.id}/restore`, { expectedVersion: 2 })).status).toBe(409);
    expect((await post(`accounts/${account.id}/restore`, { expectedVersion: 2 })).status).toBe(201);
    expect((await post(`contacts/${contact.id}/restore`, { expectedVersion: 2 })).status).toBe(201);
    expect((await post("opportunities", { name: "Restored contact link", amount: "1.00", accountId: account.id, contactId: contact.id })).status).toBe(201);
  });

  it("creates immutable user activities with audited paged filtered history", async () => {
    const account = (await post("accounts", { name: "Activity account" })).body;
    const created = await post("activities", { type: "CALL", subject: "Follow-up marker", body: "Discuss tender", relatedType: "Account", relatedId: account.id });
    expect(created.status).toBe(201);
    expect(await prisma.auditLog.count({ where: { organizationId, resourceId: created.body.id, action: "crm.activity.created" } })).toBe(1);
    const history = await get(`activities/page?relatedType=Account&relatedId=${account.id}&type=CALL&q=follow-up&pageSize=1`);
    expect(history.status).toBe(200);
    expect(history.body).toMatchObject({ total: 1, pageSize: 1, totalPages: 1 });
    expect(history.body.items[0].id).toBe(created.body.id);
    for (const type of ["CONVERSION", "STAGE_CHANGE"]) expect((await post("activities", { type, subject: "Forged", relatedType: "Account", relatedId: account.id })).status).toBe(400);
    expect((await patch(`activities/${created.body.id}`, { subject: "Overwrite" })).status).toBe(404);
    expect((await request(app.getHttpServer()).delete(`/api/v1/crm/activities/${created.body.id}`).set("Cookie", cookie).set("Origin", "http://localhost:3100")).status).toBe(404);
  });

  it("converts into selected existing identities with exact amount, currency and date", async () => {
    const account = (await post("accounts", { name: "Selected conversion" })).body;
    const contact = (await post("contacts", { fullName: "Selected contact", accountId: account.id })).body;
    const lead = (await post("leads", { contactName: "Lead identity", companyName: "Lead company" })).body;
    const before = await prisma.crmContact.count({ where: { organizationId, companyId } });
    const converted = await post(`leads/${lead.id}/convert`, { accountId: account.id, contactId: contact.id, opportunityName: "Selected tender", amount: "1234567.89", currency: "EUR", expectedCloseDate: "2026-12-31" });
    expect(converted.status).toBe(201);
    expect(converted.body).toMatchObject({ accountId: account.id, contactId: contact.id, name: "Selected tender", amount: "1234567.89", currency: "EUR", expectedCloseDate: "2026-12-31T00:00:00.000Z" });
    expect(await prisma.crmContact.count({ where: { organizationId, companyId } })).toBe(before);
    expect(await prisma.auditLog.count({ where: { resourceId: lead.id, action: "crm.lead.converted", organizationId } })).toBe(1);
  });

  it("rejects inconsistent and archived conversion identities atomically", async () => {
    const a = (await post("accounts", { name: "Conversion account A" })).body;
    const b = (await post("accounts", { name: "Conversion account B" })).body;
    const contact = (await post("contacts", { fullName: "Different contact", accountId: b.id })).body;
    const lead = (await post("leads", { contactName: "Blocked identity", companyName: "Blocked company" })).body;
    expect((await post(`leads/${lead.id}/convert`, { accountId: a.id, contactId: contact.id, amount: "10.00" })).status).toBe(400);
    expect((await post(`leads/${lead.id}/convert`, { contactId: contact.id })).status).toBe(400);
    expect((await post(`accounts/${a.id}/archive`, { expectedVersion: 1 })).status).toBe(201);
    expect((await post(`leads/${lead.id}/convert`, { accountId: a.id })).status).toBe(409);
    expect(await prisma.crmOpportunity.count({ where: { sourceLeadId: lead.id } })).toBe(0);
    expect((await prisma.crmLead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("NEW");
    expect(await prisma.auditLog.count({ where: { organizationId, resourceId: lead.id, action: "crm.lead.converted" } })).toBe(0);
  });

  it("serializes concurrent conversions that reuse one company name and one primary contact", async () => {
    const leads = await Promise.all(Array.from({ length: 4 }, (_, index) => post("leads", { contactName: `Shared ${index}`, companyName: "Shared conversion company" })));
    const results = await Promise.all(leads.map((lead) => post(`leads/${lead.body.id}/convert`, { amount: "100.00", currency: "USD" })));
    expect(results.every((response) => response.status === 201)).toBe(true);
    const accounts = await prisma.crmAccount.findMany({ where: { organizationId, companyId, name: "Shared conversion company" } });
    expect(accounts).toHaveLength(1);
    expect(await prisma.crmContact.count({ where: { accountId: accounts[0]!.id } })).toBe(4);
    expect(await prisma.crmContact.count({ where: { accountId: accounts[0]!.id, isPrimary: true, archivedAt: null } })).toBe(1);
  });

  it("rejects cross-company identity reads, edits, filters and conversion links", async () => {
    const other = await prisma.company.create({ data: { organizationId, name: "Other company", currency: "USD" } });
    const account = await prisma.crmAccount.create({ data: { organizationId, companyId: other.id, name: "Foreign account" } });
    const contact = await prisma.crmContact.create({ data: { organizationId, companyId: other.id, accountId: account.id, fullName: "Foreign contact" } });
    expect((await get(`accounts/${account.id}`)).status).toBe(404);
    expect((await patch(`accounts/${account.id}`, { expectedVersion: 1, name: "Steal" })).status).toBe(404);
    expect((await post(`contacts/${contact.id}/archive`, { expectedVersion: 1 })).status).toBe(404);
    expect((await get(`contacts/page?accountId=${account.id}`)).status).toBe(404);
    expect((await get(`activities/page?relatedType=Contact&relatedId=${contact.id}`)).status).toBe(404);
    expect((await post("contacts", { fullName: "Mislinked", accountId: account.id })).status).toBe(404);
    expect((await post("opportunities", { name: "Foreign", amount: "1.00", accountId: account.id })).status).toBe(404);
    expect((await get("accounts/page?q=Foreign")).body.total).toBe(0);
  });

  it("validates editable fields, versions, calendar dates and pagination", async () => {
    expect((await post("accounts", { name: "Bad website", website: "javascript:alert(1)" })).status).toBe(400);
    expect((await post("accounts", { name: "Bad email", email: "invalid" })).status).toBe(400);
    expect((await post("accounts", { name: "Scope injection", organizationId: "other" })).status).toBe(400);
    expect((await post("contacts", { fullName: "Boolean", isPrimary: "true" })).status).toBe(400);
    const account = (await post("accounts", { name: "Validation account" })).body;
    for (const body of [{ name: "No version" }, { expectedVersion: "1", name: "String version" }, { expectedVersion: 1 }, { expectedVersion: 1, archivedAt: null }]) expect((await patch(`accounts/${account.id}`, body)).status).toBe(400);
    for (const query of ["page=0", "page=abc", "pageSize=101", "archived=maybe", `q=${"a".repeat(181)}`]) expect((await get(`accounts/page?${query}`)).status).toBe(400);
    expect((await get("activities/page?relatedId=random")).status).toBe(400);
    expect((await get("activities/page?relatedType=Invalid")).status).toBe(400);
    expect((await post("opportunities", { name: "Bad date", amount: "1.00", expectedCloseDate: "2026-02-30" })).status).toBe(400);
  });
});
