import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmployeeView } from "@axora24/contracts";
import { ApiError } from "../lib/api";
import { PayrollPolicy } from "./payroll-policy";
import { EmployeeServiceCard } from "./employee-service-card";

const mocks = vi.hoisted(() => ({ canManage: true, payrollPolicy: vi.fn(), updatePayrollPolicy: vi.fn(), serviceCards: vi.fn(), serviceCard: vi.fn(), issueServiceCard: vi.fn(), revokeServiceCard: vi.fn(), qrImage: vi.fn() }));
vi.mock("../lib/session", () => ({ useSession: () => ({ can: () => mocks.canManage }) }));
vi.mock("../lib/modules/hr", () => ({ hrApi: mocks }));
vi.mock("qrcode", () => ({ default: { toDataURL: mocks.qrImage } }));
const employee: EmployeeView = { id: "employee-1", code: "EMP-001", firstName: "Aline", lastName: "Test", fullName: "Aline Test", jobTitle: "Ingénieure", departmentId: null, departmentName: null, userId: null, email: null, phone: null, hireDate: "2026-01-01", contractType: "PERMANENT", status: "ACTIVE", badgeCode: null, hourlyCost: "20.00", baseSalary: "1000.00", currency: "USD", skills: [] };
const card = { id: "card-1", employeeId: employee.id, issuedAt: "2026-10-03T08:00:00.000Z", expiresAt: null, revokedAt: null, status: "ACTIVE" as const };
const document = { card, qrPayload: `AXORA-CARD:v1:${"A".repeat(43)}`, employee: { code: employee.code, fullName: employee.fullName, jobTitle: employee.jobTitle }, company: { name: "Entreprise AXORA" } };
const policy = { version: 0, configured: false, mode: "MONTHLY_BASE" as const, standardMonthlyHours: null, overtimeCoefficient: null };
beforeEach(() => { mocks.canManage = true; mocks.payrollPolicy.mockResolvedValue(policy); mocks.updatePayrollPolicy.mockResolvedValue({ ...policy, version: 1 }); mocks.serviceCards.mockResolvedValue([card]); mocks.serviceCard.mockResolvedValue(document); mocks.issueServiceCard.mockResolvedValue(document); mocks.revokeServiceCard.mockResolvedValue({ ...card, status: "REVOKED" }); mocks.qrImage.mockResolvedValue("data:image/png;base64,AAAA"); });
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe("Règles de préparation de paie", () => {
  it("exige les paramètres horaires explicites et transmet la version et les décimales", async () => {
    render(<PayrollPolicy />);
    fireEvent.click(await screen.findByRole("button", { name: "Configurer le calcul" }));
    fireEvent.change(screen.getByLabelText(/Mode de calcul/), { target: { value: "VALIDATED_HOURS" } });
    fireEvent.change(screen.getByLabelText(/Heures mensuelles de référence/), { target: { value: "745" } });
    fireEvent.change(screen.getByLabelText(/Coefficient des heures supplémentaires/), { target: { value: "1.50" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer les règles" }));
    await waitFor(() => expect(screen.getAllByRole("alert").some(alert => alert.textContent?.includes("deux décimales"))).toBe(true));
    expect(mocks.updatePayrollPolicy).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Heures mensuelles de référence/), { target: { value: "173,33" } });
    fireEvent.change(screen.getByLabelText(/Coefficient des heures supplémentaires/), { target: { value: "1,50" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer les règles" }));
    await waitFor(() => expect(mocks.updatePayrollPolicy).toHaveBeenCalledWith({ expectedVersion: 0, mode: "VALIDATED_HOURS", standardMonthlyHours: "173.33", overtimeCoefficient: "1.50" }));
  });
  it("recharge les règles après un conflit et ferme l’ancien formulaire", async () => {
    mocks.updatePayrollPolicy.mockRejectedValue(new ApiError(409, "Changed"));
    render(<PayrollPolicy />);
    fireEvent.click(await screen.findByRole("button", { name: "Configurer le calcul" }));
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer les règles" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("alert").textContent).toContain("Les règles ont changé ailleurs");
    expect(mocks.payrollPolicy).toHaveBeenCalledTimes(2);
  });
});

describe("Cartes de service protégées", () => {
  it("réserve le document et son QR au responsable habilité", async () => {
    mocks.canManage = false;
    render(<EmployeeServiceCard employee={employee} onClose={vi.fn()} onUpdated={vi.fn()} />);
    await screen.findByText("Les cartes sont émises et imprimées par un responsable habilité.");
    expect(mocks.serviceCard).not.toHaveBeenCalled();
    expect(mocks.qrImage).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Émettre une carte" })).toBeNull();
  });
  it("conserve la zone calme du QR et impose la confirmation du renouvellement", async () => {
    const updated = vi.fn();
    render(<EmployeeServiceCard employee={employee} onClose={vi.fn()} onUpdated={updated} />);
    fireEvent.click(await screen.findByRole("button", { name: "Renouveler la carte" }));
    expect(mocks.issueServiceCard).not.toHaveBeenCalled();
    expect(screen.getByText(/remplace toutes les cartes précédentes/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirmer l’émission" }));
    await waitFor(() => expect(updated).toHaveBeenCalledOnce());
    expect(mocks.issueServiceCard).toHaveBeenCalledWith(employee.id, undefined);
    expect(mocks.qrImage).toHaveBeenCalledWith(document.qrPayload, expect.objectContaining({ margin: 4 }));
    expect(screen.queryByText(document.qrPayload)).toBeNull();
  });
  it("garde la carte visible si la révocation échoue", async () => {
    mocks.revokeServiceCard.mockRejectedValue(new ApiError(503, "Révocation indisponible"));
    render(<EmployeeServiceCard employee={employee} onClose={vi.fn()} onUpdated={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Révoquer la carte" }));
    fireEvent.change(screen.getByLabelText(/Motif de la révocation/), { target: { value: "Carte perdue" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmer la révocation" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Révocation indisponible"));
    expect(screen.getByText("CARTE DE SERVICE")).toBeTruthy();
  });
});
