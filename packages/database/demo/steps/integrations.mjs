import { createHmac } from "node:crypto";

/**
 * INTEGRATIONS DEMO : une cle d'API en lecture (projets, analyses) appelee
 * reellement, et un webhook entrant « formulaire du site » alimente par une
 * requete signee (HMAC) — le secret n'est conserve nulle part apres le seed.
 */
export const integrationsStep = {
  name: "API publique & intégrations (clé, appels réels, webhook signé)",
  async isDone(api) {
    return (await api.get("/integrations/api-keys")).length > 0;
  },
  async run(api) {
    const issued = await api.post("/integrations/api-keys", {
      name: "ERP groupe — lecture projets",
      permissions: ["projects.project.read", "analytics.report.read", "finance.invoice.read"],
      rateLimitPerMinute: 120,
      dailyQuota: 5000,
    });
    const headers = { Authorization: `Bearer ${issued.secret}` };
    const projects = await fetch(`${api.baseUrl}/public/projects?limit=10`, { headers });
    const series = await fetch(`${api.baseUrl}/public/analytics/finance.invoiced?months=6`, { headers });
    const refused = await fetch(`${api.baseUrl}/public/supplier-invoices`, { headers });
    console.log(`    API publique : projets ${projects.status}, analytique ${series.status}, factures fournisseurs ${refused.status} (permission non accordée)`);

    const endpoint = await api.post("/integrations/inbound", { name: "Formulaire de contact du site web", kind: "CRM_LEAD" });
    const body = JSON.stringify({
      id: "site-contact-0001",
      type: "crm.lead",
      data: { contactName: "Mireille Tshibanda", companyName: "Résidence Les Palmiers", email: "contact@residence-palmiers.demo", message: "Demande de devis : climatisation de 24 logements." },
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = `v1=${createHmac("sha256", endpoint.secret).update(`${timestamp}.${body}`).digest("hex")}`;
    const send = () => fetch(`${api.baseUrl}/public/inbound/${endpoint.endpoint.id}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Axora-Timestamp": timestamp, "X-Axora-Signature": signature }, body });
    const first = await send();
    const replay = await send();
    console.log(`    webhook entrant : 1er envoi ${first.status}, rejeu ${replay.status} (idempotent)`);
  },
};
