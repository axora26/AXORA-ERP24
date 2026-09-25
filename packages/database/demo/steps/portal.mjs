import { createClient } from "../client.mjs";

/** Identifiants DEMO du portail externe (environnement local uniquement). */
export const PORTAL_DEMO = {
  client: { email: "moa@clinique-saint-luc.demo", password: "PortailClient2026!" },
  supplier: { email: "adv@fournisseur.demo", password: "PortailFournisseur2026!" },
};

/**
 * PORTAILS DEMO : un acces client rattache au compte CRM du projet et un
 * acces fournisseur, invites puis ACTIVES par le vrai parcours
 * (invitation a usage unique -> activation), avec expositions explicites.
 */
export const portalStep = {
  name: "Portails client & fournisseur (invitations, expositions)",
  async isDone(api) {
    return (await api.get("/portal-admin/principals")).length > 0;
  },
  async run(api) {
    const projects = await api.get("/projects");
    const project = await api.get(`/projects/${projects[0].id}`);
    const contract = await api.get(`/sales/contracts/${project.contractId}`);
    const opportunities = await api.get("/crm/opportunities");
    const accountId = opportunities.find((opportunity) => opportunity.id === contract.opportunityId)?.accountId;
    const external = createClient(api.baseUrl);

    async function invite(input, password) {
      const issued = await api.post("/portal-admin/principals", input);
      await external.post("/portal/auth/activate", { token: issued.activationPath.split("#")[1], password });
      const candidates = await api.get(`/portal-admin/principals/${issued.principal.id}/candidates`);
      for (const candidate of candidates) {
        await api.post(`/portal-admin/principals/${issued.principal.id}/grants`, { resourceType: candidate.resourceType, resourceId: candidate.resourceId });
      }
      return issued.principal;
    }

    if (accountId) {
      await invite({ kind: "CLIENT", email: PORTAL_DEMO.client.email, fullName: "Dr Aline Mwamba — maîtrise d'ouvrage", crmAccountId: accountId }, PORTAL_DEMO.client.password);
    }
    const suppliers = await api.get("/procurement/suppliers");
    const orders = await api.get("/procurement/orders");
    const supplier = suppliers.find((candidate) => orders.some((order) => order.supplierId === candidate.id && ["ISSUED", "PARTIALLY_RECEIVED"].includes(order.status)) && !/Sous-traitance/.test(candidate.category ?? ""));
    if (supplier) {
      await invite({ kind: "SUPPLIER", email: PORTAL_DEMO.supplier.email, fullName: `Service commercial ${supplier.name}`, supplierId: supplier.id }, PORTAL_DEMO.supplier.password);
    }
  },
};
