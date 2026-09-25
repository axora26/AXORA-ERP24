/** INC-07 — Stock & Logistique. Quantites a 3 decimales, valeurs a 2 decimales. */

export type StockMovementType =
  | "RECEIPT"
  | "ISSUE"
  | "RETURN"
  | "TRANSFER_OUT"
  | "TRANSFER_IN"
  | "ADJUSTMENT_IN"
  | "ADJUSTMENT_OUT"
  | "MAINTENANCE_ISSUE";

export interface InventoryItemView {
  id: string;
  code: string;
  name: string;
  unitCode: string;
  category: string | null;
  barcode: string | null;
  minStock: string;
  isActive: boolean;
  /** Stock total toutes zones et sa valeur au cout moyen. */
  totalQuantity: string;
  totalValue: string;
  /** Cout moyen pondere (4 decimales) ; null sans stock. */
  averageCost: string | null;
  belowMinimum: boolean;
}

export interface WarehouseView {
  id: string;
  code: string;
  name: string;
  kind: "WAREHOUSE" | "SITE";
  projectId: string | null;
  projectCode: string | null;
  location: string | null;
  isActive: boolean;
  itemCount: number;
  totalValue: string;
}

export interface StockBalanceView {
  itemId: string;
  itemCode: string;
  itemName: string;
  unitCode: string;
  warehouseId: string;
  warehouseCode: string;
  quantity: string;
  value: string;
  averageCost: string | null;
}

export interface StockMovementView {
  id: string;
  type: StockMovementType;
  itemId: string;
  itemCode: string;
  itemName: string;
  warehouseId: string;
  warehouseCode: string;
  quantityDelta: string;
  unitCost: string;
  valueDelta: string;
  projectId: string | null;
  projectCode: string | null;
  reference: string | null;
  reason: string | null;
  createdByName: string | null;
  createdAt: string;
}

export interface StockCountView {
  id: string;
  code: string;
  warehouseId: string;
  warehouseCode: string;
  status: "OPEN" | "CLOSED";
  createdAt: string;
  closedAt: string | null;
  lines: Array<{
    itemId: string;
    itemCode: string;
    itemName: string;
    unitCode: string;
    systemQuantity: string;
    countedQuantity: string | null;
    difference: string | null;
  }>;
}
