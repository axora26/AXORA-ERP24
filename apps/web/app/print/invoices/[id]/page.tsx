"use client";

import React, { useEffect } from "react";
import { useParams } from "next/navigation";
import type { CustomerInvoiceView } from "@axora24/contracts";
import { api } from "../../../lib/api";
import { formatDate, formatMoney, formatQuantity } from "../../../lib/format";
import { useResource } from "../../../lib/hooks";

interface Context {
  organization: { name: string } | null;
  companies: Array<{ id: string; name: string }>;
}

/**
 * Facture imprimable (A4). Hors du shell applicatif pour une impression propre.
 * Aucune mention legale ou fiscale n'est inventee : seules les donnees de la
 * facture et de l'entreprise sont reproduites.
 */
export default function PrintInvoicePage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const data = useResource(() => Promise.all([api.get<CustomerInvoiceView>(`/finance/invoices/${id}`), api.get<Context>("/auth/context")]), [id]);

  useEffect(() => {
    if (data.data && new URLSearchParams(window.location.search).get("print") === "1") window.print();
  }, [data.data]);

  if (data.loading) return <p className="print-status">Préparation de la facture…</p>;
  if (!data.data) return <p className="print-status">{data.error || "Facture inaccessible."}</p>;
  const [invoice, context] = data.data;
  const company = context.companies[0];

  return (
    <main className="print-page">
      <div className="print-actions">
        <button type="button" onClick={() => window.print()}>
          Imprimer / enregistrer en PDF
        </button>
      </div>
      <article className="print-sheet">
        <header>
          <div>
            <strong className="print-company">{company?.name ?? context.organization?.name}</strong>
            <span>{context.organization?.name}</span>
          </div>
          <div className="print-title">
            <h1>Facture</h1>
            <p>{invoice.code ?? "BROUILLON — non émise"}</p>
          </div>
        </header>
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
              <th>Désignation</th>
              <th>Qté</th>
              <th>PU HT</th>
              <th>Taxe</th>
              <th>Total HT</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((line) => (
              <tr key={line.id}>
                <td>{line.description}</td>
                <td>{formatQuantity(line.quantity, 3)}</td>
                <td>{formatMoney(line.unitPrice)}</td>
                <td>{line.taxRate} %</td>
                <td>{formatMoney(line.lineTotal)}</td>
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
          {Number(invoice.paidAmount) > 0 && (
            <>
              <div>
                <dt>Déjà réglé</dt>
                <dd>{formatMoney(invoice.paidAmount, invoice.currency)}</dd>
              </div>
              <div className="grand">
                <dt>Reste à payer</dt>
                <dd>{formatMoney(invoice.balanceDue, invoice.currency)}</dd>
              </div>
            </>
          )}
        </dl>
        {invoice.notes && <p className="print-notes">{invoice.notes}</p>}
        <footer>Document généré par AXORA-ERP24. Les mentions légales et fiscales applicables relèvent de la configuration de l&apos;entreprise émettrice.</footer>
      </article>
    </main>
  );
}
