"use client";
import React, { useState } from "react";
import Link from "next/link";
import type { ProjectWbsNodeView } from "@axora24/contracts";
import { projectsApi } from "../lib/modules/projects";
import { TIMESHEET_STATUS_LABEL } from "../lib/modules/hr";
import { formatDate, formatMoney, formatQuantity } from "../lib/format";
import { useResource } from "../lib/hooks";
import { Button, DataTable, DataUnavailable, DateField, DetailList, Empty, Feedback, Form, Loading, Panel, StatusChip } from "./ui";
import { FileDownloadButton } from "./file-download-button";

const DAY = 86_400_000;
const utcDateTime = (date: string | null): string => date ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "UTC" }).format(new Date(date)) : "—";
const workedHours = (minutes: number): string => `${(minutes / 60).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} h`;
function initialPeriod(): { from: string; to: string } { const today = new Date(); const end = today.toISOString().slice(0, 10); return { from: new Date(Date.parse(`${end}T00:00:00Z`) - 6 * DAY).toISOString().slice(0, 10), to: end }; }

export function ProjectOperations({ projectId, wbs }: { projectId: string; wbs: ProjectWbsNodeView[] }): React.ReactElement {
  const [period, setPeriod] = useState(initialPeriod);
  const [draft, setDraft] = useState(period);
  const [filterError, setFilterError] = useState("");
  const [downloadError, setDownloadError] = useState("");
  const resource = useResource(() => projectsApi.operations(projectId, period), [projectId, period.from, period.to]);
  const operations = resource.data;
  const wbsLabel = (id: string | null): string => { const node = wbs.find(item => item.id === id); return node ? `${node.code} · ${node.name}` : "—"; };
  function applyPeriod(): void { const days = (Date.parse(`${draft.to}T00:00:00Z`) - Date.parse(`${draft.from}T00:00:00Z`)) / DAY + 1; if (!Number.isFinite(days) || days < 1 || days > 31) { setFilterError("Choisissez une période de 1 à 31 jours, avec la fin après le début."); return; } setFilterError(""); setPeriod({ ...draft }); }
  return <div className="stack project-operations">
    <Panel title="Opérations chantier" subtitle="Présence, heures déclarées, matériaux et équipement issus des opérations enregistrées" actions={<Button disabled={resource.loading} onClick={() => void resource.reload()}>Actualiser</Button>}>
      <Feedback error={filterError || downloadError} />
      <Form columns={2} submitLabel="Afficher la période" saving={resource.loading} onSubmit={applyPeriod}>
        <DateField label="Du" value={draft.from} onChange={from => setDraft(current => ({ ...current, from }))} required />
        <DateField label="Au" value={draft.to} onChange={to => setDraft(current => ({ ...current, to }))} required />
      </Form>
      <p className="inline-note">La période utilise les dates UTC et couvre au maximum 31 jours. Les stocks de chantier indiquent le solde actuel, indépendamment de cette période.</p>
    </Panel>
    {!operations ? resource.loading ? <Loading label="Chargement des opérations…" /> : <DataUnavailable title="Opérations indisponibles" error={resource.error || "Les opérations n’ont pas pu être chargées."} onRetry={() => void resource.reload()} /> : <>
      <Feedback error={resource.error} />
      <Panel title={`Coûts du ${formatDate(operations.from)} au ${formatDate(operations.to)}`} subtitle="Coûts enregistrés sur la période sélectionnée" actions={<FileDownloadButton path={`/projects/${projectId}/operations/export.pdf?from=${operations.from}&to=${operations.to}`} filename={`operations-${projectId}-${operations.from}.pdf`} onError={setDownloadError}>Rapport chantier / PDF</FileDownloadButton>}>
        <DetailList items={[
          { label: "Matériaux consommés", value: operations.costs.materials.amount === null ? "Indisponible" : formatMoney(operations.costs.materials.amount, operations.currency) },
          { label: "Main-d’œuvre validée", value: operations.costs.labor.amount === null ? "Indisponible" : formatMoney(operations.costs.labor.amount, operations.currency) },
          { label: "Sous-traitance", value: operations.costs.subcontract.amount === null ? "Indisponible" : formatMoney(operations.costs.subcontract.amount, operations.currency) },
          { label: "Réceptions directes", value: operations.costs.directReceipts.amount === null ? "Indisponible" : formatMoney(operations.costs.directReceipts.amount, operations.currency) },
          { label: "Total des coûts", value: operations.costs.total.amount === null ? <StatusChip status="warning" label="Total indisponible" /> : <strong>{formatMoney(operations.costs.total.amount, operations.currency)}</strong> },
        ]} />
        {operations.costs.total.amount === null && <p className="inline-note">Le total reste indisponible si une source manque, si une permission est requise ou si les devises sont incompatibles.</p>}
      </Panel>
      <Panel title="Présence du personnel" subtitle="Paires Entrée / Sortie du chantier ; heures affichées en UTC" actions={operations.actions.recordAttendance && <Link className="btn btn-secondary" href="/hr">Enregistrer un pointage</Link>}>
        {operations.attendance === null ? <p className="inline-note">L’accès aux pointages du personnel nécessite les permissions RH correspondantes.</p> : <><DetailList items={[{ label: "Salariés pointés", value: String(operations.attendance.summary.employeeCount) }, { label: "Temps pointé", value: workedHours(operations.attendance.summary.workedMinutes) }, { label: "Entrées sans sortie", value: String(operations.attendance.summary.openIntervals) }]} />
          <DataTable rows={operations.attendance.rows.map((row, index) => ({ ...row, id: `${row.employeeId}-${row.clockInAt}-${index}` }))} empty={<Empty title="Aucun pointage sur cette période" />} columns={[
            { key: "employee", header: "Salarié", render: row => <><strong>{row.employeeName}</strong><small>{row.employeeCode}</small></> },
            { key: "in", header: "Entrée UTC", render: row => utcDateTime(row.clockInAt) },
            { key: "out", header: "Sortie UTC", render: row => utcDateTime(row.clockOutAt) },
            { key: "hours", header: "Durée", align: "right", render: row => workedHours(row.minutes) },
            { key: "state", header: "Contrôle", render: row => row.open || row.anomalies.length ? <StatusChip status="warning" label={row.open ? "Sortie manquante" : "Pointages à vérifier"} /> : <StatusChip status="verified" label="Paire complète" /> },
          ]} /></>}
      </Panel>
      <Panel title="Feuilles de temps du chantier" subtitle="Seules les heures validées participent au coût de main-d’œuvre" actions={operations.actions.manageTimesheets && <Link className="btn btn-secondary" href="/hr">Gérer les feuilles de temps</Link>}>
        {operations.timesheets === null ? <p className="inline-note">L’accès aux feuilles de temps nécessite les permissions RH correspondantes.</p> : <><DetailList items={[{ label: "Heures validées", value: `${operations.timesheets.validatedHours} h` }, { label: "Coût validé", value: operations.timesheets.validatedCost === null ? "Accès au coût salarial requis" : formatMoney(operations.timesheets.validatedCost, operations.currency) }]} /><DataTable rows={operations.timesheets.rows} empty={<Empty title="Aucune heure imputée sur cette période" />} columns={[
          { key: "employee", header: "Salarié", render: row => <><strong>{row.employeeName}</strong><small>{row.employeeCode}</small></> },
          { key: "date", header: "Jour UTC", render: row => formatDate(row.date) },
          { key: "hours", header: "Heures", align: "right", render: row => `${row.hours} h` },
          { key: "wbs", header: "Élément WBS", render: row => wbsLabel(row.wbsItemId) },
          { key: "state", header: "Statut", render: row => <StatusChip status={row.status === "SUBMITTED" ? "pending" : row.status} label={TIMESHEET_STATUS_LABEL[row.status]} /> },
          { key: "cost", header: "Coût validé", align: "right", render: row => row.costAmount === null ? "—" : formatMoney(row.costAmount, operations.currency) },
        ]} /></>}
      </Panel>
      <Panel title="Matériaux consommés et retours" subtitle="Mouvements du chantier sur la période sélectionnée" actions={operations.actions.recordStockMovement && <Link className="btn btn-secondary" href="/inventory">Enregistrer un mouvement</Link>}>
        {operations.materials === null ? <p className="inline-note">L’accès aux matériaux nécessite les permissions de stock correspondantes.</p> : <><p className="panel-note">Coût net des matériaux : <strong>{formatMoney(operations.materials.netCost, operations.currency)}</strong></p><DataTable rows={operations.materials.rows} empty={<Empty title="Aucun mouvement de matériaux sur cette période" />} columns={[
          { key: "item", header: "Article", render: row => <><strong>{row.itemName}</strong><small>{row.itemCode}</small></> },
          { key: "date", header: "Date UTC", render: row => utcDateTime(row.date) },
          { key: "type", header: "Mouvement", render: row => <StatusChip status={row.type === "ISSUE" ? "active" : "draft"} label={row.type === "ISSUE" ? "Consommation" : "Retour"} /> },
          { key: "quantity", header: "Variation", align: "right", render: row => `${formatQuantity(row.quantityDelta, 3)} ${row.unitCode}` },
          { key: "warehouse", header: "Dépôt", render: row => row.warehouseName },
          { key: "wbs", header: "Élément WBS", render: row => wbsLabel(row.wbsItemId) },
          { key: "cost", header: "Coût", align: "right", render: row => formatMoney(row.valueDelta, operations.currency) },
        ]} /><h3>Stock actuel sur chantier</h3><p className="inline-note">Solde au {utcDateTime(operations.materials.balancesAsOf)} UTC.</p><DataTable rows={operations.materials.siteBalances.map(row => ({ ...row, id: `${row.warehouseId}-${row.itemId}` }))} empty={<Empty title="Aucun stock de chantier" />} columns={[
          { key: "item", header: "Article", render: row => <><strong>{row.itemName}</strong><small>{row.itemCode}</small></> },
          { key: "warehouse", header: "Dépôt", render: row => row.warehouseName },
          { key: "quantity", header: "Quantité", align: "right", render: row => `${formatQuantity(row.quantity, 3)} ${row.unitCode}` },
          { key: "value", header: "Valeur", align: "right", render: row => formatMoney(row.value, operations.currency) },
        ]} /></>}
      </Panel>
      <Panel title="Véhicules affectés au chantier" subtitle="Affectations enregistrées qui recouvrent la période sélectionnée" actions={operations.actions.manageFleetAssignments && <Link className="btn btn-secondary" href="/fleet">Gérer les affectations</Link>}>
        {!operations.equipment || operations.equipment.fleetAssignments === null ? <p className="inline-note">L’accès aux affectations nécessite les permissions de flotte correspondantes.</p> : <DataTable rows={operations.equipment.fleetAssignments} empty={<Empty title="Aucun véhicule affecté sur cette période" />} columns={[
          { key: "vehicle", header: "Véhicule", render: row => <><strong>{row.name}</strong><small>{row.code}</small></> },
          { key: "employee", header: "Conducteur", render: row => row.employeeName ?? "—" },
          { key: "start", header: "Début UTC", render: row => utcDateTime(row.startAt) },
          { key: "end", header: "Fin UTC", render: row => utcDateTime(row.endAt) },
          { key: "purpose", header: "Objet", render: row => row.purpose },
        ]} />}
      </Panel>
      <Panel title="Immobilisations issues du projet" subtitle="Origine de mise en service enregistrée ; cet inventaire décrit les biens issus du projet">
        {!operations.equipment || operations.equipment.assets === null ? <p className="inline-note">L’accès aux immobilisations nécessite les permissions correspondantes.</p> : <DataTable rows={operations.equipment.assets} empty={<Empty title="Aucune immobilisation issue de ce projet" />} columns={[
          { key: "asset", header: "Bien", render: row => <><strong>{row.name}</strong><small>{row.code}</small></> },
          { key: "location", header: "Localisation enregistrée", render: row => row.location },
          { key: "state", header: "Statut", render: row => <StatusChip status={row.status === "IN_SERVICE" ? "active" : "closed"} label={row.status === "IN_SERVICE" ? "En service" : row.status === "OUT_OF_SERVICE" ? "Hors service" : "Sortie du patrimoine"} /> },
        ]} />}
      </Panel>
    </>}
  </div>;
}
