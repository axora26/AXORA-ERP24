import { beforeAll, afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import { AppModule } from "../src/app.module.js";
import { PrismaService } from "../src/core/prisma.service.js";

describe("Study and DQE draft corrections (PostgreSQL)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let cookie: string;
  let organizationId: string;
  let companyId: string;
  let nextCode = 0;
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  beforeAll(async () => {
    if (!new URL(process.env.DATABASE_URL!).pathname.endsWith("_test")) throw new Error("Draft tests require an isolated _test database");
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication(); prisma = app.get(PrismaService);
    app.use(cookieParser()); app.setGlobalPrefix("api/v1"); await app.init();
    const registered = await request(app.getHttpServer()).post("/api/v1/auth/register-organization")
      .set("Origin", "http://localhost:3100").send({ organizationName: `Draft ${suffix}`, organizationSlug: `draft-${suffix}`,
        companyName: "Draft qualification", ownerEmail: `draft-${suffix}@test.example`, ownerPassword: "StrongPass123!", ownerFullName: "Draft qualification" });
    expect(registered.status).toBe(201); cookie = registered.headers["set-cookie"] as unknown as string;
    organizationId = registered.body.user.organizationId;
    companyId = (await prisma.company.findFirstOrThrow({ where: { organizationId } })).id;
    await prisma.organization.update({ where: { id: organizationId }, data: { isDemo: true } });
  }, 30_000);
  afterAll(async () => { await app?.close(); });
  const get = (path: string) => request(app.getHttpServer()).get(`/api/v1/estimation/${path}`).set("Cookie", cookie);
  const post = (path: string, body: object = {}) => request(app.getHttpServer()).post(`/api/v1/estimation/${path}`).set("Cookie", cookie).set("Origin", "http://localhost:3100").send(body);
  const patch = (path: string, body: object) => request(app.getHttpServer()).patch(`/api/v1/estimation/${path}`).set("Cookie", cookie).set("Origin", "http://localhost:3100").send(body);
  const remove = (path: string, body: object) => request(app.getHttpServer()).delete(`/api/v1/estimation/${path}`).set("Cookie", cookie).set("Origin", "http://localhost:3100").send(body);
  async function study() {
    const opportunity = await request(app.getHttpServer()).post("/api/v1/crm/opportunities").set("Cookie", cookie).set("Origin", "http://localhost:3100").send({ name: "Draft opportunity", amount: "1000.00" });
    expect(opportunity.status).toBe(201);
    const created = await post("studies", { opportunityId: opportunity.body.id, code: `ETU-${++nextCode}`, title: "Study draft", objective: "Correct draft data" });
    expect(created.status).toBe(201);
    const requirement = await post(`studies/${created.body.id}/requirements`, { position: 1, category: "FACT", statement: "Initial evidence", expectedVersion: 1 });
    expect(requirement.status).toBe(201);
    return (await get(`studies/${created.body.id}`)).body;
  }
  async function dqe() {
    const source = await study();
    expect((await post(`studies/${source.id}/ready`, { expectedVersion: source.version })).status).toBe(201);
    const created = await post("dqes", { studyId: source.id, code: `DQE-${++nextCode}`, title: "DQE draft", currency: "USD" });
    expect(created.status).toBe(201);
    const line = await post(`dqes/${created.body.id}/lines`, { position: 1, designation: "Initial item", unitCode: "u", quantity: "1", unitPrice: "10", expectedVersion: 1 });
    expect(line.status).toBe(201);
    return (await get(`dqes/${created.body.id}`)).body;
  }

  it("edits and deletes draft requirements with atomic parent version and audit", async () => {
    const current = await study(); const requirement = current.requirements[0];
    const edited = await patch(`studies/${current.id}/requirements/${requirement.id}`, { expectedVersion: 2, position: 3, statement: "Corrected evidence", category: "ASSUMPTION", sourceReference: "Drawing A" });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ version: 3, status: "DRAFT" });
    expect(edited.body.requirements[0]).toMatchObject({ id: requirement.id, position: 3, statement: "Corrected evidence", category: "ASSUMPTION", sourceReference: "Drawing A" });
    const cleared = await patch(`studies/${current.id}/requirements/${requirement.id}`, { expectedVersion: 3, sourceReference: null });
    expect(cleared.body.requirements[0].sourceReference).toBeNull();
    const deleted = await remove(`studies/${current.id}/requirements/${requirement.id}`, { expectedVersion: 4 });
    expect(deleted.status).toBe(200); expect(deleted.body).toMatchObject({ version: 5, requirements: [] });
    expect((await post(`studies/${current.id}/ready`, { expectedVersion: 5 })).status).toBe(400);
    expect(await prisma.auditLog.count({ where: { organizationId, resourceId: requirement.id } })).toBe(4);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { organizationId, resourceId: requirement.id, action: "estimation.study.requirement.deleted" } });
    expect(audit.metadata).toMatchObject({ parentId: current.id, version: 5, deletedSnapshot: { statement: "Corrected evidence", category: "ASSUMPTION" } });
  });

  it("creates a versioned lot, assigns an ouvrage and returns the exact lot subtotal", async () => {
    const current = await dqe();
    expect(current).toMatchObject({ version: 2, lots: [] });

    const created = await post(`dqes/${current.id}/lots`, {
      expectedVersion: 2,
      position: 1,
      code: "LOT-GO",
      designation: "Gros œuvre",
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      version: 3,
      lots: [{ position: 1, code: "LOT-GO", designation: "Gros œuvre", lineCount: 0, subtotal: "0.000000" }],
    });

    const lotId = created.body.lots[0].id as string;
    const assigned = await patch(`dqes/${current.id}/lines/${current.lines[0].id}`, { expectedVersion: 3, lotId });
    expect(assigned.status).toBe(200);
    expect(assigned.body).toMatchObject({ version: 4, subtotal: "10.000000" });
    expect(assigned.body.lines[0]).toMatchObject({ lotId, lineTotal: "10.000000" });
    expect(assigned.body.lots[0]).toMatchObject({ id: lotId, lineCount: 1, subtotal: "10.000000" });
    expect(await prisma.auditLog.count({ where: { organizationId, resourceId: lotId, action: "estimation.dqe.lot.created" } })).toBe(1);

    const other = await dqe();
    const otherLot = await post(`dqes/${other.id}/lots`, { expectedVersion: 2, position: 1, code: "LOT-OTHER", designation: "Lot d'un autre DQE" });
    expect(otherLot.status).toBe(201);
    await expect(prisma.dqeLine.update({
      where: { id: current.lines[0].id },
      data: { lotId: otherLot.body.lots[0].id },
    })).rejects.toMatchObject({ code: "P2003" });
  });

  it.each([null, ""])("unassigns a DQE lot with %j while preserving scope, version, totals and audit", async (clearLotId) => {
    const current = await dqe();
    const lineId = current.lines[0].id as string;
    const path = `dqes/${current.id}/lines/${lineId}`;
    const created = await post(`dqes/${current.id}/lots`, { expectedVersion: 2, position: 1, code: "LOT-CLEAR", designation: "Lot à désaffecter" });
    expect(created.status).toBe(201);
    const lotId = created.body.lots[0].id as string;
    const assigned = await patch(path, { expectedVersion: 3, lotId });
    expect(assigned.status).toBe(200);
    expect(assigned.body.lines[0].lotId).toBe(lotId);
    const identity = { id: lineId, organizationId, companyId, dqeId: current.id };
    expect(await prisma.dqeLine.findUniqueOrThrow({ where: { id: lineId } })).toMatchObject({ ...identity, lotId });

    const cleared = await patch(path, { expectedVersion: 4, lotId: clearLotId });
    expect(cleared.status).toBe(200);
    expect(cleared.body).toMatchObject({ version: 5, subtotal: "10.000000", total: "10.000000" });
    expect(cleared.body.lines[0]).toMatchObject({ id: lineId, lotId: null, lineTotal: "10.000000" });
    expect(cleared.body.lots[0]).toMatchObject({ id: lotId, lineCount: 0, subtotal: "0.000000" });
    expect(await prisma.dqeLine.findUniqueOrThrow({ where: { id: lineId } })).toMatchObject({ ...identity, lotId: null });
    const audit = await prisma.auditLog.findMany({ where: { organizationId, resourceId: lineId, action: "estimation.dqe.line.updated" } });
    expect(audit).toHaveLength(2);
    expect(audit).toEqual(expect.arrayContaining([expect.objectContaining({ metadata: expect.objectContaining({ companyId, parentId: current.id, version: 5, fields: ["lotId"] }) })]));
  });

  it.each([null, ""])("updates an already unassigned DQE line with lotId %j and keeps draft guards", async (clearLotId) => {
    const current = await dqe();
    const lineId = current.lines[0].id as string;
    const path = `dqes/${current.id}/lines/${lineId}`;
    const identity = { id: lineId, organizationId, companyId, dqeId: current.id, lotId: null };
    const edited = await patch(path, { expectedVersion: 2, lotId: clearLotId, quantity: "1.234560", unitPrice: "123.456780" });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ version: 3, subtotal: "152.414802", total: "152.414802", lots: [] });
    expect(edited.body.lines[0]).toMatchObject({ id: lineId, lotId: null, quantity: "1.234560", unitPrice: "123.456780", lineTotal: "152.414802" });
    expect(await prisma.dqeLine.findUniqueOrThrow({ where: { id: lineId } })).toMatchObject(identity);
    expect(await prisma.auditLog.count({ where: { organizationId, resourceId: lineId, action: "estimation.dqe.line.updated" } })).toBe(1);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { organizationId, resourceId: lineId, action: "estimation.dqe.line.updated" } });
    expect(audit.metadata).toMatchObject({ companyId, parentId: current.id, version: 3, fields: ["quantity", "unitPrice", "lotId"] });

    expect((await patch(path, { expectedVersion: 2, lotId: clearLotId, quantity: "99" })).status).toBe(409);
    expect((await get(`dqes/${current.id}`)).body).toMatchObject({ version: 3, subtotal: "152.414802" });
    expect((await post(`dqes/${current.id}/finalize`, { expectedVersion: 3 })).status).toBe(201);
    expect((await patch(path, { expectedVersion: 4, lotId: clearLotId, quantity: "99" })).status).toBe(400);
    expect((await get(`dqes/${current.id}`)).body).toMatchObject({ version: 4, status: "FINALIZED", subtotal: "152.414802" });
    expect(await prisma.dqeLine.findUniqueOrThrow({ where: { id: lineId } })).toMatchObject(identity);
    expect(await prisma.auditLog.count({ where: { organizationId, resourceId: lineId, action: "estimation.dqe.line.updated" } })).toBe(1);
  });

  it("rejects foreign lots and scope changes without mutating the DQE line, version or audit", async () => {
    const current = await dqe();
    const lineId = current.lines[0].id as string;
    const path = `dqes/${current.id}/lines/${lineId}`;
    const other = await dqe();
    const foreignCompany = await prisma.company.create({ data: { organizationId, name: "Foreign lot company" } });
    const foreignOrganization = await prisma.organization.create({ data: { name: "Foreign lot organization", slug: `foreign-lot-${suffix}` } });
    const foreignTenantCompany = await prisma.company.create({ data: { organizationId: foreignOrganization.id, name: "Foreign tenant company" } });
    const companyDocument = await prisma.dqeDocument.create({ data: { organizationId, companyId: foreignCompany.id, code: "FOREIGN-LOT", title: "Foreign company DQE" } });
    const tenantDocument = await prisma.dqeDocument.create({ data: { organizationId: foreignOrganization.id, companyId: foreignTenantCompany.id, code: "FOREIGN-LOT", title: "Foreign tenant DQE" } });
    const targets = [
      { organizationId, companyId, dqeId: other.id },
      { organizationId, companyId: foreignCompany.id, dqeId: companyDocument.id },
      { organizationId: foreignOrganization.id, companyId: foreignTenantCompany.id, dqeId: tenantDocument.id },
    ];
    const before = await prisma.dqeLine.findUniqueOrThrow({ where: { id: lineId } });
    const auditBefore = await prisma.auditLog.count({ where: { organizationId, resourceId: lineId } });
    const missingLot = await patch(path, { expectedVersion: 2, lotId: "missing-lot", quantity: "99" });
    expect(missingLot.status).toBe(404);
    for (const target of targets) {
      const lot = await prisma.dqeLot.create({ data: { ...target, position: 1, code: "LOT-FOREIGN", designation: "Foreign lot" } });
      const refused = await patch(path, { expectedVersion: 2, lotId: lot.id, quantity: "99" });
      expect(refused.status).toBe(404);
      expect(refused.body.message).toBe(missingLot.body.message);
    }
    for (const data of [{ dqeId: other.id }, { organizationId: foreignOrganization.id }, { companyId: foreignCompany.id }]) {
      await expect(prisma.dqeLine.update({ where: { id: lineId }, data })).rejects.toThrow("A DQE line cannot change document or scope");
    }
    for (const data of [{ dqeId: other.id }, { organizationId: foreignOrganization.id }]) {
      expect((await patch(path, { expectedVersion: 2, lotId: null, ...data })).status).toBe(400);
    }
    expect((await patch(path, { expectedVersion: 2, lotId: null, companyId: foreignCompany.id })).status).toBe(403);
    expect((await patch(`dqes/${other.id}/lines/${lineId}`, { expectedVersion: 2, lotId: null })).status).toBe(404);
    expect(await prisma.dqeLine.findUniqueOrThrow({ where: { id: lineId } })).toEqual(before);
    expect((await get(`dqes/${current.id}`)).body).toMatchObject({ version: 2, subtotal: "10.000000", lines: [expect.objectContaining({ id: lineId, lotId: null })] });
    expect(await prisma.auditLog.count({ where: { organizationId, resourceId: lineId } })).toBe(auditBefore);
  });

  it("corrects exact DQE quantities and prices, recalculates totals and deletes draft lines", async () => {
    const current = await dqe(); const line = current.lines[0];
    const edited = await patch(`dqes/${current.id}/lines/${line.id}`, { expectedVersion: 2, quantity: "1.234560", unitPrice: "123.456780", designation: "Corrected item", reference: "BPU-1" });
    expect(edited.status).toBe(200); expect(edited.body).toMatchObject({ version: 3, subtotal: "152.414802" });
    expect(edited.body.lines[0]).toMatchObject({ quantity: "1.234560", unitPrice: "123.456780", reference: "BPU-1", lineTotal: "152.414802" });
    const removed = await remove(`dqes/${current.id}/lines/${line.id}`, { expectedVersion: 3 });
    expect(removed.status).toBe(200); expect(removed.body).toMatchObject({ version: 4, lines: [], subtotal: "0.000000" });
    expect((await post(`dqes/${current.id}/finalize`, { expectedVersion: 4 })).status).toBe(400);
    expect(await prisma.auditLog.count({ where: { organizationId, resourceId: line.id } })).toBe(3);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { organizationId, resourceId: line.id, action: "estimation.dqe.line.deleted" } });
    expect(audit.metadata).toMatchObject({ deletedSnapshot: { quantity: "1.234560", unitPrice: "123.456780" } });
  });

  it("rejects stale parent versions and duplicate row positions without extra mutations", async () => {
    const current = await dqe(); const line = current.lines[0];
    const second = await post(`dqes/${current.id}/lines`, { position: 2, designation: "Second", unitCode: "u", quantity: "1", unitPrice: "2", expectedVersion: 2 });
    expect(second.status).toBe(201);
    expect((await patch(`dqes/${current.id}/lines/${line.id}`, { expectedVersion: 2, quantity: "3" })).status).toBe(409);
    expect((await patch(`dqes/${current.id}/lines/${line.id}`, { expectedVersion: 3, position: 2 })).status).toBe(409);
    expect((await remove(`dqes/${current.id}/lines/${line.id}`, { expectedVersion: 2 })).status).toBe(409);
    expect((await get(`dqes/${current.id}`)).body).toMatchObject({ version: 3, subtotal: "12.000000" });
    const source = await study(); const requirement = source.requirements[0];
    expect((await post(`studies/${source.id}/requirements`, { position: 1, category: "NOTE", statement: "Duplicate", expectedVersion: 2 })).status).toBe(409);
    expect((await patch(`studies/${source.id}/requirements/${requirement.id}`, { expectedVersion: 1, statement: "Stale" })).status).toBe(409);
    expect((await get(`studies/${source.id}`)).body.version).toBe(2);
  });

  it("permits only one concurrent correction for a shared parent version", async () => {
    const current = await dqe(); const line = current.lines[0];
    const edits = await Promise.all(Array.from({ length: 8 }, (_, index) => patch(`dqes/${current.id}/lines/${line.id}`, { expectedVersion: 2, quantity: `${index + 2}` })));
    expect(edits.filter((response) => response.status === 200)).toHaveLength(1);
    expect(edits.filter((response) => response.status === 409)).toHaveLength(7);
    expect((await get(`dqes/${current.id}`)).body.version).toBe(3);
    expect(await prisma.auditLog.count({ where: { organizationId, resourceId: line.id, action: "estimation.dqe.line.updated" } })).toBe(1);
  });

  it("serializes correction against finalization and preserves the frozen quote source", async () => {
    const current = await dqe(); const line = current.lines[0];
    const [edited, finalized] = await Promise.all([
      patch(`dqes/${current.id}/lines/${line.id}`, { expectedVersion: 2, quantity: "4" }),
      post(`dqes/${current.id}/finalize`, { expectedVersion: 2 }),
    ]);
    expect([edited.status, finalized.status].filter((status) => status < 300)).toHaveLength(1);
    let latest = (await get(`dqes/${current.id}`)).body;
    if (latest.status === "DRAFT") {
      expect(finalized.status).toBe(409);
      expect((await post(`dqes/${current.id}/finalize`, { expectedVersion: latest.version })).status).toBe(201);
      latest = (await get(`dqes/${current.id}`)).body;
    } else expect(edited.status).toBe(400);
    expect((await patch(`dqes/${current.id}/lines/${line.id}`, { expectedVersion: latest.version, quantity: "99" })).status).toBe(400);
    expect((await remove(`dqes/${current.id}/lines/${line.id}`, { expectedVersion: latest.version })).status).toBe(400);
    const quote = await request(app.getHttpServer()).post("/api/v1/sales/quotes").set("Cookie", cookie).set("Origin", "http://localhost:3100").send({ dqeId: current.id, code: `DEV-${++nextCode}`, title: "Frozen corrected quote" });
    expect(quote.status).toBe(201);
    expect(quote.body.lines[0].quantity).toBe(latest.lines[0].quantity);
    expect(quote.body.subtotal).toBe(latest.subtotal);
  });

  it("rejects requirement edits and deletion after study readiness", async () => {
    const current = await study(); const requirement = current.requirements[0];
    const ready = await post(`studies/${current.id}/ready`, { expectedVersion: current.version });
    expect(ready.status).toBe(201); expect(ready.body.version).toBe(3);
    expect((await patch(`studies/${current.id}/requirements/${requirement.id}`, { expectedVersion: 3, statement: "After freeze" })).status).toBe(400);
    expect((await remove(`studies/${current.id}/requirements/${requirement.id}`, { expectedVersion: 3 })).status).toBe(400);
    expect((await get(`studies/${current.id}`)).body.requirements[0].statement).toBe("Initial evidence");
  });

  it("serializes requirement correction against readiness", async () => {
    const source = await study(); const requirement = source.requirements[0];
    const [edited, ready] = await Promise.all([
      patch(`studies/${source.id}/requirements/${requirement.id}`, { expectedVersion: 2, statement: "Concurrent corrected evidence" }),
      post(`studies/${source.id}/ready`, { expectedVersion: 2 }),
    ]);
    expect([edited.status, ready.status].filter((status) => status < 300)).toHaveLength(1);
    let latest = (await get(`studies/${source.id}`)).body;
    if (latest.status === "DRAFT") {
      expect(ready.status).toBe(409);
      expect(latest.requirements[0].statement).toBe("Concurrent corrected evidence");
      expect((await post(`studies/${source.id}/ready`, { expectedVersion: latest.version })).status).toBe(201);
      latest = (await get(`studies/${source.id}`)).body;
    } else {
      expect(edited.status).toBe(400);
      expect(latest.requirements[0].statement).toBe("Initial evidence");
    }
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { organizationId, resourceId: source.id, action: "estimation.study.ready" } });
    expect(audit.metadata).toMatchObject({ requirementCount: latest.requirements.length });
  });

  it("cannot finalize an empty DQE while its last draft line is being deleted", async () => {
    const current = await dqe();
    const [deleted, finalized] = await Promise.all([
      remove(`dqes/${current.id}/lines/${current.lines[0].id}`, { expectedVersion: 2 }),
      post(`dqes/${current.id}/finalize`, { expectedVersion: 2 }),
    ]);
    expect([deleted.status, finalized.status].filter((status) => status < 300)).toHaveLength(1);
    const latest = (await get(`dqes/${current.id}`)).body;
    if (latest.status === "FINALIZED") {
      expect(deleted.status).toBe(400);
      expect(latest.lines).toHaveLength(1);
    } else {
      expect(finalized.status).toBe(409);
      expect(latest.lines).toHaveLength(0);
      expect((await post(`dqes/${current.id}/finalize`, { expectedVersion: latest.version })).status).toBe(400);
    }
  });

  it("enforces frozen sources even for direct SQL writes", async () => {
    const source = await study();
    expect((await post(`studies/${source.id}/ready`, { expectedVersion: source.version })).status).toBe(201);
    await expect(prisma.estimationStudyRequirement.update({ where: { id: source.requirements[0].id }, data: { statement: "SQL override" } })).rejects.toThrow();
    await expect(prisma.estimationStudyRequirement.delete({ where: { id: source.requirements[0].id } })).rejects.toThrow();
    await expect(prisma.estimationStudyRequirement.create({ data: { organizationId, companyId, studyId: source.id, position: 2, category: "NOTE", statement: "SQL append after freeze" } })).rejects.toThrow();
    const current = await dqe();
    const structured = await post(`dqes/${current.id}/lots`, { expectedVersion: current.version, position: 1, code: "LOT-FROZEN", designation: "Lot figé" });
    expect(structured.status).toBe(201);
    const frozenLotId = structured.body.lots[0].id as string;
    expect((await post(`dqes/${current.id}/finalize`, { expectedVersion: structured.body.version })).status).toBe(201);
    await expect(prisma.dqeLine.update({ where: { id: current.lines[0].id }, data: { quantity: "99" } })).rejects.toThrow();
    await expect(prisma.dqeLot.update({ where: { id: frozenLotId }, data: { designation: "SQL override" } })).rejects.toThrow();
    await expect(prisma.dqeLot.delete({ where: { id: frozenLotId } })).rejects.toThrow();
    await expect(prisma.dqeLot.create({ data: { organizationId, companyId, dqeId: current.id, position: 2, code: "LOT-LATE", designation: "Lot tardif" } })).rejects.toThrow();
    const otherDraft = await dqe();
    await expect(prisma.dqeLot.update({ where: { id: frozenLotId }, data: { dqeId: otherDraft.id } })).rejects.toThrow();
    await expect(prisma.dqeLine.delete({ where: { id: current.lines[0].id } })).rejects.toThrow();
    const sourceBefore = (await get(`dqes/${current.id}`)).body;
    expect(sourceBefore.lines[0].quantity).toBe("1.000000");
  });

  it("checks parent identity and company scope for every correction and deletion", async () => {
    const first = await dqe(); const second = await dqe();
    expect((await patch(`dqes/${first.id}/lines/${second.lines[0].id}`, { expectedVersion: first.version, quantity: "2" })).status).toBe(404);
    expect((await remove(`dqes/${first.id}/lines/${second.lines[0].id}`, { expectedVersion: first.version })).status).toBe(404);
    const a = await study(); const b = await study();
    expect((await patch(`studies/${a.id}/requirements/${b.requirements[0].id}`, { expectedVersion: a.version, statement: "Mislinked" })).status).toBe(404);
    const other = await prisma.company.create({ data: { organizationId, name: "Foreign draft company" } });
    const foreign = await prisma.dqeDocument.create({ data: { organizationId, companyId: other.id, code: "FOREIGN", title: "Foreign draft" } });
    const foreignLine = await prisma.dqeLine.create({ data: { organizationId, companyId: other.id, dqeId: foreign.id, position: 1, designation: "Foreign", unitCode: "u", quantity: "1", unitPrice: "1" } });
    expect((await patch(`dqes/${foreign.id}/lines/${foreignLine.id}`, { expectedVersion: 1, quantity: "2" })).status).toBe(404);
    expect((await remove(`dqes/${foreign.id}/lines/${foreignLine.id}`, { expectedVersion: 1 })).status).toBe(404);
    expect((await prisma.dqeLine.findUniqueOrThrow({ where: { id: foreignLine.id } })).quantity.toFixed(6)).toBe("1.000000");
    expect(await prisma.auditLog.count({ where: { organizationId, resourceId: foreignLine.id } })).toBe(0);
    expect(companyId).not.toBe(other.id);
  });

  it("requires numeric versions, strict patch fields and exact decimal strings", async () => {
    const current = await dqe(); const line = current.lines[0];
    for (const body of [{ quantity: "2" }, { expectedVersion: "2", quantity: "2" }, { expectedVersion: 2 }, { expectedVersion: 2, quantity: 2 }, { expectedVersion: 2, quantity: "1.0000001" }, { expectedVersion: 2, dqeId: "other" }]) {
      expect((await patch(`dqes/${current.id}/lines/${line.id}`, body)).status).toBe(400);
    }
    expect((await remove(`dqes/${current.id}/lines/${line.id}`, {})).status).toBe(400);
    expect((await post(`dqes/${current.id}/finalize`, { expectedVersion: 1 })).status).toBe(409);
    expect((await get(`dqes/${current.id}`)).body.version).toBe(2);
  });

  it("calculates advanced cost breakdowns with exact decimal rates", async () => {
    const current = await dqe(); const line = current.lines[0];
    const categorized = await patch(`dqes/${current.id}/lines/${line.id}`, { expectedVersion: 2, costCategory: "LABOR" });
    expect(categorized.status).toBe(200);
    const priced = await patch(`dqes/${current.id}/pricing`, { expectedVersion: 3, overheadRate: "10.000000", marginRate: "5.000000", taxRate: "16.000000" });
    expect(priced.status).toBe(200);
    expect(priced.body).toMatchObject({ version: 4, subtotal: "10.000000", overheadAmount: "1.000000", costBase: "11.000000", marginAmount: "0.550000", taxableTotal: "11.550000", taxAmount: "1.848000", total: "13.398000", overheadRate: "10.000000", marginRate: "5.000000", taxRate: "16.000000" });
    expect(priced.body.categoryTotals).toMatchObject({ LABOR: "10.000000", MATERIAL: "0.000000" });
    expect(priced.body.lines[0].costCategory).toBe("LABOR");
    expect((await patch(`dqes/${current.id}/pricing`, { expectedVersion: 4, taxRate: "100.000001" })).status).toBe(400);
    expect((await post(`dqes/${current.id}/finalize`, { expectedVersion: 4 })).status).toBe(201);
    expect((await patch(`dqes/${current.id}/pricing`, { expectedVersion: 5, marginRate: "1" })).status).toBe(400);
  });

  it("captures immutable DQE variants and compares their current delta", async () => {
    const current = await dqe();
    const structured = await post(`dqes/${current.id}/lots`, { expectedVersion: 2, position: 1, code: "LOT-A", designation: "Lot capturé" });
    expect(structured.status).toBe(201);
    const lotId = structured.body.lots[0].id as string;
    expect((await patch(`dqes/${current.id}/lines/${current.lines[0].id}`, { expectedVersion: 3, lotId })).status).toBe(200);
    expect((await post(`dqes/${current.id}/variants`, { code: "OPT-NO-VERSION", title: "Sans version" })).status).toBe(400);
    const captured = await post(`dqes/${current.id}/variants`, { expectedVersion: 4, code: "OPT-A", title: "Option de référence" });
    expect(captured.status).toBe(201);
    expect(captured.body).toMatchObject({ dqeId: current.id, code: "OPT-A", subtotal: "10.000000", total: "10.000000", deltaSubtotal: "0.000000", deltaTotal: "0.000000" });
    const persisted = await prisma.dqeVariant.findUniqueOrThrow({ where: { id: captured.body.id } });
    expect(persisted.snapshot).toMatchObject({
      lots: [{ id: lotId, position: 1, code: "LOT-A", designation: "Lot capturé", lineCount: 1, subtotal: "10.000000" }],
      lines: [expect.objectContaining({ lotId })],
    });
    expect((await post(`dqes/${current.id}/variants`, { expectedVersion: 4, code: "OPT-A", title: "Doublon" })).status).toBe(409);
    const priced = await patch(`dqes/${current.id}/pricing`, { expectedVersion: 4, marginRate: "10.000000" });
    expect(priced.status).toBe(200);
    expect((await post(`dqes/${current.id}/variants`, { expectedVersion: 4, code: "OPT-STALE", title: "Capture périmée" })).status).toBe(409);
    const variants = await get(`dqes/${current.id}/variants`);
    expect(variants.status).toBe(200);
    expect(variants.body[0]).toMatchObject({ code: "OPT-A", deltaSubtotal: "0.000000", deltaTotal: "-1.000000" });
  });

  it("manages a scoped DQE library with exact reusable prices", async () => {
    const created = await post("library", { code: "OUV-001", designation: "Béton C25/30", unitCode: "m3", costCategory: "MATERIAL", unitPrice: "125.500000" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ code: "OUV-001", unitPrice: "125.500000", isActive: true });
    const updated = await patch(`library/${created.body.id}`, { unitPrice: "130.250000", isActive: false });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ unitPrice: "130.250000", isActive: false });
    const listed = await get("library");
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual(expect.arrayContaining([expect.objectContaining({ id: created.body.id, code: "OUV-001", isActive: false })]));
    expect((await post("library", { code: "OUV-001", designation: "Doublon", unitCode: "u", unitPrice: "1" })).status).toBe(409);
  });
});
