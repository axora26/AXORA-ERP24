import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { createClient } from "../client.mjs";

/** Comptes DEMO du circuit d'approbation (environnement local uniquement). */
export const WORKFLOW_DEMO = {
  daf: { email: "daf@axora-erp24.local", fullName: "Grâce Kabongo", password: "Controle2026!" },
};

/** Recepteur local ephemere : prouve la livraison et la signature HMAC d'un webhook reel. */
async function startReceiver() {
  const received = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      received.push({ headers: request.headers, body });
      response.end("ok");
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${server.address().port}/axora/webhooks`, received, close: () => new Promise((resolve) => server.close(resolve)) };
}

function signatureValid(secret, delivery) {
  const expected = Buffer.from(`v1=${createHmac("sha256", secret).update(`${delivery.headers["x-axora-timestamp"]}.${delivery.body}`).digest("hex")}`);
  const given = Buffer.from(String(delivery.headers["x-axora-signature"] ?? ""));
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/**
 * WORKFLOW DEMO : roles DAF / Direction generale, quatre workflows reels
 * (achat > 10 000, facture en ecart, NC critique, alarme critique), puis un
 * circuit complet : demande d'achat soumise -> notification + approbation DAF
 * + webhook signe recu et verifie -> decision DAF -> approbation metier.
 */
export const workflowStep = {
  name: "Workflows & approbations (règles, circuit DAF, webhook signé)",
  async isDone(api) {
    return (await api.get("/workflow/definitions")).length > 0;
  },
  async run(api) {
    const companies = await api.get("/admin/companies");
    const roles = await api.get("/admin/roles");
    const dafRole =
      roles.find((role) => role.name === "Contrôle de gestion (DAF)") ??
      (await api.post("/admin/roles", {
        name: "Contrôle de gestion (DAF)",
        permissions: ["dashboard.overview.read", "procurement.request.read", "procurement.request.approve", "finance.payable.read", "finance.payable.approve", "workflow.definition.read", "workflow.approval.decide"],
      }));
    const dgRole = roles.find((role) => role.name === "Direction générale (visa)") ?? (await api.post("/admin/roles", { name: "Direction générale (visa)", permissions: ["workflow.definition.read", "workflow.approval.decide"] }));
    const directionRole = roles.find((role) => role.name === "Direction (lecture)");
    const users = await api.get("/admin/users");
    if (!users.some((user) => user.email === WORKFLOW_DEMO.daf.email)) {
      await api.post("/admin/users", { email: WORKFLOW_DEMO.daf.email, fullName: WORKFLOW_DEMO.daf.fullName, password: WORKFLOW_DEMO.daf.password, roleIds: [dafRole.id], companyIds: [companies[0].id] });
    }
    const direction = users.find((user) => user.email === "direction@axora-erp24.local");
    if (direction && !direction.roles.some((role) => role.id === dgRole.id)) {
      await api.patch(`/admin/users/${direction.id}`, { roleIds: [...direction.roles.map((role) => role.id), dgRole.id] });
    }

    const receiver = await startReceiver();
    try {
      const purchase = {
        code: "ACHAT-10K",
        name: "Achat supérieur à 10 000 — visa DAF",
        description: "Toute demande d'achat estimée au-delà de 10 000 exige le visa du contrôle de gestion sous 24 h, escalade à la Direction générale.",
        eventType: "procurement.request.submitted",
        conditions: [{ field: "estimatedTotal", operator: "gt", value: "10000" }],
        actions: [
          { type: "NOTIFY", roleId: dafRole.id, title: "Demande {{code}} à viser", body: "{{title}} — {{estimatedTotal}} {{currency}}" },
          { type: "REQUIRE_APPROVAL", approverRoleId: dafRole.id, escalationRoleId: dgRole.id, slaHours: 24, title: "Visa DAF — {{code}} {{title}}" },
        ],
      };
      let created;
      try {
        created = await api.post("/workflow/definitions", { ...purchase, actions: [...purchase.actions, { type: "WEBHOOK", url: receiver.url }] });
      } catch (error) {
        // Cibles locales interdites par la configuration du serveur : workflow cree sans webhook.
        if (error.status !== 400) throw error;
        created = await api.post("/workflow/definitions", purchase);
      }
      await api.post("/workflow/definitions", {
        code: "FACT-ECART",
        name: "Facture fournisseur en écart — visa DAF",
        eventType: "finance.payable.recorded",
        conditions: [{ field: "matchStatus", operator: "neq", value: "MATCHED" }],
        actions: [
          { type: "NOTIFY", roleId: dafRole.id, title: "Facture {{code}} en écart", body: "{{supplierName}} — {{total}} {{currency}} ({{matchStatus}})" },
          { type: "REQUIRE_APPROVAL", approverRoleId: dafRole.id, escalationRoleId: dgRole.id, slaHours: 48, title: "Visa facture {{code}} ({{supplierName}})" },
        ],
      });
      if (directionRole) {
        await api.post("/workflow/definitions", {
          code: "NC-CRITIQUE",
          name: "Non-conformité critique — alerte Direction",
          eventType: "qhse.finding.created",
          conditions: [{ field: "severity", operator: "eq", value: "CRITICAL" }],
          actions: [{ type: "NOTIFY", roleId: directionRole.id, title: "NC critique {{code}}", body: "{{title}} ({{domain}})" }],
        });
        await api.post("/workflow/definitions", {
          code: "ALARME-CRITIQUE",
          name: "Alarme GTB critique — alerte Direction",
          eventType: "smart.alarm.raised",
          conditions: [{ field: "severity", operator: "eq", value: "CRITICAL" }],
          actions: [{ type: "NOTIFY", roleId: directionRole.id, title: "Alarme critique : {{pointName}}", body: "{{message}} — valeur {{triggerValue}}" }],
        });
      }

      // Circuit complet : deux demandes > 10 000 ; la premiere est visee puis approuvee, la seconde reste a viser.
      const projects = await api.get("/projects");
      const projectId = projects.find((project) => project.status === "IN_PROGRESS")?.id;
      const requests = [];
      for (const [title, description, price] of [
        ["Groupe froid de secours bloc opératoire", "Groupe froid 120 kW", "18500.00"],
        ["Onduleurs salle informatique", "Onduleur 40 kVA", "13200.00"],
      ]) {
        const request = await api.post("/procurement/requests", { title, projectId, lines: [{ description, unitCode: "u", quantity: "1", estimatedUnitPrice: price }] });
        await api.post(`/procurement/requests/${request.id}/submit`);
        requests.push(request);
      }
      await api.post("/workflow/run");
      for (let attempt = 0; attempt < 20 && created.webhookSecrets.length > 0 && receiver.received.length < 2; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 250));
      if (created.webhookSecrets.length > 0) {
        const secret = created.webhookSecrets[0].secret;
        const verified = receiver.received.filter((delivery) => signatureValid(secret, delivery)).length;
        console.log(`    webhook : ${receiver.received.length} livraison(s) reçue(s), ${verified} signature(s) HMAC vérifiée(s)`);
      }

      const daf = createClient(api.baseUrl);
      await daf.post("/auth/login", { email: WORKFLOW_DEMO.daf.email, password: WORKFLOW_DEMO.daf.password });
      const approvals = await daf.get("/workflow/approvals");
      const first = approvals.find((approval) => approval.resourceId === requests[0].id);
      if (first) {
        await daf.post(`/workflow/approvals/${first.id}/decision`, { decision: "APPROVED", note: "Budget lot CVC disponible — visa accordé." });
        await daf.post(`/procurement/requests/${requests[0].id}/approve`, { note: "Visa DAF obtenu." });
      }
    } finally {
      await receiver.close();
    }
  },
};
