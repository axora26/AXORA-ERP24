/** INC-06 — Achats. Quantites a 3 decimales, montants a 2 decimales (chaines exactes). */

export type PurchaseRequestStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED" | "ORDERED" | "CANCELLED";
export type PurchaseOrderStatus = "DRAFT" | "ISSUED" | "PARTIALLY_RECEIVED" | "RECEIVED" | "CANCELLED";

export interface SupplierView {
  id: string;
  code: string;
  name: string;
  taxId: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  country: string | null;
  category: string | null;
  paymentTermsDays: number;
  currency: string;
  isActive: boolean;
  /** Moyenne des evaluations (1-5, 1 decimale) ; null sans evaluation. */
  rating: string | null;
  evaluationCount: number;
  orderCount: number;
}

export interface PurchaseRequestLineView {
  id: string;
  position: number;
  description: string;
  unitCode: string;
  quantity: string;
  estimatedUnitPrice: string;
  estimatedTotal: string;
  wbsItemId: string | null;
  inventoryItemId: string | null;
}

export interface SupplierQuoteView {
  id: string;
  supplierId: string;
  supplierName: string;
  reference: string | null;
  validUntil: string | null;
  deliveryDays: number | null;
  note: string | null;
  total: string;
  selected: boolean;
  /** Prix unitaire propose par ligne de demande. */
  lines: Array<{ requestLineId: string; unitPrice: string; lineTotal: string }>;
  createdAt: string;
}

export interface PurchaseRequestView {
  id: string;
  code: string;
  title: string;
  justification: string | null;
  projectId: string | null;
  projectCode: string | null;
  currency: string;
  neededBy: string | null;
  status: PurchaseRequestStatus;
  estimatedTotal: string;
  requestedByUserId: string;
  requestedByName: string | null;
  submittedAt: string | null;
  decidedByUserId: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
  lines: PurchaseRequestLineView[];
  quotes: SupplierQuoteView[];
  orderIds: string[];
}

export interface PurchaseOrderLineView {
  id: string;
  position: number;
  description: string;
  unitCode: string;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
  receivedQuantity: string;
  remainingQuantity: string;
  projectId: string | null;
  wbsItemId: string | null;
  inventoryItemId: string | null;
}

export interface GoodsReceiptView {
  id: string;
  code: string;
  receivedAt: string;
  receivedByName: string | null;
  note: string | null;
  lines: Array<{ orderLineId: string; quantity: string }>;
}

export interface PurchaseOrderView {
  id: string;
  code: string;
  supplierId: string;
  supplierName: string;
  requestId: string | null;
  requestCode: string | null;
  projectId: string | null;
  projectCode: string | null;
  currency: string;
  status: PurchaseOrderStatus;
  total: string;
  /** Valeur recue (quantites recues x prix unitaire). */
  receivedValue: string;
  expectedDate: string | null;
  issuedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  lines: PurchaseOrderLineView[];
  receipts: GoodsReceiptView[];
}
