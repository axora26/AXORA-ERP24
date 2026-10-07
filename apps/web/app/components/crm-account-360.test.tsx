import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { crmDirectoryApi, type CrmAccount360View, type CrmNextActionView } from "../lib/modules/crm";
import { CrmAccount360 } from "./crm-account-360";

const can = vi.fn((permission: string) => ["crm.nextaction.read", "crm.nextaction.manage", "crm.activity.read"].includes(permission));
vi.mock("../lib/session", () => ({ useSession: () => ({ can }) }));
vi.mock("../lib/modules/crm", () => ({ crmDirectoryApi: { account360: vi.fn(), accountTimeline: vi.fn(), nextActions: vi.fn(), assignees: vi.fn() } }));

const view: CrmAccount360View = {
  account: { id: "account-1", companyId: "company-1", name: "Horizon Bâtiment", industry: "Construction", city: "Lyon", country: "France", email: "contact@horizon.fr", phone: "+33 4 00 00 00 00", website: "https://horizon.fr", archivedAt: null, version: 2, createdAt: "2026-01-01", updatedAt: "2026-10-01" },
  contacts: { available: true, items: [{ id: "contact-1", companyId: "company-1", accountId: "account-1", fullName: "Mina Rossi", email: "mina@horizon.fr", phone: null, jobTitle: "Directrice travaux", isPrimary: true, archivedAt: null, version: 1, createdAt: "2026-01-01", updatedAt: "2026-01-01" }] },
  opportunities: { available: true, items: [
    { id: "opp-eur", companyId: "company-1", name: "Campus Est", amount: "125000.00", currency: "EUR", status: "OPEN", stageId: "stage-1", stageName: "Proposition", accountId: "account-1", accountName: "Horizon Bâtiment", contactId: null, sourceLeadId: null, expectedCloseDate: "2026-11-10", closedAt: null, createdAt: "2026-09-01" },
    { id: "opp-usd", companyId: "company-1", name: "Data center", amount: "80000.00", currency: "USD", status: "OPEN", stageId: "stage-1", stageName: "Proposition", accountId: "account-1", accountName: "Horizon Bâtiment", contactId: null, sourceLeadId: null, expectedCloseDate: null, closedAt: null, createdAt: "2026-09-02" },
  ] },
  nextActions: { available: true, items: [] },
  timeline: { available: true, items: [] },
};
const actions: CrmNextActionView[] = [];

beforeEach(() => {
  vi.mocked(crmDirectoryApi.account360).mockResolvedValue(view);
  vi.mocked(crmDirectoryApi.accountTimeline).mockResolvedValue([{ id: "activity-1", companyId: "company-1", type: "CALL", subject: "Appel de cadrage", body: null, relatedType: "Account", relatedId: "account-1", actorUserId: null, occurredAt: "2026-10-06T09:00:00.000Z" }]);
  vi.mocked(crmDirectoryApi.nextActions).mockResolvedValue(actions);
  vi.mocked(crmDirectoryApi.assignees).mockResolvedValue([]);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("Compte CRM 360", () => {
  it("charge en parallèle les données puis sépare les opportunités par devise", async () => {
    render(<CrmAccount360 accountId="account-1" />);
    expect(screen.getByRole("status").textContent).toContain("Chargement");
    expect(await screen.findByRole("heading", { name: "Horizon Bâtiment" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "EUR" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "USD" })).not.toBeNull();
    expect(screen.getByText("Appel de cadrage")).not.toBeNull();
    expect(crmDirectoryApi.account360).toHaveBeenCalledWith("account-1");
    expect(crmDirectoryApi.accountTimeline).toHaveBeenCalledWith("account-1");
  });

  it("affiche un état d’erreur récupérable", async () => {
    vi.mocked(crmDirectoryApi.account360).mockRejectedValue(new Error("offline"));
    render(<CrmAccount360 accountId="account-1" />);
    expect(await screen.findByRole("alert")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Réessayer" })).not.toBeNull();
  });

  it("conserve la vue 360 quand un complément autorisé est indisponible", async () => {
    vi.mocked(crmDirectoryApi.assignees).mockRejectedValue(new Error("offline"));
    render(<CrmAccount360 accountId="account-1" />);
    expect(await screen.findByRole("heading", { name: "Horizon Bâtiment" })).not.toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("complémentaires");
  });

  it("présente explicitement les sections vides", async () => {
    vi.mocked(crmDirectoryApi.account360).mockResolvedValue({ ...view, contacts: { available: true, items: [] }, opportunities: { available: true, items: [] } });
    render(<CrmAccount360 accountId="account-1" />);
    await screen.findByRole("heading", { name: "Horizon Bâtiment" });
    await waitFor(() => expect(screen.getByText("Aucun contact rattaché")).not.toBeNull());
    expect(screen.getByText("Aucune opportunité pour ce compte")).not.toBeNull();
  });
});
