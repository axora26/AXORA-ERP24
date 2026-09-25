import { createClient } from "../client.mjs";
import { DEMO_USERS } from "./admin.mjs";

/** Finance DEMO : taux et comptes parametres, situation client, facture fournisseur rapprochee. */
export const financeStep = {
  name: "Finance (facturation, fournisseurs, paiements)",
  async isDone(api) {
    const accounts = await api.get("/finance/bank-accounts");
    return accounts.length > 0;
  },
  async run(api) {
    // Taux fictif de demonstration : aucun taux fiscal reel n'est presume par le logiciel.
    const rates = await api.post("/finance/tax-rates", { name: "Taxe DEMO 16 %", rate: "16" });
    const vat = rates[0].id;
    const accounts = await api.post("/finance/bank-accounts", {
      code: "BQ-USD",
      name: "Banque DEMO — compte USD",
      currency: "USD",
      openingBalance: "250000.00",
    });
    await api.post("/finance/bank-accounts", { code: "CAISSE-CHT", name: "Caisse chantier", kind: "CASH", currency: "USD", openingBalance: "3000.00" });
    const bank = accounts.find((account) => account.code === "BQ-USD").id;

    const roles = await api.get("/admin/roles");
    const direction = roles.find((role) => role.name === "Direction (lecture)");
    if (direction && !direction.permissions.includes("finance.payable.approve")) {
      await api.put(`/admin/roles/${direction.id}/permissions`, {
        permissions: [...direction.permissions, "finance.payable.approve", "finance.payable.read"],
      });
    }
    const directionUser = DEMO_USERS.find((user) => user.role === "Direction (lecture)");
    const directionApi = createClient(api.baseUrl);
    await directionApi.post("/auth/login", { email: directionUser.email, password: directionUser.password });

    const contracts = await api.get("/sales/contracts");
    const contract = contracts.find((candidate) => candidate.status === "ACTIVE");
    const first = await api.post("/finance/invoices", { contractId: contract.id, percent: "20", taxRateId: vat });
    const issued = await api.post(`/finance/invoices/${first.id}/issue`, { issueDate: "2026-08-28", dueDays: 30 });
    await api.post("/finance/payments", {
      invoiceType: "CUSTOMER",
      invoiceId: issued.id,
      bankAccountId: bank,
      amount: issued.total,
      method: "TRANSFER",
      paidAt: "2026-09-18",
      reference: "VIR CLINIQUE 0918",
      idempotencyKey: "demo-enc-0001",
    });
    const second = await api.post("/finance/invoices", { contractId: contract.id, percent: "15", taxRateId: vat });
    await api.post(`/finance/invoices/${second.id}/issue`, { dueDays: 45 });

    const orders = await api.get("/procurement/orders");
    const received = orders.find((order) => order.status === "PARTIALLY_RECEIVED" || order.status === "RECEIVED");
    if (received) {
      const lines = received.lines
        .filter((line) => Number(line.receivedQuantity) > 0)
        .map((line) => ({ orderLineId: line.id, description: line.description, quantity: line.receivedQuantity, unitPrice: line.unitPrice, taxRateId: vat }));
      const payable = await api.post("/finance/payables", {
        supplierId: received.supplierId,
        orderId: received.id,
        supplierReference: "CM-FAC-2026-0412",
        invoiceDate: "2026-09-12",
        lines,
      });
      const approved = await directionApi.post(`/finance/payables/${payable.id}/approve`, { note: "Rapprochement conforme" });
      await api.post("/finance/payments", {
        invoiceType: "SUPPLIER",
        invoiceId: approved.id,
        bankAccountId: bank,
        amount: (Number(approved.total) / 2).toFixed(2),
        method: "TRANSFER",
        reference: "Acompte 50 %",
        idempotencyKey: "demo-dec-0001",
      });
      // Deuxieme facture avec ecart de prix, en attente de validation.
      const firstLine = received.lines.find((line) => Number(line.receivedQuantity) > 0);
      await api.post("/finance/payables", {
        supplierId: received.supplierId,
        orderId: received.id,
        supplierReference: "CM-FAC-2026-0431",
        invoiceDate: "2026-09-21",
        lines: [
          {
            orderLineId: firstLine.id,
            description: `${firstLine.description} — complément`,
            quantity: "2",
            unitPrice: (Number(firstLine.unitPrice) + 4).toFixed(2),
            taxRateId: vat,
          },
        ],
      });
    }
  },
};
