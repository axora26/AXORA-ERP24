"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import type { PurchaseRequestView } from "@axora24/contracts";
import { CheckCircle2, Plus, Send, ShoppingCart, XCircle } from "lucide-react";
import { REQUEST_STATUS_LABEL, procurementApi } from "../../../../lib/modules/procurement";
import { formatDate, formatDateTime, formatMoney, formatQuantity } from "../../../../lib/format";
import { useMutation, useResource } from "../../../../lib/hooks";
import { useSession } from "../../../../lib/session";
import {
  ActionBar,
  Button,
  DataTable,
  DateField,
  DetailList,
  Empty,
  Feedback,
  Form,
  Loading,
  Modal,
  PageHeader,
  Panel,
  SelectField,
  StatusChip,
  TextAreaField,
  TextField,
} from "../../../../components/ui";

export default function PurchaseRequestPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const session = useSession();
  const resource = useResource(() => procurementApi.request(id), [id]);
  const suppliers = useResource(() => (session.can("procurement.supplier.read") ? procurementApi.suppliers() : Promise.resolve([])));
  const mutation = useMutation();
  const [override, setOverride] = useState<PurchaseRequestView | null>(null);
  const [dialog, setDialog] = useState<"reject" | "quote" | { order: string } | null>(null);
  const request = override ?? resource.data;

  async function apply(action: () => Promise<PurchaseRequestView>, success: string): Promise<void> {
    const updated = await mutation.run(action, success);
    if (updated) {
      setOverride(updated);
      setDialog(null);
    }
  }

  if (resource.loading && !request) return <Loading label="Chargement de la demande…" />;
  if (!request) return <Feedback error={resource.error || "Demande introuvable."} />;

  const isRequester = request.requestedByUserId === session.user.id;
  const canApprove = session.can("procurement.request.approve") && !isRequester;
  const canOrder = session.can("procurement.order.manage");
  const quoted = new Set(request.quotes.map((quote) => quote.supplierId));
  const availableSuppliers = (suppliers.data ?? []).filter((supplier) => supplier.isActive && !quoted.has(supplier.id));
  const bestPerLine = new Map<string, string>();
  for (const line of request.lines) {
    let best: { quoteId: string; price: number } | null = null;
    for (const quote of request.quotes) {
      const entry = quote.lines.find((candidate) => candidate.requestLineId === line.id);
      if (entry && (!best || Number(entry.unitPrice) < best.price)) best = { quoteId: quote.id, price: Number(entry.unitPrice) };
    }
    if (best) bestPerLine.set(line.id, best.quoteId);
  }

  return (
    <>
      <PageHeader
        breadcrumb={`Achats / Demandes / ${request.code}`}
        title={request.title}
        subtitle={`Demandée par ${request.requestedByName ?? "—"} le ${formatDate(request.createdAt)}`}
        onRefresh={() => {
          setOverride(null);
          void resource.reload();
        }}
        actions={<StatusChip status={request.status === "SUBMITTED" ? "pending" : request.status} label={REQUEST_STATUS_LABEL[request.status]} />}
      />
      <Feedback error={mutation.error} notice={mutation.notice} />

      <Panel title="Demande">
        <DetailList
          items={[
            { label: "Code", value: request.code },
            { label: "Projet", value: request.projectId ? <Link href={`/projects/${request.projectId}`}>{request.projectCode}</Link> : "Frais généraux" },
            { label: "Besoin le", value: formatDate(request.neededBy) },
            { label: "Estimation", value: formatMoney(request.estimatedTotal, request.currency) },
            { label: "Décision", value: request.decidedAt ? `${formatDateTime(request.decidedAt)}${request.decisionNote ? ` — ${request.decisionNote}` : ""}` : "—" },
          ]}
        />
        {request.justification && <p className="inline-note">{request.justification}</p>}
        {request.status === "DRAFT" && isRequester && (
          <ActionBar note="Brouillon : soumettez la demande pour validation par un responsable (vous ne pourrez pas la valider vous-même).">
            <Button variant="primary" disabled={mutation.saving} onClick={() => void apply(() => procurementApi.submitRequest(request.id), "Demande soumise pour validation.")}>
              <Send size={14} aria-hidden="true" /> Soumettre
            </Button>
          </ActionBar>
        )}
        {request.status === "SUBMITTED" && (
          <ActionBar note={isRequester ? "En attente de validation par une autre personne (séparation des devoirs)." : "Validez ou rejetez cette demande."}>
            {canApprove && (
              <>
                <Button variant="danger" onClick={() => setDialog("reject")}>
                  <XCircle size={14} aria-hidden="true" /> Rejeter
                </Button>
                <Button variant="primary" disabled={mutation.saving} onClick={() => void apply(() => procurementApi.approveRequest(request.id), "Demande approuvée.")}>
                  <CheckCircle2 size={14} aria-hidden="true" /> Approuver
                </Button>
              </>
            )}
          </ActionBar>
        )}
      </Panel>

      <div className="stack">
        <Panel
          title="Comparatif des offres fournisseurs"
          subtitle="Prix unitaires proposés par ligne ; le meilleur prix de chaque ligne est surligné."
          actions={
            request.status === "APPROVED" &&
            canOrder && (
              <Button onClick={() => setDialog("quote")} disabled={availableSuppliers.length === 0}>
                <Plus size={14} aria-hidden="true" /> Saisir une offre
              </Button>
            )
          }
        >
          {request.status !== "APPROVED" && request.status !== "ORDERED" && (
            <p className="inline-note">La consultation des fournisseurs s&apos;ouvre une fois la demande approuvée.</p>
          )}
          <div className="table-wrap">
            <table className="data-table compare-table">
              <thead>
                <tr>
                  <th>Ligne</th>
                  <th style={{ textAlign: "right" }}>Quantité</th>
                  <th style={{ textAlign: "right" }}>PU estimé</th>
                  {request.quotes.map((quote) => (
                    <th key={quote.id} style={{ textAlign: "right" }} className={quote.selected ? "selected-col" : ""}>
                      {quote.supplierName}
                      {quote.selected ? " ✓" : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {request.lines.map((line) => (
                  <tr key={line.id}>
                    <td>
                      <strong>{line.description}</strong>
                    </td>
                    <td style={{ textAlign: "right" }} className="num">
                      {formatQuantity(line.quantity, 3)} {line.unitCode}
                    </td>
                    <td style={{ textAlign: "right" }} className="num">
                      {formatMoney(line.estimatedUnitPrice)}
                    </td>
                    {request.quotes.map((quote) => {
                      const entry = quote.lines.find((candidate) => candidate.requestLineId === line.id);
                      return (
                        <td key={quote.id} style={{ textAlign: "right" }} className={`num ${bestPerLine.get(line.id) === quote.id && request.quotes.length > 1 ? "best" : ""}`}>
                          {entry ? formatMoney(entry.unitPrice) : "—"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr>
                  <td>
                    <strong>Total</strong>
                  </td>
                  <td />
                  <td style={{ textAlign: "right" }} className="num">
                    <strong>{formatMoney(request.estimatedTotal, request.currency)}</strong>
                  </td>
                  {request.quotes.map((quote) => (
                    <td key={quote.id} style={{ textAlign: "right" }} className="num">
                      <strong>{formatMoney(quote.total, request.currency)}</strong>
                      <small>
                        {quote.deliveryDays !== null ? `Livraison ${quote.deliveryDays} j` : "Délai non précisé"}
                        {quote.validUntil ? ` · valable au ${formatDate(quote.validUntil)}` : ""}
                      </small>
                      {request.status === "APPROVED" && canOrder && (
                        <Button variant="primary" onClick={() => setDialog({ order: quote.id })}>
                          <ShoppingCart size={13} aria-hidden="true" /> Commander
                        </Button>
                      )}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          {request.quotes.length === 0 && <Empty title="Aucune offre saisie" />}
          {request.orderIds.length > 0 && (
            <ActionBar note="Commande(s) issue(s) de cette demande :">
              {request.orderIds.map((orderId) => (
                <Button key={orderId} onClick={() => router.push(`/procurement/orders/${orderId}`)}>
                  Ouvrir la commande
                </Button>
              ))}
            </ActionBar>
          )}
        </Panel>
      </div>

      {dialog === "reject" && (
        <Modal title="Rejeter la demande" onClose={() => setDialog(null)}>
          <Feedback error={mutation.error} />
          <RejectForm saving={mutation.saving} onSubmit={(note) => apply(() => procurementApi.rejectRequest(request.id, note), "Demande rejetée.")} />
        </Modal>
      )}
      {dialog === "quote" && (
        <QuoteModal
          request={request}
          suppliers={availableSuppliers.map((supplier) => ({ value: supplier.id, label: `${supplier.name} (${supplier.code})` }))}
          saving={mutation.saving}
          error={mutation.error}
          onClose={() => setDialog(null)}
          onSubmit={(input) => apply(() => procurementApi.addQuote(request.id, input), "Offre enregistrée.")}
        />
      )}
      {dialog && typeof dialog === "object" && (
        <Modal title="Créer la commande" onClose={() => setDialog(null)}>
          <Feedback error={mutation.error} />
          <OrderForm
            saving={mutation.saving}
            quoteLabel={request.quotes.find((quote) => quote.id === dialog.order)?.supplierName ?? ""}
            onSubmit={async (expectedDate) => {
              const order = await mutation.run(
                () => procurementApi.createOrder({ requestId: request.id, quoteId: dialog.order, expectedDate: expectedDate || undefined }),
                "Commande créée (brouillon) : émettez-la pour engager le budget.",
              );
              if (order) router.push(`/procurement/orders/${order.id}`);
            }}
          />
        </Modal>
      )}
    </>
  );
}

function RejectForm({ saving, onSubmit }: { saving: boolean; onSubmit: (note: string) => Promise<void> }): React.ReactElement {
  const [note, setNote] = useState("");
  return (
    <Form columns={1} submitLabel="Rejeter" saving={saving} onSubmit={() => onSubmit(note)}>
      <TextAreaField label="Motif du rejet" value={note} onChange={setNote} required />
    </Form>
  );
}

function OrderForm({ saving, quoteLabel, onSubmit }: { saving: boolean; quoteLabel: string; onSubmit: (expectedDate: string) => Promise<void> }): React.ReactElement {
  const [expectedDate, setExpectedDate] = useState("");
  return (
    <Form columns={1} submitLabel="Créer la commande" saving={saving} onSubmit={() => onSubmit(expectedDate)}>
      <p className="field-note wide">Fournisseur retenu : {quoteLabel}. Les prix de son offre sont repris à l&apos;identique.</p>
      <DateField label="Livraison attendue" value={expectedDate} onChange={setExpectedDate} />
    </Form>
  );
}

function QuoteModal({
  request,
  suppliers,
  saving,
  error,
  onClose,
  onSubmit,
}: {
  request: PurchaseRequestView;
  suppliers: Array<{ value: string; label: string }>;
  saving: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (input: Parameters<typeof procurementApi.addQuote>[1]) => Promise<void>;
}): React.ReactElement {
  const [supplierId, setSupplierId] = useState("");
  const [reference, setReference] = useState("");
  const [deliveryDays, setDeliveryDays] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [prices, setPrices] = useState<Record<string, string>>({});
  return (
    <Modal title="Offre fournisseur" onClose={onClose} wide>
      <Feedback error={error} />
      <Form
        submitLabel="Enregistrer l'offre"
        saving={saving}
        onSubmit={() =>
          onSubmit({
            supplierId,
            reference: reference || undefined,
            deliveryDays: deliveryDays ? Number(deliveryDays) : undefined,
            validUntil: validUntil || undefined,
            lines: request.lines.map((line) => ({ requestLineId: line.id, unitPrice: (prices[line.id] ?? "").replace(",", ".") })),
          })
        }
      >
        <SelectField label="Fournisseur" value={supplierId} onChange={setSupplierId} options={suppliers} required />
        <TextField label="Référence de l'offre" value={reference} onChange={setReference} />
        <TextField label="Délai de livraison (jours)" inputMode="numeric" value={deliveryDays} onChange={setDeliveryDays} />
        <DateField label="Valable jusqu'au" value={validUntil} onChange={setValidUntil} />
        <div className="field wide">
          <span className="field-note">Prix unitaires proposés ({request.currency})</span>
          <DataTable
            rows={request.lines}
            empty={null}
            columns={[
              { key: "line", header: "Ligne", render: (line) => line.description },
              { key: "qty", header: "Quantité", align: "right", render: (line) => `${formatQuantity(line.quantity, 3)} ${line.unitCode}` },
              {
                key: "price",
                header: "PU proposé",
                align: "right",
                render: (line) => (
                  <input
                    className="inline-select"
                    aria-label={`Prix unitaire ${line.description}`}
                    inputMode="decimal"
                    required
                    value={prices[line.id] ?? ""}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setPrices((current) => ({ ...current, [line.id]: value }));
                    }}
                  />
                ),
              },
            ]}
          />
        </div>
      </Form>
    </Modal>
  );
}
