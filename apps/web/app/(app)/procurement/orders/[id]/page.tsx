"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { PurchaseOrderView } from "@axora24/contracts";
import { PackageCheck, Send, XCircle } from "lucide-react";
import { ORDER_STATUS_LABEL, newIdempotencyKey, procurementApi } from "../../../../lib/modules/procurement";
import { formatDate, formatDateTime, formatMoney, formatQuantity } from "../../../../lib/format";
import { useMutation, useResource } from "../../../../lib/hooks";
import { useSession } from "../../../../lib/session";
import {
  Button,
  DataTable,
  DetailList,
  Empty,
  Feedback,
  Form,
  Loading,
  Modal,
  PageHeader,
  Panel,
  ProgressBar,
  StatusChip,
  TextAreaField,
} from "../../../../components/ui";

export default function PurchaseOrderPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const session = useSession();
  const resource = useResource(() => procurementApi.order(id), [id]);
  const mutation = useMutation();
  const [override, setOverride] = useState<PurchaseOrderView | null>(null);
  const [dialog, setDialog] = useState<"receive" | "cancel" | null>(null);
  const order = override ?? resource.data;

  async function apply(action: () => Promise<PurchaseOrderView>, success: string): Promise<void> {
    const updated = await mutation.run(action, success);
    if (updated) {
      setOverride(updated);
      setDialog(null);
    }
  }

  if (resource.loading && !order) return <Loading label="Chargement de la commande…" />;
  if (!order) return <Feedback error={resource.error || "Commande introuvable."} />;

  const canManage = session.can("procurement.order.manage");
  const canReceive = session.can("procurement.receipt.create");
  const receivable = order.status === "ISSUED" || order.status === "PARTIALLY_RECEIVED";
  const receivedRatio = Number(order.total) > 0 ? (Number(order.receivedValue) / Number(order.total)) * 100 : 0;

  return (
    <>
      <PageHeader
        breadcrumb={`Achats / Commandes / ${order.code}`}
        title={`Commande ${order.code}`}
        subtitle={`${order.supplierName}${order.projectCode ? ` · projet ${order.projectCode}` : ""}`}
        onRefresh={() => {
          setOverride(null);
          void resource.reload();
        }}
        actions={
          <>
            <StatusChip status={order.status} label={ORDER_STATUS_LABEL[order.status]} />
            {canManage && order.status === "DRAFT" && (
              <Button variant="primary" disabled={mutation.saving} onClick={() => void apply(() => procurementApi.issueOrder(order.id), "Commande émise : le budget du projet est engagé.")}>
                <Send size={14} aria-hidden="true" /> Émettre
              </Button>
            )}
            {canReceive && receivable && (
              <Button variant="primary" onClick={() => setDialog("receive")}>
                <PackageCheck size={14} aria-hidden="true" /> Réceptionner
              </Button>
            )}
            {canManage && (order.status === "DRAFT" || order.status === "ISSUED") && (
              <Button variant="danger" onClick={() => setDialog("cancel")}>
                <XCircle size={14} aria-hidden="true" /> Annuler
              </Button>
            )}
          </>
        }
      />
      <Feedback error={mutation.error} notice={mutation.notice} />

      <Panel title="Commande">
        <DetailList
          items={[
            { label: "Fournisseur", value: order.supplierName },
            { label: "Demande d'origine", value: order.requestId ? <Link href={`/procurement/requests/${order.requestId}`}>{order.requestCode}</Link> : "—" },
            { label: "Projet", value: order.projectId ? <Link href={`/projects/${order.projectId}`}>{order.projectCode}</Link> : "Frais généraux" },
            { label: "Montant", value: formatMoney(order.total, order.currency) },
            { label: "Émise le", value: formatDateTime(order.issuedAt) },
            { label: "Livraison attendue", value: formatDate(order.expectedDate) },
          ]}
        />
        <div style={{ padding: "0 21px 16px" }}>
          <span className="field-note">Valeur reçue : {formatMoney(order.receivedValue, order.currency)}</span>
          <ProgressBar value={receivedRatio} label="Part reçue" />
        </div>
        {order.status === "CANCELLED" && <p className="inline-warning">Annulée le {formatDateTime(order.cancelledAt)} : {order.cancelReason}</p>}
        {order.status === "DRAFT" && (
          <p className="inline-note">Brouillon : tant qu&apos;elle n&apos;est pas émise, la commande n&apos;engage pas le budget du projet.</p>
        )}
      </Panel>

      <div className="stack">
        <Panel title="Lignes" subtitle="Quantités commandées, reçues et restant à recevoir">
          <DataTable
            rows={order.lines}
            empty={null}
            columns={[
              { key: "line", header: "Désignation", render: (line) => <strong>{line.description}</strong> },
              { key: "ordered", header: "Commandé", align: "right", render: (line) => `${formatQuantity(line.quantity, 3)} ${line.unitCode}` },
              { key: "received", header: "Reçu", align: "right", render: (line) => formatQuantity(line.receivedQuantity, 3) },
              {
                key: "remaining",
                header: "Reste",
                align: "right",
                render: (line) => (Number(line.remainingQuantity) === 0 ? <StatusChip status="done" label="Soldé" /> : formatQuantity(line.remainingQuantity, 3)),
              },
              { key: "price", header: "PU", align: "right", render: (line) => <span className="num">{formatMoney(line.unitPrice)}</span> },
              { key: "total", header: "Total", align: "right", render: (line) => <span className="num">{formatMoney(line.lineTotal, order.currency)}</span> },
            ]}
          />
        </Panel>
        <Panel title="Réceptions" subtitle="Historique des bons de réception">
          <DataTable
            rows={order.receipts}
            empty={<Empty title="Aucune réception" />}
            columns={[
              { key: "code", header: "Bon", render: (receipt) => <strong>{receipt.code}</strong> },
              { key: "date", header: "Reçu le", render: (receipt) => formatDateTime(receipt.receivedAt) },
              { key: "by", header: "Par", render: (receipt) => receipt.receivedByName ?? "—" },
              {
                key: "lines",
                header: "Contenu",
                render: (receipt) =>
                  receipt.lines
                    .map((line) => {
                      const orderLine = order.lines.find((candidate) => candidate.id === line.orderLineId);
                      return `${formatQuantity(line.quantity, 3)} ${orderLine?.unitCode ?? ""} ${orderLine?.description ?? ""}`;
                    })
                    .join(" · "),
              },
              { key: "note", header: "Note", render: (receipt) => receipt.note ?? "—" },
            ]}
          />
        </Panel>
      </div>

      {dialog === "receive" && (
        <ReceiveModal
          order={order}
          saving={mutation.saving}
          error={mutation.error}
          onClose={() => setDialog(null)}
          onSubmit={(input) => apply(() => procurementApi.receive(order.id, input), "Réception enregistrée.")}
        />
      )}
      {dialog === "cancel" && (
        <Modal title="Annuler la commande" onClose={() => setDialog(null)}>
          <Feedback error={mutation.error} />
          <CancelForm saving={mutation.saving} onSubmit={(reason) => apply(() => procurementApi.cancelOrder(order.id, reason), "Commande annulée.")} />
        </Modal>
      )}
    </>
  );
}

