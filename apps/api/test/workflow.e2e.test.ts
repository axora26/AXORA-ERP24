import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createHarness, registerTenant, type Harness, type Tenant } from "./support/harness.js";
import { createUserWith } from "./support/fixtures.js";
import { verifyWebhook } from "../src/workflow/engine.js";

interface Received {
  headers: IncomingHttpHeaders;
  body: string;
}

/** Recepteur HTTP local reel : enregistre les livraisons et repond avec le code configure. */
async function receiver(): Promise<{ url: string; received: Received[]; setStatus: (status: number) => void; close: () => Promise<void> }> {
  const received: Received[] = [];
  let status = 200;
  const server: Server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
    request.on("end", () => {
      received.push({ headers: request.headers, body });
      response.statusCode = status;
      response.end(status === 200 ? "ok" : "boom");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/hooks/axora`, received, setStatus: (next) => (status = next), close: () => new Promise((resolve) => server.close(() => resolve())) };
}

/**
 * INC-21 — Workflow Engine & Automatisation, via l'API reelle et PostgreSQL :
 * evenement -> condition -> actions, idempotence, quatre yeux, barriere
 * d'approbation, escalade, webhook signe verifie par un recepteur reel,
 * journal des echecs, versionnement et isolation.
 */
describe("INC-21 Workflow (e2e)", () => {
  let harness: Harness;
  let owner: Tenant;
  let daf: Tenant;
  let dg: Tenant;
  let other: Tenant;
  let dafRoleId = "";
  let dgRoleId = "";
  let emptyRoleId = "";
  let definitionId = "";
  let secret = "";
  let hook: Awaited<ReturnType<typeof receiver>>;
  const api = () => as(harness, owner);

  async function run() {
    const response = await api().post("/workflow/run");
    expect(response.status).toBe(201);
    return response.body as { events: number; executions: number; deliveries: number; escalations: number };
  }

  async function submittedRequest(unitPrice: string): Promise<string> {
    const request = await api().post("/procurement/requests", { title: `Achat ${unitPrice}`, lines: [{ description: "Fourniture", unitCode: "u", quantity: "10", estimatedUnitPrice: unitPrice }] });
    expect(request.status).toBe(201);
    expect((await api().post(`/procurement/requests/${request.body.id}/submit`)).status).toBe(201);
    return request.body.id as string;
  }

  async function approvalFor(resourceId: string) {
    const list = await as(harness, daf).get("/workflow/approvals");
    expect(list.status).toBe(200);
    return (list.body as Array<{ id: string; resourceId: string; status: string; canDecide: boolean; code: string }>).find((approval) => approval.resourceId === resourceId);
  }

  beforeAll(async () => {
    harness = await createHarness();
    hook = await receiver();
    owner = await registerTenant(harness, "wf");
    other = await registerTenant(harness, "wf-other");
    daf = await createUserWith(harness, owner, ["procurement.request.read", "procurement.request.approve", "workflow.definition.read", "workflow.approval.decide"], "daf");
    dg = await createUserWith(harness, owner, ["procurement.request.read", "workflow.approval.decide"], "dg");
    const roles = await api().get("/workflow/roles");
    expect(roles.status).toBe(200);
    const roleOf = async (user: Tenant) => (await harness.prisma.roleAssignment.findFirstOrThrow({ where: { userId: user.userId } })).roleId;
    dafRoleId = await roleOf(daf);
    dgRoleId = await roleOf(dg);
    const empty = await api().post("/admin/roles", { name: `vide-${Date.now()}`, permissions: ["workflow.definition.read"] });
    emptyRoleId = empty.body.id;
  });

  afterAll(async () => {
    await hook?.close();
    await harness?.close();
  });

  it("validation stricte et RBAC deny-by-default sur la configuration", async () => {
    expect((await as(harness, daf).post("/workflow/definitions", {})).status).toBe(403);
    expect((await as(harness, dg).get("/workflow/definitions")).status).toBe(403);
    const base = { code: "PR-GT-10K", name: "Achats > 10 000", eventType: "procurement.request.submitted", actions: [{ type: "NOTIFY", roleId: dafRoleId, title: "t", body: "b" }] };
    expect((await api().post("/workflow/definitions", { ...base, eventType: "inconnu" })).status).toBe(400);
    expect((await api().post("/workflow/definitions", { ...base, conditions: [{ field: "absent", operator: "eq", value: "x" }] })).status).toBe(400);
    expect((await api().post("/workflow/definitions", { ...base, conditions: [{ field: "title", operator: "gt", value: "x" }] })).status).toBe(400);
    expect((await api().post("/workflow/definitions", { ...base, conditions: [{ field: "estimatedTotal", operator: "gt", value: "dix mille" }] })).status).toBe(400);
    expect((await api().post("/workflow/definitions", { ...base, actions: [] })).status).toBe(400);
    const qhseApproval = await api().post("/workflow/definitions", { ...base, eventType: "qhse.finding.created", actions: [{ type: "REQUIRE_APPROVAL", approverRoleId: dafRoleId, slaHours: 4, title: "x" }] });
    expect(qhseApproval.status).toBe(400);
    const credentials = await api().post("/workflow/definitions", { ...base, actions: [{ type: "WEBHOOK", url: "https://user:pw@hooks.example.com/x" }] });
    expect(credentials.status).toBe(400);
    expect(credentials.body.message).toContain("identifiants");
    // Un role d'une autre organisation n'est jamais accepte.
    const foreignRole = await as(harness, other).post("/admin/roles", { name: `etranger-${Date.now()}`, permissions: ["workflow.definition.read"] });
    expect((await api().post("/workflow/definitions", { ...base, actions: [{ type: "NOTIFY", roleId: foreignRole.body.id, title: "t", body: "b" }] })).status).toBe(400);
  });

  it("creation : secret de signature montre une seule fois, jamais relu", async () => {
    const created = await api().post("/workflow/definitions", {
      code: "pr-gt-10k",
      name: "Achats supérieurs à 10 000",
      eventType: "procurement.request.submitted",
      conditions: [{ field: "estimatedTotal", operator: "gt", value: "10000" }],
      actions: [
        { type: "NOTIFY", roleId: dafRoleId, title: "Demande {{code}} à valider", body: "{{title}} : {{estimatedTotal}} {{currency}}" },
        { type: "REQUIRE_APPROVAL", approverRoleId: dafRoleId, escalationRoleId: dgRoleId, slaHours: 24, title: "Visa DAF {{code}}" },
        { type: "WEBHOOK", url: hook.url },
      ],
    });
    expect(created.status).toBe(201);
    expect(created.body.definition.code).toBe("PR-GT-10K");
    expect(created.body.definition.version).toBe(1);
    expect(created.body.webhookSecrets).toHaveLength(1);
    secret = created.body.webhookSecrets[0].secret;
    expect(secret).toMatch(/^whsec_/);
    definitionId = created.body.definition.id;
    const listed = await api().get("/workflow/definitions");
    const raw = JSON.stringify(listed.body);
    expect(raw).not.toContain(secret);
    expect(raw).not.toContain("secretEnc");
    const stored = await harness.prisma.workflowDefinition.findUniqueOrThrow({ where: { id: definitionId } });
    expect(JSON.stringify(stored.actions)).not.toContain(secret);
  });

  it("condition non remplie : aucune execution, la decision metier reste libre", async () => {
    const requestId = await submittedRequest("500.00");
    const report = await run();
    expect(report.executions).toBe(0);
    expect(await harness.prisma.automationExecution.count({ where: { definitionId } })).toBe(0);
    expect((await as(harness, daf).post(`/procurement/requests/${requestId}/approve`)).status).toBe(201);
  });

  it("condition remplie : notification, approbation bloquante, webhook signe verifie ; idempotence", async () => {
    const requestId = await submittedRequest("1250.00");
    // Fail-closed : tant que l'evenement n'est pas evalue, la decision est refusee.
    const early = await as(harness, daf).post(`/procurement/requests/${requestId}/approve`);
    expect(early.status).toBe(409);
    expect(early.body.message).toContain("Évaluation du workflow en cours");

    const report = await run();
    expect(report.executions).toBe(1);
    expect(report.deliveries).toBe(1);

    const executions = await api().get(`/workflow/executions?definitionId=${definitionId}`);
    expect(executions.body).toHaveLength(1);
    expect(executions.body[0].status).toBe("SUCCEEDED");
    expect(executions.body[0].log.map((entry: { action: string; ok: boolean }) => `${entry.action}:${entry.ok}`)).toEqual(["NOTIFY:true", "REQUIRE_APPROVAL:true", "WEBHOOK:true"]);

    const notifications = await as(harness, daf).get("/notifications");
    expect(notifications.status).toBe(200);
    const titles = notifications.body.items.map((item: { title: string }) => item.title);
    expect(titles.some((title: string) => /^Demande DA-\d{4}-\d+ à valider$/.test(title))).toBe(true);
    expect(titles.some((title: string) => title.startsWith("Approbation requise — Visa DAF"))).toBe(true);
    expect(notifications.body.items.find((item: { body: string }) => item.body.includes("12500.00 USD"))).toBeTruthy();

    // Webhook : livre au recepteur reel, signature HMAC verifiee avec le secret montre a la creation.
    expect(hook.received).toHaveLength(1);
    const delivery = hook.received[0]!;
    const signature = String(delivery.headers["x-axora-signature"]);
    const timestamp = String(delivery.headers["x-axora-timestamp"]);
    expect(verifyWebhook(secret, timestamp, delivery.body, signature)).toBe(true);
    expect(verifyWebhook(secret, timestamp, delivery.body.replace("12500.00", "1.00"), signature)).toBe(false);
    const payload = JSON.parse(delivery.body);
    expect(payload).toMatchObject({ type: "procurement.request.submitted", resource: { type: "PurchaseRequest", id: requestId }, workflow: { code: "PR-GT-10K", version: 1 }, data: { estimatedTotal: "12500.00" } });
    expect(delivery.headers["x-axora-delivery"]).toBe(payload.id);
    const deliveries = await api().get("/workflow/deliveries");
    expect(deliveries.body[0]).toMatchObject({ status: "DELIVERED", attempts: 1, lastStatusCode: 200 });

    // Idempotence : un second passage ne rejoue rien ; la base refuse un doublon et toute retouche du journal.
    expect((await run()).executions).toBe(0);
    expect(await harness.prisma.automationExecution.count({ where: { definitionId } })).toBe(1);
    expect(hook.received).toHaveLength(1);
    const execution = await harness.prisma.automationExecution.findFirstOrThrow({ where: { definitionId } });
    await expect(harness.prisma.automationExecution.create({ data: { organizationId: execution.organizationId, companyId: execution.companyId, definitionId, eventId: execution.eventId, status: "SUCCEEDED", log: [], startedAt: new Date() } })).rejects.toThrow();
    await expect(harness.prisma.automationExecution.update({ where: { id: execution.id }, data: { error: "maquillage" } })).rejects.toThrow();
    const event = await harness.prisma.automationEvent.findUniqueOrThrow({ where: { id: execution.eventId } });
    await expect(harness.prisma.automationEvent.update({ where: { id: event.id }, data: { processedAt: null } })).rejects.toThrow();

    // Barriere : l'approbation metier attend la decision du workflow.
    const blocked = await as(harness, daf).post(`/procurement/requests/${requestId}/approve`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toContain("en attente");

    const approval = (await approvalFor(requestId))!;
    expect(approval.status).toBe("PENDING");
    expect(approval.canDecide).toBe(true);
    // Quatre yeux : le demandeur (owner) ne decide pas, meme avec toutes les permissions.
    const own = await api().post(`/workflow/approvals/${approval.id}/decision`, { decision: "APPROVED" });
    expect(own.status).toBe(403);
    expect(own.body.message).toContain("quatre yeux");
    // Le role d'escalade n'a pas la main avant l'escalade.
    expect((await as(harness, dg).post(`/workflow/approvals/${approval.id}/decision`, { decision: "APPROVED" })).status).toBe(403);
    const decided = await as(harness, daf).post(`/workflow/approvals/${approval.id}/decision`, { decision: "APPROVED", note: "Budget disponible" });
    expect(decided.status).toBe(201);
    expect(decided.body).toMatchObject({ status: "APPROVED", canDecide: false });
    expect((await as(harness, daf).post(`/workflow/approvals/${approval.id}/decision`, { decision: "REJECTED", note: "x" })).status).toBe(409);
    await expect(harness.prisma.workflowApproval.update({ where: { id: approval.id }, data: { status: "PENDING" } })).rejects.toThrow();

    const approved = await as(harness, daf).post(`/procurement/requests/${requestId}/approve`);
    expect(approved.status).toBe(201);
    expect(approved.body.status).toBe("APPROVED");
    const ownerNotes = await api().get("/notifications");
    expect(ownerNotes.body.items.some((item: { title: string }) => item.title.includes("approuvée"))).toBe(true);
    const audit = await harness.prisma.auditLog.findMany({ where: { organizationId: owner.organizationId, action: { startsWith: "workflow." } }, select: { action: true } });
    expect(audit.map((entry) => entry.action)).toEqual(expect.arrayContaining(["workflow.definition.created", "workflow.approval.requested", "workflow.approval.approved"]));
  });

  it("refus motive : la piece ne peut plus etre approuvee, seulement refusee", async () => {
    const requestId = await submittedRequest("1500.00");
    await run();
    const approval = (await approvalFor(requestId))!;
    expect((await as(harness, daf).post(`/workflow/approvals/${approval.id}/decision`, { decision: "REJECTED" })).status).toBe(400);
    expect((await as(harness, daf).post(`/workflow/approvals/${approval.id}/decision`, { decision: "REJECTED", note: "Hors budget" })).status).toBe(201);
    const blocked = await as(harness, daf).post(`/procurement/requests/${requestId}/approve`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toContain("refusée : Hors budget");
    expect((await as(harness, daf).post(`/procurement/requests/${requestId}/reject`, { note: "Refus workflow" })).status).toBe(201);
  });

  it("escalade unique apres echeance : le role d'escalade est notifie et peut decider", async () => {
    const requestId = await submittedRequest("2000.00");
    await run();
    const approval = (await approvalFor(requestId))!;
    await harness.prisma.workflowApproval.update({ where: { id: approval.id }, data: { dueAt: new Date(Date.now() - 60_000) } });
    const report = await run();
    expect(report.escalations).toBe(1);
    expect((await run()).escalations).toBe(0);
    const dgNotes = await as(harness, dg).get("/notifications");
    expect(dgNotes.body.items.filter((item: { title: string }) => item.title.startsWith("Escalade —"))).toHaveLength(1);
    const view = await as(harness, dg).get("/workflow/approvals?status=PENDING");
    expect(view.body.find((row: { id: string }) => row.id === approval.id)).toMatchObject({ canDecide: true, overdue: true });
    expect((await as(harness, dg).post(`/workflow/approvals/${approval.id}/decision`, { decision: "APPROVED" })).status).toBe(201);
    const audit = await harness.prisma.auditLog.count({ where: { resourceId: approval.id, action: "workflow.approval.escalated" } });
    expect(audit).toBe(1);
  });

  it("echecs journalises : destinataire absent, webhook en erreur puis nouvelle tentative", async () => {
    hook.setStatus(500);
    const created = await api().post("/workflow/definitions", {
      code: "NC-CRITIQUE",
      name: "Non-conformité critique",
      eventType: "qhse.finding.created",
      conditions: [{ field: "severity", operator: "eq", value: "CRITICAL" }],
      actions: [
        { type: "NOTIFY", roleId: emptyRoleId, title: "NC {{code}}", body: "{{title}}" },
        { type: "WEBHOOK", url: hook.url },
      ],
    });
    expect(created.status).toBe(201);
    const qhseSecret = created.body.webhookSecrets[0].secret;
    const finding = await api().post("/qhse/findings", { title: "Garde-corps absent", description: "Niveau R+3", category: "SAFETY", severity: "CRITICAL" });
    expect(finding.status).toBe(201);
    await api().post("/qhse/findings", { title: "Mineure", description: "Etiquetage", category: "QUALITY", severity: "MINOR" });
    const before = hook.received.length;
    await run();
    const execution = (await api().get(`/workflow/executions?definitionId=${created.body.definition.id}`)).body;
    expect(execution).toHaveLength(1);
    expect(execution[0].status).toBe("FAILED");
    expect(execution[0].error).toContain("Aucun destinataire actif");
    expect(hook.received.length).toBe(before + 1);
    let delivery = (await api().get("/workflow/deliveries")).body.find((row: { definitionCode: string }) => row.definitionCode === "NC-CRITIQUE");
    expect(delivery).toMatchObject({ status: "PENDING", attempts: 1, lastStatusCode: 500, lastError: "Réponse HTTP 500" });
    expect(new Date(delivery.nextAttemptAt).getTime()).toBeGreaterThan(Date.now() + 30_000);
    // Pas de nouvelle tentative avant l'echeance.
    await run();
    expect(hook.received.length).toBe(before + 1);
    // Echec definitif simule, puis relance manuelle : re-signee avec un horodatage frais.
    await harness.prisma.webhookDelivery.update({ where: { id: delivery.id }, data: { status: "FAILED", nextAttemptAt: null } });
    hook.setStatus(200);
    const retried = await api().post(`/workflow/deliveries/${delivery.id}/retry`);
    expect(retried.status).toBe(201);
    expect(retried.body).toMatchObject({ status: "DELIVERED", attempts: 2, lastStatusCode: 200 });
    const last = hook.received[hook.received.length - 1]!;
    expect(verifyWebhook(qhseSecret, String(last.headers["x-axora-timestamp"]), last.body, String(last.headers["x-axora-signature"]))).toBe(true);
    expect((await api().post(`/workflow/deliveries/${delivery.id}/retry`)).status).toBe(409);
    delivery = await harness.prisma.webhookDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    await expect(harness.prisma.webhookDelivery.update({ where: { id: delivery.id }, data: { body: "{}" } })).rejects.toThrow();
  });

  it("versionnement : une modification cree une version, une version est immuable", async () => {
    const v2 = await api().post("/workflow/definitions", {
      code: "PR-GT-10K",
      name: "Achats supérieurs à 50 000",
      eventType: "procurement.request.submitted",
      conditions: [{ field: "estimatedTotal", operator: "gt", value: "50000" }],
      actions: [{ type: "NOTIFY", roleId: dafRoleId, title: "Gros achat {{code}}", body: "{{estimatedTotal}}" }],
    });
    expect(v2.status).toBe(201);
    expect(v2.body.definition.version).toBe(2);
    const all = (await api().get("/workflow/definitions")).body.filter((row: { code: string }) => row.code === "PR-GT-10K");
    expect(all.map((row: { version: number; active: boolean }) => `${row.version}:${row.active}`)).toEqual(["2:true", "1:false"]);
    await expect(harness.prisma.workflowDefinition.update({ where: { id: definitionId }, data: { conditions: [] } })).rejects.toThrow();
    // Reactiver v1 desactive v2 (une seule version active par code).
    expect((await api().post(`/workflow/definitions/${definitionId}/active`, { active: true })).body.active).toBe(true);
    const after = (await api().get("/workflow/definitions")).body.filter((row: { code: string; active: boolean }) => row.code === "PR-GT-10K" && row.active);
    expect(after).toHaveLength(1);
    expect(after[0].version).toBe(1);
    // Une definition creee apres un evenement ne s'applique pas retroactivement.
    const summary = await api().get("/workflow/summary");
    expect(summary.body).toMatchObject({ pendingEvents: 0 });
  });

  it("notifications strictement personnelles ; lecture groupee", async () => {
    const mine = await as(harness, daf).get("/notifications");
    expect(mine.body.unread).toBeGreaterThan(0);
    const ownerNote = (await api().get("/notifications")).body.items[0];
    expect((await as(harness, daf).post(`/notifications/${ownerNote.id}/read`)).status).toBe(404);
    const cleared = await as(harness, daf).post("/notifications/read-all");
    expect(cleared.body.unread).toBe(0);
    expect((await api().get("/notifications")).body.unread).toBeGreaterThan(0);
    expect((await harness.http().get("/api/v1/notifications")).status).toBe(401);
  });

  it("isolation : aucun acces aux workflows, approbations ou livraisons d'un autre tenant", async () => {
    const theirs = as(harness, other);
    expect((await theirs.get("/workflow/definitions")).body).toEqual([]);
    expect((await theirs.get("/workflow/approvals")).body).toEqual([]);
    expect((await theirs.get("/workflow/deliveries")).body).toEqual([]);
    expect((await theirs.get("/workflow/executions")).body).toEqual([]);
    const foreign = await harness.prisma.workflowApproval.findFirstOrThrow({ where: { organizationId: owner.organizationId } });
    expect((await theirs.post(`/workflow/approvals/${foreign.id}/decision`, { decision: "APPROVED" })).status).toBe(404);
    expect((await theirs.post(`/workflow/definitions/${definitionId}/active`, { active: false })).status).toBe(404);
    const delivery = await harness.prisma.webhookDelivery.findFirstOrThrow({ where: { organizationId: owner.organizationId } });
    expect((await theirs.post(`/workflow/deliveries/${delivery.id}/retry`)).status).toBe(404);
    // Un evenement de l'autre tenant ne declenche jamais les workflows de ce tenant.
    const before = await harness.prisma.automationExecution.count({ where: { organizationId: owner.organizationId } });
    const request = await theirs.post("/procurement/requests", { title: "Achat autre tenant", lines: [{ description: "X", unitCode: "u", quantity: "100", estimatedUnitPrice: "1000.00" }] });
    await theirs.post(`/procurement/requests/${request.body.id}/submit`);
    expect((await theirs.post("/workflow/run")).status).toBe(201);
    expect(await harness.prisma.automationExecution.count({ where: { organizationId: owner.organizationId } })).toBe(before);
    expect((await theirs.post(`/procurement/requests/${request.body.id}/approve`)).status).toBe(403);
  });
});
