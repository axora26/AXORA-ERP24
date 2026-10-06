import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectOperationsView } from "@axora24/contracts";
import { ProjectOperations } from "./project-operations";

const mocks = vi.hoisted(() => ({ operations: vi.fn() }));
vi.mock("../lib/modules/projects", () => ({ projectsApi: mocks }));
const hidden = { amount: null, available: false, source: "Permission required" };
const view: ProjectOperationsView = { projectId: "project-1", from: "2026-10-01", to: "2026-10-03", timezone: "UTC", currency: "USD", attendance: null, timesheets: null, materials: null, equipment: null, costs: { materials: hidden, labor: hidden, subcontract: hidden, directReceipts: hidden, total: hidden }, actions: { recordAttendance: false, manageTimesheets: false, recordStockMovement: false, manageFleetAssignments: false } };
beforeEach(() => mocks.operations.mockResolvedValue(view));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
describe("Opérations chantier", () => {
  it("signale les sections interdites et ne transforme pas des coûts absents en zéro", async () => {
    render(<ProjectOperations projectId="project-1" wbs={[]} />);
    await screen.findByText("Total indisponible");
    expect(screen.getByText(/L’accès aux pointages du personnel/)).toBeTruthy();
    expect(screen.queryByText("Aucun pointage sur cette période")).toBeNull();
    expect(screen.queryByText(/0,00 USD/)).toBeNull();
    expect(screen.queryByRole("link", { name: "Enregistrer un pointage" })).toBeNull();
  });
  it("empêche une période invalide d’être envoyée au serveur", async () => {
    render(<ProjectOperations projectId="project-1" wbs={[]} />);
    await screen.findByText("Total indisponible");
    fireEvent.change(screen.getByLabelText(/^Du/), { target: { value: "2026-01-01" } });
    fireEvent.change(screen.getByLabelText(/^Au/), { target: { value: "2026-02-15" } });
    fireEvent.click(screen.getByRole("button", { name: "Afficher la période" }));
    expect(screen.getByRole("alert").textContent).toContain("1 à 31 jours");
    expect(mocks.operations).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText(/^Au/), { target: { value: "2026-01-31" } });
    fireEvent.click(screen.getByRole("button", { name: "Afficher la période" }));
    await waitFor(() => expect(mocks.operations).toHaveBeenCalledWith("project-1", { from: "2026-01-01", to: "2026-01-31" }));
  });
});
