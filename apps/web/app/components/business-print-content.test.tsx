import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { PurchaseOrderView, TimesheetView } from "@axora24/contracts";
import { BusinessPrintContent, businessPrintMetadata } from "./business-print-content";

afterEach(cleanup);
const order: PurchaseOrderView = { id: "order-1", code: "PO-001", supplierId: "supplier-1", supplierName: "Fournisseur réel", requestId: null, requestCode: null, projectId: null, projectCode: null, currency: "USD", status: "PARTIALLY_RECEIVED", total: "40.00", receivedValue: "20.00", expectedDate: null, issuedAt: "2026-10-01T12:00:00Z", cancelledAt: null, cancelReason: null, createdAt: "2026-10-01T12:00:00Z", lines: [{ id: "line-1", position: 1, description: "Câble", unitCode: "m", quantity: "4.000", unitPrice: "10.00", lineTotal: "40.00", receivedQuantity: "2.000", remainingQuantity: "2.000", projectId: null, wbsItemId: null, inventoryItemId: null }], receipts: [{ id: "receipt-1", code: "BR-001", receivedAt: "2026-10-03T12:00:00Z", receivedByName: "Responsable magasin", note: "Lot contrôlé", lines: [{ orderLineId: "line-1", quantity: "2.000" }] }] };
describe("Documents métier imprimables", () => {
  it("isole un bon de réception et conserve la désignation de sa ligne source", () => {
    expect(businessPrintMetadata("goods-receipts", order, "other-receipt")).toBeNull();
    expect(businessPrintMetadata("goods-receipts", order, "receipt-1")).toEqual({ title: "Bon de réception", reference: "BR-001" });
    render(<BusinessPrintContent kind="goods-receipts" document={order} receiptId="receipt-1" />);
    expect(screen.getByText("Câble")).toBeTruthy();
    expect(screen.getByText("2,000")).toBeTruthy();
    expect(screen.queryByText("40,00 USD")).toBeNull();
  });
  it("imprime une feuille de temps sans exposer les coûts salariaux", () => {
    const sheet: TimesheetView = { id: "sheet-1", employeeId: "employee-1", employeeName: "Aline", employeeUserId: null, submittedByUserId: null, weekStart: "2026-10-05", status: "VALIDATED", totalHours: "8.00", attendanceHours: "8.00", submittedAt: null, decidedAt: null, decisionNote: null, entries: [{ id: "entry-1", workDate: "2026-10-05", hours: "8.00", projectId: "project-1", projectCode: "PR-001", wbsItemId: null, description: "Contrôle", costAmount: "999999.99" }] };
    render(<BusinessPrintContent kind="timesheets" document={sheet} />);
    expect(screen.getByText("PR-001")).toBeTruthy();
    expect(screen.queryByText(/999/)).toBeNull();
  });
});
