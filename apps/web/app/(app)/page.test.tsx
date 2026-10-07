import React from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardOverview } from "@axora24/contracts";
import OverviewPage from "./page";

const overview: DashboardOverview = {
  generatedAt: "2026-10-07T08:30:00.000Z",
  kpis: [
    { key: "open-projects", label: "Projets ouverts", kind: "count", value: "12", amounts: [], detail: "Portefeuille actif", tone: "blue", href: "/projects" },
    { key: "pending-approvals", label: "Validations en attente", kind: "count", value: "4", amounts: [], detail: "Décisions requises", tone: "amber", href: "/workflow" },
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
  it("présente les indicateurs réels en rail et limite la file d’attention et les raccourcis", () => {
    render(<OverviewPage />);

    expect(screen.getByRole("heading", { name: "Bonjour, Amina" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Indicateurs disponibles" })).toBeTruthy();

    const attention = screen.getByRole("list", { name: "File d’attention" });
    expect(within(attention).getAllByRole("listitem")).toHaveLength(6);
    expect(within(attention).queryByText("ACTION_6")).toBeNull();

    const shortcuts = screen.getByRole("list", { name: "Raccourcis modules" });
    expect(within(shortcuts).getAllByRole("listitem")).toHaveLength(6);
  });
});
