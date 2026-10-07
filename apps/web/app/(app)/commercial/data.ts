import { estimationApi, salesApi } from "../../lib/api";
import { financeApi } from "../../lib/modules/finance";
import { inventoryApi } from "../../lib/modules/inventory";
import { procurementApi } from "../../lib/modules/procurement";

export type CommercialData = {
  dqes: Array<{ id: string; status: string }>;
  quotes: Array<{ id: string; status: string }>;
  contracts: Array<{ id: string; status: string }>;
  requests: Array<{ id: string; status: string }>;
  orders: Array<{ id: string; status: string }>;
  suppliers: Array<{ id: string; isActive: boolean }>;
  items: Array<{ id: string; belowMinimum: boolean }>;
  warehouses: Array<{ id: string; isActive: boolean }>;
  invoices: Array<{ id: string; status: string; overdue: boolean }>;
  payables: Array<{ id: string; status: string; overdue: boolean }>;
};

type Can = (permission: string) => boolean;

export async function loadCommercialData(can: Can): Promise<CommercialData> {
  const [dqes, quotes, contracts, requests, orders, suppliers, items, warehouses, invoices, payables] = await Promise.all([
    can("estimation.dqe.read") ? estimationApi.dqes() : Promise.resolve([]),
    can("sales.quote.read") ? salesApi.quotes() : Promise.resolve([]),
    can("sales.contract.read") ? salesApi.contracts() : Promise.resolve([]),
    can("procurement.request.read") ? procurementApi.requests() : Promise.resolve([]),
    can("procurement.order.read") ? procurementApi.orders() : Promise.resolve([]),
    can("procurement.supplier.read") ? procurementApi.suppliers() : Promise.resolve([]),
    can("inventory.item.read") ? inventoryApi.items() : Promise.resolve([]),
    can("inventory.item.read") ? inventoryApi.warehouses() : Promise.resolve([]),
    can("finance.invoice.read") ? financeApi.invoices() : Promise.resolve([]),
    can("finance.payable.read") ? financeApi.payables() : Promise.resolve([]),
  ]);
  return { dqes, quotes, contracts, requests, orders, suppliers, items, warehouses, invoices, payables };
}
