"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { FleetVehicleDetailView } from "@axora24/contracts";
import { FilePlus2, Gauge, PauseCircle, PlayCircle } from "lucide-react";
import {
  COMPLIANCE_CHIP,
  COMPLIANCE_LABEL,
  DOCUMENT_KIND_LABEL,
  FUEL_LABEL,
  INCIDENT_KIND_LABEL,
  VEHICLE_KIND_LABEL,
  VEHICLE_STATUS_CHIP,
  VEHICLE_STATUS_LABEL,
  fleetApi,
  usageUnitLabel,
} from "../../../../lib/modules/fleet";
import { assetUrl } from "../../../../lib/api";
import { formatDate, formatDateTime, formatMoney, formatQuantity, todayIso } from "../../../../lib/format";
import { useMutation, useResource } from "../../../../lib/hooks";
import { useSession } from "../../../../lib/session";
import { ActionBar, Button, DataTable, DateField, DecimalField, DetailList, Empty, Feedback, Form, Grid, Loading, Modal, PageHeader, Panel, SelectField, StatusChip, TextAreaField, TextField } from "../../../../components/ui";

type Dialog = "document" | "reading" | "status";

export default function FleetVehiclePage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const session = useSession();
  const mutation = useMutation();
  const resource = useResource(() => fleetApi.vehicle(id), [id]);
  const [override, setOverride] = useState<FleetVehicleDetailView | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const vehicle = override ?? resource.data;

  if (resource.loading && !vehicle) return <Loading label="Chargement du véhicule…" />;
  if (!vehicle) return <Feedback error={resource.error || "Véhicule introuvable."} />;
  const canManage = session.can("fleet.vehicle.manage") && vehicle.status !== "DISPOSED";
  const unit = usageUnitLabel(vehicle.usageUnit);
  const costs = vehicle.costs12m;

  async function apply(action: () => Promise<FleetVehicleDetailView>, success: string): Promise<void> {
    const updated = await mutation.run(action, success);
    if (updated) {
      setOverride(updated);
      setDialog(null);
    }
  }

  return (
    <>
      <PageHeader
        breadcrumb={`Parc / ${vehicle.code}`}
        title={`${vehicle.make} ${vehicle.model}`}
        subtitle={`${vehicle.code} · ${vehicle.registration ?? vehicle.category} · ${VEHICLE_KIND_LABEL[vehicle.kind]} · ${vehicle.homeBase}`}
        onRefresh={() => {
          setOverride(null);
          void resource.reload();
        }}
        actions={<StatusChip status={VEHICLE_STATUS_CHIP[vehicle.status] ?? "planned"} label={VEHICLE_STATUS_LABEL[vehicle.status]} />}
      />
      <Feedback error={mutation.error} notice={mutation.notice} />
      {canManage && (
        <ActionBar note="Compteurs, pleins et pièces sont conservés en historique (append-only).">
          <Button onClick={() => setDialog("reading")}>
            <Gauge size={15} aria-hidden="true" /> Relevé compteur
          </Button>
          <Button onClick={() => setDialog("document")}>
            <FilePlus2 size={15} aria-hidden="true" /> Pièce réglementaire
          </Button>
          <Button variant={vehicle.status === "ACTIVE" ? "danger" : "secondary"} onClick={() => setDialog("status")}>
            {vehicle.status === "ACTIVE" ? <PauseCircle size={15} aria-hidden="true" /> : <PlayCircle size={15} aria-hidden="true" />} {vehicle.status === "ACTIVE" ? "Immobiliser / céder" : "Remettre en service"}
          </Button>
        </ActionBar>
      )}
      <div className="stack">
        <Grid>
          <Panel title="Fiche">
            <DetailList
              items={[
                { label: "Compteur", value: vehicle.lastReading ? `${formatQuantity(vehicle.lastReading, vehicle.usageUnit === "KM" ? 0 : 1)} ${unit} · ${formatDateTime(vehicle.lastReadingAt)}` : "—" },
                { label: "Affecté à", value: vehicle.currentAssignment ? `${vehicle.currentAssignment.employeeName} (${vehicle.currentAssignment.code})` : "Disponible" },
                { label: "Habilitation exigée", value: vehicle.requiredLicence ?? "Aucune" },
                { label: "Énergie", value: FUEL_LABEL[vehicle.fuelType] },
                { label: "Passeport GMAO", value: <Link href={`/assets/${vehicle.assetId}`}>{vehicle.assetCode}</Link> },
                { label: "OT GMAO ouverts", value: String(vehicle.openWorkOrders) },
                { label: "Acquisition", value: `${formatDate(vehicle.acquisitionDate)}${vehicle.acquisitionCost ? ` · ${formatMoney(vehicle.acquisitionCost, costs.currency)}` : ""}` },
                { label: "N° de série", value: vehicle.serialNumber ?? "—" },
              ]}
            />
          </Panel>
          <Panel title="Coût de possession — 12 mois" subtitle="Carburant + maintenance GMAO + pièces réglementaires + incidents.">
            <DetailList
              items={[
                { label: "Carburant", value: formatMoney(costs.fuel, costs.currency) },
                { label: "Maintenance (GMAO)", value: formatMoney(costs.maintenance, costs.currency) },
                { label: "Assurances et contrôles", value: formatMoney(costs.documents, costs.currency) },
                { label: "Incidents", value: formatMoney(costs.incidents, costs.currency) },
                { label: "Total", value: <strong>{formatMoney(costs.total, costs.currency)}</strong> },
                { label: `Usage mesuré`, value: costs.usage === null ? "—" : `${formatQuantity(costs.usage, 0)} ${unit}` },
                { label: `Coût par ${unit}`, value: costs.perUnit === null ? "Non calculable (usage nul)" : `${formatMoney(costs.perUnit, costs.currency)}` },
                { label: "Consommation", value: vehicle.consumption.value === null ? "—" : `${vehicle.consumption.value.replace(".", ",")} ${vehicle.consumption.unit}` },
              ]}
            />
            <p className="panel-note" style={{ color: "#667085" }}>
              {vehicle.consumption.note}
            </p>
          </Panel>
        </Grid>
        <Panel className="compact" title="Conformité réglementaire" subtitle="Une pièce obligatoire échue ou absente bloque toute nouvelle affectation.">
          <DataTable
            rows={vehicle.compliance.map((item) => ({ ...item, id: item.kind }))}
            empty={<Empty icon={<FilePlus2 size={22} />} title="Aucune pièce" body="—" />}
            columns={[
              { key: "kind", header: "Pièce", render: (item) => <strong>{DOCUMENT_KIND_LABEL[item.kind]}{item.required ? "" : " (facultative)"}</strong> },
              { key: "state", header: "État", render: (item) => <StatusChip status={COMPLIANCE_CHIP[item.state] ?? "warning"} label={COMPLIANCE_LABEL[item.state]} /> },
              { key: "until", header: "Validité", render: (item) => (item.validUntil ? `jusqu'au ${formatDate(item.validUntil)}` : "—") },
              { key: "ref", header: "Référence", render: (item) => item.reference ?? "—" },
            ]}
          />
        </Panel>
        <Panel title="Historique des pièces">
          <DataTable
            rows={vehicle.documents}
            empty={<Empty icon={<FilePlus2 size={22} />} title="Aucune pièce enregistrée" body="Assurance, carte grise, contrôle technique ou VGP." />}
            columns={[
              { key: "kind", header: "Pièce", render: (document) => DOCUMENT_KIND_LABEL[document.kind] },
              { key: "ref", header: "Référence", render: (document) => (document.fileUrl ? <a href={assetUrl(document.fileUrl)} target="_blank" rel="noreferrer">{document.reference}</a> : document.reference) },
              { key: "issuer", header: "Émetteur", render: (document) => document.issuer ?? "—" },
              { key: "validity", header: "Validité", render: (document) => `${formatDate(document.validFrom)} → ${formatDate(document.validUntil)}` },
              { key: "cost", header: "Coût", align: "right", render: (document) => (document.cost ? formatMoney(document.cost, costs.currency) : "—") },
            ]}
          />
        </Panel>
        <Grid>
          <Panel className="compact" title="Affectations">
            <DataTable
              rows={vehicle.assignments}
              empty={<Empty icon={<Gauge size={22} />} title="Aucune affectation" body="—" />}
              columns={[
                {
                  key: "driver",
                  header: "Chauffeur",
                  render: (assignment) => (
                    <>
                      <strong>{assignment.employeeName}</strong>
                      <small>
                        {assignment.code}
                        {assignment.projectCode ? ` · ${assignment.projectCode}` : ""} · {assignment.purpose}
                      </small>
                    </>
                  ),
                },
                { key: "period", header: "Période", render: (assignment) => `${formatDate(assignment.startAt)} → ${assignment.endAt ? formatDate(assignment.endAt) : "en cours"}` },
                { key: "usage", header: "Usage", align: "right", render: (assignment) => (assignment.usage === null ? "—" : `${formatQuantity(assignment.usage, 0)} ${unit}`) },
              ]}
            />
          </Panel>
          <Panel className="compact" title="Relevés compteur">
            <DataTable
              rows={vehicle.readings.map((reading) => ({ ...reading, id: `${reading.readAt}-${reading.value}` }))}
              empty={<Empty icon={<Gauge size={22} />} title="Aucun relevé" body="—" />}
              columns={[
                { key: "at", header: "Date", render: (reading) => formatDateTime(reading.readAt) },
                { key: "value", header: "Valeur", align: "right", render: (reading) => `${formatQuantity(reading.value, vehicle.usageUnit === "KM" ? 0 : 1)} ${unit}` },
                { key: "source", header: "Origine", render: (reading) => ({ MANUAL: "Relevé", FUEL: "Plein", ASSIGNMENT_START: "Départ", ASSIGNMENT_END: "Retour", INCIDENT: "Incident" })[reading.source] ?? reading.source },
              ]}
            />
          </Panel>
        </Grid>
        <Panel title="Pleins">
          <DataTable
            rows={vehicle.fuelLogs}
            empty={<Empty icon={<Gauge size={22} />} title="Aucun plein" body="—" />}
            columns={[
              { key: "at", header: "Date", render: (log) => formatDateTime(log.filledAt) },
              { key: "liters", header: "Litres", align: "right", render: (log) => `${formatQuantity(log.liters, 2)} L${log.fullTank ? " · plein" : ""}` },
              { key: "reading", header: "Compteur", align: "right", render: (log) => formatQuantity(log.reading, 0) },
              { key: "cost", header: "Montant", align: "right", render: (log) => formatMoney(log.totalCost, costs.currency) },
              { key: "project", header: "Projet", render: (log) => log.projectCode ?? "—" },
              { key: "by", header: "Saisi par", render: (log) => log.recordedByName },
            ]}
          />
        </Panel>
        <Panel title="Incidents">
          <DataTable
            rows={vehicle.incidents}
            empty={<Empty icon={<Gauge size={22} />} title="Aucun incident" body="—" />}
            columns={[
              {
                key: "incident",
                header: "Incident",
                render: (incident) => (
                  <>
                    <strong>
                      {INCIDENT_KIND_LABEL[incident.kind]} · {incident.code}
                    </strong>
                    <small>{incident.description}</small>
                  </>
                ),
              },
              { key: "at", header: "Survenu", render: (incident) => formatDateTime(incident.occurredAt) },
              { key: "driver", header: "Conducteur", render: (incident) => incident.driverName ?? "Non affecté" },
              { key: "ticket", header: "GMAO", render: (incident) => incident.maintenanceTicketCode ?? "—" },
              { key: "status", header: "État", render: (incident) => <StatusChip status={incident.status === "OPEN" ? "pending" : "closed"} label={incident.status === "OPEN" ? "Ouvert" : `Clos${incident.cost ? ` · ${formatMoney(incident.cost, costs.currency)}` : ""}`} /> },
            ]}
          />
        </Panel>
      </div>

      {dialog === "reading" && (
        <Modal title="Relevé compteur" onClose={() => setDialog(null)}>
          <Feedback error={mutation.error} />
          <ReadingForm unit={unit} last={vehicle.lastReading} saving={mutation.saving} onSubmit={(value) => apply(() => fleetApi.addReading(id, value), "Relevé enregistré.")} />
        </Modal>
      )}
      {dialog === "document" && (
        <Modal title="Pièce réglementaire" onClose={() => setDialog(null)}>
          <Feedback error={mutation.error} />
          <DocumentForm saving={mutation.saving} onSubmit={(input) => apply(() => fleetApi.addDocument(id, input), "Pièce enregistrée.")} />
        </Modal>
      )}
      {dialog === "status" && (
        <Modal title="Changer l'état" onClose={() => setDialog(null)}>
          <Feedback error={mutation.error} />
          <StatusForm current={vehicle.status} saving={mutation.saving} onSubmit={(status, reason) => apply(() => fleetApi.setStatus(id, status, reason), "État mis à jour (répercuté sur le passeport GMAO).")} />
        </Modal>
      )}
    </>
  );
}

