import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NumberingService } from "../src/common/numbering.service.js";
import { as, createHarness, registerTenant, type Harness, type Tenant } from "./support/harness.js";

describe("Plateforme — contexte, tableau de bord, perimetre, numerotation (e2e)", () => {
  let harness: Harness;
  let tenantA: Tenant;
  let tenantB: Tenant;

  beforeAll(async () => {
    harness = await createHarness();
    tenantA = await registerTenant(harness, "platform-a");
    tenantB = await registerTenant(harness, "platform-b");
  });

  afterAll(async () => {
    await harness.close();
  });

  it("GET /auth/context renvoie organisation, entreprises et permissions effectives de la session", async () => {
    const response = await as(harness, tenantA).get("/auth/context");
    expect(response.status).toBe(200);
    expect(response.body.organization.id).toBe(tenantA.organizationId);
    expect(response.body.organization.isDemo).toBe(false);
    expect(response.body.companies).toEqual([expect.objectContaining({ id: tenantA.companyId })]);
    expect(response.body.roles).toEqual(["OWNER"]);
    expect(response.body.permissions).toContain("dashboard.overview.read");
    expect(response.body.permissions).toContain("core.audit.read");
  });

  it("GET /auth/context sans session est refuse (401)", async () => {
    const response = await harness.http().get("/api/v1/auth/context");
    expect(response.status).toBe(401);
  });

  it("la vue d'ensemble agrege uniquement les donnees du tenant et son journal d'audit", async () => {
    const response = await as(harness, tenantA).get("/dashboard/overview");
    expect(response.status).toBe(200);
    const pipeline = response.body.kpis.find((kpi: { key: string }) => kpi.key === "crm.pipeline");
    expect(pipeline).toBeDefined();
    expect(pipeline.amounts).toEqual([]);
    expect(response.body.activity.map((entry: { action: string }) => entry.action)).toContain(
      "organization.bootstrap",
    );
    const foreign = response.body.activity.filter(
      (entry: { resourceId: string }) => entry.resourceId === tenantB.organizationId,
    );
    expect(foreign).toEqual([]);
  });

  it("un companyId d'un autre tenant est refuse par le garde de perimetre (403)", async () => {
    const response = await as(harness, tenantA).get(`/dashboard/overview?companyId=${tenantB.companyId}`);
    expect(response.status).toBe(403);
  });

  it("la numerotation automatique est atomique sous concurrence (aucun doublon, aucun trou)", async () => {
    const numbering = harness.app.get(NumberingService);
    const scope = { organizationId: tenantA.organizationId, companyId: tenantA.companyId };
    const at = new Date("2031-06-01T00:00:00.000Z");
    const codes = await Promise.all(
      Array.from({ length: 15 }, () =>
        harness.prisma.$transaction((tx) => numbering.next(tx, scope, "TST", at)),
      ),
    );
    const sorted = [...codes].sort();
    expect(new Set(codes).size).toBe(15);
    expect(sorted[0]).toBe("TST-2031-0001");
    expect(sorted[14]).toBe("TST-2031-0015");

    // Sequence independante par entreprise.
    const other = await harness.prisma.$transaction((tx) =>
      numbering.next(tx, { organizationId: tenantB.organizationId, companyId: tenantB.companyId }, "TST", at),
    );
    expect(other).toBe("TST-2031-0001");
  });
});
