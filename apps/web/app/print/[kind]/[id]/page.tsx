"use client";
import React from "react";
import { useParams } from "next/navigation";
import { api, ApiError } from "../../../lib/api";
import { useResource } from "../../../lib/hooks";
import { PrintDocument } from "../../../components/print-document";
import { BusinessPrintContent, businessPrintMetadata, type BusinessDocument } from "../../../components/business-print-content";
import type { BusinessPrintKind } from "../../../components/business-print-link";
import "./business-print.css";

interface Context { organization: { isDemo: boolean } | null; companies: Array<{ id: string; name: string }> }
const ENDPOINT: Record<BusinessPrintKind, string> = { quotes: "/sales/quotes", contracts: "/sales/contracts", "purchase-requests": "/procurement/requests", "purchase-orders": "/procurement/orders", "goods-receipts": "/procurement/orders", "daily-logs": "/field/logs", commissioning: "/commissioning/activities", timesheets: "/hr/timesheets", "stock-movements": "/inventory/movements" };

export default function BusinessPrintPage(): React.ReactElement {
  const { kind, id } = useParams<{ kind: string; id: string }>();
  const resource = useResource(async () => {
    if (!Object.hasOwn(ENDPOINT, kind)) throw new ApiError(404, "Ce type de document n’est pas disponible à l’impression.");
    const context = await api.get<Context>("/auth/context");
    const query = new URLSearchParams(window.location.search);
    const requestedId = query.get("companyId");
    const company = requestedId ? context.companies.find(item => item.id === requestedId) : context.companies.length === 1 ? context.companies[0] : undefined;
    if (!company) throw new ApiError(400, "Ouvrez l’impression depuis le document de l’entreprise sélectionnée.");
    const receiptId = query.get("receiptId");
    const data = await api.get<BusinessDocument>(`${ENDPOINT[kind as BusinessPrintKind]}/${encodeURIComponent(id)}?companyId=${encodeURIComponent(company.id)}`);
    return { company, data, kind: kind as BusinessPrintKind, receiptId, demo: context.organization?.isDemo ?? false };
  }, [kind, id]);
  if (!resource.data) return <main className="print-status">{resource.loading ? <p role="status">Préparation du document…</p> : <><p role="alert">{resource.error || "Document inaccessible."}</p><button type="button" onClick={() => void resource.reload()}>Réessayer</button></>}</main>;
  const { data, company, receiptId, demo } = resource.data;
  const metadata = businessPrintMetadata(resource.data.kind, data, receiptId);
  if (!metadata) return <main className="print-status"><p role="alert">Le document demandé n’a pas été trouvé dans cette entreprise.</p></main>;
  return <main className="business-print-page"><div className="print-actions no-print"><button type="button" onClick={() => window.print()}>Imprimer / enregistrer en PDF</button></div><PrintDocument title={metadata.title} reference={metadata.reference} companyName={company.name} demo={demo}><BusinessPrintContent kind={resource.data.kind} document={data} receiptId={receiptId} /></PrintDocument></main>;
}
