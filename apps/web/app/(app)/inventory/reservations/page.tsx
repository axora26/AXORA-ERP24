"use client";

import React, { useState } from "react";
import type { ProjectSummaryView, StockReservationView } from "@axora24/contracts";
import { Boxes, CalendarClock, LockKeyhole, Plus, RotateCcw } from "lucide-react";
import { inventoryApi } from "../../../lib/modules/inventory";
import { projectsApi } from "../../../lib/modules/projects";
import { newIdempotencyKey } from "../../../lib/modules/procurement";
import { formatDate, formatQuantity } from "../../../lib/format";
import { useMutation, useResource } from "../../../lib/hooks";
import { useSession } from "../../../lib/session";
import { Button, DataTable, DataUnavailable, DecimalField, Empty, Feedback, Form, Loading, Modal, PageHeader, Panel, SelectField, StatusChip, TextAreaField, TextField } from "../../../components/ui";

type Dialog = "create" | { release: StockReservationView } | null;

export default function StockReservationsPage(): React.ReactElement {
  const session = useSession();
  const mutation = useMutation();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [projectFilter, setProjectFilter] = useState("");
  const data = useResource(
    () => Promise.all([inventoryApi.reservations({ projectId: projectFilter || undefined }), inventoryApi.items(), inventoryApi.warehouses(), projectsApi.list()]),
    [projectFilter],
  );
  const [reservations, items, warehouses, projects] = data.data ?? [[], [], [], []];
  const siteWarehouses = warehouses.filter((warehouse) => warehouse.kind === "SITE" && warehouse.isActive);
  const active = reservations.filter((reservation) => reservation.status === "ACTIVE");
  const projectOptions = projects.map((project) => ({ value: project.id, label: `${project.code} — ${project.name}` }));

  async function reload(): Promise<void> {
    await data.reload();
  }

  async function done(action: () => Promise<unknown>, message: string): Promise<void> {
    const result = await mutation.run(action, message);
    if (result !== undefined) {
      setDialog(null);
      await reload();
    }
  }

  if (data.error && !data.data && !data.loading) return <DataUnavailable title="Réservations de stock" error={data.error} onRetry={() => void reload()} />;
  return (
    <>
      <PageHeader
        breadcrumb="Supply chain / Stock"
        title="Réservations de stock"
        subtitle="Allouer du matériel futur sans modifier le stock physique ni le coût consommé."
        onRefresh={() => void reload()}
        actions={session.can("inventory.reservation.manage") ? <Button onClick={() => setDialog("create")}><Plus size={15} aria-hidden="true" /> Réserver du stock</Button> : undefined}
      />
      <Feedback error={data.error || mutation.error} notice={mutation.notice} />
      {data.loading && !data.data ? <Loading label="Chargement des réservations…" /> : (
        <div className="stack">
          <Panel title="Disponibilité planifiée" subtitle="Libre = physique − réservations actives. Une réservation ne crée ni réception ni consommation.">
            <div className="module-form cols-3">
              <SelectField label="Projet" value={projectFilter} onChange={setProjectFilter} options={projectOptions} emptyLabel="Tous les projets" />
              <div className="field-note"><strong>{active.length}</strong> réservation(s) active(s)<br /><span>Les libérations sont auditées avec leur motif.</span></div>
              <div className="field-note"><LockKeyhole size={16} aria-hidden="true" /> Les sorties sans réservation respectent également la quantité libre.</div>
            </div>
          </Panel>
          <Panel title="Allocations" subtitle="Une réservation consommée diminue son reste dans la même transaction que la sortie chantier.">
            <DataTable
              rows={reservations}
              empty={<Empty icon={<Boxes size={22} />} title="Aucune réservation" body="Créez une allocation depuis un magasin de chantier pour sécuriser un besoin futur." />}
              columns={[
                { key: "project", header: "Projet", render: (row) => <><strong>{row.projectCode}</strong><small>{row.reason}</small></> },
                { key: "item", header: "Article", render: (row) => `${row.itemCode} — ${row.itemName}` },
                { key: "warehouse", header: "Magasin", render: (row) => row.warehouseCode },
                { key: "quantity", header: "Réservé / reste", align: "right", render: (row) => `${formatQuantity(row.remainingQuantity, 3)} / ${formatQuantity(row.quantity, 3)} ${row.unitCode}` },
                { key: "needed", header: "Besoin", render: (row) => row.neededAt ? formatDate(row.neededAt) : "—" },
                { key: "status", header: "Statut", render: (row) => <StatusChip status={row.status === "ACTIVE" ? "pending" : row.status === "FULFILLED" ? "closed" : "critical"} label={row.status === "ACTIVE" ? "Active" : row.status === "FULFILLED" ? "Consommée" : "Libérée"} /> },
                { key: "actions", header: "", align: "right", render: (row) => row.status === "ACTIVE" && session.can("inventory.reservation.manage") ? <Button variant="ghost" onClick={() => setDialog({ release: row })}><RotateCcw size={14} aria-hidden="true" /> Libérer</Button> : "—" },
              ]}
            />
          </Panel>
          <Panel title="Règle de gestion" subtitle="La date de besoin est informative : aucune expiration automatique ne supprime une allocation.">
            <p className="inline-note"><CalendarClock size={16} aria-hidden="true" /> Les transferts, ajustements et sorties maintenance sont plafonnés par le stock libre. Un inventaire ouvert bloque une nouvelle réservation et une consommation ; la libération explicite reste possible.</p>
          </Panel>
        </div>
      )}
      {dialog === "create" && <ReservationDialog items={items} warehouses={siteWarehouses} projects={projects} saving={mutation.saving} error={mutation.error} onClose={() => setDialog(null)} onSubmit={(input) => done(() => inventoryApi.createReservation(input), "Réservation créée.")} />}
      {dialog && typeof dialog === "object" && <ReleaseDialog reservation={dialog.release} saving={mutation.saving} error={mutation.error} onClose={() => setDialog(null)} onSubmit={(input) => done(() => inventoryApi.releaseReservation(dialog.release.id, input), "Réservation libérée.")} />}
    </>
  );
}

