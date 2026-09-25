import type { PurchaseOrderView, PurchaseRequestView, SupplierView } from "@axora24/contracts";
import { api } from "../api";

export const procurementApi = {
  suppliers: () => api.get<SupplierView[]>("/procurement/suppliers"),
  createSupplier: (input: Record<string, unknown>) => api.post<SupplierView>("/procurement/suppliers", input),
  updateSupplier: (id: string, input: Record<string, unknown>) => api.patch<SupplierView>(`/procurement/suppliers/${id}`, input),
  evaluateSupplier: (id: string, input: { quality: number; delivery: number; price: number; comment?: string; orderId?: string }) =>
    api.post<SupplierView>(`/procurement/suppliers/${id}/evaluations`, input),
  requests: () => api.get<PurchaseRequestView[]>("/procurement/requests"),
  request: (id: string) => api.get<PurchaseRequestView>(`/procurement/requests/${id}`),
  createRequest: (input: {
    title: string;
    justification?: string;
    projectId?: string;
    neededBy?: string;
    currency?: string;
    lines: Array<{ description: string; unitCode: string; quantity: string; estimatedUnitPrice: string; wbsItemId?: string }>;
  }) => api.post<PurchaseRequestView>("/procurement/requests", input),
  submitRequest: (id: string) => api.post<PurchaseRequestView>(`/procurement/requests/${id}/submit`),
  approveRequest: (id: string, note?: string) => api.post<PurchaseRequestView>(`/procurement/requests/${id}/approve`, { note }),
  rejectRequest: (id: string, note: string) => api.post<PurchaseRequestView>(`/procurement/requests/${id}/reject`, { note }),
  addQuote: (
    id: string,
    input: { supplierId: string; reference?: string; validUntil?: string; deliveryDays?: number; note?: string; lines: Array<{ requestLineId: string; unitPrice: string }> },
  ) => api.post<PurchaseRequestView>(`/procurement/requests/${id}/quotes`, input),
  orders: () => api.get<PurchaseOrderView[]>("/procurement/orders"),
  order: (id: string) => api.get<PurchaseOrderView>(`/procurement/orders/${id}`),
  createOrder: (input: { requestId: string; quoteId: string; expectedDate?: string }) =>
    api.post<PurchaseOrderView>("/procurement/orders", input),
  issueOrder: (id: string) => api.post<PurchaseOrderView>(`/procurement/orders/${id}/issue`),
  cancelOrder: (id: string, reason: string) => api.post<PurchaseOrderView>(`/procurement/orders/${id}/cancel`, { reason }),
  receive: (id: string, input: { idempotencyKey: string; note?: string; lines: Array<{ orderLineId: string; quantity: string }> }) =>
    api.post<PurchaseOrderView>(`/procurement/orders/${id}/receipts`, input),
};

export const REQUEST_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Brouillon",
  SUBMITTED: "À valider",
  APPROVED: "Approuvée",
  REJECTED: "Rejetée",
  ORDERED: "Commandée",
  CANCELLED: "Annulée",
};

export const ORDER_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Brouillon",
  ISSUED: "Émise",
  PARTIALLY_RECEIVED: "Reçue partiellement",
  RECEIVED: "Reçue",
  CANCELLED: "Annulée",
};

/** Cle d'idempotence generee cote client pour une soumission (rejouable sans doublon). */
export function newIdempotencyKey(prefix: string): string {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  return `${prefix}-${random}`;
}
