import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module.js";
import { PrismaService } from "../src/core/prisma.service.js";

/**
 * INC-02 — CRM : tests d'integration contre une base PostgreSQL REELLE.
 *
 * Couvre la Definition of Done du backlog :
 * - isolation cross-company testee (assertion croisee explicite, y compris
 *   tentative de forger un companyId appartenant a un autre tenant) ;
 * - CRUD + pipeline testes en integration ;
 * - parcours E2E Lead -> Opportunite (§5.1 du backlog) ;
 * - historique d'activites immuable ;
 * - arithmetique decimale exacte sur les montants.
 */
describe("CRM (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const suffix = Date.now();

  // Deux tenants distincts, crees une fois pour toute la suite.
  const tenantA = {
    slug: `crm-a-${suffix}`,
    email: `owner-crm-a-${suffix}@test.com`,
    password: "StrongPass123!",
    cookie: [] as string[],
    companyId: "",
  };
  const tenantB = {
    slug: `crm-b-${suffix}`,
    email: `owner-crm-b-${suffix}@test.com`,
    password: "StrongPass123!",
    cookie: [] as string[],
    companyId: "",
  };

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
        ownerPassword: tenant.password,
        ownerFullName: `Owner ${tenant.slug}`,
      });
    expect(registered.status).toBe(201);
    tenant.cookie = registered.headers["set-cookie"] as unknown as string[];

    const company = await prisma.company.findFirst({
      where: { organization: { slug: tenant.slug } },
      select: { id: true },
    });
    expect(company).not.toBeNull();
    tenant.companyId = company!.id;
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
  });

  afterAll(async () => {
    await app.close();
  });

  // -------------------------------------------------------------------------
  // Authentification et autorisation
  // -------------------------------------------------------------------------

  it("denies every CRM route without a session (401)", async () => {
    for (const path of [
      "/api/v1/crm/leads",
      "/api/v1/crm/opportunities",
      "/api/v1/crm/accounts",
      "/api/v1/crm/activities",
      "/api/v1/crm/pipeline/stages",
      "/api/v1/crm/dashboard",
    ]) {
      const response = await http().get(path);
      expect(response.status, `${path} must require a session`).toBe(401);
    }
  });

  // -------------------------------------------------------------------------
  // Pipeline
  // -------------------------------------------------------------------------

  it("provisions a default pipeline when the organization is bootstrapped", async () => {
    const response = await http().get("/api/v1/crm/pipeline/stages").set("Cookie", tenantA.cookie);

    expect(response.status).toBe(200);
    expect(response.body.length).toBeGreaterThanOrEqual(4);

    const positions = response.body.map((stage: { position: number }) => stage.position);
    expect([...positions]).toEqual([...positions].sort((a: number, b: number) => a - b));

    expect(response.body.some((stage: { isWon: boolean }) => stage.isWon)).toBe(true);
    expect(response.body.some((stage: { isLost: boolean }) => stage.isLost)).toBe(true);
    expect(
      response.body.every((stage: { companyId: string }) => stage.companyId === tenantA.companyId),
    ).toBe(true);
  });

  it("rejects a stage flagged both won and lost (400)", async () => {
    const response = await http()
      .post("/api/v1/crm/pipeline/stages")
      .set("Cookie", tenantA.cookie)
      .send({ name: `Incoherente ${suffix}`, position: 90, isWon: true, isLost: true });

    expect(response.status).toBe(400);
  });

  it("creates a custom pipeline stage scoped to the caller's company", async () => {
    const response = await http()
      .post("/api/v1/crm/pipeline/stages")
      .set("Cookie", tenantA.cookie)
      .send({ name: `Avant-projet ${suffix}`, position: 99, probability: 5 });

    expect(response.status).toBe(201);
    expect(response.body.companyId).toBe(tenantA.companyId);
    expect(response.body.probability).toBe(5);
  });

  // -------------------------------------------------------------------------
  // CRUD prospects et parcours de conversion
  // -------------------------------------------------------------------------

  it("creates a lead and lists it back for the same tenant only", async () => {
    const created = await http()
      .post("/api/v1/crm/leads")
      .set("Cookie", tenantA.cookie)
      .send({
        contactName: "Alice Mbala",
        companyName: `Client Alpha ${suffix}`,
        email: "alice@alpha.test",
        source: "Salon BTP",
      });

    expect(created.status).toBe(201);
    expect(created.body.status).toBe("NEW");
    expect(created.body.companyId).toBe(tenantA.companyId);

    const listA = await http().get("/api/v1/crm/leads").set("Cookie", tenantA.cookie);
    expect(listA.status).toBe(200);
    expect(listA.body.some((lead: { id: string }) => lead.id === created.body.id)).toBe(true);

    // Isolation : le tenant B ne voit jamais le prospect du tenant A.
    const listB = await http().get("/api/v1/crm/leads").set("Cookie", tenantB.cookie);
    expect(listB.status).toBe(200);
    expect(listB.body.some((lead: { id: string }) => lead.id === created.body.id)).toBe(false);
  });

  it("rejects a lead without the required fields (400)", async () => {
    const response = await http()
      .post("/api/v1/crm/leads")
      .set("Cookie", tenantA.cookie)
      .send({ contactName: "   " });

    expect(response.status).toBe(400);
  });

  it("converts a lead into an opportunity with account, contact and traceability", async () => {
    const lead = await http()
      .post("/api/v1/crm/leads")
      .set("Cookie", tenantA.cookie)
      .send({ contactName: "Bruno Kasongo", companyName: `Client Beta ${suffix}` });
    expect(lead.status).toBe(201);

    const converted = await http()
      .post(`/api/v1/crm/leads/${lead.body.id}/convert`)
      .set("Cookie", tenantA.cookie)
      .send({ amount: "125000.50", currency: "USD", opportunityName: `Extension Beta ${suffix}` });

    expect(converted.status).toBe(201);
    expect(converted.body.amount).toBe("125000.50");
    expect(converted.body.currency).toBe("USD");
    expect(converted.body.status).toBe("OPEN");
    expect(converted.body.sourceLeadId).toBe(lead.body.id);
    expect(converted.body.accountId).not.toBeNull();
    expect(converted.body.contactId).not.toBeNull();
    expect(converted.body.stageName).toBeTruthy();

    // Le prospect passe a CONVERTED et porte la date de conversion.
    const leads = await http().get("/api/v1/crm/leads").set("Cookie", tenantA.cookie);
    const refreshed = leads.body.find((item: { id: string }) => item.id === lead.body.id);
    expect(refreshed.status).toBe("CONVERTED");
    expect(refreshed.convertedAt).not.toBeNull();

    // Le compte a bien ete cree a partir du nom d'entreprise du prospect.
    const accounts = await http().get("/api/v1/crm/accounts").set("Cookie", tenantA.cookie);
    expect(
      accounts.body.some((account: { name: string }) => account.name === `Client Beta ${suffix}`),
    ).toBe(true);

    // Historique : une activite CONVERSION de chaque cote.
    const leadActivities = await http()
      .get(`/api/v1/crm/activities?relatedType=Lead&relatedId=${lead.body.id}`)
      .set("Cookie", tenantA.cookie);
    expect(
      leadActivities.body.some((activity: { type: string }) => activity.type === "CONVERSION"),
    ).toBe(true);

    const opportunityActivities = await http()
      .get(`/api/v1/crm/activities?relatedType=Opportunity&relatedId=${converted.body.id}`)
      .set("Cookie", tenantA.cookie);
    expect(
      opportunityActivities.body.some(
        (activity: { type: string }) => activity.type === "CONVERSION",
      ),
    ).toBe(true);
  });

  it("refuses to convert the same lead twice (400)", async () => {
    const lead = await http()
      .post("/api/v1/crm/leads")
      .set("Cookie", tenantA.cookie)
      .send({ contactName: "Chantal Ilunga", companyName: `Client Gamma ${suffix}` });

    const first = await http()
      .post(`/api/v1/crm/leads/${lead.body.id}/convert`)
      .set("Cookie", tenantA.cookie)
      .send({ amount: "1000.00" });
    expect(first.status).toBe(201);

    const second = await http()
      .post(`/api/v1/crm/leads/${lead.body.id}/convert`)
      .set("Cookie", tenantA.cookie)
      .send({ amount: "1000.00" });
    expect(second.status).toBe(400);

    // Une seule opportunite doit exister pour ce prospect.
    const opportunities = await prisma.crmOpportunity.count({
      where: { sourceLeadId: lead.body.id },
    });
    expect(opportunities).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Montants : arithmetique decimale stricte
  // -------------------------------------------------------------------------

  it("rejects a numeric amount and an over-precise amount (400)", async () => {
    const asNumber = await http()
      .post("/api/v1/crm/opportunities")
      .set("Cookie", tenantA.cookie)
      .send({ name: `Flottant ${suffix}`, amount: 1234.56 });
    expect(asNumber.status).toBe(400);

    const tooPrecise = await http()
      .post("/api/v1/crm/opportunities")
      .set("Cookie", tenantA.cookie)
      .send({ name: `Trop precis ${suffix}`, amount: "1234.567" });
    expect(tooPrecise.status).toBe(400);
  });

  it("keeps amounts exact through storage and serialization", async () => {
    // 0.1 + 0.2 en flottant vaut 0.30000000000000004 : ce test echouerait
    // si un montant transitait par un number a un quelconque moment.
    const first = await http()
      .post("/api/v1/crm/opportunities")
      .set("Cookie", tenantB.cookie)
      .send({ name: `Decimal 1 ${suffix}`, amount: "0.10" });
    const second = await http()
      .post("/api/v1/crm/opportunities")
      .set("Cookie", tenantB.cookie)
      .send({ name: `Decimal 2 ${suffix}`, amount: "0.20" });

    expect(first.body.amount).toBe("0.10");
    expect(second.body.amount).toBe("0.20");

    const dashboard = await http().get("/api/v1/crm/dashboard").set("Cookie", tenantB.cookie);
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.pipelineValue).toBe("0.30");
  });

  // -------------------------------------------------------------------------
  // Pipeline : deplacement d'etape et cloture
  // -------------------------------------------------------------------------

  it("closes an opportunity when moved to a won stage and blocks further moves", async () => {
    const opportunity = await http()
      .post("/api/v1/crm/opportunities")
      .set("Cookie", tenantA.cookie)
      .send({ name: `Affaire a gagner ${suffix}`, amount: "50000.00" });
    expect(opportunity.status).toBe(201);

    const stages = await http().get("/api/v1/crm/pipeline/stages").set("Cookie", tenantA.cookie);
    const wonStage = stages.body.find((stage: { isWon: boolean }) => stage.isWon);
    expect(wonStage).toBeTruthy();

    const moved = await http()
      .patch(`/api/v1/crm/opportunities/${opportunity.body.id}/stage`)
      .set("Cookie", tenantA.cookie)
      .send({ stageId: wonStage.id });

    expect(moved.status).toBe(200);
    expect(moved.body.status).toBe("WON");
    expect(moved.body.closedAt).not.toBeNull();

    const again = await http()
      .patch(`/api/v1/crm/opportunities/${opportunity.body.id}/stage`)
      .set("Cookie", tenantA.cookie)
      .send({ stageId: wonStage.id });
    expect(again.status).toBe(400);

    const history = await http()
      .get(`/api/v1/crm/activities?relatedType=Opportunity&relatedId=${opportunity.body.id}`)
      .set("Cookie", tenantA.cookie);
    expect(
      history.body.some((activity: { type: string }) => activity.type === "STAGE_CHANGE"),
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Isolation cross-company (Definition of Done INC-02)
  // -------------------------------------------------------------------------

  it("refuses a forged companyId belonging to another tenant (403)", async () => {
    const read = await http()
      .get(`/api/v1/crm/leads?companyId=${tenantA.companyId}`)
      .set("Cookie", tenantB.cookie);
    expect(read.status).toBe(403);

    const write = await http()
      .post("/api/v1/crm/leads")
      .set("Cookie", tenantB.cookie)
      .send({
        contactName: "Intrus",
        companyName: "Tentative cross-tenant",
        companyId: tenantA.companyId,
      });
    expect(write.status).toBe(403);

    // Aucun enregistrement n'a ete cree dans l'entreprise visee.
    const leaked = await prisma.crmLead.count({
      where: { companyId: tenantA.companyId, contactName: "Intrus" },
    });
    expect(leaked).toBe(0);
  });

  it("never exposes another tenant's opportunity by direct id (404)", async () => {
    const opportunity = await http()
      .post("/api/v1/crm/opportunities")
      .set("Cookie", tenantA.cookie)
      .send({ name: `Confidentiel ${suffix}`, amount: "9999.00" });
    expect(opportunity.status).toBe(201);

    const stagesB = await http().get("/api/v1/crm/pipeline/stages").set("Cookie", tenantB.cookie);
    const stageB = stagesB.body[0];

    const attempt = await http()
      .patch(`/api/v1/crm/opportunities/${opportunity.body.id}/stage`)
      .set("Cookie", tenantB.cookie)
      .send({ stageId: stageB.id });
    expect(attempt.status).toBe(404);

    const listB = await http().get("/api/v1/crm/opportunities").set("Cookie", tenantB.cookie);
    expect(listB.body.some((item: { id: string }) => item.id === opportunity.body.id)).toBe(false);
  });

  it("refuses to attach an activity to another tenant's record (404)", async () => {
    const lead = await http()
      .post("/api/v1/crm/leads")
      .set("Cookie", tenantA.cookie)
      .send({ contactName: "Cible", companyName: `Client Delta ${suffix}` });

    const attempt = await http()
      .post("/api/v1/crm/activities")
      .set("Cookie", tenantB.cookie)
      .send({
        type: "NOTE",
        subject: "Greffe hostile",
        relatedType: "Lead",
        relatedId: lead.body.id,
      });

    expect(attempt.status).toBe(404);

    const leaked = await prisma.crmActivity.count({
      where: { relatedId: lead.body.id, subject: "Greffe hostile" },
    });
    expect(leaked).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Historique immuable
  // -------------------------------------------------------------------------

  it("exposes no route to modify or delete an activity (append-only)", async () => {
    const lead = await http()
      .post("/api/v1/crm/leads")
      .set("Cookie", tenantA.cookie)
      .send({ contactName: "Historique", companyName: `Client Epsilon ${suffix}` });

    const activity = await http()
      .post("/api/v1/crm/activities")
      .set("Cookie", tenantA.cookie)
      .send({
        type: "CALL",
        subject: "Appel de qualification",
        body: "Budget confirme",
        relatedType: "Lead",
        relatedId: lead.body.id,
      });
    expect(activity.status).toBe(201);

    for (const method of ["patch", "put", "delete"] as const) {
      const response = await http()
        [method](`/api/v1/crm/activities/${activity.body.id}`)
        .set("Cookie", tenantA.cookie)
        .send({ subject: "Reecriture" });
      expect(response.status, `${method} must not exist on activities`).toBe(404);
    }

    // Le contenu d'origine est intact en base.
    const stored = await prisma.crmActivity.findUnique({ where: { id: activity.body.id } });
    expect(stored?.subject).toBe("Appel de qualification");
    expect(stored?.body).toBe("Budget confirme");
  });

  // -------------------------------------------------------------------------
  // Tableau de bord : agregats reels
  // -------------------------------------------------------------------------

  it("computes dashboard aggregates from real tenant data only", async () => {
    const dashboard = await http().get("/api/v1/crm/dashboard").set("Cookie", tenantA.cookie);
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.companyId).toBe(tenantA.companyId);

    const [leadCount, wonCount] = await Promise.all([
      prisma.crmLead.count({ where: { companyId: tenantA.companyId } }),
      prisma.crmOpportunity.count({ where: { companyId: tenantA.companyId, status: "WON" } }),
    ]);

    expect(dashboard.body.leads.total).toBe(leadCount);
    expect(dashboard.body.opportunities.won).toBe(wonCount);

    // La valeur ponderee ne peut pas depasser la valeur brute du pipeline.
    expect(Number(dashboard.body.weightedPipelineValue)).toBeLessThanOrEqual(
      Number(dashboard.body.pipelineValue),
    );

    // Les agregats du tenant B sont independants de ceux du tenant A.
    const dashboardB = await http().get("/api/v1/crm/dashboard").set("Cookie", tenantB.cookie);
    expect(dashboardB.body.companyId).toBe(tenantB.companyId);
    expect(dashboardB.body.companyId).not.toBe(dashboard.body.companyId);
  });
});
