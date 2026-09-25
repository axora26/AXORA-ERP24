"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { CustomerInvoiceView } from "@axora24/contracts";
import { Banknote, Printer, Send, XCircle } from "lucide-react";
import { CUSTOMER_STATUS_LABEL, financeApi } from "../../../../lib/modules/finance";
import { formatDate, formatMoney, formatQuantity } from "../../../../lib/format";
import { useMutation, useResource } from "../../../../lib/hooks";
import { useSession } from "../../../../lib/session";
import { PaymentModal, PaymentsTable } from "../../../../components/finance-payment";
import {
  Button,
  DataTable,
  DateField,
  DetailList,
  Feedback,
  Form,
  Loading,
  Modal,
  PageHeader,
  Panel,
  StatusChip,
  TextAreaField,
  TextField,
} from "../../../../components/ui";

export default function CustomerInvoicePage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const session = useSession();
  const resource = useResource(() => Promise.all([financeApi.invoice(id), financeApi.bankAccounts()]), [id]);
  const mutation = useMutation();
  const [override, setOverride] = useState<CustomerInvoiceView | null>(null);
  const [dialog, setDialog] = useState<"issue" | "cancel" | "pay" | null>(null);
  const invoice = override ?? resource.data?.[0];
  const accounts = resource.data?.[1] ?? [];

  async function apply(action: () => Promise<CustomerInvoiceView>, success: string): Promise<void> {
    const updated = await mutation.run(action, success);
    if (updated) {
      setOverride(updated);
      setDialog(null);
    }
  }

  if (resource.loading && !invoice) return <Loading label="Chargement de la facture…" />;
  if (!invoice) return <Feedback error={resource.error || "Facture introuvable."} />;
  const canManage = session.can("finance.invoice.manage");
  const payable = invoice.status === "ISSUED" || invoice.status === "PARTIALLY_PAID";

  return (
    <>
      <PageHeader
        breadcrumb={`Finance / Factures clients / ${invoice.code ?? "Brouillon"}`}
        title={invoice.code ? `Facture ${invoice.code}` : "Facture (brouillon)"}
        subtitle={invoice.customerName}
        actions={
          <>
            <StatusChip status={invoice.overdue ? "overdue" : invoice.status} label={invoice.overdue ? "Échue" : CUSTOMER_STATUS_LABEL[invoice.status]} />
            {invoice.status !== "DRAFT" && invoice.status !== "CANCELLED" && (
              <Link className="btn btn-secondary" href={`/print/invoices/${invoice.id}`} target="_blank">
                <Printer size={14} aria-hidden="true" /> Imprimer / PDF
              </Link>
            )}
            {canManage && invoice.status === "DRAFT" && (
              <>
                <Button variant="danger" onClick={() => setDialog("cancel")}>
                  <XCircle size={14} aria-hidden="true" /> Annuler
                </Button>
                <Button variant="primary" onClick={() => setDialog("issue")}>
                  <Send size={14} aria-hidden="true" /> Émettre
                </Button>
              </>
            )}
            {session.can("finance.payment.create") && payable && (
              <Button variant="primary" onClick={() => setDialog("pay")}>
                <Banknote size={14} aria-hidden="true" /> Encaisser
              </Button>
            )}
          </>
        }
      />
      <Feedback error={mutation.error} notice={mutation.notice} />
      <Panel title="Facture">
        <DetailList
          items={[
            { label: "Client", value: invoice.customerName },
            { label: "Contrat", value: invoice.contractCode ?? "—" },
            { label: "Projet", value: invoice.projectId ? <Link href={`/projects/${invoice.projectId}`}>{invoice.projectCode}</Link> : "—" },
            { label: "Émise le", value: formatDate(invoice.issueDate) },
            { label: "Échéance", value: formatDate(invoice.dueDate) },
            { label: "Reste dû", value: <strong>{formatMoney(invoice.balanceDue, invoice.currency)}</strong> },
          ]}
        />
        {invoice.cancelReason && <p className="inline-warning">Annulée : {invoice.cancelReason}</p>}
      </Panel>
      <div className="stack">
        <Panel title="Lignes">
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
              <dt>Encaissé</dt>
              <dd>{formatMoney(invoice.paidAmount, invoice.currency)}</dd>
            </div>
          </dl>
        </Panel>
        <Panel title="Encaissements">
          <PaymentsTable payments={invoice.payments} />
        </Panel>
      </div>

      {dialog === "issue" && <IssueModal saving={mutation.saving} error={mutation.error} onClose={() => setDialog(null)} onSubmit={(input) => apply(() => financeApi.issueInvoice(invoice.id, input), "Facture émise : numéro légal attribué.")} />}
      {dialog === "cancel" && (
        <Modal title="Annuler le brouillon" onClose={() => setDialog(null)}>
          <Feedback error={mutation.error} />
          <CancelForm saving={mutation.saving} onSubmit={(reason) => apply(() => financeApi.cancelInvoice(invoice.id, reason), "Brouillon annulé.")} />
        </Modal>
      )}
      {dialog === "pay" && (
        <PaymentModal
          title="Encaissement client"
          currency={invoice.currency}
          balanceDue={invoice.balanceDue}
          accounts={accounts}
          saving={mutation.saving}
          error={mutation.error}
          onClose={() => setDialog(null)}
          onSubmit={(input) => apply(() => financeApi.pay<CustomerInvoiceView>({ invoiceType: "CUSTOMER", invoiceId: invoice.id, ...input }), "Encaissement enregistré.")}
        />
      )}
    </>
  );
}

function IssueModal({ saving, error, onClose, onSubmit }: { saving: boolean; error: string; onClose: () => void; onSubmit: (input: { issueDate?: string; dueDays?: number }) => Promise<void> }): React.ReactElement {
  const [issueDate, setIssueDate] = useState("");
  const [dueDays, setDueDays] = useState("30");
  return (
    <Modal title="Émettre la facture" onClose={onClose}>
      <Feedback error={error} />
      <Form submitLabel="Émettre" saving={saving} onSubmit={() => onSubmit({ issueDate: issueDate || undefined, dueDays: Number(dueDays || "30") })}>
        <DateField label="Date d'émission" value={issueDate} onChange={setIssueDate} hint="Aujourd'hui par défaut ; jamais antérieure à la dernière facture émise." />
        <TextField label="Délai de paiement (jours)" inputMode="numeric" value={dueDays} onChange={setDueDays} />
      </Form>
    </Modal>
  );
}

function CancelForm({ saving, onSubmit }: { saving: boolean; onSubmit: (reason: string) => Promise<void> }): React.ReactElement {
  const [reason, setReason] = useState("");
  return (
    <Form columns={1} submitLabel="Annuler le brouillon" saving={saving} onSubmit={() => onSubmit(reason)}>
      <TextAreaField label="Motif" value={reason} onChange={setReason} required />
    </Form>
  );
}