function CancelForm({ saving, onSubmit }: { saving: boolean; onSubmit: (reason: string) => Promise<void> }): React.ReactElement {
  const [reason, setReason] = useState("");
  return (
    <Form columns={1} submitLabel="Annuler la commande" saving={saving} onSubmit={() => onSubmit(reason)}>
      <TextAreaField label="Motif" value={reason} onChange={setReason} required hint="La demande d'origine redevient commandable auprès d'un autre fournisseur." />
    </Form>
  );
}

function ReceiveModal({
  order,
  saving,
  error,
  onClose,
  onSubmit,
}: {
  order: PurchaseOrderView;
  saving: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (input: { idempotencyKey: string; note?: string; lines: Array<{ orderLineId: string; quantity: string }> }) => Promise<void>;
}): React.ReactElement {
  // Cle generee une fois a l'ouverture : un double clic ou un renvoi reseau ne cree jamais deux receptions.
  const [idempotencyKey] = useState(() => newIdempotencyKey("rcpt"));
  const open = order.lines.filter((line) => Number(line.remainingQuantity) > 0);
  const [quantities, setQuantities] = useState<Record<string, string>>(() => Object.fromEntries(open.map((line) => [line.id, line.remainingQuantity])));
  const [note, setNote] = useState("");
  return (
    <Modal title={`Réception — ${order.code}`} onClose={onClose} wide>
      <Feedback error={error} />
      <Form
        columns={1}
        submitLabel="Enregistrer la réception"
        saving={saving}
        onSubmit={() =>
          onSubmit({
            idempotencyKey,
            note: note || undefined,
            lines: open
              .map((line) => ({ orderLineId: line.id, quantity: (quantities[line.id] ?? "").replace(",", ".").trim() }))
              .filter((line) => line.quantity !== "" && Number(line.quantity) > 0),
          })
        }
      >
        <DataTable
          rows={open}
          empty={<Empty title="Tout est déjà reçu" />}
          columns={[
            { key: "line", header: "Désignation", render: (line) => line.description },
            { key: "remaining", header: "Reste à recevoir", align: "right", render: (line) => `${formatQuantity(line.remainingQuantity, 3)} ${line.unitCode}` },
            {
              key: "qty",
              header: "Quantité reçue",
              align: "right",
              render: (line) => (
                <input
                  className="inline-select"
                  aria-label={`Quantité reçue ${line.description}`}
                  inputMode="decimal"
                  value={quantities[line.id] ?? ""}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setQuantities((current) => ({ ...current, [line.id]: value }));
                  }}
                />
              ),
            },
          ]}
        />
        <TextAreaField label="Observations (état, écarts, bon de livraison)" value={note} onChange={setNote} />
      </Form>
    </Modal>
  );
}
