import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/api";
import { crmDirectoryApi } from "../lib/modules/crm";
import { CrmDirectory } from "./crm-directory";

vi.mock("../lib/session", () => { const session = { can: vi.fn(() => true) }; return { useSession: () => session }; });
vi.mock("../lib/modules/crm", () => ({ crmDirectoryApi: { accountPage: vi.fn(), updateAccount: vi.fn(), archiveAccount: vi.fn() } }));
const account = { id: "account-1", companyId: "company-1", name: "Client Alpha", city: null, country: null, industry: null, email: null, phone: null, website: null, archivedAt: null, version: 3, updatedAt: "2026-01-01", createdAt: "2026-01-01" };
beforeEach(() => { vi.mocked(crmDirectoryApi.accountPage).mockResolvedValue({ items: [account], total: 1, totalPages: 1, page: 1, pageSize: 20 }); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe("Répertoire CRM", () => {
  it("signale un conflit de version et empêche de réécrire une fiche périmée", async () => {
    vi.mocked(crmDirectoryApi.updateAccount).mockRejectedValue(new ApiError(409, "Version périmée"));
    render(<CrmDirectory kind="accounts" />);
    fireEvent.click(await screen.findByRole("button", { name: "Modifier Client Alpha" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox", { name: /Nom de l’entreprise/ }), { target: { value: "Client actualisé" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toContain("modifiée ailleurs"));
    expect(crmDirectoryApi.updateAccount).toHaveBeenCalledWith(account.id, expect.objectContaining({ name: "Client actualisé", expectedVersion: 3 }));
    expect(within(dialog).getByRole("button", { name: "Enregistrer" }).hasAttribute("disabled")).toBe(true);
  });
  it("confirme l’archivage avant de l’envoyer et transmet la version courante", async () => {
    vi.mocked(crmDirectoryApi.archiveAccount).mockResolvedValue({ ...account, version: 4, archivedAt: "2026-01-02" });
    render(<CrmDirectory kind="accounts" />);
    fireEvent.click(await screen.findByRole("button", { name: "Archiver Client Alpha" }));
    expect(crmDirectoryApi.archiveAccount).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Archiver" }));
    await waitFor(() => expect(crmDirectoryApi.archiveAccount).toHaveBeenCalledWith(account.id, 3, false));
  });
  it("rend le nom du compte comme lien vers sa vue 360", async () => {
    render(<CrmDirectory kind="accounts" />);
    expect((await screen.findByRole("link", { name: "Client Alpha" })).getAttribute("href")).toBe("/crm/accounts/account-1");
  });
  it("transmet la recherche et recommence à la première page", async () => {
    render(<CrmDirectory kind="accounts" />);
    await screen.findByText("Client Alpha");
    fireEvent.change(screen.getByRole("textbox", { name: "Rechercher" }), { target: { value: "Bâtiment" } });
    await waitFor(() => expect(crmDirectoryApi.accountPage).toHaveBeenLastCalledWith(expect.stringContaining("q=B%C3%A2timent")));
    expect(crmDirectoryApi.accountPage).toHaveBeenLastCalledWith(expect.stringContaining("page=1"));
  });
});
