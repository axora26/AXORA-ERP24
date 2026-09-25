import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createHarness, registerTenant, type Harness, type Tenant } from "./support/harness.js";
import { createUserWith } from "./support/fixtures.js";

interface Evidence {
  id: string;
  sessionId: string;
  mode: string;
  answer: string;
  answerSha256: string;
  engine: string;
  modelProvider: string | null;
  sources: Array<{ index: number; tool: string; resourceType: string; resourceId: string; link: string | null }>;
  permissionChecks: Array<{ tool: string; permission: string; granted: boolean }>;
}

/**
 * INC-22 — Copilote IA, via l'API reelle et PostgreSQL : chaque reponse est
 * tracee a des donnees reelles, avec la preuve du filtrage RBAC applique a
 * l'utilisateur demandeur ; aucune donnee hors droits ni hors tenant.
 */
describe("INC-22 Copilote IA (e2e)", () => {
  let harness: Harness;
  let owner: Tenant;
  let buyer: Tenant;
  let noCopilot: Tenant;
  let other: Tenant;
  let requestCode = "";
  let requestId = "";
  let findingCode = "";
  let foreignCode = "";

  async function ask(tenant: Tenant, question: string, sessionId?: string): Promise<{ sessionId: string; evidence: Evidence }> {
    const response = await as(harness, tenant).post("/copilot/ask", { question, sessionId });
    expect(response.status).toBe(201);
    return response.body;
  }

  /** Preuve RBAC : toute source citee provient d'un outil dont le controle d'acces est accorde. */
  function assertSourcesAuthorized(evidence: Evidence): void {
    const grantedTools = new Set(evidence.permissionChecks.filter((check) => check.granted).map((check) => check.tool));
    for (const source of evidence.sources) expect(grantedTools.has(source.tool)).toBe(true);
    expect(createHash("sha256").update(evidence.answer, "utf8").digest("hex")).toBe(evidence.answerSha256);
    expect(evidence.engine).toBe("axora-grounded-v1");
    expect(evidence.modelProvider).toBeNull();
  }

  beforeAll(async () => {
    harness = await createHarness();
    owner = await registerTenant(harness, "copilot");
    other = await registerTenant(harness, "copilot-other");
    buyer = await createUserWith(harness, owner, ["ai.copilot.use", "procurement.request.read", "procurement.order.read"], "acheteur");
    noCopilot = await createUserWith(harness, owner, ["procurement.request.read", "qhse.inspection.read"], "sans-copilote");

    const request = await as(harness, owner).post("/procurement/requests", { title: "Câbles cuivre lot électricité", lines: [{ description: "Câble 3G2.5", unitCode: "m", quantity: "500", estimatedUnitPrice: "2.40" }] });
    expect(request.status).toBe(201);
    requestId = request.body.id;
    requestCode = request.body.code;
    expect((await as(harness, owner).post(`/procurement/requests/${requestId}/submit`)).status).toBe(201);
    const finding = await as(harness, owner).post("/qhse/findings", { title: "Échafaudage non ancré", description: "Façade nord", category: "SAFETY", severity: "CRITICAL" });
    expect(finding.status).toBe(201);
    findingCode = finding.body.code;

    // Autre tenant : deux demandes, dont une confidentielle ; son 2e code n'existe pas chez le premier tenant.
    await as(harness, other).post("/procurement/requests", { title: "Achat ordinaire", lines: [{ description: "X", unitCode: "u", quantity: "1", estimatedUnitPrice: "10.00" }] });
    const secret = await as(harness, other).post("/procurement/requests", { title: "Achat confidentiel tenant B", lines: [{ description: "Y", unitCode: "u", quantity: "1", estimatedUnitPrice: "99999.00" }] });
    await as(harness, other).post(`/procurement/requests/${secret.body.id}/submit`);
    foreignCode = secret.body.code;
    expect(foreignCode).not.toBe(requestCode);
  });

  afterAll(async () => {
    await harness?.close();
  });

  it("deny-by-default : sans ai.copilot.use, aucune question ; l'audit des preuves exige ai.evidence.read", async () => {
    expect((await as(harness, noCopilot).post("/copilot/ask", { question: "Demandes d'achat en attente ?" })).status).toBe(403);
    expect((await as(harness, noCopilot).get("/copilot/capabilities")).status).toBe(403);
    expect((await as(harness, buyer).get("/copilot/evidence")).status).toBe(403);
    expect((await as(harness, buyer).post("/copilot/ask", { question: "" })).status).toBe(400);
    expect((await harness.http().post("/api/v1/copilot/ask").send({ question: "x" })).status).toBe(401);
  });

  it("capacites = droits de lecture de l'utilisateur, rien de plus", async () => {
    const capabilities = (await as(harness, buyer).get("/copilot/capabilities")).body as Array<{ tool: string; granted: boolean }>;
    const grantedTools = capabilities.filter((capability) => capability.granted).map((capability) => capability.tool);
    expect(grantedTools).toEqual(["procurement.requests", "procurement.orders"]);
  });

  it("reponse ancree sur des donnees reelles, sources citees et controle d'acces trace", async () => {
    const { evidence } = await ask(buyer, "Quelles demandes d'achat attendent une décision ?");
    expect(evidence.mode).toBe("TOOLS");
    expect(evidence.answer).toContain(requestCode);
    expect(evidence.answer).toContain("1 200,00 USD");
    expect(evidence.sources).toEqual([expect.objectContaining({ index: 1, tool: "procurement.requests", resourceType: "PurchaseRequest", resourceId: requestId, link: `/procurement/requests/${requestId}` })]);
    expect(evidence.permissionChecks).toEqual([{ tool: "procurement.requests", label: "Demandes d'achat", permission: "procurement.request.read", granted: true }]);
    expect(evidence.answer).not.toContain("confidentiel");
    assertSourcesAuthorized(evidence);
  });

  it("domaine sans droit : refus trace, aucune donnee lue ni citee", async () => {
    const { evidence } = await ask(buyer, "Quelles non-conformités QHSE sont ouvertes ?");
    expect(evidence.permissionChecks).toEqual([expect.objectContaining({ tool: "qhse.open", permission: "qhse.inspection.read", granted: false })]);
    expect(evidence.sources).toEqual([]);
    expect(evidence.answer).not.toContain("Échafaudage");
    expect(evidence.answer).not.toContain(findingCode);
    expect(evidence.answer).toContain("permission qhse.inspection.read absente");
    // Le proprietaire, lui, obtient la donnee : la difference vient bien du RBAC.
    const ownerView = await ask(owner, "Quelles non-conformités QHSE sont ouvertes ?");
    expect(ownerView.evidence.answer).toContain(findingCode);
    assertSourcesAuthorized(ownerView.evidence);
  });

  it("synthese : seules les sections du tableau de bord autorisees sont lues", async () => {
    const { evidence } = await ask(buyer, "Fais-moi une synthèse de la situation");
    expect(evidence.mode).toBe("BRIEFING");
    const byTool = new Map(evidence.permissionChecks.map((check) => [check.tool, check.granted]));
    expect(byTool.get("dashboard.procurement")).toBe(true);
    expect(byTool.get("dashboard.finance")).toBe(false);
    expect(byTool.get("dashboard.hr")).toBe(false);
    expect(byTool.get("dashboard.qhse")).toBe(false);
    expect(evidence.sources.length).toBeGreaterThan(0);
    expect(evidence.sources.every((source) => source.tool === "dashboard.procurement")).toBe(true);
    assertSourcesAuthorized(evidence);
  });

  it("consultation par reference : dans le perimetre seulement, sans reveler l'existence ailleurs", async () => {
    const own = await ask(buyer, `Où en est ${requestCode} ?`);
    expect(own.evidence.mode).toBe("LOOKUP");
    expect(own.evidence.answer).toContain("soumise, en attente de décision");
    // Workflow non consultable par l'acheteur : son etat n'est pas cite.
    expect(own.evidence.sources.map((source) => source.resourceType)).toEqual(["PurchaseRequest"]);
    const foreign = await ask(buyer, `Et ${foreignCode} ?`);
    expect(foreign.evidence.answer).toContain(`Aucune pièce ${foreignCode} trouvée dans votre périmètre`);
    expect(foreign.evidence.answer).not.toContain("confidentiel");
    const denied = await ask(buyer, `Détail de ${findingCode}`);
    // La reference (lookup.NC) et le mot-cle « NC » (outil QHSE) sont tous deux controles, et refuses.
    expect(denied.evidence.permissionChecks.map((check) => check.tool).sort()).toEqual(["lookup.NC", "qhse.open"]);
    expect(denied.evidence.permissionChecks.every((check) => !check.granted)).toBe(true);
    expect(denied.evidence.sources).toEqual([]);
    expect(denied.evidence.answer).not.toContain("Échafaudage");
    for (const result of [own, foreign, denied]) assertSourcesAuthorized(result.evidence);
  });

  it("question hors perimetre : aucune reponse inventee, seulement ce que l'utilisateur peut demander", async () => {
    const { evidence } = await ask(buyer, "Quelle est la capitale du Congo ?");
    expect(evidence.mode).toBe("HELP");
    expect(evidence.sources).toEqual([]);
    expect(evidence.answer).toContain("Demandes d'achat");
    expect(evidence.answer).not.toContain("QHSE —");
    expect(evidence.answer).not.toContain("Kinshasa");
  });

  it("conversations privees a leur auteur ; preuves auditables par ai.evidence.read, jamais hors tenant", async () => {
    const first = await ask(buyer, "Demandes d'achat en attente ?");
    const second = await ask(buyer, "Et les achats soumis ?", first.sessionId);
    expect(second.sessionId).toBe(first.sessionId);
    const detail = await as(harness, buyer).get(`/copilot/sessions/${first.sessionId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.exchangesDetail).toHaveLength(2);
    expect((await as(harness, owner).get(`/copilot/sessions/${first.sessionId}`)).status).toBe(404);
    expect((await as(harness, owner).post("/copilot/ask", { question: "x", sessionId: first.sessionId })).status).toBe(404);
    expect((await as(harness, other).get(`/copilot/sessions/${first.sessionId}`)).status).toBe(404);

    const audit = await as(harness, owner).get(`/copilot/evidence?userId=${buyer.userId}`);
    expect(audit.status).toBe(200);
    expect(audit.body.length).toBeGreaterThanOrEqual(8);
    expect(audit.body.every((row: { userName: string }) => row.userName.startsWith("acheteur"))).toBe(true);
    expect((await as(harness, other).get("/copilot/evidence")).body).toEqual([]);
  });

  it("garanties en base : preuve append-only, empreinte verifiee, preuve liee au proprietaire de la session", async () => {
    const { evidence, sessionId } = await ask(buyer, "Demandes d'achat ?");
    await expect(harness.prisma.aiInferenceEvidence.update({ where: { id: evidence.id }, data: { answer: "réécrite" } })).rejects.toThrow();
    await expect(harness.prisma.aiInferenceEvidence.delete({ where: { id: evidence.id } })).rejects.toThrow();
    const base = { organizationId: owner.organizationId, companyId: owner.companyId, question: "q", mode: "HELP", permissionChecks: [], sources: [], blocks: [], engine: "x", latencyMs: 0 };
    await expect(harness.prisma.aiInferenceEvidence.create({ data: { ...base, userId: buyer.userId, sessionId, answer: "vrai", answerSha256: "0".repeat(64) } })).rejects.toThrow();
    const hash = createHash("sha256").update("vrai", "utf8").digest("hex");
    await expect(harness.prisma.aiInferenceEvidence.create({ data: { ...base, userId: owner.userId, sessionId, answer: "vrai", answerSha256: hash } })).rejects.toThrow();
    await expect(harness.prisma.aiCopilotSession.update({ where: { id: sessionId }, data: { userId: owner.userId } })).rejects.toThrow();
    const accepted = await harness.prisma.aiInferenceEvidence.create({ data: { ...base, userId: buyer.userId, sessionId, answer: "vrai", answerSha256: hash } });
    expect(accepted.id).toBeTruthy();
  });
});