function ReadingForm({ unit, last, saving, onSubmit }: { unit: string; last: string | null; saving: boolean; onSubmit: (value: string) => Promise<void> }): React.ReactElement {
  const [value, setValue] = useState("");
  return (
    <Form columns={1} submitLabel="Enregistrer" saving={saving} onSubmit={() => onSubmit(value)}>
      <DecimalField label={`Compteur (${unit})`} value={value} onChange={setValue} required hint={last ? `Dernier relevé : ${last} — un compteur ne recule jamais.` : undefined} />
    </Form>
  );
}

function DocumentForm({ saving, onSubmit }: { saving: boolean; onSubmit: (input: Record<string, unknown>) => Promise<void> }): React.ReactElement {
  const [form, setForm] = useState({ kind: "INSURANCE", reference: "", issuer: "", validFrom: todayIso(), validUntil: "", cost: "" });
  const set = (key: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));
  return (
    <Form submitLabel="Enregistrer" saving={saving} onSubmit={() => onSubmit({ ...form, issuer: form.issuer || undefined, cost: form.cost || undefined })}>
      <SelectField label="Pièce" value={form.kind} onChange={set("kind")} options={Object.entries(DOCUMENT_KIND_LABEL).map(([value, label]) => ({ value, label }))} required />
      <TextField label="Référence" value={form.reference} onChange={set("reference")} required />
      <TextField label="Émetteur" value={form.issuer} onChange={set("issuer")} />
      <DecimalField label="Coût" value={form.cost} onChange={set("cost")} />
      <DateField label="Valide du" value={form.validFrom} onChange={set("validFrom")} required />
      <DateField label="Valide jusqu'au" value={form.validUntil} onChange={set("validUntil")} required />
    </Form>
  );
}

function StatusForm({ current, saving, onSubmit }: { current: string; saving: boolean; onSubmit: (status: string, reason: string) => Promise<void> }): React.ReactElement {
  const [status, setStatus] = useState(current === "ACTIVE" ? "IMMOBILIZED" : "ACTIVE");
  const [reason, setReason] = useState("");
  return (
    <Form columns={1} submitLabel="Valider" saving={saving} onSubmit={() => onSubmit(status, reason)}>
      <SelectField label="Nouvel état" value={status} onChange={setStatus} options={Object.entries(VEHICLE_STATUS_LABEL).filter(([value]) => value !== current).map(([value, label]) => ({ value, label }))} required />
      <TextAreaField label="Motif" value={reason} onChange={setReason} required />
    </Form>
  );
}
