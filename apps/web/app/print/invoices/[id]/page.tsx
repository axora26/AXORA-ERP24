"use client";

import React, { useEffect } from "react";
import { useParams } from "next/navigation";
import type { CustomerInvoiceView } from "@axora24/contracts";
import { api, ApiError } from "../../../lib/api";
import { formatDate, formatMoney, formatQuantity } from "../../../lib/format";
import { useResource } from "../../../lib/hooks";
import { PrintDocument } from "../../../components/print-document";
import "./invoice-print.css";

interface Context {
  organization: { name: string; isDemo?: boolean } | null;
  companies: Array<{ id: string; name: string }>;
}

/**
 * Facture imprimable (A4). Hors du shell applicatif pour une impression propre.
 * Aucune mention legale ou fiscale n'est inventee : seules les donnees de la
 * facture et de l'entreprise sont reproduites.
 */
export default function PrintInvoicePage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const data = useResource(async () => {
    const context = await api.get<Context>("/auth/context");
    const requestedId = new URLSearchParams(window.location.search).get("companyId");
    const company = requestedId ? context.companies.find(item => item.id === requestedId) : context.companies.length === 1 ? context.companies[0] : undefined;
    if (!company) throw new ApiError(400, "Ouvrez l’impression depuis la facture de l’entreprise sélectionnée.");
    const invoice = await api.get<CustomerInvoiceView>(`/finance/invoices/${id}?companyId=${encodeURIComponent(company.id)}`);
    return { invoice, context, company };
  }, [id]);

  useEffect(() => {
    if (data.data && new URLSearchParams(window.location.search).get("print") === "1") window.print();
  }, [data.data]);

  if (data.loading) return <p className="print-status">Préparation de la facture…</p>;
  if (!data.data) return <main className="print-status"><p role="alert">{data.error || "Facture inaccessible."}</p><button type="button" onClick={() => void data.reload()}>Réessayer</button></main>;
  const { invoice, context, company } = data.data;

  return (
    <main className="print-page invoice-print-page">
      <div className="print-actions no-print">
        <button type="button" onClick={() => window.print()}>
          Imprimer / enregistrer en PDF
        </button>
      </div>
      <PrintDocument title="Facture" reference={invoice.code ?? "BROUILLON — non émise"} companyName={company.name} demo={context.organization?.isDemo}>
        <section className="print-parties">
          <div>
            <h2>Facturé à</h2>
            <p>
              <strong>{invoice.customerName}</strong>
            </p>
            {invoice.customerAddress && <p>{invoice.customerAddress}</p>}
          </div>
          <dl>
            <div>
              <dt>Date d&apos;émission</dt>
              <dd>{formatDate(invoice.issueDate)}</dd>
            </div>
            <div>
              <dt>Échéance</dt>
              <dd>{formatDate(invoice.dueDate)}</dd>
            </div>
            {invoice.contractCode && (
              <div>
                <dt>Contrat</dt>
                <dd>{invoice.contractCode}</dd>
              </div>
            )}
            {invoice.projectCode && (
              <div>
                <dt>Projet</dt>
                <dd>{invoice.projectCode}</dd>
              </div>
            )}
          </dl>
        </section>
        <table>
          <thead>
            <tr>
              <th scope="col">Désignation</th>
              <th scope="col">Qté</th>
              <th scope="col">PU HT</th>
              <th scope="col">Taxe</th>
              <th scope="col">Total HT</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((line) => (
              <tr key={line.id}>
                <td>{line.description}</td>
                <td>{formatQuantity(line.quantity, 3)}</td>
                <td>{formatMoney(line.unitPrice, invoice.currency)}</td>
                <td>{line.taxRate} %</td>
                <td>{formatMoney(line.lineTotal, invoice.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="print-totals">
          <div>
            <dt>Total HT</dt>
            <dd>{formatMoney(invoice.subtotal, invoice.currency)}</dd>
          </div>
          <div>
            <dt>Taxes</dt>
            <dd>{formatMoney(invoice.taxTotal, invoice.currency)}</dd>
          </div>
          <div className="grand">
            <dt>Total TTC</dt>
            <dd>{formatMoney(invoice.total, invoice.currency)}</dd>
          </div>
          <>
              <div>
                <dt>Déjà réglé</dt>
                <dd>{formatMoney(invoice.paidAmount, invoice.currency)}</dd>
              </div>
              {invoice.credit && Number(invoice.credit.creditedAmount) > 0 && <>
                <div><dt>Avoirs émis</dt><dd>{formatMoney(invoice.credit.creditedAmount, invoice.currency)}</dd></div>
                <div><dt>Total après avoirs</dt><dd>{formatMoney(invoice.credit.netTotal, invoice.currency)}</dd></div>
                {Number(invoice.credit.refundedAmount) > 0 && <div><dt>Remboursements</dt><dd>{formatMoney(invoice.credit.refundedAmount, invoice.currency)}</dd></div>}
              </>}
              <div className="grand">
                <dt>Reste à payer</dt>
                <dd>{formatMoney(invoice.balanceDue, invoice.currency)}</dd>
              </div>
              {invoice.credit && Number(invoice.credit.refundDue) > 0 && <div><dt>À rembourser au client</dt><dd>{formatMoney(invoice.credit.refundDue, invoice.currency)}</dd></div>}
          </>
        </dl>
        {invoice.notes && <p className="print-notes">{invoice.notes}</p>}
        <p className="print-notes">Les mentions légales et fiscales applicables relèvent de la configuration de l’entreprise émettrice.</p>
      </PrintDocument>
    </main>
  );
}
