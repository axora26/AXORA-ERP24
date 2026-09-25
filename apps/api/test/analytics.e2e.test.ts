import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createHarness, registerTenant, type Harness, type Tenant } from "./support/harness.js";
import { createStartedProject, createUserWith } from "./support/fixtures.js";

/**
 * INC-23 — Analytique / BI, via l'API reelle et PostgreSQL : indicateurs
 * calcules sur les donnees reelles, RBAC par indicateur, isolation tenant,
 * instantanes figes a fenetre explicite, export CSV, tableaux de bord.
 */
describe("INC-23 Analytique (e2e)", () => {
  let harness: Harness;
  let owner: Tenant;
  let other: Tenant;
  let qhseAnalyst: Tenant;
  let noAnalytics: Tenant;
  let invoiceTotal = "";
  const now = new Date();
  const currentMonth = now.toISOString().slice(0, 7);
  const previousMonthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15));
  const previousMonth = previousMonthDate.toISOString().slice(0, 7);

  beforeAll(async () => {
    harness = await createHarness();
    owner = await registerTenant(harness, "analytics");
    other = await registerTenant(harness, "analytics-other");
    qhseAnalyst = await createUserWith(harness, owner, ["analytics.report.read", "analytics.snapshot.manage", "analytics.dashboard.manage", "qhse.inspection.read"], "analyste-qhse");
    noAnalytics = await createUserWith(harness, owner, ["qhse.inspection.read", "finance.invoice.read"], "sans-analytique");
    const api = as(harness, owner);

    // Donnees reelles : deux NC (mois precedent et mois courant), une facture emise et un encaissement partiel.
    expect((await api.post("/qhse/findings", { title: "Garde-corps", description: "R+2", category: "SAFETY", severity: "MAJOR", detectedAt: previousMonthDate.toISOString() })).status).toBe(201);
    expect((await api.post("/qhse/findings", { title: "Étiquetage", description: "Stock", category: "QUALITY", severity: "MINOR" })).status).toBe(201);
    const project = await createStartedProject(harness, owner);
    const contractId = (await api.get(`/projects/${project.projectId}`)).body.contractId;
    const draft = await api.post("/finance/invoices", { contractId, percent: "20" });
    expect(draft.status).toBe(201);
    const issued = await api.post(`/finance/invoices/${draft.body.id}/issue`, { dueDays: 30 });
    expect(issued.status).toBe(201);
    invoiceTotal = issued.body.total;
    const accounts = await api.post("/finance/bank-accounts", { code: "BQ-AN", name: "Banque", currency: "USD" });
    const bankAccountId = accounts.body.find((account: { code: string }) => account.code === "BQ-AN").id;
    const payment = await api.post("/finance/payments", { invoiceType: "CUSTOMER", invoiceId: draft.body.id, bankAccountId, amount: "1000.00", method: "TRANSFER", idempotencyKey: `an-${Date.now()}` });
    expect(payment.status).toBe(201);

    // Autre tenant : ses propres NC, jamais melangees.
    await as(harness, other).post("/qhse/findings", { title: "Autre tenant", description: "x", category: "SAFETY", severity: "CRITICAL" });
  });

  afterAll(async () => {
    await harness?.close();
  });

  it("RBAC par indicateur : la permission analytique n'ouvre que les modules deja lisibles", async () => {
    expect((await as(harness, noAnalytics).get("/analytics/catalog")).status).toBe(403);
    const catalog = (await as(harness, qhseAnalyst).get("/analytics/catalog")).body as Array<{ key: string; granted: boolean }>;
    expect(catalog.filter((entry) => entry.granted).map((entry) => entry.key)).toEqual(["qhse.findings", "qhse.incidents"]);
    const refused = await as(harness, qhseAnalyst).get("/analytics/series/finance.invoiced");
    expect(refused.status).toBe(403);
    expect(refused.body.message).toContain("finance.invoice.read");
    expect((await as(harness, qhseAnalyst).get("/analytics/export/finance.invoiced")).status).toBe(403);
    expect((await as(harness, owner).get("/analytics/series/inconnu")).status).toBe(404);
    expect((await as(harness, owner).get("/analytics/series/qhse.findings?months=48")).status).toBe(400);
  });

  it("series mensuelles calculees sur les donnees reelles, fenetre et tracabilite explicites", async () => {
    const findings = await as(harness, qhseAnalyst).get("/analytics/series/qhse.findings");
    expect(findings.status).toBe(200);
    expect(findings.body.months).toHaveLength(12);
    expect(findings.body.months[11]).toBe(currentMonth);
    expect(findings.body.months[10]).toBe(previousMonth);
    const opened = findings.body.series.find((serie: { key: string }) => serie.key === "Ouvertes");
    expect(opened.values[11]).toBe("1");
    expect(opened.values[10]).toBe("1");
    expect(findings.body.series.map((serie: { key: string }) => serie.key)).toEqual(["Ouvertes", "Clôturées"]);
    expect(findings.body.sourceRows).toBe(2);
    expect(findings.body.companyId).toBe(owner.companyId);
    expect(findings.body.window.to > findings.body.window.from).toBe(true);

    const invoiced = await as(harness, owner).get("/analytics/series/finance.invoiced");
    expect(invoiced.body.series).toEqual([{ key: "USD", label: "USD", values: [...Array(11).fill("0.00"), invoiceTotal] }]);
    const collected = await as(harness, owner).get("/analytics/series/finance.collected");
    expect(collected.body.series[0].values[11]).toBe("1000.00");
    expect(collected.body.sourceRows).toBe(1);
  });

  it("isolation : les donnees d'un autre tenant ne sont jamais agregees", async () => {
    const theirs = await as(harness, other).get("/analytics/series/qhse.findings");
    expect(theirs.body.sourceRows).toBe(1);
    expect(theirs.body.series.find((serie: { key: string }) => serie.key === "Ouvertes").values[11]).toBe("1");
    const theirInvoices = await as(harness, other).get("/analytics/series/finance.invoiced");
    expect(theirInvoices.body.series).toEqual([]);
    expect(theirInvoices.body.sourceRows).toBe(0);
  });

  it("export CSV : memes droits, memes valeurs", async () => {
    const csv = await as(harness, qhseAnalyst).get("/analytics/export/qhse.findings");
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.headers["content-disposition"]).toMatch(/^attachment; filename="qhse\.findings-\d{4}-\d{2}_\d{4}-\d{2}\.csv"$/);
    const text = csv.text.replace(/^\ufeff/, "");
    expect(text.split("\r\n")[0]).toBe("mois,serie,valeur,unite");
    expect(text).toContain(`${currentMonth},Ouvertes,1,nombre`);
  });

  it("instantanes : fenetre explicite, versionnes, figes, et relus selon les droits du lecteur", async () => {
    expect((await as(harness, owner).post("/analytics/snapshots", { period: "2026-13" })).status).toBe(400);
    expect((await as(harness, owner).post("/analytics/snapshots", { period: "2099-01" })).status).toBe(400);
    expect((await as(harness, noAnalytics).post("/analytics/snapshots", { period: currentMonth })).status).toBe(403);

    const first = await as(harness, owner).post("/analytics/snapshots", { period: currentMonth });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ period: currentMonth, version: 1, isDemo: false, excludedMetrics: [], hiddenMetrics: 0 });
    expect(first.body.periodStart).toBe(`${currentMonth}-01T00:00:00.000Z`);
    const invoiced = first.body.metrics.find((metric: { metric: string }) => metric.metric === "finance.invoiced");
    expect(invoiced.series).toEqual([{ key: "USD", label: "USD", value: invoiceTotal }]);
    const second = await as(harness, owner).post("/analytics/snapshots", { period: currentMonth });
    expect(second.body.version).toBe(2);

    // Capture par un analyste QHSE : les domaines qu'il ne lit pas ne sont pas figes (et c'est trace).
    const partial = await as(harness, qhseAnalyst).post("/analytics/snapshots", { period: previousMonth });
    expect(partial.status).toBe(201);
    expect(partial.body.metrics.map((metric: { metric: string }) => metric.metric)).toEqual(["qhse.findings", "qhse.incidents"]);
    expect(partial.body.excludedMetrics).toContain("finance.invoiced");

    // Relecture : l'analyste QHSE ne voit pas les indicateurs financiers figes par le proprietaire.
    const seen = (await as(harness, qhseAnalyst).get("/analytics/snapshots")).body.find((snapshot: { id: string }) => snapshot.id === first.body.id);
    expect(seen.metrics.map((metric: { metric: string }) => metric.metric)).toEqual(["qhse.findings", "qhse.incidents"]);
    expect(seen.hiddenMetrics).toBeGreaterThan(0);
    expect((await as(harness, other).get("/analytics/snapshots")).body).toEqual([]);

    await expect(harness.prisma.analyticsSnapshot.update({ where: { id: first.body.id }, data: { version: 9 } })).rejects.toThrow();
    await expect(harness.prisma.analyticsSnapshot.delete({ where: { id: first.body.id } })).rejects.toThrow();
    await expect(
      harness.prisma.analyticsSnapshot.create({
        data: { organizationId: owner.organizationId, companyId: owner.companyId, period: "2026-01", periodStart: new Date("2026-01-02T00:00:00Z"), periodEnd: new Date("2026-02-01T00:00:00Z"), version: 1, isDemo: false, metrics: [], excludedMetrics: [], capturedByUserId: owner.userId },
      }),
    ).rejects.toThrow();
  });

  it("tableaux de bord : indicateurs limites aux droits du createur, partage en lecture, proprietaire seul editeur", async () => {
    const forbidden = await as(harness, qhseAnalyst).post("/analytics/dashboards", { name: "Mix", metrics: ["qhse.findings", "finance.invoiced"] });
    expect(forbidden.status).toBe(403);
    const shared = await as(harness, qhseAnalyst).post("/analytics/dashboards", { name: "Sécurité chantier", metrics: ["qhse.findings", "qhse.incidents"], shared: true });
    expect(shared.status).toBe(201);
    const privateBoard = await as(harness, owner).post("/analytics/dashboards", { name: "Direction financière", metrics: ["finance.invoiced", "finance.collected"] });
    expect(privateBoard.status).toBe(201);

    const ownerList = (await as(harness, owner).get("/analytics/dashboards")).body as Array<{ id: string; mine: boolean }>;
    expect(ownerList.find((board) => board.id === shared.body.id)).toMatchObject({ mine: false });
    const analystList = (await as(harness, qhseAnalyst).get("/analytics/dashboards")).body as Array<{ id: string }>;
    expect(analystList.map((board) => board.id)).not.toContain(privateBoard.body.id);
    expect((await as(harness, other).get("/analytics/dashboards")).body).toEqual([]);

    expect((await as(harness, owner).put(`/analytics/dashboards/${shared.body.id}`, { name: "Repris", metrics: ["qhse.findings"] })).status).toBe(403);
    expect((await as(harness, qhseAnalyst).put(`/analytics/dashboards/${privateBoard.body.id}`, { name: "x", metrics: ["qhse.findings"] })).status).toBe(404);
    const renamed = await as(harness, qhseAnalyst).put(`/analytics/dashboards/${shared.body.id}`, { name: "Sécurité", metrics: ["qhse.incidents"], shared: true });
    expect(renamed.body).toMatchObject({ name: "Sécurité", metrics: ["qhse.incidents"] });
    expect((await as(harness, qhseAnalyst).delete(`/analytics/dashboards/${shared.body.id}`)).status).toBe(200);
    expect((await as(harness, owner).post("/analytics/dashboards", { name: "Vide", metrics: [] })).status).toBe(400);
    const audit = await harness.prisma.auditLog.findMany({ where: { organizationId: owner.organizationId, action: { startsWith: "analytics." } }, select: { action: true } });
    expect(audit.map((entry) => entry.action)).toEqual(expect.arrayContaining(["analytics.snapshot.captured", "analytics.dashboard.created", "analytics.dashboard.updated", "analytics.dashboard.deleted"]));
  });
});
