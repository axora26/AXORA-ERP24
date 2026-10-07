import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardOverview } from "@axora24/contracts";
import OverviewPage from "./page";

const overview: DashboardOverview = {
  generatedAt: "2026-10-07T08:30:00.000Z",
  kpis: [
    { key: "open-projects", label: "Projets ouverts", kind: "count", value: "12", amounts: [], detail: "Portefeuille actif", tone: "blue", href: "/projects" },
    { key: "pending-approvals", label: "Validations en attente", kind: "count", value: "4", amounts: [], detail: "Décisions requises", tone: "amber", href: "/workflow" },
    { key: "open-quotes", label: "Devis ouverts", kind: "count", value: "8", amounts: [], detail: "À examiner", tone: "blue", href: "/sales" },
    { key: "active-orders", label: "Commandes actives", kind: "count", value: "6", amounts: [], detail: "En exécution", tone: "green", href: "/procurement" },
    { key: "stock-alerts", label: "Alertes stock", kind: "count", value: "3", amounts: [], detail: "Sous seuil", tone: "red", href: "/inventory" },
    { key: "open-findings", label: "Réserves ouvertes", kind: "count", value: "5", amounts: [], detail: "À corriger", tone: "amber", href: "/qhse" },
    { key: "work-orders", label: "Ordres de travail", kind: "count", value: "9", amounts: [], detail: "En cours", tone: "blue", href: "/assets" },
  ],
  activity: Array.from({ length: 9 }, (_, index) => ({
    id: `audit-${index}`,
    action: `ACTION_${index}`,
    resourceType: "project",
    resourceId: `project-${index}`,
    actorName: `Utilisateur ${index}`,
    createdAt: `2026-10-07T0${index}:00:00.000Z`,
  })),
};

vi.mock("../lib/session", () => ({
  useSession: () => ({
    user: { fullName: "Amina Kabasele", email: "amina@axora.cd" },
    can: () => true,
  }),
}));

vi.mock("../lib/hooks", () => ({
  useResource: () => ({ data: overview, error: "", loading: false, reload: vi.fn() }),
}));

vi.mock("../lib/audit-labels", () => ({ describeAudit: (action: string) => action }));

vi.mock("../lib/format", () => ({
  formatCompactMoney: (amount: string, currency: string) => `${amount} ${currency}`,
  formatMoney: (amount: string, currency: string) => `${amount} ${currency}`,
  formatDateTime: (value: string) => value,
}));

vi.mock("../lib/navigation", () => ({
  visibleGroups: () => [
    {
      label: "Modules",
      items: Array.from({ length: 9 }, (_, index) => ({
        href: `/module-${index}`,
        label: `Module ${index}`,
        icon: () => <svg aria-hidden="true" />,
      })),
    },
  ],
}));

vi.mock("../lib/api", () => ({ api: { get: vi.fn() } }));

afterEach(cleanup);

describe("Command Center", () => {
  it("hiérarchise la situation exécutive et expose une action CRM réelle", () => {
    render(<OverviewPage />);

    expect(screen.getByRole("heading", { name: "Command Center" })).toBeTruthy();
    expect(screen.getByText("Bonjour, Amina")).toBeTruthy();
    const situation = screen.getByRole("region", { name: "Situation exécutive" });
    expect(situation).toBeTruthy();
    expect(within(situation).getAllByRole("link")).toHaveLength(5);
    const expand = within(situation).getByRole("button", { name: "Afficher les 2 autres indicateurs" });
    fireEvent.click(expand);
    expect(within(situation).getAllByRole("link")).toHaveLength(7);
    expect(screen.getByRole("link", { name: /Piloter le CRM/i }).getAttribute("href")).toBe("/crm");
    expect(screen.getByText(/Actualisé/)).toBeTruthy();
  });

  it("présente le journal comme une activité récente et limite les actions rapides", () => {
    render(<OverviewPage />);

    expect(screen.getByRole("heading", { name: "Activité récente" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "File d’attention" })).toBeNull();

    const activity = screen.getByRole("list", { name: "Activité récente" });
    expect(within(activity).getAllByRole("listitem")).toHaveLength(6);
    expect(within(activity).queryByText("ACTION_6")).toBeNull();

    const shortcuts = screen.getByRole("list", { name: "Actions rapides" });
    expect(within(shortcuts).getAllByRole("listitem")).toHaveLength(4);
  });
});
