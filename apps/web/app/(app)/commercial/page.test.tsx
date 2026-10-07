import React from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CommercialPage from "./page";
import { loadCommercialData } from "./data";

const apiMocks = vi.hoisted(() => ({
  dqes: vi.fn(async () => []),
  quotes: vi.fn(async () => []),
  contracts: vi.fn(async () => []),
  requests: vi.fn(async () => []),
  orders: vi.fn(async () => []),
  suppliers: vi.fn(async () => []),
  items: vi.fn(async () => []),
  warehouses: vi.fn(async () => []),
  invoices: vi.fn(async () => []),
  payables: vi.fn(async () => []),
}));
const grantedPermissions = vi.hoisted(() => new Set<string>());

const data = {
  dqes: [
    { id: "dqe-1", status: "DRAFT" },
    { id: "dqe-2", status: "FINALIZED" },
  ],
  quotes: [
    { id: "quote-1", status: "DRAFT" },
    { id: "quote-2", status: "ACCEPTED" },
  ],
  contracts: [{ id: "contract-1", status: "ACTIVE" }],
  requests: [{ id: "request-1", status: "SUBMITTED" }],
  orders: [{ id: "order-1", status: "PARTIALLY_RECEIVED" }],
  suppliers: [{ id: "supplier-1", isActive: true }],
  items: [{ id: "item-1", belowMinimum: true }],
  warehouses: [{ id: "warehouse-1", isActive: true }],
  invoices: [{ id: "invoice-1", status: "DRAFT", overdue: false }],
  payables: [{ id: "payable-1", status: "RECORDED", overdue: false }],
};

vi.mock("../../lib/session", () => ({
  useSession: () => ({ can: (permission: string) => grantedPermissions.has(permission) }),
}));

vi.mock("../../lib/hooks", () => ({
  useResource: () => ({ data, error: "", loading: false, reload: vi.fn() }),
}));

vi.mock("../../lib/api", () => ({ estimationApi: { dqes: apiMocks.dqes }, salesApi: { quotes: apiMocks.quotes, contracts: apiMocks.contracts } }));
vi.mock("../../lib/modules/procurement", () => ({ procurementApi: { requests: apiMocks.requests, orders: apiMocks.orders, suppliers: apiMocks.suppliers } }));
vi.mock("../../lib/modules/inventory", () => ({ inventoryApi: { items: apiMocks.items, warehouses: apiMocks.warehouses } }));
vi.mock("../../lib/modules/finance", () => ({ financeApi: { invoices: apiMocks.invoices, payables: apiMocks.payables } }));

beforeEach(() => {
  grantedPermissions.clear();
  ["crm.account.read", "estimation.dqe.read", "estimation.dqe.manage", "sales.quote.read", "sales.contract.read", "procurement.request.read", "procurement.order.read", "procurement.supplier.read", "inventory.item.read", "finance.invoice.read", "finance.payable.read", "finance.credit.read"].forEach((permission) => grantedPermissions.add(permission));
});
afterEach(cleanup);

describe("Gestion commerciale", () => {
  it.each([
    ["sales.quote.read", "quotes", ["contracts"]],
    ["sales.contract.read", "contracts", ["quotes"]],
    ["procurement.request.read", "requests", ["orders", "suppliers"]],
    ["procurement.order.read", "orders", ["requests", "suppliers"]],
    ["procurement.supplier.read", "suppliers", ["requests", "orders"]],
  ] as const)("ne charge que la ressource autorisée pour %s", async (permission, called, forbidden) => {
    Object.values(apiMocks).forEach((mock) => mock.mockClear());
    await loadCommercialData((candidate) => candidate === permission);
    expect(apiMocks[called]).toHaveBeenCalledTimes(1);
    forbidden.forEach((name) => expect(apiMocks[name]).not.toHaveBeenCalled());
  });

  it("réunit les parcours vente achat facturation et stock avec des actions réelles", () => {
    render(<CommercialPage />);

    expect(screen.getByRole("heading", { name: "Gestion commerciale" })).toBeTruthy();
    const journeys = screen.getByRole("region", { name: "Chaînes commerciales" });
    expect(within(journeys).getByRole("heading", { name: "Vendre" })).toBeTruthy();
    expect(within(journeys).getByRole("heading", { name: "Acheter" })).toBeTruthy();
    expect(within(journeys).getByRole("heading", { name: "Facturer" })).toBeTruthy();
    expect(within(journeys).getByRole("heading", { name: "Gérer le stock" })).toBeTruthy();

    expect(screen.getByRole("link", { name: /Créer et structurer un DQE/i }).getAttribute("href")).toBe("/estimation");
    expect(screen.getByRole("link", { name: /Ouvrir les achats/i }).getAttribute("href")).toBe("/procurement");
    expect(screen.getByRole("link", { name: /Créer une facture directe/i }).getAttribute("href")).toBe("/finance");
    expect(screen.getByRole("link", { name: /Piloter articles et magasins/i }).getAttribute("href")).toBe("/inventory");
  });

  it("affiche des indicateurs calculés uniquement depuis les ressources métier", () => {
    render(<CommercialPage />);

    expect(screen.getByText("2 DQE")).toBeTruthy();
    expect(screen.getByText("2 devis")).toBeTruthy();
    expect(screen.getByText("1 commande en cours")).toBeTruthy();
    expect(screen.getByText("1 article sous seuil")).toBeTruthy();
    expect(screen.getByText("1 facture client à traiter")).toBeTruthy();
  });

  it.each([
    ["sales.contract.read", "Gérer devis et contrats"],
    ["procurement.order.read", "Suivre commandes et réceptions"],
    ["procurement.supplier.read", "Gérer les fournisseurs"],
    ["finance.payable.read", "Traiter les factures fournisseurs"],
    ["finance.credit.read", "Gérer les avoirs"],
  ])("reste exploitable avec la seule permission %s", (permission, action) => {
    grantedPermissions.clear();
    grantedPermissions.add(permission);
    render(<CommercialPage />);
    expect(screen.getByRole("link", { name: new RegExp(action, "i") })).toBeTruthy();
  });
});
