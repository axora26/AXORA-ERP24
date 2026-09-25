"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import type { InventoryItemView } from "@axora24/contracts";
import { AlertTriangle, ArrowLeftRight, Boxes, ClipboardCheck, PackageMinus, Plus, QrCode, SlidersHorizontal, Warehouse } from "lucide-react";
import { MOVEMENT_LABEL, inventoryApi } from "../../lib/modules/inventory";
import { newIdempotencyKey } from "../../lib/modules/procurement";
import { projectsApi } from "../../lib/modules/projects";
import { formatDateTime, formatMoney, formatQuantity, sumMoney } from "../../lib/format";
import { useMutation, useResource } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import {
  Button,
  DataTable,
  DecimalField,
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

type TabId = "items" | "balances" | "ledger" | "warehouses" | "counts";
type Dialog = "item" | "warehouse" | "issue" | "return" | "transfer" | "adjust" | "count" | { label: InventoryItemView };

export default function InventoryPage(): React.ReactElement {
  const session = useSession();
  const router = useRouter();
  const [tab, setTab] = useState<TabId>("items");
  const [warehouseFilter, setWarehouseFilter] = useState("");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const mutation = useMutation();
  const data = useResource(() => Promise.all([inventoryApi.items(), inventoryApi.warehouses(), inventoryApi.counts()]));
  const balances = useResource(() => inventoryApi.balances({ warehouseId: warehouseFilter || undefined }), [warehouseFilter]);
  const ledger = useResource(() => inventoryApi.movements({ warehouseId: warehouseFilter || undefined }), [warehouseFilter]);
  const [items, warehouses, counts] = data.data ?? [[], [], []];
  const company = session.companies.find((candidate) => candidate.id === session.activeCompanyId) ?? session.companies[0];
  const currency = company?.currency ?? "USD";
  const canMove = session.can("inventory.movement.create");

  async function done(action: () => Promise<unknown>, success: string): Promise<void> {
    const result = await mutation.run(action, success);
    if (result !== undefined) {
      setDialog(null);
      await Promise.all([data.reload(), balances.reload(), ledger.reload()]);
    }
  }

  const itemOptions = items.filter((item) => item.isActive).map((item) => ({ value: item.id, label: `${item.code} — ${item.name} (${item.unitCode})` }));
  const warehouseOptions = warehouses.filter((warehouse) => warehouse.isActive).map((warehouse) => ({ value: warehouse.id, label: `${warehouse.code} — ${warehouse.name}` }));
  const totalValue = sumMoney(warehouses.map((warehouse) => warehouse.totalValue));

  return (
    <>
      <PageHeader
        breadcrumb="Supply chain / Stock"
        title="Stock & logistique"
        subtitle="Grand livre des mouvements immuable, soldes jamais négatifs, valorisation au coût moyen pondéré."
        onRefresh={() => void Promise.all([data.reload(), balances.reload(), ledger.reload()])}
        actions={
          <>
            {canMove && (
              <>
                <Button onClick={() => setDialog("issue")}>
                  <PackageMinus size={15} aria-hidden="true" /> Sortie chantier
                </Button>
                <Button onClick={() => setDialog("transfer")}>
                  <ArrowLeftRight size={15} aria-hidden="true" /> Transfert
                </Button>
              </>
            )}
            {session.can("inventory.adjustment.create") && (
              <Button onClick={() => setDialog("adjust")}>
                <SlidersHorizontal size={15} aria-hidden="true" /> Ajustement
              </Button>
            )}
          </>
        }
      />
      <Feedback error={data.error || mutation.error} notice={mutation.notice} />
      {data.loading && !data.data ? (
        <Loading label="Chargement du stock…" />
      ) : (
        <>
          <Metrics label="Synthèse du stock">
            <Metric
              icon={<Boxes size={20} />}
              tone="blue"
              label="Valeur du stock"
              value={formatMoney(totalValue, currency)}
              detail={`${items.length} article(s) · ${warehouses.length} magasin(s)`}
            />
            <Metric
              icon={<AlertTriangle size={20} />}
              tone={items.some((item) => item.belowMinimum) ? "red" : "green"}
              label="Sous le seuil"
              value={String(items.filter((item) => item.belowMinimum).length)}
              detail="Articles à réapprovisionner"
            />
            <Metric
              icon={<ClipboardCheck size={20} />}
              tone="violet"
              label="Inventaires ouverts"
              value={String(counts.filter((count) => count.status === "OPEN").length)}
              detail="Magasins gelés pendant le comptage"
            />
          </Metrics>

          <Tabs<TabId>
            active={tab}
            onChange={setTab}
            tabs={[
              { id: "items", label: "Articles", count: items.length },
              { id: "balances", label: "Soldes par magasin" },
              { id: "ledger", label: "Grand livre" },
              { id: "warehouses", label: "Magasins", count: warehouses.length },
              { id: "counts", label: "Inventaires", count: counts.length },
            ]}
          />

          <div className="stack">
            {(tab === "balances" || tab === "ledger") && (
              <Panel>
                <div className="module-form cols-3">
                  <SelectField label="Magasin" value={warehouseFilter} onChange={setWarehouseFilter} options={warehouseOptions} emptyLabel="Tous les magasins" />
                </div>
              </Panel>
            )}

            {tab === "items" && (
              <Panel
                title="Articles"
                actions={
                  session.can("inventory.item.manage") && (
                    <Button onClick={() => setDialog("item")}>
                      <Plus size={14} aria-hidden="true" /> Article
                    </Button>
                  )
                }
              >
                <DataTable
                  rows={items}
                  empty={<Empty icon={<Boxes size={22} />} title="Aucun article" />}
                  columns={[
                    {
                      key: "name",
                      header: "Article",
                      render: (item) => (
                        <>
                          <strong>{item.name}</strong>
                          <small>
                            {item.code}
                            {item.category ? ` · ${item.category}` : ""}
                          </small>
                        </>
                      ),
                    },
                    { key: "qty", header: "Stock total", align: "right", render: (item) => `${formatQuantity(item.totalQuantity, 3)} ${item.unitCode}` },
                    { key: "avg", header: "Coût moyen", align: "right", render: (item) => (item.averageCost ? formatMoney(item.averageCost) : "—") },
                    { key: "value", header: "Valeur", align: "right", render: (item) => <span className="num">{formatMoney(item.totalValue, currency)}</span> },
                    {
                      key: "min",
                      header: "Seuil",
                      render: (item) =>
                        item.belowMinimum ? (
                          <StatusChip status="critical" label={`Sous le seuil (${formatQuantity(item.minStock, 3)})`} />
                        ) : Number(item.minStock) > 0 ? (
                          formatQuantity(item.minStock, 3)
                        ) : (
                          <span className="muted">—</span>
                        ),
                    },
                    {
                      key: "label",
                      header: "",
                      align: "right",
                      render: (item) => (
                        <Button variant="ghost" onClick={() => setDialog({ label: item })} title="Étiquette QR">
                          <QrCode size={14} aria-label="Étiquette QR" />
                        </Button>
                      ),
                    },
                  ]}
                />
              </Panel>
            )}

            {tab === "balances" && (
              <Panel title="Soldes" subtitle="Quantité et valeur par article et magasin">
                <DataTable
                  rows={(balances.data ?? []).map((balance) => ({ ...balance, id: `${balance.itemId}-${balance.warehouseId}` }))}
                  empty={<Empty title="Aucun solde" />}
                  columns={[
                    { key: "wh", header: "Magasin", render: (balance) => balance.warehouseCode },
                    { key: "item", header: "Article", render: (balance) => `${balance.itemCode} — ${balance.itemName}` },
                    { key: "qty", header: "Quantité", align: "right", render: (balance) => `${formatQuantity(balance.quantity, 3)} ${balance.unitCode}` },
                    { key: "avg", header: "Coût moyen", align: "right", render: (balance) => (balance.averageCost ? formatMoney(balance.averageCost) : "—") },
                    { key: "value", header: "Valeur", align: "right", render: (balance) => <span className="num">{formatMoney(balance.value, currency)}</span> },
                  ]}
                />
              </Panel>
            )}

            {tab === "ledger" && (
              <Panel title="Grand livre des mouvements" subtitle="Append-only : aucune écriture ne peut être modifiée ni supprimée (garanti en base de données)">
                <DataTable
                  rows={ledger.data ?? []}
                  empty={<Empty title="Aucun mouvement" />}
                  columns={[
                    { key: "date", header: "Date", render: (movement) => formatDateTime(movement.createdAt) },
                    {
                      key: "type",
                      header: "Mouvement",
                      render: (movement) => (
                        <>
                          <strong>{MOVEMENT_LABEL[movement.type]}</strong>
                          <small>
                            {movement.reference ?? ""}
                            {movement.projectCode ? ` · ${movement.projectCode}` : ""}
                            {movement.reason ? ` · ${movement.reason}` : ""}
                          </small>
                        </>
                      ),
                    },
                    { key: "item", header: "Article", render: (movement) => `${movement.itemCode} — ${movement.itemName}` },
                    { key: "wh", header: "Magasin", render: (movement) => movement.warehouseCode },
                    {
                      key: "qty",
                      header: "Quantité",
                      align: "right",
                      render: (movement) => (
                        <span className={`num ${movement.quantityDelta.startsWith("-") ? "text-danger" : "text-success"}`}>
                          {movement.quantityDelta.startsWith("-") ? "" : "+"}
                          {formatQuantity(movement.quantityDelta, 3)}
                        </span>
                      ),
                    },
                    { key: "value", header: "Valeur", align: "right", render: (movement) => <span className="num">{formatMoney(movement.valueDelta)}</span> },
                    { key: "by", header: "Par", render: (movement) => movement.createdByName ?? "—" },
                  ]}
                />
              </Panel>
            )}

            {tab === "warehouses" && (
              <Panel
                title="Magasins et stocks de chantier"
                actions={
                  session.can("inventory.item.manage") && (
                    <Button onClick={() => setDialog("warehouse")}>
                      <Plus size={14} aria-hidden="true" /> Magasin
                    </Button>
                  )
                }
              >
                <DataTable
                  rows={warehouses}
                  empty={<Empty icon={<Warehouse size={22} />} title="Aucun magasin" />}
                  columns={[
                    {
                      key: "name",
                      header: "Magasin",
                      render: (warehouse) => (
                        <>
                          <strong>{warehouse.name}</strong>
                          <small>{warehouse.code}</small>
                        </>
                      ),
                    },
                    {
                      key: "kind",
                      header: "Type",
                      render: (warehouse) => (warehouse.kind === "SITE" ? `Chantier ${warehouse.projectCode ?? ""}` : "Dépôt"),
                    },
                    { key: "location", header: "Localisation", render: (warehouse) => warehouse.location ?? "—" },
                    { key: "items", header: "Articles en stock", align: "right", render: (warehouse) => warehouse.itemCount },
                    { key: "value", header: "Valeur", align: "right", render: (warehouse) => <span className="num">{formatMoney(warehouse.totalValue, currency)}</span> },
                  ]}
                />
              </Panel>
            )}

            {tab === "counts" && (
              <Panel
                title="Inventaires physiques"
                subtitle="Un inventaire ouvert gèle le magasin ; à la clôture, chaque écart devient un ajustement tracé."
                actions={
                  session.can("inventory.count.manage") && (
                    <Button onClick={() => setDialog("count")}>
                      <Plus size={14} aria-hidden="true" /> Ouvrir un inventaire
                    </Button>
                  )
                }
              >
                <DataTable
                  rows={counts}
                  onRowClick={(count) => router.push(`/inventory/counts/${count.id}`)}
                  empty={<Empty icon={<ClipboardCheck size={22} />} title="Aucun inventaire" />}
                  columns={[
                    { key: "code", header: "Inventaire", render: (count) => <strong>{count.code}</strong> },
                    { key: "wh", header: "Magasin", render: (count) => count.warehouseCode },
                    { key: "opened", header: "Ouvert le", render: (count) => formatDateTime(count.createdAt) },
                    {
                      key: "progress",
                      header: "Comptage",
                      render: (count) => `${count.lines.filter((line) => line.countedQuantity !== null).length} / ${count.lines.length} ligne(s)`,
                    },
                    {
                      key: "status",
                      header: "Statut",
                      render: (count) => <StatusChip status={count.status === "OPEN" ? "pending" : "closed"} label={count.status === "OPEN" ? "En cours" : "Clôturé"} />,
                    },
                  ]}
                />
              </Panel>
            )}
          </div>
        </>
      )}

      {dialog && (
        <InventoryDialog
          dialog={dialog}
          itemOptions={itemOptions}
          warehouseOptions={warehouseOptions}
          saving={mutation.saving}
          error={mutation.error}
          onClose={() => setDialog(null)}
          onDone={done}
          onCountOpened={(id) => router.push(`/inventory/counts/${id}`)}
          currency={currency}
        />
      )}
    </>
  );
}

function InventoryDialog({
  dialog,
  itemOptions,
  warehouseOptions,
  saving,
  error,
  onClose,
  onDone,
  onCountOpened,
  currency,
}: {
  dialog: Dialog;
  itemOptions: Array<{ value: string; label: string }>;
  warehouseOptions: Array<{ value: string; label: string }>;
  saving: boolean;
  error: string;
  onClose: () => void;
  onDone: (action: () => Promise<unknown>, success: string) => Promise<void>;
  onCountOpened: (id: string) => void;
  currency: string;
}): React.ReactElement {
  const [values, setValues] = useState<Record<string, string>>({ kind: "WAREHOUSE" });
  const [idempotencyKey] = useState(() => newIdempotencyKey("stock"));
  const projects = useResource(() => projectsApi.list().catch(() => []));
  const set = (field: string) => (value: string) => setValues((current) => ({ ...current, [field]: value }));
  const value = (field: string) => values[field] ?? "";
  const projectOptions = (projects.data ?? []).map((project) => ({ value: project.id, label: `${project.code} — ${project.name}` }));
  const decimal = (field: string) => value(field).replace(",", ".");

  if (typeof dialog === "object") return <QrLabel item={dialog.label} onClose={onClose} />;

  let title = "";
  let body: React.ReactNode = null;
  switch (dialog) {
    case "item":
      title = "Nouvel article";
      body = (
        <Form
          submitLabel="Créer"
          saving={saving}
          onSubmit={() =>
            onDone(
              () =>
                inventoryApi.createItem({
                  name: value("name"),
                  unitCode: value("unitCode"),
                  code: value("code") || undefined,
                  category: value("category") || undefined,
                  barcode: value("barcode") || undefined,
                  minStock: value("minStock") ? decimal("minStock") : undefined,
                }),
              "Article créé.",
            )
          }
        >
          <TextField label="Désignation" value={value("name")} onChange={set("name")} required />
          <TextField label="Unité de gestion" value={value("unitCode")} onChange={set("unitCode")} required placeholder="t, m3, u, ml…" />
          <TextField label="Code (auto si vide)" value={value("code")} onChange={set("code")} />
          <TextField label="Catégorie" value={value("category")} onChange={set("category")} />
          <TextField label="Code-barres" value={value("barcode")} onChange={set("barcode")} />
          <DecimalField label="Seuil de réapprovisionnement" value={value("minStock")} onChange={set("minStock")} placeholder="0" />
        </Form>
      );
      break;
    case "warehouse":
      title = "Nouveau magasin";
      body = (
        <Form
          submitLabel="Créer"
          saving={saving}
          onSubmit={() =>
            onDone(
              () =>
                inventoryApi.createWarehouse({
                  code: value("code"),
                  name: value("name"),
                  kind: value("kind"),
                  projectId: value("kind") === "SITE" ? value("projectId") : undefined,
                  location: value("location") || undefined,
                }),
              "Magasin créé.",
            )
          }
        >
          <TextField label="Code" value={value("code")} onChange={set("code")} required placeholder="MAG-CENTRAL" />
          <TextField label="Nom" value={value("name")} onChange={set("name")} required />
          <SelectField
            label="Type"
            value={value("kind")}
            onChange={set("kind")}
            required
            options={[
              { value: "WAREHOUSE", label: "Dépôt" },
              { value: "SITE", label: "Magasin de chantier" },
            ]}
          />
          {value("kind") === "SITE" && <SelectField label="Projet" value={value("projectId")} onChange={set("projectId")} options={projectOptions} required />}
          <TextField label="Localisation" value={value("location")} onChange={set("location")} />
        </Form>
      );
      break;
    case "issue":
    case "return":
      title = dialog === "issue" ? "Sortie vers un chantier" : "Retour de chantier";
      body = (
        <Form
          submitLabel={dialog === "issue" ? "Enregistrer la sortie" : "Enregistrer le retour"}
          saving={saving}
          onSubmit={() => {
            const input = {
              warehouseId: value("warehouseId"),
              projectId: value("projectId"),
              reference: value("reference") || undefined,
              idempotencyKey,
              lines: [{ itemId: value("itemId"), quantity: decimal("quantity") }],
            };
            return onDone(
              () => (dialog === "issue" ? inventoryApi.issue(input) : inventoryApi.returnToStock(input)),
              dialog === "issue" ? "Sortie enregistrée : consommation imputée au projet." : "Retour enregistré.",
            );
          }}
        >
          <SelectField label="Magasin" value={value("warehouseId")} onChange={set("warehouseId")} options={warehouseOptions} required />
          <SelectField label="Projet" value={value("projectId")} onChange={set("projectId")} options={projectOptions} required />
          <SelectField label="Article" value={value("itemId")} onChange={set("itemId")} options={itemOptions} required wide />
          <DecimalField label="Quantité" value={value("quantity")} onChange={set("quantity")} required />
          <TextField label="Bon de sortie / référence" value={value("reference")} onChange={set("reference")} />
        </Form>
      );
      break;
    case "transfer":
      title = "Transfert entre magasins";
      body = (
        <Form
          submitLabel="Transférer"
          saving={saving}
          onSubmit={() =>
            onDone(
              () =>
                inventoryApi.transfer({
                  fromWarehouseId: value("from"),
                  toWarehouseId: value("to"),
                  reference: value("reference") || undefined,
                  idempotencyKey,
                  lines: [{ itemId: value("itemId"), quantity: decimal("quantity") }],
                }),
              "Transfert enregistré (valeur conservée).",
            )
          }
        >
          <SelectField label="Depuis" value={value("from")} onChange={set("from")} options={warehouseOptions} required />
          <SelectField label="Vers" value={value("to")} onChange={set("to")} options={warehouseOptions} required />
          <SelectField label="Article" value={value("itemId")} onChange={set("itemId")} options={itemOptions} required wide />
          <DecimalField label="Quantité" value={value("quantity")} onChange={set("quantity")} required />
          <TextField label="Référence" value={value("reference")} onChange={set("reference")} />
        </Form>
      );
      break;
    case "adjust":
      title = "Ajustement de stock";
      body = (
        <Form
          submitLabel="Enregistrer l'ajustement"
          saving={saving}
          onSubmit={() =>
            onDone(
              () =>
                inventoryApi.adjust({
                  warehouseId: value("warehouseId"),
                  itemId: value("itemId"),
                  quantityDelta: decimal("quantityDelta"),
                  unitCost: value("unitCost") ? decimal("unitCost") : undefined,
                  reason: value("reason"),
                }),
              "Ajustement enregistré et audité.",
            )
          }
        >
          <SelectField label="Magasin" value={value("warehouseId")} onChange={set("warehouseId")} options={warehouseOptions} required />
          <SelectField label="Article" value={value("itemId")} onChange={set("itemId")} options={itemOptions} required />
          <DecimalField label="Variation (+ entrée / − sortie)" value={value("quantityDelta")} onChange={set("quantityDelta")} required hint="Ex. -2 pour une casse." />
          <DecimalField label={`Coût unitaire (${currency})`} value={value("unitCost")} onChange={set("unitCost")} hint="Requis pour une entrée sans stock existant." />
          <TextAreaField label="Motif (obligatoire)" value={value("reason")} onChange={set("reason")} required />
        </Form>
      );
      break;
    case "count":
      title = "Ouvrir un inventaire";
      body = (
        <Form
          columns={1}
          submitLabel="Ouvrir et geler le magasin"
          saving={saving}
          onSubmit={() =>
            onDone(async () => {
              const count = await inventoryApi.openCount(value("warehouseId"));
              onCountOpened(count.id);
              return count;
            }, "Inventaire ouvert : le magasin est gelé.")
          }
        >
          <SelectField label="Magasin" value={value("warehouseId")} onChange={set("warehouseId")} options={warehouseOptions} required />
        </Form>
      );
      break;
  }
  return (
    <Modal title={title} onClose={onClose} wide={dialog !== "count"}>
      <Feedback error={error} />
      {body}
    </Modal>
  );
}

function QrLabel({ item, onClose }: { item: InventoryItemView; onClose: () => void }): React.ReactElement {
  const [image, setImage] = useState("");
  useEffect(() => {
    QRCode.toDataURL(`AXORA-ITEM:${item.code}`, { margin: 1, width: 200 })
      .then(setImage)
      .catch(() => setImage(""));
  }, [item.code]);
  return (
    <Modal title="Étiquette article" onClose={onClose}>
      <div className="qr-box">
        {image ? <img src={image} alt={`QR code de l'article ${item.code}`} /> : <span className="loader" />}
        <div>
          <strong>{item.name}</strong>
          <code>{item.code}</code>
          <p className="inline-note" style={{ padding: "10px 0 0" }}>
            Contenu du QR code : <code>AXORA-ITEM:{item.code}</code> — à imprimer et coller sur l&apos;emplacement de stockage.
          </p>
        </div>
      </div>
    </Modal>
  );
}
