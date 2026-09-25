import type {
  InventoryItemView,
  StockBalanceView,
  StockCountView,
  StockMovementView,
  WarehouseView,
} from "@axora24/contracts";
import { api } from "../api";

function query(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1]))).toString();
  return search ? `?${search}` : "";
}

export const inventoryApi = {
  items: () => api.get<InventoryItemView[]>("/inventory/items"),
  createItem: (input: Record<string, unknown>) => api.post<InventoryItemView>("/inventory/items", input),
  updateItem: (id: string, input: Record<string, unknown>) => api.patch<InventoryItemView>(`/inventory/items/${id}`, input),
  warehouses: () => api.get<WarehouseView[]>("/inventory/warehouses"),
  createWarehouse: (input: Record<string, unknown>) => api.post<WarehouseView>("/inventory/warehouses", input),
  balances: (params: { warehouseId?: string; itemId?: string } = {}) => api.get<StockBalanceView[]>(`/inventory/balances${query(params)}`),
  movements: (params: { warehouseId?: string; itemId?: string; projectId?: string } = {}) =>
    api.get<StockMovementView[]>(`/inventory/movements${query(params)}`),
  issue: (input: { warehouseId: string; projectId: string; wbsItemId?: string; reference?: string; idempotencyKey: string; lines: Array<{ itemId: string; quantity: string }> }) =>
    api.post<{ posted: number }>("/inventory/issues", input),
  returnToStock: (input: { warehouseId: string; projectId: string; reference?: string; idempotencyKey: string; lines: Array<{ itemId: string; quantity: string }> }) =>
    api.post<{ posted: number }>("/inventory/returns", input),
  transfer: (input: { fromWarehouseId: string; toWarehouseId: string; reference?: string; idempotencyKey: string; lines: Array<{ itemId: string; quantity: string }> }) =>
    api.post<{ posted: number }>("/inventory/transfers", input),
  adjust: (input: { warehouseId: string; itemId: string; quantityDelta: string; unitCost?: string; reason: string }) =>
    api.post<StockBalanceView[]>("/inventory/adjustments", input),
  counts: () => api.get<StockCountView[]>("/inventory/counts"),
  count: (id: string) => api.get<StockCountView>(`/inventory/counts/${id}`),
  openCount: (warehouseId: string) => api.post<StockCountView>("/inventory/counts", { warehouseId }),
  recordCount: (id: string, itemId: string, countedQuantity: string) =>
    api.put<StockCountView>(`/inventory/counts/${id}/lines`, { itemId, countedQuantity }),
  closeCount: (id: string) => api.post<StockCountView>(`/inventory/counts/${id}/close`),
};

export const MOVEMENT_LABEL: Record<string, string> = {
  RECEIPT: "Réception achat",
  ISSUE: "Sortie chantier",
  RETURN: "Retour chantier",
  TRANSFER_OUT: "Transfert sortant",
  TRANSFER_IN: "Transfert entrant",
  ADJUSTMENT_IN: "Ajustement +",
  ADJUSTMENT_OUT: "Ajustement −",
};
