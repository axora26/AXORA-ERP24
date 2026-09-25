import { createClient } from "../client.mjs";
import { DEMO_USERS } from "./admin.mjs";

const day = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

/**
 * SOUS-TRAITANCE DEMO : fournisseurs des Achats enregistres comme
 * sous-traitants, qualifies par la Direction (quatre yeux), lots adosses a
 * des commandes emises, situation derivee des taches terminees du lot WBS,
 * facture de situation en Finance, retenue de garantie detenue.
 */
export const subcontractingStep = {
  name: "Sous-traitance (qualification, lots, situations, retenues)",
  async isDone(api) {
    return (await api.get("/subcontracting/subcontractors")).length > 0;
  },
  async run(api) {
    const roles = await api.get("/admin/roles");
    const direction = roles.find((role) => role.name === "Direction (lecture)");
    const needed = ["subcontracting.subcontractor.qualify", "subcontracting.statement.approve", "procurement.request.approve"];
    if (direction && needed.some((key) => !direction.permissions.includes(key))) {
      await api.put(`/admin/roles/${direction.id}/permissions`, { permissions: [...new Set([...direction.permissions, ...needed])] });
    }
    const directionUser = DEMO_USERS.find((user) => user.role === "Direction (lecture)");
    const director = createClient(api.baseUrl);
    await director.post("/auth/login", { email: directionUser.email, password: directionUser.password });

    const projects = await api.get("/projects");
    const project = await api.get(`/projects/${projects[0].id}`);
    const leaf = Object.fromEntries(project.wbs.map((node) => [node.code, node.id]));

    async function subcontractor(name, trades, workforce, documents, qualify) {
      const supplier = await api.post("/procurement/suppliers", { name, city: "Lubumbashi", category: "Sous-traitance", paymentTermsDays: 30 });
      const profile = await api.post("/subcontracting/subcontractors", { supplierId: supplier.id, trades, workforce });
      for (const [kind, reference, issuer, from, until] of documents) {
        await api.post(`/subcontracting/subcontractors/${profile.id}/documents`, { kind, reference, issuer, validFrom: day(from), validUntil: day(until) });
      }
      if (qualify) await director.post(`/subcontracting/subcontractors/${profile.id}/decision`, { decision: "QUALIFIED", note: qualify });
      return supplier;
    }
    const vigilance = (prefix, taxUntil = 150) => [
      ["RCCM", `CD/LSH/RCCM/${prefix}`, "Guichet unique Lubumbashi", -900, 2000],
      ["TAX_CERTIFICATE", `DGI-AF-${prefix}-2026`, "DGI Haut-Katanga", -60, taxUntil],
      ["SOCIAL_CERTIFICATE", `CNSS-${prefix}-2026-Q3`, "CNSS", -40, 50],
      ["LIABILITY_INSURANCE", `SONAS-RC-${prefix}`, "SONAS", -100, 265],
    ];
    const earthworks = await subcontractor("Terrassements du Katanga SARL", "Terrassement, VRD, fondations", 24, vigilance("TK"), "Références vérifiées (3 chantiers), visite du dépôt matériel");
    const concrete = await subcontractor("Coffrages & Béton Lualaba", "Gros œuvre : coffrages, ferraillage, bétonnage", 35, vigilance("CBL", 22), "Qualification sur références et entretien technique");
    await subcontractor("Étanchéité Moderne SPRL", "Étanchéité toiture-terrasse", 8, [["RCCM", "CD/LSH/RCCM/EM", "Guichet unique Lubumbashi", -500, 2400]], null);

    async function order(supplier, description, amount, wbsItemId) {
      let request = await api.post("/procurement/requests", { title: `Sous-traitance — ${description}`, projectId: project.id, lines: [{ description, unitCode: "FT", quantity: "1", estimatedUnitPrice: amount, wbsItemId }] });
      request = await api.post(`/procurement/requests/${request.id}/submit`);
      request = await director.post(`/procurement/requests/${request.id}/approve`, { note: "Lot sous-traité prévu au budget" });
      request = await api.post(`/procurement/requests/${request.id}/quotes`, { supplierId: supplier.id, reference: `DEV-${supplier.code}`, deliveryDays: 20, lines: [{ requestLineId: request.lines[0].id, unitPrice: amount }] });
      const created = await api.post("/procurement/orders", { requestId: request.id, quoteId: request.quotes[0].id });
      return api.post(`/procurement/orders/${created.id}/issue`);
    }
    const earthworksOrder = await order(earthworks, "Terrassement et fondations superficielles — forfait", "64000.00", leaf["GO-01"]);
    const concreteOrder = await order(concrete, "Voiles, poteaux et dalle R+1 — forfait", "186000.00", leaf["GO-02"]);

    const firstPackage = await api.post("/subcontracting/packages", {
      purchaseOrderId: earthworksOrder.id,
      wbsItemId: leaf["GO-01"],
      title: "Terrassement et fondations — extension bloc opératoire",
      scope: "Implantation, décapage, fouilles en rigole, béton de propreté, semelles filantes et isolées selon plans STR-FND-01 à 04.",
      retentionRate: "5",
      retentionReleaseDays: 365,
    });
    await api.post("/subcontracting/packages", {
      purchaseOrderId: concreteOrder.id,
      wbsItemId: leaf["GO-02"],
      title: "Gros œuvre superstructure R+0 / R+1",
      scope: "Voiles et poteaux R+0, dalle haute R+1 : coffrage, ferraillage, bétonnage, cure.",
      retentionRate: "5",
      retentionReleaseDays: 365,
    });

    const statement = await api.post(`/subcontracting/packages/${firstPackage.id}/statements`, { periodEnd: day(0) });
    await director.post(`/subcontracting/statements/${statement.id}/decision`, { decision: "APPROVED", note: "Constat contradictoire : fondations réceptionnées sans réserve" });
    await api.post(`/subcontracting/statements/${statement.id}/invoice`, { supplierReference: "TK-FAC-2026-0412", invoiceDate: day(0), taxRate: "16" });
  },
};
