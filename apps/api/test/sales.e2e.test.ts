import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module.js";
import { PrismaService } from "../src/core/prisma.service.js";

describe("Sales Quote -> Contract (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const suffix = Date.now();

  const tenantA = {
    slug: `sales-a-${suffix}`,
    email: `owner-sales-a-${suffix}@test.com`,
    cookie: [] as string[],
  };
  const tenantB = {
    slug: `sales-b-${suffix}`,
    email: `owner-sales-b-${suffix}@test.com`,
    cookie: [] as string[],
  };

  let opportunityId = "";
  let studyId = "";
  let dqeId = "";
  let secondDqeId = "";
  let quoteId = "";

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

  async function createFinalizedDqe(code: string, quantity = "10.000000", unitPrice = "100.000000", lineCount = 1): Promise<string> {
    const study = await http()
      .post("/api/v1/estimation/studies")
      .set("Cookie", tenantA.cookie)
      .send({
        opportunityId,
        code: `ST-${code}`,
        title: "Etude pour devis",
        objective: "Etablir les hypothèses vérifiables avant le chiffrage.",
      });
    expect(study.status).toBe(201);

    const requirement = await http()
      .post(`/api/v1/estimation/studies/${study.body.id}/requirements`)
      .set("Cookie", tenantA.cookie)
      .send({
        position: 1,
        category: "FACT",
        statement: "Surface utile confirmée : 1 250 m².",
        sourceReference: "PV-CLIENT-001",
      });
    expect(requirement.status).toBe(201);

    const ready = await http()
      .post(`/api/v1/estimation/studies/${study.body.id}/ready`)
      .set("Cookie", tenantA.cookie);
    expect(ready.status).toBe(201);

    const dqe = await http()
      .post("/api/v1/estimation/dqes")
      .set("Cookie", tenantA.cookie)
      .send({ studyId: study.body.id, code: `DQE-${code}`, title: "DQE devis", currency: "USD" });
    expect(dqe.status).toBe(201);

    const lot = await http()
      .post(`/api/v1/estimation/dqes/${dqe.body.id}/lots`)
      .set("Cookie", tenantA.cookie)
      .send({ expectedVersion: 1, position: 1, code: "LOT-ELEC", designation: "Electricité" });
    expect(lot.status).toBe(201);

    const line = await http()
      .post(`/api/v1/estimation/dqes/${dqe.body.id}/lines`)
      .set("Cookie", tenantA.cookie)
      .send({
        lotId: lot.body.lots[0].id,
        position: 1,
        reference: "SOL-001",
        designation: "Panneau photovoltaïque",
        unitCode: "u",
        quantity,
        unitPrice,
      });
    expect(line.status).toBe(201);

    for (let position = 2; position <= lineCount; position += 1) {
      const extraLine = await http()
        .post(`/api/v1/estimation/dqes/${dqe.body.id}/lines`)
        .set("Cookie", tenantA.cookie)
        .send({
          lotId: lot.body.lots[0].id,
          position,
          reference: `SOL-00${position}`,
          designation: `Panneau photovoltaïque ${position}`,
          unitCode: "u",
          quantity,
          unitPrice,
        });
      expect(extraLine.status).toBe(201);
    }

    return dqe.body.id as string;
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
      .send({ name: `Campus solaire devis ${suffix}`, amount: "250000.00", currency: "USD" });
    expect(opportunity.status).toBe(201);
    opportunityId = opportunity.body.id as string;

    dqeId = await createFinalizedDqe(`${suffix}-1`);
    secondDqeId = await createFinalizedDqe(`${suffix}-2`);
  });

  afterAll(async () => {
    await app.close();
  });

  it("requires an authenticated session on sales routes", async () => {
    const response = await http().get("/api/v1/sales/quotes");
    expect(response.status).toBe(401);
  });

  it("refuses to quote a DQE that is not FINALIZED", async () => {
    const response = await http()
      .post("/api/v1/sales/quotes")
      .set("Cookie", tenantA.cookie)
      .send({ dqeId, code: `Q-${suffix}-early`, title: "Devis prematuré" });
    expect(response.status).toBe(400);
  });

  it("creates a Quote from a FINALIZED DQE with an immutable line snapshot", async () => {
    const finalize = await http()
      .post(`/api/v1/estimation/dqes/${dqeId}/finalize`)
      .set("Cookie", tenantA.cookie);
    expect(finalize.status).toBe(201);

    const created = await http()
      .post("/api/v1/sales/quotes")
      .set("Cookie", tenantA.cookie)
      .send({ dqeId, code: `Q-${suffix}`, title: "Devis Campus solaire" });

    expect(created.status).toBe(201);
    expect(created.body.status).toBe("DRAFT");
    expect(created.body.subtotal).toBe("1000.000000");
    expect(created.body.lines).toHaveLength(1);
    expect(created.body.lots).toMatchObject([
      { position: 1, code: "LOT-ELEC", designation: "Electricité", lineCount: 1, subtotal: "1000.000000" },
    ]);
    expect(created.body.lines[0].lotId).toBe(created.body.lots[0].id);
    expect(created.body.source.dqeId).toBe(dqeId);
    quoteId = created.body.id as string;
    const quoteLot = await prisma.quoteLot.findFirstOrThrow({ where: { quoteId } });
    await expect(prisma.quoteLot.update({ where: { id: quoteLot.id }, data: { designation: "SQL override" } })).rejects.toThrow();
    await expect(prisma.quoteLot.delete({ where: { id: quoteLot.id } })).rejects.toThrow();
    await expect(prisma.quoteLot.create({ data: {
      organizationId: quoteLot.organizationId,
      companyId: quoteLot.companyId,
      quoteId,
      position: 2,
      code: "LOT-LATE",
      designation: "Lot tardif",
    } })).rejects.toThrow();
    const quoteLine = await prisma.quoteLine.findFirstOrThrow({ where: { quoteId } });
    await expect(prisma.quoteLine.update({ where: { id: quoteLine.id }, data: { designation: "SQL override" } })).rejects.toThrow();
    await expect(prisma.quoteLine.update({ where: { id: quoteLine.id }, data: { lotId: null } })).rejects.toThrow();
    await expect(prisma.quoteLine.delete({ where: { id: quoteLine.id } })).rejects.toThrow();
    await expect(prisma.quoteLine.create({ data: {
      organizationId: quoteLine.organizationId,
      companyId: quoteLine.companyId,
      quoteId,
      lotId: quoteLot.id,
      position: 2,
      reference: "LATE",
      designation: "Ligne tardive",
      unitCode: "u",
      quantity: "1.000000",
      unitPrice: "1.000000",
    } })).rejects.toThrow();
  });

  it("walks Quote through submit -> accept before a Contract can exist", async () => {
    const earlyContract = await http()
      .post("/api/v1/sales/contracts")
      .set("Cookie", tenantA.cookie)
      .send({ quoteId, code: `C-${suffix}-early`, title: "Contrat prematuré" });
    expect(earlyContract.status).toBe(400);

    const submitted = await http()
      .post(`/api/v1/sales/quotes/${quoteId}/submit`)
      .set("Cookie", tenantA.cookie);
    expect(submitted.status).toBe(201);
    expect(submitted.body.status).toBe("SUBMITTED");

    const accepted = await http()
      .post(`/api/v1/sales/quotes/${quoteId}/accept`)
      .set("Cookie", tenantA.cookie);
    expect(accepted.status).toBe(201);
    expect(accepted.body.status).toBe("ACCEPTED");
  });

  it("creates a Contract from an ACCEPTED Quote with an immutable line snapshot", async () => {
    const contract = await http()
      .post("/api/v1/sales/contracts")
      .set("Cookie", tenantA.cookie)
      .send({ quoteId, code: `C-${suffix}`, title: "Contrat Campus solaire" });

    expect(contract.status).toBe(201);
    expect(contract.body.status).toBe("ACTIVE");
    expect(contract.body.subtotal).toBe("1000.000000");
    expect(contract.body.lines).toHaveLength(1);
    expect(contract.body.lots).toMatchObject([
      { position: 1, code: "LOT-ELEC", designation: "Electricité", lineCount: 1, subtotal: "1000.000000" },
    ]);
    expect(contract.body.lines[0].lotId).toBe(contract.body.lots[0].id);
    expect(contract.body.source.quoteId).toBe(quoteId);
    const contractLot = await prisma.contractLot.findFirstOrThrow({ where: { contractId: contract.body.id } });
    await expect(prisma.contractLot.update({ where: { id: contractLot.id }, data: { designation: "SQL override" } })).rejects.toThrow();
    await expect(prisma.contractLot.delete({ where: { id: contractLot.id } })).rejects.toThrow();
    await expect(prisma.contractLot.create({ data: {
      organizationId: contractLot.organizationId,
      companyId: contractLot.companyId,
      contractId: contract.body.id,
      position: 2,
      code: "LOT-LATE",
      designation: "Lot tardif",
    } })).rejects.toThrow();
    const contractLine = await prisma.contractLine.findFirstOrThrow({ where: { contractId: contract.body.id } });
    await expect(prisma.contractLine.update({ where: { id: contractLine.id }, data: { designation: "SQL override" } })).rejects.toThrow();
    await expect(prisma.contractLine.update({ where: { id: contractLine.id }, data: { lotId: null } })).rejects.toThrow();
    await expect(prisma.contractLine.delete({ where: { id: contractLine.id } })).rejects.toThrow();
    await expect(prisma.contractLine.create({ data: {
      organizationId: contractLine.organizationId,
      companyId: contractLine.companyId,
      contractId: contract.body.id,
      lotId: contractLot.id,
      position: 2,
      reference: "LATE",
      designation: "Ligne tardive",
      unitCode: "u",
      quantity: "1.000000",
      unitPrice: "1.000000",
    } })).rejects.toThrow();

    const second = await http()
      .post("/api/v1/sales/contracts")
      .set("Cookie", tenantA.cookie)
      .send({ quoteId, code: `C-${suffix}-dup`, title: "Contrat dupliqué" });
    expect(second.status).toBe(400);
  });

  it("rejects a submitted Quote with a mandatory reason and blocks empty rejection", async () => {
    const quote2 = await http()
      .post("/api/v1/sales/quotes")
      .set("Cookie", tenantA.cookie)
      .send({ dqeId: secondDqeId, code: `Q-${suffix}-r`, title: "Devis à rejeter" });
    expect(quote2.status).toBe(400);

    const finalize2 = await http()
      .post(`/api/v1/estimation/dqes/${secondDqeId}/finalize`)
      .set("Cookie", tenantA.cookie);
    expect(finalize2.status).toBe(201);

    const created2 = await http()
      .post("/api/v1/sales/quotes")
      .set("Cookie", tenantA.cookie)
      .send({ dqeId: secondDqeId, code: `Q-${suffix}-r`, title: "Devis à rejeter" });
    expect(created2.status).toBe(201);

    await http().post(`/api/v1/sales/quotes/${created2.body.id}/submit`).set("Cookie", tenantA.cookie);

    const emptyReason = await http()
      .post(`/api/v1/sales/quotes/${created2.body.id}/reject`)
      .set("Cookie", tenantA.cookie)
      .send({ reason: "" });
    expect(emptyReason.status).toBe(400);

    const rejected = await http()
      .post(`/api/v1/sales/quotes/${created2.body.id}/reject`)
      .set("Cookie", tenantA.cookie)
      .send({ reason: "Budget client insuffisant" });
    expect(rejected.status).toBe(201);
    expect(rejected.body.status).toBe("REJECTED");
    expect(rejected.body.rejectionReason).toBe("Budget client insuffisant");
  });

  it("uses the same six-decimal line rounding for document and lot subtotals", async () => {
    const fractionalDqeId = await createFinalizedDqe(`${suffix}-rounding`, "0.000001", "0.400000", 3);
    expect((await http().post(`/api/v1/estimation/dqes/${fractionalDqeId}/finalize`).set("Cookie", tenantA.cookie)).status).toBe(201);
    const quote = await http()
      .post("/api/v1/sales/quotes")
      .set("Cookie", tenantA.cookie)
      .send({ dqeId: fractionalDqeId, code: `Q-${suffix}-rounding`, title: "Devis arrondi" });
    expect(quote.status).toBe(201);
    expect(quote.body.lines[0].lineTotal).toBe("0.000000");
    expect(quote.body.lots[0].subtotal).toBe("0.000000");
    expect(quote.body.subtotal).toBe("0.000000");
  });

  it("never exposes another tenant's Quote or Contract by direct identifier", async () => {
    const crossQuote = await http()
      .get(`/api/v1/sales/quotes/${quoteId}`)
      .set("Cookie", tenantB.cookie);
    expect(crossQuote.status).toBe(404);

    const contracts = await prisma.contract.findFirst({ where: { quoteId } });
    const crossContract = await http()
      .get(`/api/v1/sales/contracts/${contracts?.id}`)
      .set("Cookie", tenantB.cookie);
    expect(crossContract.status).toBe(404);
  });

  it("persists audit events for Quote creation and Contract creation", async () => {
    const quoteAudit = await prisma.auditLog.findFirst({
      where: { action: "sales.quote.created", resourceId: quoteId },
    });
    expect(quoteAudit).not.toBeNull();

    const contract = await prisma.contract.findFirst({ where: { quoteId } });
    const contractAudit = await prisma.auditLog.findFirst({
      where: { action: "sales.contract.created", resourceId: contract?.id },
    });
    expect(contractAudit).not.toBeNull();
  });
});
