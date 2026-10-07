import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DqeView } from "@axora24/contracts";
import { api, ApiError } from "../lib/api";
import { EstimationDraftEditor } from "./estimation-draft-editor";

vi.mock("../lib/api", async original => { const actual = await original<typeof import("../lib/api")>(); return { ...actual, api: { ...actual.api, patch: vi.fn(), delete: vi.fn() } }; });
const line = { id: "line-1", lotId: null, position: 2, reference: null, designation: "Ouvrage", unitCode: "m3", quantity: "12.123456", unitPrice: "9999999999.123456", lineTotal: "0.000000" };
const parent: DqeView = { id: "dqe-1", companyId: "company-1", opportunityId: null, code: "DQE-001", title: "Étude", status: "DRAFT", revision: 1, currency: "EUR", subtotal: "0.000000", finalizedAt: null, createdAt: "2026-01-01", updatedAt: "2026-01-01", version: 4, source: null, lots: [{ id: "lot-1", position: 1, code: "LOT-01", designation: "Gros œuvre", lineCount: 0, subtotal: "0.000000" }], lines: [line] };
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe("Corrections des brouillons DQE", () => {
  it("préserve les décimales comme chaînes et transmet la version du parent", async () => {
    vi.mocked(api.patch).mockResolvedValue(parent);
    const saved = vi.fn(async () => undefined);
    render(<EstimationDraftEditor selection={{ kind: "line", parent, row: line }} deleting={false} onClose={vi.fn()} onSaved={saved} />);
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer la correction" }));
    await waitFor(() => expect(saved).toHaveBeenCalledWith(parent));
    expect(api.patch).toHaveBeenCalledWith("/estimation/dqes/dqe-1/lines/line-1", expect.objectContaining({ quantity: "12.123456", unitPrice: "9999999999.123456", expectedVersion: 4 }));
  });
  it("classe une ligne existante dans un lot", async () => {
    vi.mocked(api.patch).mockResolvedValue(parent);
    render(<EstimationDraftEditor selection={{ kind: "line", parent, row: line }} deleting={false} onClose={vi.fn()} onSaved={vi.fn(async () => undefined)} />);
    fireEvent.change(screen.getByLabelText("Lot du devis"), { target: { value: "lot-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer la correction" }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith("/estimation/dqes/dqe-1/lines/line-1", expect.objectContaining({ lotId: "lot-1" })));
  });
  it("bloque les tentatives répétées après un conflit pour éviter d’écraser le brouillon", async () => {
    vi.mocked(api.patch).mockRejectedValue(new ApiError(409, "Version différente"));
    render(<EstimationDraftEditor selection={{ kind: "line", parent, row: line }} deleting={false} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer la correction" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Le brouillon a changé"));
    expect(screen.getByRole("button", { name: "Enregistrer la correction" }).hasAttribute("disabled")).toBe(true);
    expect(api.patch).toHaveBeenCalledTimes(1);
  });
});
