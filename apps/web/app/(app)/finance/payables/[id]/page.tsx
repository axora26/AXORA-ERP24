"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { SupplierInvoiceView } from "@axora24/contracts";
import { Banknote, CheckCircle2, XCircle } from "lucide-react";
import { MATCH_LABEL, SUPPLIER_STATUS_LABEL, financeApi } from "../../../../lib/modules/finance";
import { formatDate, formatDateTime, formatMoney, formatQuantity } from "../../../../lib/format";
import { useMutation, useResource } from "../../../../lib/hooks";
import { useSession } from "../../../../lib/session";
import { PaymentModal, PaymentsTable } from "../../../../components/finance-payment";
import { ActionBar, Button, DataTable, DetailList, Feedback, Form, Loading, Modal, PageHeader, Panel, StatusChip, TextAreaField } from "../../../../components/ui";

export default function SupplierInvoicePage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const session = useSession();
  const resource = useResource(() => Promise.all([financeApi.payable(id), financeApi.bankAccounts()]), [id]);
  const mutation = useMutation();
  const [override, setOverride] = useState<SupplierInvoiceView | null>(null);
  const [dialog, setDialog] = useState<"approve" | "reject" | "pay" | null>(null);
  const invoice = override ?? resource.data?.[0];
  const accounts = resource.data?.[1] ?? [];

  async function apply(action: () => Promise<SupplierInvoiceView>, success: string): Promise<void> {
    const updated = await mutation.run(action, success);
    if (updated) {
      setOverride(updated);
      setDialog(null);
    }
  }

  if (resource.loading && !invoice) return <Loading label="Chargement de la facture…" />;
  if (!invoice) return <Feedback error={resource.error || "Facture introuvable."} />;
  const isRecorder = invoice.recordedByUserId === session.user.id;
  const canDecide = session.can("finance.payable.approve") && !isRecorder && invoice.status === "RECORDED";
  const payable = invoice.status === "APPROVED" || invoice.status === "PARTIALLY_PAID";

  return (
    <>
      <PageHeader
        breadcrumb={`Finance / Factures fournisseurs / ${invoice.code}`}
        title={`Facture ${invoice.supplierReference}`}
        subtitle={`${invoice.supplierName} · enregistrée sous ${invoice.code}`}
        actions={
          <>
            <StatusChip status={invoice.status === "RECORDED" ? "pending" : invoice.status} label={SUPPLIER_STATUS_LABEL[invoice.status]} />
            {session.can("finance.payment.create") && payable && (
              <Button variant="primary" onClick={() => setDialog("pay")}>
                <Banknote size={14} aria-hidden="true" /> Payer
              </Button>
            )}
          </>
        }
      />
      <Feedback error={mutation.error} notice={mutation.notice} />
      <Panel title="Rapprochement commande ↔ réception ↔ facture">
        <DetailList
          items={[
            { label: "Commande", value: invoice.orderId ? <Link href={`/procurement/orders/${invoice.orderId}`}>{invoice.orderCode}</Link> : "Hors commande" },
            { label: "Projet", value: invoice.projectId ? <Link href={`/projects/${invoice.projectId}`}>{invoice.projectCode}</Link> : "—" },
            {
              label: "Résultat",
              value: <StatusChip status={invoice.matchStatus === "MATCHED" ? "done" : invoice.matchStatus === "DISCREPANCY" ? "critical" : "pending"} label={MATCH_LABEL[invoice.matchStatus]} />,
            },
            { label: "Date de facture", value: formatDate(invoice.invoiceDate) },
            { label: "Échéance", value: invoice.overdue ? <StatusChip status="overdue" label={formatDate(invoice.dueDate)} /> : formatDate(invoice.dueDate) },
            { label: "Reste dû", value: <strong>{formatMoney(invoice.balanceDue, invoice.currency)}</strong> },
          ]}
        />
        {invoice.matchNotes && <p className="inline-warning">Écarts détectés : {invoice.matchNotes}</p>}
        {invoice.decidedAt && (
          <p className="inline-note">
            Décision le {formatDateTime(invoice.decidedAt)}
            {invoice.decisionNote ? ` — ${invoice.decisionNote}` : ""}
          </p>
        )}
        {invoice.status === "RECORDED" && (
          <ActionBar
            note={
              isRecorder
                ? "Vous avez saisi cette facture : sa validation revient à une autre personne (séparation des devoirs)."
                : invoice.matchStatus === "MATCHED"
                  ? "Rapprochement conforme : la facture peut être validée pour paiement."
                  : "Écart ou absence de commande : une justification est exigée pour valider."
            }
          >
            {canDecide && (
              <>
                <Button variant="danger" onClick={() => setDialog("reject")}>
                  <XCircle size={14} aria-hidden="true" /> Rejeter
                </Button>
                <Button variant="primary" onClick={() => setDialog("approve")}>
                  <CheckCircle2 size={14} aria-hidden="true" /> Valider
                </Button>
              </>
            )}
          </ActionBar>
        )}
      </Panel>
      <div className="stack">
        <Panel title="Lignes facturées">
          <DataTable
            rows={invoice.lines}
            empty={null}
            columns={[
              { key: "desc", header: "Désignation", render: (line) => line.description },
              { key: "qty", header: "Quantité", align: "right", render: (line) => formatQuantity(line.quantity, 3) },
              { key: "pu", header: "PU HT", align: "right", render: (line) => formatMoney(line.unitPrice) },
              { key: "tax", header: "Taxe", align: "right", render: (line) => `${line.taxRate} %` },
              { key: "total", header: "Total HT", align: "right", render: (line) => <span className="num">{formatMoney(line.lineTotal)}</span> },
            ]}
          />
          <dl className="invoice-totals">
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
            <div>
              <dt>Payé</dt>
              <dd>{formatMoney(invoice.paidAmount, invoice.currency)}</dd>
            </div>
          </dl>
        </Panel>
        <Panel title="Décaissements">
          <PaymentsTable payments={invoice.payments} />
        </Panel>
      </div>

      {(dialog === "approve" || dialog === "reject") && (
        <Modal title={dialog === "approve" ? "Valider la facture" : "Rejeter la facture"} onClose={() => setDialog(null)}>
          <Feedback error={mutation.error} />
          <DecisionForm
            required={dialog === "reject" || invoice.matchStatus !== "MATCHED"}
            label={dialog === "approve" ? "Valider" : "Rejeter"}
            saving={mutation.saving}
            onSubmit={(note) =>
              apply(
                () => (dialog === "approve" ? financeApi.approvePayable(invoice.id, note || undefined) : financeApi.rejectPayable(invoice.id, note)),
                dialog === "approve" ? "Facture validée : elle peut être payée." : "Facture rejetée.",
              )
            }
          />
        </Modal>
      )}
      {dialog === "pay" && (
        <PaymentModal
          title="Paiement fournisseur"
          currency={invoice.currency}
          balanceDue={invoice.balanceDue}
          accounts={accounts}
          saving={mutation.saving}
          error={mutation.error}
          onClose={() => setDialog(null)}
          onSubmit={(input) => apply(() => financeApi.pay<SupplierInvoiceView>({ invoiceType: "SUPPLIER", invoiceId: invoice.id, ...input }), "Paiement enregistré.")}
        />
      )}
    </>
  );
}

function DecisionForm({ required, label, saving, onSubmit }: { required: boolean; label: string; saving: boolean; onSubmit: (note: string) => Promise<void> }): React.ReactElement {
  const [note, setNote] = useState("");
  return (
    <Form columns={1} submitLabel={label} saving={saving} onSubmit={() => onSubmit(note)}>
      <TextAreaField label={required ? "Justification (obligatoire)" : "Commentaire"} value={note} onChange={setNote} required={required} />
    </Form>
  );
}
