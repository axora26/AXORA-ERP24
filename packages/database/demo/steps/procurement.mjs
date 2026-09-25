import { createClient } from "../client.mjs";
import { DEMO_USERS } from "./admin.mjs";

/** Achats DEMO : fournisseurs, demandes validees par la Direction, offres, commandes, receptions. */

const SUPPLIERS = [
  { name: "Béton du Katanga", category: "Matériaux", city: "Lubumbashi", country: "RD Congo", paymentTermsDays: 45 },
  { name: "Congo Matériaux", category: "Matériaux", city: "Kolwezi", country: "RD Congo", paymentTermsDays: 30 },
  { name: "ElecPro RDC", category: "Électricité", city: "Kinshasa", country: "RD Congo", paymentTermsDays: 30 },
  { name: "Froid & Air Services", category: "CVC", city: "Lubumbashi", country: "RD Congo", paymentTermsDays: 60 },
];

export const procurementStep = {
  name: "Achats (fournisseurs, demandes, commandes, réceptions)",
  async isDone(api) {
    const suppliers = await api.get("/procurement/suppliers");
    return suppliers.length > 0;
  },
  async run(api) {
    const roles = await api.get("/admin/roles");
    const direction = roles.find((role) => role.name === "Direction (lecture)");
    if (direction && !direction.permissions.includes("procurement.request.approve")) {
      await api.put(`/admin/roles/${direction.id}/permissions`, {
        permissions: [...direction.permissions, "procurement.request.approve"],
      });
    }
    const directionUser = DEMO_USERS.find((user) => user.role === "Direction (lecture)");
    const directionApi = createClient(api.baseUrl);
    await directionApi.post("/auth/login", { email: directionUser.email, password: directionUser.password });

    const suppliers = {};
    for (const supplier of SUPPLIERS) suppliers[supplier.name] = await api.post("/procurement/suppliers", supplier);

    const projects = await api.get("/projects");
    const project = await api.get(`/projects/${projects[0].id}`);
    const leaf = Object.fromEntries(project.wbs.map((node) => [node.code, node.id]));

    async function requestFlow({ title, neededBy, lines, quotes, approve = true, order = true, receipt }) {
      let request = await api.post("/procurement/requests", { title, projectId: project.id, neededBy, lines });
      request = await api.post(`/procurement/requests/${request.id}/submit`);
      if (!approve) return request;
      request = await directionApi.post(`/procurement/requests/${request.id}/approve`, { note: "Conforme au budget du lot" });
      for (const quote of quotes) {
        request = await api.post(`/procurement/requests/${request.id}/quotes`, {
          supplierId: suppliers[quote.supplier].id,
          reference: quote.reference,
          deliveryDays: quote.deliveryDays,
          lines: request.lines.map((line, index) => ({ requestLineId: line.id, unitPrice: quote.prices[index] })),
        });
      }
      if (!order) return request;
      const best = request.quotes[0];
      let purchaseOrder = await api.post("/procurement/orders", { requestId: request.id, quoteId: best.id, expectedDate: neededBy });
      purchaseOrder = await api.post(`/procurement/orders/${purchaseOrder.id}/issue`);
      if (receipt) {
        purchaseOrder = await api.post(`/procurement/orders/${purchaseOrder.id}/receipts`, {
          idempotencyKey: `demo-${purchaseOrder.code}-1`,
          note: receipt.note,
          lines: receipt.lines.map(([index, quantity]) => ({ orderLineId: purchaseOrder.lines[index].id, quantity })),
        });
      }
      return purchaseOrder;
    }

    const concrete = await requestFlow({
      title: "Ciment et aciers — voiles R+0",
      neededBy: "2026-11-06",
      lines: [
        { description: "Ciment CEM II 42.5", unitCode: "t", quantity: "48.000", estimatedUnitPrice: "180.00", wbsItemId: leaf["GO-02"] },
        { description: "Aciers HA 12", unitCode: "t", quantity: "14.500", estimatedUnitPrice: "1020.00", wbsItemId: leaf["GO-02"] },
      ],
      quotes: [
        { supplier: "Béton du Katanga", reference: "BK-2026-311", deliveryDays: 7, prices: ["176.40", "1015.00"] },
        { supplier: "Congo Matériaux", reference: "CM-8841", deliveryDays: 12, prices: ["182.00", "990.00"] },
      ],
      receipt: { note: "Livraison n°1 — BL 55812", lines: [[0, "30.000"], [1, "14.500"]] },
    });
    await api.post(`/procurement/suppliers/${concrete.supplierId}/evaluations`, {
      orderId: concrete.id,
      quality: 5,
      delivery: 3,
      price: 4,
      comment: "Qualité conforme, livraison du ciment en deux fois",
    });

    await requestFlow({
      title: "TGBT et protections",
      neededBy: "2027-02-15",
      lines: [
        { description: "Tableau général basse tension 1600 A", unitCode: "u", quantity: "1", estimatedUnitPrice: "38000.00", wbsItemId: leaf["ELEC-01"] },
        { description: "Disjoncteurs de protection", unitCode: "u", quantity: "24", estimatedUnitPrice: "140.00", wbsItemId: leaf["ELEC-01"] },
      ],
      quotes: [
        { supplier: "ElecPro RDC", reference: "EP-0925", deliveryDays: 45, prices: ["37200.00", "132.50"] },
      ],
    });

    await requestFlow({
      title: "Location nacelle 12 m",
      neededBy: "2027-02-20",
      lines: [{ description: "Nacelle articulée 12 m (semaine)", unitCode: "sem", quantity: "3", estimatedUnitPrice: "650.00", wbsItemId: leaf["CVC-01"] }],
      quotes: [],
      approve: false,
    });
  },
};
