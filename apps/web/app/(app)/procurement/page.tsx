"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import type { SupplierView } from "@axora24/contracts";
import { ClipboardList, PackageCheck, Plus, Star, Trash2, Truck } from "lucide-react";
import { ORDER_STATUS_LABEL, REQUEST_STATUS_LABEL, procurementApi } from "../../lib/modules/procurement";
import { projectsApi } from "../../lib/modules/projects";
import { formatDate, formatMoney } from "../../lib/format";
import { useMutation, useResource } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import {
  Button,
  DataTable,
  DateField,
  Empty,
  Feedback,
  Form,
  Loading,
  Metric,
  Metrics,
  Modal,
  PageHeader,
  Panel,
  SelectField,
  StatusChip,
  Tabs,
  TextAreaField,
  TextField,
} from "../../components/ui";

type TabId = "requests" | "orders" | "suppliers";

export default function ProcurementPage(): React.ReactElement {
  const session = useSession();
  const router = useRouter();
  const [tab, setTab] = useState<TabId>("requests");
  const mutation = useMutation();
  const data = useResource(() =>
    Promise.all([
      session.can("procurement.request.read") ? procurementApi.requests() : Promise.resolve([]),
      session.can("procurement.order.read") ? procurementApi.orders() : Promise.resolve([]),
      session.can("procurement.supplier.read") ? procurementApi.suppliers() : Promise.resolve([]),
    ]),
  );
  const [dialog, setDialog] = useState<"request" | "supplier" | { evaluate: SupplierView } | null>(null);
  const [requests, orders, suppliers] = data.data ?? [[], [], []];

  const openOrders = orders.filter((order) => order.status === "ISSUED" || order.status === "PARTIALLY_RECEIVED");

  return (
    <>
      <PageHeader
        breadcrumb="Achats"
        title="Achats"
        subtitle="Demande → validation → consultation → commande → réception. Les commandes émises engagent le budget des projets."
        onRefresh={() => void data.reload()}
        actions={
          <>
            {session.can("procurement.supplier.manage") && (
              <Button onClick={() => setDialog("supplier")}>
                <Plus size={15} aria-hidden="true" /> Fournisseur
              </Button>
            )}
            {session.can("procurement.request.create") && (
              <Button variant="primary" onClick={() => setDialog("request")}>
                <Plus size={15} aria-hidden="true" /> Demande d&apos;achat
              </Button>
            )}
          </>
        }
      />
      <Feedback error={data.error || mutation.error} notice={mutation.notice} />
      {data.loading && !data.data ? (
        <Loading label="Chargement des achats…" />
      ) : (
        <>
          <Metrics label="Synthèse des achats">
            <Metric
              icon={<ClipboardList size={20} />}
              tone="violet"
              label="Demandes à valider"
              value={String(requests.filter((request) => request.status === "SUBMITTED").length)}
              detail={`${requests.filter((request) => request.status === "APPROVED").length} approuvée(s) à commander`}
            />
            <Metric
              icon={<Truck size={20} />}
              tone="amber"
              label="Commandes en cours"
              value={String(openOrders.length)}
              detail={`${orders.filter((order) => order.status === "PARTIALLY_RECEIVED").length} en réception partielle`}
            />
            <Metric
              icon={<PackageCheck size={20} />}
              tone="green"
              label="Commandes reçues"
              value={String(orders.filter((order) => order.status === "RECEIVED").length)}
              detail={`${suppliers.filter((supplier) => supplier.isActive).length} fournisseur(s) actif(s)`}
            />
          </Metrics>

          <Tabs<TabId>
            active={tab}
            onChange={setTab}
            tabs={[
              { id: "requests", label: "Demandes d'achat", count: requests.length },
              { id: "orders", label: "Commandes", count: orders.length },
              { id: "suppliers", label: "Fournisseurs", count: suppliers.length },
            ]}
          />

          <div className="stack">
            {tab === "requests" && (
              <Panel title="Demandes d'achat" subtitle="Cliquez sur une demande pour la valider, consulter les fournisseurs ou commander">
                <DataTable
                  rows={requests}
                  onRowClick={(request) => router.push(`/procurement/requests/${request.id}`)}
                  empty={<Empty icon={<ClipboardList size={22} />} title="Aucune demande d'achat" />}
                  columns={[
                    {
                      key: "title",
                      header: "Demande",
                      render: (request) => (
                        <>
                          <strong>{request.title}</strong>
                          <small>
                            {request.code}
                            {request.projectCode ? ` · projet ${request.projectCode}` : ""}
                          </small>
                        </>
                      ),
                    },
                    { key: "by", header: "Demandeur", render: (request) => request.requestedByName ?? "—" },
                    { key: "needed", header: "Besoin le", render: (request) => formatDate(request.neededBy) },
                    {
                      key: "amount",
                      header: "Estimation",
                      align: "right",
                      render: (request) => <span className="num">{formatMoney(request.estimatedTotal, request.currency)}</span>,
                    },
                    { key: "quotes", header: "Offres", align: "right", render: (request) => request.quotes.length },
                    {
                      key: "status",
                      header: "Statut",
                      render: (request) => <StatusChip status={statusTone(request.status)} label={REQUEST_STATUS_LABEL[request.status]} />,
                    },
                  ]}
                />
              </Panel>
            )}

            {tab === "orders" && (
              <Panel title="Commandes fournisseurs" subtitle="Cliquez sur une commande pour l'émettre ou enregistrer une réception">
                <DataTable
                  rows={orders}
                  onRowClick={(order) => router.push(`/procurement/orders/${order.id}`)}
                  empty={<Empty icon={<Truck size={22} />} title="Aucune commande" body="Une commande naît d'une demande approuvée et d'une offre retenue." />}
                  columns={[
                    {
                      key: "code",
                      header: "Commande",
                      render: (order) => (
                        <>
                          <strong>{order.code}</strong>
                          <small>
                            {order.supplierName}
                            {order.projectCode ? ` · projet ${order.projectCode}` : ""}
                          </small>
                        </>
                      ),
                    },
                    { key: "request", header: "Demande", render: (order) => order.requestCode ?? "—" },
                    {
                      key: "total",
                      header: "Montant",
                      align: "right",
                      render: (order) => <span className="num">{formatMoney(order.total, order.currency)}</span>,
                    },
                    {
                      key: "received",
                      header: "Reçu",
                      align: "right",
                      render: (order) => <span className="num">{formatMoney(order.receivedValue, order.currency)}</span>,
                    },
                    {
                      key: "status",
                      header: "Statut",
                      render: (order) => <StatusChip status={order.status} label={ORDER_STATUS_LABEL[order.status]} />,
                    },
                  ]}
                />
              </Panel>
            )}

            {tab === "suppliers" && (
              <Panel title="Fournisseurs">
                <DataTable
                  rows={suppliers}
                  empty={<Empty title="Aucun fournisseur" />}
                  columns={[
                    {
                      key: "name",
                      header: "Fournisseur",
                      render: (supplier) => (
                        <>
                          <strong>{supplier.name}</strong>
                          <small>
                            {supplier.code}
                            {supplier.category ? ` · ${supplier.category}` : ""}
                          </small>
                        </>
                      ),
                    },
                    { key: "city", header: "Ville", render: (supplier) => [supplier.city, supplier.country].filter(Boolean).join(", ") || "—" },
                    { key: "terms", header: "Paiement", render: (supplier) => `${supplier.paymentTermsDays} j` },
                    { key: "orders", header: "Commandes", align: "right", render: (supplier) => supplier.orderCount },
                    {
                      key: "rating",
                      header: "Évaluation",
                      render: (supplier) =>
                        supplier.rating ? (
                          <span>
                            <Star size={12} aria-hidden="true" /> {supplier.rating} / 5 <small>({supplier.evaluationCount})</small>
                          </span>
                        ) : (
                          <span className="muted">Non évalué</span>
                        ),
                    },
                    {
                      key: "state",
                      header: "",
                      align: "right",
                      render: (supplier) => (
                        <div className="chip-row" style={{ justifyContent: "flex-end" }}>
                          <StatusChip status={supplier.isActive ? "active" : "archived"} label={supplier.isActive ? "Actif" : "Inactif"} />
                          {session.can("procurement.supplier.manage") && (
                            <Button variant="ghost" onClick={() => setDialog({ evaluate: supplier })}>
                              Évaluer
                            </Button>
                          )}
                        </div>
                      ),
                    },
                  ]}
                />
              </Panel>
            )}
          </div>
        </>
      )}

      {dialog === "request" && (
        <RequestModal
          saving={mutation.saving}
          error={mutation.error}
          onClose={() => setDialog(null)}
          onSubmit={async (input) => {
            const created = await mutation.run(() => procurementApi.createRequest(input), "Demande créée (brouillon).");
            if (created) router.push(`/procurement/requests/${created.id}`);
          }}
        />
      )}
      {dialog === "supplier" && (
        <SupplierModal
          saving={mutation.saving}
          error={mutation.error}
          onClose={() => setDialog(null)}
          onSubmit={async (input) => {
            const created = await mutation.run(() => procurementApi.createSupplier(input), "Fournisseur créé.");
            if (created) {
              setDialog(null);
              setTab("suppliers");
              await data.reload();
            }
          }}
        />
      )}
      {dialog && typeof dialog === "object" && (
        <EvaluateModal
          supplier={dialog.evaluate}
          saving={mutation.saving}
          error={mutation.error}
          onClose={() => setDialog(null)}
          onSubmit={async (input) => {
            const done = await mutation.run(() => procurementApi.evaluateSupplier(dialog.evaluate.id, input), "Évaluation enregistrée.");
            if (done) {
              setDialog(null);
              await data.reload();
            }
          }}
        />
      )}
    </>
  );
}

