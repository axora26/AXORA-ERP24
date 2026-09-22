import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module.js";
import { PrismaService } from "../src/core/prisma.service.js";

describe("Estimation Study -> DQE (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const suffix = Date.now();

  const tenantA = {
    slug: `estimate-a-${suffix}`,
    email: `owner-estimate-a-${suffix}@test.com`,
    cookie: [] as string[],
  };
  const tenantB = {
    slug: `estimate-b-${suffix}`,
    email: `owner-estimate-b-${suffix}@test.com`,
    cookie: [] as string[],
  };

  let opportunityId = "";
  let studyId = "";
  let dqeId = "";

  function http() {
    return request(app.getHttpServer());
  }

  async function bootstrap(tenant: typeof tenantA): Promise<void> {
    const registered = await http()
      .post("/api/v1/auth/register-organization")
      .send({
        organizationName: `Org ${tenant.slug}`,
        organizationSlug: tenant.slug,
        companyName: `Company ${tenant.slug}`,
        ownerEmail: tenant.email,
        ownerPassword: "StrongPass123!",
        ownerFullName: `Owner ${tenant.slug}`,
      });

    expect(registered.status).toBe(201);
    tenant.cookie = registered.headers["set-cookie"] as unknown as string[];
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    prisma = app.get(PrismaService);
    app.use(cookieParser());
    app.setGlobalPrefix("api/v1", { exclude: ["health"] });
    await app.init();

    await bootstrap(tenantA);
    await bootstrap(tenantB);

    const opportunity = await http()
      .post("/api/v1/crm/opportunities")
      .set("Cookie", tenantA.cookie)
      .send({ name: `Campus solaire ${suffix}`, amount: "250000.00", currency: "USD" });
    expect(opportunity.status).toBe(201);
    opportunityId = opportunity.body.id as string;
  });

  afterAll(async () => {
    await app.close();
  });

  it("requires an authenticated session on estimation routes", async () => {
    const response = await http().get("/api/v1/estimation/studies");
    expect(response.status).toBe(401);
  });

  it("creates a company-scoped study from a CRM opportunity", async () => {
    const response = await http()
      .post("/api/v1/estimation/studies")
      .set("Cookie", tenantA.cookie)
      .send({
        opportunityId,
        code: `ST-${suffix}`,
        title: "Etude technique et commerciale",
        objective: "Etablir les hypothèses vérifiables avant le chiffrage.",
      });

    expect(response.status).toBe(201);
    expect(response.body.opportunityId).toBe(opportunityId);
    expect(response.body.status).toBe("DRAFT");
    studyId = response.body.id as string;
  });

  it("records immutable study requirements and only then marks the study ready", async () => {
    const emptyReady = await http()
      .post(`/api/v1/estimation/studies/${studyId}/ready`)
      .set("Cookie", tenantA.cookie);
    expect(emptyReady.status).toBe(400);

    const requirement = await http()
      .post(`/api/v1/estimation/studies/${studyId}/requirements`)
      .set("Cookie", tenantA.cookie)
      .send({
        position: 1,
        category: "FACT",
        statement: "Surface utile confirmée : 1 250 m².",
        sourceReference: "PV-CLIENT-001",
      });
    expect(requirement.status).toBe(201);
    expect(requirement.body.category).toBe("FACT");

    const ready = await http()
      .post(`/api/v1/estimation/studies/${studyId}/ready`)
      .set("Cookie", tenantA.cookie);
    expect(ready.status).toBe(201);
    expect(ready.body.status).toBe("READY_FOR_DQE");
  });

  it("creates a draft DQE with an immutable Study source snapshot", async () => {
    const response = await http()
      .post("/api/v1/estimation/dqes")
      .set("Cookie", tenantA.cookie)
      .send({
        studyId,
        code: `DQE-${suffix}`,
        title: "DQE Campus solaire",
        currency: "USD",
      });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe("DRAFT");
    expect(response.body.revision).toBe(1);
    expect(response.body.source.studyId).toBe(studyId);
    expect(response.body.source.studyCode).toBe(`ST-${suffix}`);
    dqeId = response.body.id as string;
  });

  it("rejects IEEE-754 numbers and preserves exact Decimal arithmetic", async () => {
    const numeric = await http()
      .post(`/api/v1/estimation/dqes/${dqeId}/lines`)
      .set("Cookie", tenantA.cookie)
      .send({
        position: 1,
        designation: "Quantité flottante interdite",
        unitCode: "m2",
        quantity: 0.1,
        unitPrice: "0.20",
      });
    expect(numeric.status).toBe(400);

    const first = await http()
      .post(`/api/v1/estimation/dqes/${dqeId}/lines`)
      .set("Cookie", tenantA.cookie)
      .send({
        position: 1,
        reference: "SOL-001",
        designation: "Panneau photovoltaïque",
        unitCode: "u",
        quantity: "3.000000",
        unitPrice: "0.100000",
      });
    expect(first.status).toBe(201);
    expect(first.body.lineTotal).toBe("0.300000");

    const second = await http()
      .post(`/api/v1/estimation/dqes/${dqeId}/lines`)
      .set("Cookie", tenantA.cookie)
      .send({
        position: 2,
        designation: "Câblage",
        unitCode: "ml",
        quantity: "0.200000",
        unitPrice: "1.000000",
      });
    expect(second.status).toBe(201);

    const document = await http()
      .get(`/api/v1/estimation/dqes/${dqeId}`)
      .set("Cookie", tenantA.cookie);
    expect(document.status).toBe(200);
    expect(document.body.subtotal).toBe("0.500000");
    expect(document.body.lines).toHaveLength(2);
  });

  it("finalizes a non-empty DQE and rejects every later line mutation", async () => {
    const finalized = await http()
      .post(`/api/v1/estimation/dqes/${dqeId}/finalize`)
      .set("Cookie", tenantA.cookie);
    expect(finalized.status).toBe(201);
    expect(finalized.body.status).toBe("FINALIZED");

    const mutation = await http()
      .post(`/api/v1/estimation/dqes/${dqeId}/lines`)
      .set("Cookie", tenantA.cookie)
      .send({
        position: 3,
        designation: "Mutation interdite",
        unitCode: "u",
        quantity: "1.000000",
        unitPrice: "1.000000",
      });
    expect(mutation.status).toBe(400);
  });

  it("never exposes another tenant's Study or DQE by direct identifier", async () => {
    const crossStudy = await http()
      .get(`/api/v1/estimation/studies/${studyId}`)
      .set("Cookie", tenantB.cookie);
    expect(crossStudy.status).toBe(404);

    const crossDqe = await http()
      .get(`/api/v1/estimation/dqes/${dqeId}`)
      .set("Cookie", tenantB.cookie);
    expect(crossDqe.status).toBe(404);
  });

  it("persists an audit event for DQE finalization", async () => {
    const audit = await prisma.auditLog.findFirst({
      where: { action: "estimation.dqe.finalized", resourceId: dqeId },
    });
    expect(audit).not.toBeNull();
    expect(audit?.metadata).toMatchObject({ status: "FINALIZED" });
  });
});
