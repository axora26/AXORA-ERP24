import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PurchaseOrderView } from "@axora24/contracts";
import { SupplierReturnModal } from "./supplier-return-modal";

const order: PurchaseOrderView = {
  id: "order-1", code: "BC-2026-0001", supplierId: "s-1", supplierName: "Aciers du Kivu", requestId: null, requestCode: null,
  projectId: null, projectCode: null, currency: "USD", status: "RECEIVED", total: "11900.00", receivedValue: "11900.00",
  expectedDate: null, issuedAt: "2026-10-01T08:00:00Z", cancelledAt: null, cancelReason: null, createdAt: "2026-10-01T08:00:00Z",
  lines: [
    { id: "l-stock", position: 1, description: "Aciers HA 16", unitCode: "t", quantity: "10.000", unitPrice: "1100.00", lineTotal: "11000.00", receivedQuantity: "10.000", returnedQuantity: "0.000", remainingQuantity: "0.000", projectId: null, wbsItemId: null, inventoryItemId: "item-1" },
    { id: "l-direct", position: 2, description: "Panneaux coffrage", unitCode: "u", quantity: "20.000", unitPrice: "45.00", lineTotal: "900.00", receivedQuantity: "20.000", returnedQuantity: "0.000", remainingQuantity: "0.000", projectId: null, wbsItemId: null, inventoryItemId: null },
    { id: "l-none", position: 3, description: "Non livré", unitCode: "u", quantity: "1.000", unitPrice: "1.00", lineTotal: "1.00", receivedQuantity: "0.000", returnedQuantity: "0.000", remainingQuantity: "1.000", projectId: null, wbsItemId: null, inventoryItemId: null },
  ],
  receipts: [],
  returns: [],
};

afterEach(() => cleanup());

describe("SupplierReturnModal", () => {
  it("ne propose que les lignes au reçu net positif", () => {
    render(<SupplierReturnModal order={order} saving={false} error="" onClose={() => {}} onSubmit={vi.fn()} />);
    expect(screen.getByLabelText("Quantité retournée Aciers HA 16")).toBeTruthy();
    expect(screen.getByLabelText("Quantité retournée Panneaux coffrage")).toBeTruthy();
    expect(screen.queryByLabelText("Quantité retournée Non livré")).toBeNull();
  });

  it("refuse un retour supérieur au reçu net ou sans ligne, sans appeler l'API", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<SupplierReturnModal order={order} saving={false} error="" onClose={() => {}} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/Motif du retour/), { target: { value: "Oxydation" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer le retour" }));
    await waitFor(() => expect(screen.getByText(/au moins une ligne/)).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Quantité retournée Aciers HA 16"), { target: { value: "10.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer le retour" }));
    await waitFor(() => expect(screen.getByText(/dépasse le reçu net/)).toBeTruthy());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("transmet les quantités décimales, le motif et une clé d'idempotence stable", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<SupplierReturnModal order={order} saving={false} error="" onClose={() => {}} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText("Quantité retournée Aciers HA 16"), { target: { value: "2,5" } });
    fireEvent.change(screen.getByLabelText("Quantité retournée Panneaux coffrage"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText(/Motif du retour/), { target: { value: "  Aciers oxydés  " } });
    expect(screen.getByText(/2\s?930,00/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer le retour" }));
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer le retour" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    const [first] = onSubmit.mock.calls[0]!;
    const [second] = onSubmit.mock.calls[1]!;
    expect(first).toEqual({
      idempotencyKey: expect.stringMatching(/^ret-/),
      reason: "Aciers oxydés",
      lines: [
        { orderLineId: "l-stock", quantity: "2.5" },
        { orderLineId: "l-direct", quantity: "4" },
      ],
    });
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
  });
});