function ReservationDialog({ items, warehouses, projects, saving, error, onClose, onSubmit }: { items: Array<{ id: string; code: string; name: string; unitCode: string; isActive: boolean }>; warehouses: Array<{ id: string; code: string; name: string; projectId: string | null }>; projects: ProjectSummaryView[]; saving: boolean; error: string; onClose: () => void; onSubmit: (input: { projectId: string; itemId: string; warehouseId: string; quantity: string; neededAt?: string; reason: string; idempotencyKey: string }) => void }): React.ReactElement {
  const [values, setValues] = useState({ projectId: "", itemId: "", warehouseId: "", quantity: "", neededAt: "", reason: "" });
  const set = (key: keyof typeof values) => (value: string) => setValues((current) => ({ ...current, [key]: value }));
  const selectedProject = projects.find((project) => project.id === values.projectId);
  const projectWarehouses = warehouses.filter((warehouse) => warehouse.projectId === values.projectId);
  const itemOptions = items.filter((item) => item.isActive).map((item) => ({ value: item.id, label: `${item.code} — ${item.name} (${item.unitCode})` }));
  return <Modal title="Réserver du stock" onClose={onClose} wide><Feedback error={error} /><Form submitLabel="Créer la réservation" saving={saving} onSubmit={() => onSubmit({ projectId: values.projectId, itemId: values.itemId, warehouseId: values.warehouseId, quantity: values.quantity.replace(",", "."), neededAt: values.neededAt || undefined, reason: values.reason, idempotencyKey: newIdempotencyKey("stock-reservation") })}>
    <SelectField label="Projet" value={values.projectId} onChange={set("projectId")} options={projects.map((project) => ({ value: project.id, label: `${project.code} — ${project.name}` }))} required wide />
    <SelectField label="Magasin de chantier" value={values.warehouseId} onChange={set("warehouseId")} options={projectWarehouses.map((warehouse) => ({ value: warehouse.id, label: `${warehouse.code} — ${warehouse.name}` }))} required wide emptyLabel={selectedProject ? "Choisir le magasin du projet" : "Choisir d'abord le projet"} />
    <SelectField label="Article" value={values.itemId} onChange={set("itemId")} options={itemOptions} required wide />
    <DecimalField label="Quantité à réserver" value={values.quantity} onChange={set("quantity")} required hint="Jusqu'à 3 décimales. Le stock physique reste inchangé." />
    <TextField label="Date de besoin" type="date" value={values.neededAt} onChange={set("neededAt")} />
    <TextAreaField label="Motif" value={values.reason} onChange={set("reason")} required wide placeholder="Ex. approvisionnement prévu du lot CVC" />
  </Form></Modal>;
}

function ReleaseDialog({ reservation, saving, error, onClose, onSubmit }: { reservation: StockReservationView; saving: boolean; error: string; onClose: () => void; onSubmit: (input: { reason: string; idempotencyKey: string }) => void }): React.ReactElement {
  const [reason, setReason] = useState("");
  return <Modal title={`Libérer ${reservation.itemCode}`} onClose={onClose}><Feedback error={error} /><p className="inline-note">Reste concerné : <strong>{reservation.remainingQuantity} {reservation.unitCode}</strong>. La libération ne crée aucun mouvement de stock.</p><Form columns={1} submitLabel="Libérer la réservation" saving={saving} onSubmit={() => onSubmit({ reason, idempotencyKey: newIdempotencyKey("stock-release") })}><TextAreaField label="Motif de libération" value={reason} onChange={setReason} required /></Form></Modal>;
}