function statusTone(status: string): string {
  if (status === "SUBMITTED") return "pending";
  if (status === "ORDERED") return "done";
  return status;
}

type LineDraft = { description: string; unitCode: string; quantity: string; estimatedUnitPrice: string; wbsItemId: string };
const EMPTY_LINE: LineDraft = { description: "", unitCode: "u", quantity: "", estimatedUnitPrice: "", wbsItemId: "" };

function RequestModal({
  saving,
  error,
  onClose,
  onSubmit,
}: {
  saving: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (input: Parameters<typeof procurementApi.createRequest>[0]) => Promise<void>;
}): React.ReactElement {
  const projects = useResource(() => projectsApi.list().catch(() => []));
  const [projectId, setProjectId] = useState("");
  const project = useResource(() => (projectId ? projectsApi.detail(projectId) : Promise.resolve(null)), [projectId]);
  const [title, setTitle] = useState("");
  const [justification, setJustification] = useState("");
  const [neededBy, setNeededBy] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([{ ...EMPTY_LINE }]);
  const leaves = (project.data?.wbs ?? []).filter((node) => node.isLeaf);
  const activeProjects = (projects.data ?? []).filter((candidate) => candidate.status !== "COMPLETED" && candidate.status !== "CANCELLED");

  function update(index: number, field: keyof LineDraft, value: string): void {
    setLines((current) => current.map((line, position) => (position === index ? { ...line, [field]: value } : line)));
  }

  return (
    <Modal title="Nouvelle demande d'achat" onClose={onClose} wide>
      <Feedback error={error} />
      <Form
        submitLabel="Créer la demande"
        saving={saving}
        onSubmit={() =>
          onSubmit({
            title,
            justification: justification || undefined,
            projectId: projectId || undefined,
            neededBy: neededBy || undefined,
            lines: lines.map((line) => ({
              description: line.description,
              unitCode: line.unitCode,
              quantity: line.quantity.replace(",", "."),
              estimatedUnitPrice: line.estimatedUnitPrice.replace(",", "."),
              wbsItemId: line.wbsItemId || undefined,
            })),
          })
        }
      >
        <TextField label="Objet" value={title} onChange={setTitle} required />
        <DateField label="Besoin le" value={neededBy} onChange={setNeededBy} />
        <SelectField
          label="Projet imputé"
          value={projectId}
          onChange={setProjectId}
          options={activeProjects.map((candidate) => ({ value: candidate.id, label: `${candidate.code} — ${candidate.name}` }))}
          emptyLabel="Aucun (frais généraux)"
          hint="La demande prend la devise du projet ; la commande engagera son budget."
          wide
        />
        <TextAreaField label="Justification" value={justification} onChange={setJustification} />
        <div className="field wide">
          <span className="field-note">Lignes</span>
          <div className="line-editor">
            {lines.map((line, index) => (
              <div className="line-editor-row" key={index}>
                <input aria-label={`Désignation ligne ${index + 1}`} placeholder="Désignation" value={line.description} onChange={(event) => update(index, "description", event.currentTarget.value)} required />
                <input aria-label={`Unité ligne ${index + 1}`} placeholder="Unité" value={line.unitCode} onChange={(event) => update(index, "unitCode", event.currentTarget.value)} required />
                <input aria-label={`Quantité ligne ${index + 1}`} placeholder="Qté" inputMode="decimal" value={line.quantity} onChange={(event) => update(index, "quantity", event.currentTarget.value)} required />
                <input aria-label={`Prix estimé ligne ${index + 1}`} placeholder="PU estimé" inputMode="decimal" value={line.estimatedUnitPrice} onChange={(event) => update(index, "estimatedUnitPrice", event.currentTarget.value)} required />
                {projectId ? (
                  <select aria-label={`Élément WBS ligne ${index + 1}`} value={line.wbsItemId} onChange={(event) => update(index, "wbsItemId", event.currentTarget.value)}>
                    <option value="">WBS…</option>
                    {leaves.map((node) => (
                      <option key={node.id} value={node.id}>
                        {node.code} — {node.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span />
                )}
                <button type="button" className="icon-button" aria-label={`Retirer la ligne ${index + 1}`} disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((_, position) => position !== index))}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <Button variant="ghost" onClick={() => setLines((current) => [...current, { ...EMPTY_LINE }])}>
              <Plus size={14} aria-hidden="true" /> Ajouter une ligne
            </Button>
          </div>
        </div>
      </Form>
    </Modal>
  );
}

function SupplierModal({
  saving,
  error,
  onClose,
  onSubmit,
}: {
  saving: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (input: Record<string, unknown>) => Promise<void>;
}): React.ReactElement {
  const [values, setValues] = useState({ name: "", category: "", email: "", phone: "", city: "", country: "", taxId: "", paymentTermsDays: "30", currency: "USD" });
  const set = (field: keyof typeof values) => (value: string) => setValues((current) => ({ ...current, [field]: value }));
  return (
    <Modal title="Nouveau fournisseur" onClose={onClose} wide>
      <Feedback error={error} />
      <Form
        submitLabel="Créer"
        saving={saving}
        onSubmit={() =>
          onSubmit({
            ...Object.fromEntries(Object.entries(values).filter(([, value]) => value !== "")),
            paymentTermsDays: Number(values.paymentTermsDays || "30"),
          })
        }
      >
        <TextField label="Raison sociale" value={values.name} onChange={set("name")} required />
        <TextField label="Catégorie" value={values.category} onChange={set("category")} placeholder="Ex. Matériaux, Location…" />
        <TextField label="E-mail" type="email" value={values.email} onChange={set("email")} />
        <TextField label="Téléphone" value={values.phone} onChange={set("phone")} />
        <TextField label="Ville" value={values.city} onChange={set("city")} />
        <TextField label="Pays" value={values.country} onChange={set("country")} />
        <TextField label="Identifiant fiscal" value={values.taxId} onChange={set("taxId")} />
        <TextField label="Délai de paiement (jours)" inputMode="numeric" value={values.paymentTermsDays} onChange={set("paymentTermsDays")} />
        <TextField label="Devise" value={values.currency} onChange={(value) => set("currency")(value.toUpperCase())} />
      </Form>
    </Modal>
  );
}

const SCORE = [1, 2, 3, 4, 5].map((value) => ({ value: String(value), label: `${value} / 5` }));

function EvaluateModal({
  supplier,
  saving,
  error,
  onClose,
  onSubmit,
}: {
  supplier: SupplierView;
  saving: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (input: { quality: number; delivery: number; price: number; comment?: string }) => Promise<void>;
}): React.ReactElement {
  const [quality, setQuality] = useState("4");
  const [delivery, setDelivery] = useState("4");
  const [price, setPrice] = useState("4");
  const [comment, setComment] = useState("");
  return (
    <Modal title={`Évaluer ${supplier.name}`} onClose={onClose}>
      <Feedback error={error} />
      <Form
        columns={3}
        submitLabel="Enregistrer l'évaluation"
        saving={saving}
        onSubmit={() => onSubmit({ quality: Number(quality), delivery: Number(delivery), price: Number(price), comment: comment || undefined })}
      >
        <SelectField label="Qualité" value={quality} onChange={setQuality} options={SCORE} required />
        <SelectField label="Délais" value={delivery} onChange={setDelivery} options={SCORE} required />
        <SelectField label="Prix" value={price} onChange={setPrice} options={SCORE} required />
        <TextAreaField label="Commentaire" value={comment} onChange={setComment} />
      </Form>
    </Modal>
  );
}

