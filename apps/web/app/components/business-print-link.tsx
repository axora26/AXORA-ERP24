"use client";
import React from "react";
import Link from "next/link";
import { Printer } from "lucide-react";

export type BusinessPrintKind = "quotes" | "contracts" | "purchase-requests" | "purchase-orders" | "goods-receipts" | "daily-logs" | "commissioning" | "timesheets" | "stock-movements";
export function BusinessPrintLink({ kind, id, companyId, receiptId, children = "Imprimer / PDF" }: { kind: BusinessPrintKind; id: string; companyId?: string; receiptId?: string; children?: React.ReactNode }): React.ReactElement {
  const query = new URLSearchParams();
  if (companyId) query.set("companyId", companyId);
  if (receiptId) query.set("receiptId", receiptId);
  return <Link className="btn btn-secondary" href={`/print/${kind}/${encodeURIComponent(id)}${query.size ? `?${query}` : ""}`} target="_blank" rel="noopener noreferrer"><Printer size={14} aria-hidden="true" />{children}</Link>;
}
