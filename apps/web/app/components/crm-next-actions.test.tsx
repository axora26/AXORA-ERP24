import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { crmDirectoryApi, type CrmNextActionView } from "../lib/modules/crm";
import { CrmNextActions } from "./crm-next-actions";

vi.mock("../lib/modules/crm", () => ({ crmDirectoryApi: { createNextAction: vi.fn(), updateNextAction: vi.fn(), completeNextAction: vi.fn(), cancelNextAction: vi.fn() } }));

const action: CrmNextActionView = {
  id: "action-1", companyId: "company-1", accountId: "account-1", title: "Relancer le devis", details: "Valider le lot CVC", dueAt: "2026-10-09T08:30:00.000Z",
  priority: "HIGH", status: "OPEN", assigneeUserId: "user-1", assigneeName: "Aïcha Diallo", createdByUserId: "user-1", updatedByUserId: "user-1", completedAt: null, cancelledAt: null, overdue: false, version: 4,
  createdAt: "2026-10-01T08:00:00.000Z", updatedAt: "2026-10-01T08:00:00.000Z",
};
const assignees = [{ id: "user-1", fullName: "Aïcha Diallo", email: "aicha@example.com" }];

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("Prochaines actions", () => {
  it("crée une action avec une échéance, une priorité et un assigné", async () => {
    vi.mocked(crmDirectoryApi.createNextAction).mockResolvedValue(action);
    const changed = vi.fn().mockResolvedValue(undefined);
    render(<CrmNextActions accountId="account-1" actions={[]} assignees={assignees} canManage onChanged={changed} />);

    fireEvent.click(screen.getByRole("button", { name: "Nouvelle action" }));
    const form = screen.getByRole("form", { name: "Créer une prochaine action" });
    fireEvent.change(within(form).getByRole("textbox", { name: "Intitulé" }), { target: { value: "Relancer le devis" } });
    fireEvent.change(within(form).getByLabelText("Échéance"), { target: { value: "2026-10-09T08:30" } });
    fireEvent.change(within(form).getByLabelText("Priorité"), { target: { value: "HIGH" } });
    fireEvent.change(within(form).getByLabelText("Assignée à"), { target: { value: "user-1" } });
    fireEvent.click(within(form).getByRole("button", { name: "Créer l’action" }));

    await waitFor(() => expect(crmDirectoryApi.createNextAction).toHaveBeenCalledWith(expect.objectContaining({ accountId: "account-1", title: "Relancer le devis", details: null, priority: "HIGH", assigneeUserId: "user-1" })));
    expect(changed).toHaveBeenCalled();
  });

  it("aligne la longueur maximale de l’intitulé sur le contrat API", () => {
    render(<CrmNextActions accountId="account-1" actions={[]} assignees={assignees} canManage onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Nouvelle action" }));
    expect(screen.getByRole("textbox", { name: "Intitulé" }).getAttribute("maxLength")).toBe("200");
  });

  it("termine et replanifie avec la version courante", async () => {
    vi.mocked(crmDirectoryApi.completeNextAction).mockResolvedValue({ ...action, status: "COMPLETED", version: 5 });
    vi.mocked(crmDirectoryApi.updateNextAction).mockResolvedValue({ ...action, version: 5 });
    const changed = vi.fn().mockResolvedValue(undefined);
    render(<CrmNextActions accountId="account-1" actions={[action]} assignees={assignees} canManage onChanged={changed} />);

    fireEvent.click(screen.getByRole("button", { name: "Replanifier Relancer le devis" }));
    const form = screen.getByRole("form", { name: "Replanifier Relancer le devis" });
    fireEvent.change(within(form).getByLabelText("Nouvelle échéance"), { target: { value: "2026-10-12T10:00" } });
    fireEvent.click(within(form).getByRole("button", { name: "Enregistrer l’échéance" }));
    await waitFor(() => expect(crmDirectoryApi.updateNextAction).toHaveBeenCalledWith("action-1", expect.objectContaining({ expectedVersion: 4 })));

    fireEvent.click(screen.getByRole("button", { name: "Terminer Relancer le devis" }));
    await waitFor(() => expect(crmDirectoryApi.completeNextAction).toHaveBeenCalledWith("action-1", 4));
  });

  it("reste en lecture seule sans permission de gestion", () => {
    render(<CrmNextActions accountId="account-1" actions={[action]} assignees={assignees} canManage={false} onChanged={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Nouvelle action" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Terminer/ })).toBeNull();
    expect(screen.getByText("Lecture seule")).not.toBeNull();
  });
});
