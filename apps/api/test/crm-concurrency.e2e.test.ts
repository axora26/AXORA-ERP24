import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module.js";
import { PrismaService } from "../src/core/prisma.service.js";

describe("CRM concurrency and exact currency buckets (PostgreSQL)", () => {
  let app: INestApplication; let prisma: PrismaService;
  let cookie: string[]; let companyId: string; let organizationId: string;
  let stages: Array<{ id: string; isWon: boolean; isLost: boolean }>;
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  beforeAll(async () => {
    // The qualification suite must never connect to the user's original DB.
    const database = new URL(process.env.DATABASE_URL!);
    if (!database.pathname.endsWith("_test")) throw new Error("CRM qualification requires an isolated *_test database");
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication(); prisma = app.get(PrismaService);
    app.use(cookieParser()); app.setGlobalPrefix("api/v1", { exclude: ["health"] }); await app.init();
    const registered = await request(app.getHttpServer()).post("/api/v1/auth/register-organization").set("Origin", "http://localhost:3100").send({
      organizationName: `CRM qualification ${suffix}`, organizationSlug: `crm-qualification-${suffix}`, companyName: "Qualification CRM",
      ownerEmail: `crm-qualification-${suffix}@test.example`, ownerPassword: "StrongPass123!", ownerFullName: "Qualification Owner",
    });
    expect(registered.status).toBe(201); cookie = registered.headers["set-cookie"] as unknown as string[];
    organizationId = registered.body.user.organizationId;
    const company = await prisma.company.findFirstOrThrow({ where: { organizationId } }); companyId = company.id;
    await prisma.organization.update({ where: { id: organizationId }, data: { isDemo: true } });
    stages = (await request(app.getHttpServer()).get("/api/v1/crm/pipeline/stages").set("Cookie", cookie)).body;
  });
  afterAll(async () => { await app?.close(); });
  function post(path: string, body: object) {
    return request(app.getHttpServer()).post(`/api/v1/crm/${path}`).set("Cookie", cookie).set("Origin", "http://localhost:3100").send(body);
  }
  function patch(path: string, body: object) {
    return request(app.getHttpServer()).patch(`/api/v1/crm/${path}`).set("Cookie", cookie).set("Origin", "http://localhost:3100").send(body);
  }
  it("serializes eight simultaneous conversions into exactly one opportunity and two conversion history entries", async () => {
    const name = `Existing customer ${suffix}`;
    expect((await post("accounts", { name })).status).toBe(201);
    const lead = await post("leads", { contactName: "Jane Atomic", companyName: name }); expect(lead.status).toBe(201);
    const results = await Promise.all(Array.from({ length: 8 }, () => post(`leads/${lead.body.id}/convert`, { amount: "123.45", currency: "USD" })));
    expect(results.filter((response) => response.status === 201)).toHaveLength(1);
    expect(results.filter((response) => response.status === 400)).toHaveLength(7);
    expect(await prisma.crmOpportunity.count({ where: { sourceLeadId: lead.body.id, organizationId, companyId } })).toBe(1);
    const opportunity = await prisma.crmOpportunity.findFirstOrThrow({ where: { sourceLeadId: lead.body.id } });
    expect(await prisma.crmActivity.count({ where: { organizationId, companyId, type: "CONVERSION",
      OR: [{ relatedType: "Lead", relatedId: lead.body.id }, { relatedType: "Opportunity", relatedId: opportunity.id }] } })).toBe(2);
  });
  it("does not let concurrent status edits reopen a lead once conversion has succeeded", async () => {
    const name = `Converted lead race ${suffix}`;
    expect((await post("accounts", { name })).status).toBe(201);
    const lead = await post("leads", { contactName: "Race Contact", companyName: name });
    const responses = await Promise.all([
      post(`leads/${lead.body.id}/convert`, { amount: "1.00", currency: "USD" }),
      ...Array.from({ length: 5 }, () => patch(`leads/${lead.body.id}/status`, { status: "QUALIFIED" })),
    ]);
    expect(responses[0]!.status).toBe(201);
    expect((await prisma.crmLead.findUniqueOrThrow({ where: { id: lead.body.id } })).status).toBe("CONVERTED");
  });
  it("does not let concurrent moves reopen an opportunity after a successful closing move", async () => {
    const won = stages.find((stage) => stage.isWon)!;
    const open = stages.find((stage) => !stage.isWon && !stage.isLost)!;
    const opportunity = await post("opportunities", { name: `Closing race ${suffix}`, amount: "42.00", currency: "USD" });
    const responses = await Promise.all([
      patch(`opportunities/${opportunity.body.id}/stage`, { stageId: won.id }),
      ...Array.from({ length: 5 }, () => patch(`opportunities/${opportunity.body.id}/stage`, { stageId: open.id })),
    ]);
    expect(responses[0]!.status).toBe(200);
    const stored = await prisma.crmOpportunity.findUniqueOrThrow({ where: { id: opportunity.body.id } });
    expect(stored.status).toBe("WON"); expect(stored.stageId).toBe(won.id); expect(stored.closedAt).not.toBeNull();
  });
  it("refuses creating or converting an OPEN opportunity in a closed pipeline stage", async () => {
    const won = stages.find((stage) => stage.isWon)!;
    expect((await post("opportunities", { name: "Inconsistent status", stageId: won.id, amount: "1", currency: "USD" })).status).toBe(400);
    const lead = await post("leads", { contactName: "Closed stage", companyName: `Closed ${suffix}` });
    expect((await post(`leads/${lead.body.id}/convert`, { stageId: won.id, amount: "1", currency: "USD" })).status).toBe(400);
    expect(await prisma.crmOpportunity.count({ where: { sourceLeadId: lead.body.id } })).toBe(0);
  });
  it("never labels won EUR as USD or returns a combined amount for mixed currencies", async () => {
    const won = stages.find((stage) => stage.isWon)!;
    const foreign = await post("opportunities", { name: "Foreign won", amount: "987.65", currency: "EUR" });
    expect((await patch(`opportunities/${foreign.body.id}/stage`, { stageId: won.id })).status).toBe(200);
    const dashboard = await request(app.getHttpServer()).get("/api/v1/crm/dashboard").set("Cookie", cookie);
    expect(dashboard.status).toBe(200); expect(dashboard.body.currency).toBe("MIXED");
    expect(dashboard.body.pipelineValue).toBeNull(); expect(dashboard.body.wonValue).toBeNull(); expect(dashboard.body.weightedPipelineValue).toBeNull();
    expect(dashboard.body.currencyBreakdown.map((entry: { currency: string }) => entry.currency)).toEqual(["EUR", "USD"]);
    const eur = dashboard.body.currencyBreakdown.find((entry: { currency: string }) => entry.currency === "EUR");
    expect(eur.wonValue).toBe("987.65"); expect(eur.pipelineValue).toBe("0.00");
    const usd = dashboard.body.currencyBreakdown.find((entry: { currency: string }) => entry.currency === "USD");
    expect(usd.wonValue).toBe("42.00"); expect(usd.pipelineValue).toBe("124.45");
    expect(dashboard.body.stages.every((stage: { value: string | null }) => stage.value === null)).toBe(true);
  });
});
