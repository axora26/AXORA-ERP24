"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import type { FleetAssignmentView, FleetIncidentView } from "@axora24/contracts";
import { AlertOctagon, Fuel, KeyRound, Plus, ShieldAlert, Truck } from "lucide-react";
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
} from "../../lib/modules/fleet";
import { hrApi } from "../../lib/modules/hr";
import { projectsApi } from "../../lib/modules/projects";
import { formatDateTime, formatMoney, formatQuantity, todayIso } from "../../lib/format";
import { useMutation, useResource } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import { Button, DataTable, DateField, DecimalField, Empty, Feedback, Form, Loading, Metric, Metrics, Modal, PageHeader, Panel, SelectField, StatusChip, Tabs, TextAreaField, TextField, Toggle } from "../../components/ui";

type TabId = "vehicles" | "assignments" | "fuel" | "incidents" | "projects";
type Dialog = "vehicle" | "assign" | "fuel" | "incident";

export default function FleetPage(): React.ReactElement {
  const session = useSession();
  const router = useRouter();
  const mutation = useMutation();
  const [tab, setTab] = useState<TabId>("vehicles");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [closing, setClosing] = useState<FleetAssignmentView | null>(null);
  const [closingIncident, setClosingIncident] = useState<FleetIncidentView | null>(null);
  const data = useResource(() => Promise.all([fleetApi.summary(), fleetApi.vehicles(), fleetApi.assignments(), fleetApi.fuel(), fleetApi.incidents("ALL"), fleetApi.projectCosts()]));
  const [summary, vehicles, assignments, fuel, incidents, projectCosts] = data.data ?? [null, [], [], [], [], []];
  const needsPeople = dialog === "assign";
  const employees = useResource(() => (needsPeople && session.can("hr.employee.read") ? hrApi.employees() : Promise.resolve([])), [needsPeople]);
  const projects = useResource(() => ((dialog === "assign" || dialog === "fuel") && session.can("projects.project.read") ? projectsApi.list() : Promise.resolve([])), [dialog]);
  const vehicleOptions = vehicles.filter((vehicle) => vehicle.status !== "DISPOSED").map((vehicle) => ({ value: vehicle.id, label: `${vehicle.code} — ${vehicle.make} ${vehicle.model}${vehicle.registration ? ` · ${vehicle.registration}` : ""}` }));
  const projectOptions = (projects.data ?? []).map((project) => ({ value: project.id, label: `${project.code} — ${project.name}` }));
  const currency = summary?.currency;

  async function done(action: () => Promise<unknown>, success: string): Promise<void> {
    const result = await mutation.run(action, success);
    if (result !== undefined) {
      setDialog(null);
      setClosing(null);
      setClosingIncident(null);
      await data.reload();
    }
  }

  return (
    <>
      <PageHeader
        breadcrumb="Exploitation / Parc"
        title="Parc véhicules & engins"
        subtitle="Affectations aux chauffeurs habilités, compteurs et carburant tracés, échéances réglementaires, incidents — la maintenance passe par la GMAO."
        onRefresh={() => void data.reload()}
        actions={
          <>
            {session.can("fleet.incident.report") && (
              <Button variant="danger" onClick={() => setDialog("incident")} disabled={vehicleOptions.length === 0}>
                <AlertOctagon size={15} aria-hidden="true" /> Incident
              </Button>
            )}
            {session.can("fleet.fuel.record") && (
              <Button onClick={() => setDialog("fuel")} disabled={vehicleOptions.length === 0}>
                <Fuel size={15} aria-hidden="true" /> Plein
              </Button>
            )}
            {session.can("fleet.assignment.manage") && (
              <Button onClick={() => setDialog("assign")} disabled={vehicleOptions.length === 0}>
                <KeyRound size={15} aria-hidden="true" /> Affecter
              </Button>
            )}
            {session.can("fleet.vehicle.manage") && (
              <Button variant="primary" onClick={() => setDialog("vehicle")}>
                <Plus size={15} aria-hidden="true" /> Mise au parc
              </Button>
            )}
          </>
        }
      />
      <Feedback error={data.error || mutation.error} notice={mutation.notice} />
      {data.loading && !data.data ? (
        <Loading label="Chargement du parc…" />
      ) : (
        <>
          {summary && (
            <Metrics label="Indicateurs du parc">
              <Metric icon={<Truck size={20} />} tone="blue" label="Véhicules et engins" value={String(summary.vehicles)} detail={`${summary.assigned} affecté(s) · ${summary.immobilized} immobilisé(s)`} />
              <Metric icon={<ShieldAlert size={20} />} tone={summary.complianceIssues > 0 ? "red" : "green"} label="Conformité réglementaire" value={String(summary.complianceIssues)} detail="Équipement(s) avec pièce échue, absente ou < 30 j" />
              <Metric icon={<AlertOctagon size={20} />} tone={summary.openIncidents > 0 ? "amber" : "green"} label="Incidents ouverts" value={String(summary.openIncidents)} detail="Pannes, accidents, dommages, amendes" />
              <Metric icon={<Fuel size={20} />} tone="violet" label="Carburant 30 j" value={formatMoney(summary.fuelCost30d, summary.currency)} detail="Pleins enregistrés" />
            </Metrics>
          )}
          <Tabs
            tabs={[
              { id: "vehicles", label: "Véhicules", count: vehicles.length },
              { id: "assignments", label: "Affectations", count: assignments.length },
              { id: "fuel", label: "Carburant", count: fuel.length },
              { id: "incidents", label: "Incidents", count: incidents.filter((incident) => incident.status === "OPEN").length },
              { id: "projects", label: "Imputation projets", count: projectCosts.length },
            ]}
            active={tab}
            onChange={setTab}
          />
          <div className="stack">
            {tab === "vehicles" && (
              <Panel title="Véhicules et engins">
                <DataTable
                  rows={vehicles}
                  onRowClick={(vehicle) => router.push(`/fleet/vehicles/${vehicle.id}`)}
                  empty={<Empty icon={<Truck size={22} />} title="Aucun véhicule" body="La mise au parc crée aussi le passeport GMAO de l'équipement." />}
                  columns={[
                    {
                      key: "vehicle",
                      header: "Équipement",
                      render: (vehicle) => (
                        <>
                          <strong>
                            {vehicle.make} {vehicle.model}
                          </strong>
                          <small>
                            {vehicle.code} · {vehicle.registration ?? vehicle.category} · {VEHICLE_KIND_LABEL[vehicle.kind]}
                          </small>
                        </>
                      ),
                    },
                    { key: "status", header: "État", render: (vehicle) => <StatusChip status={VEHICLE_STATUS_CHIP[vehicle.status] ?? "planned"} label={VEHICLE_STATUS_LABEL[vehicle.status]} /> },
                    { key: "driver", header: "Affecté à", render: (vehicle) => (vehicle.currentAssignment ? `${vehicle.currentAssignment.employeeName}${vehicle.currentAssignment.projectCode ? ` · ${vehicle.currentAssignment.projectCode}` : ""}` : "Disponible") },
                    { key: "reading", header: "Compteur", align: "right", render: (vehicle) => (vehicle.lastReading ? `${formatQuantity(vehicle.lastReading, vehicle.usageUnit === "KM" ? 0 : 1)} ${usageUnitLabel(vehicle.usageUnit)}` : "—") },
                    {
                      key: "compliance",
                      header: "Conformité",
                      render: (vehicle) => {
                        const worst = vehicle.compliance.filter((item) => item.required).sort((a, b) => ["EXPIRED", "MISSING", "EXPIRING", "VALID"].indexOf(a.state) - ["EXPIRED", "MISSING", "EXPIRING", "VALID"].indexOf(b.state))[0];
                        return worst ? <StatusChip status={COMPLIANCE_CHIP[worst.state] ?? "warning"} label={worst.state === "VALID" ? "À jour" : `${DOCUMENT_KIND_LABEL[worst.kind]} : ${COMPLIANCE_LABEL[worst.state]}`} /> : "—";
                      },
                    },
                    { key: "wo", header: "OT GMAO", align: "right", render: (vehicle) => String(vehicle.openWorkOrders) },
                  ]}
                />
              </Panel>
            )}
            {tab === "assignments" && (
              <Panel title="Affectations en cours" subtitle="Chauffeur actif et habilité, véhicule en règle : contrôlé à l'ouverture.">
                <DataTable
                  rows={assignments}
                  empty={<Empty icon={<KeyRound size={22} />} title="Aucune affectation en cours" body="Affectez un véhicule à un chauffeur habilité." />}
                  columns={[
                    {
                      key: "vehicle",
                      header: "Véhicule",
                      render: (assignment) => (
                        <>
                          <strong>{assignment.vehicleLabel}</strong>
                          <small>
                            {assignment.code} · {assignment.vehicleCode}
                          </small>
                        </>
                      ),
                    },
                    { key: "driver", header: "Chauffeur", render: (assignment) => assignment.employeeName },
                    { key: "project", header: "Projet", render: (assignment) => assignment.projectCode ?? "—" },
                    { key: "since", header: "Depuis", render: (assignment) => `${formatDateTime(assignment.startAt)} · ${formatQuantity(assignment.startReading, 0)}` },
                    {
                      key: "close",
                      header: "",
                      render: (assignment) =>
                        session.can("fleet.assignment.manage") ? (
                          <Button onClick={() => setClosing(assignment)}>Restituer</Button>
                        ) : null,
                    },
                  ]}
                />
              </Panel>
            )}
            {tab === "fuel" && (
              <Panel title="Pleins de carburant" subtitle="Chaque plein enregistre aussi le relevé compteur ; imputation par défaut au projet de l'affectation.">
                <DataTable
                  rows={fuel}
                  onRowClick={(log) => router.push(`/fleet/vehicles/${log.vehicleId}`)}
                  empty={<Empty icon={<Fuel size={22} />} title="Aucun plein" body="Les pleins alimentent la consommation plein à plein et les coûts." />}
                  columns={[
                    { key: "vehicle", header: "Véhicule", render: (log) => <strong>{log.vehicleCode}</strong> },
                    { key: "at", header: "Date", render: (log) => formatDateTime(log.filledAt) },
                    { key: "liters", header: "Litres", align: "right", render: (log) => `${formatQuantity(log.liters, 2)} L${log.fullTank ? " · plein" : ""}` },
                    { key: "cost", header: "Montant", align: "right", render: (log) => formatMoney(log.totalCost, currency) },
                    { key: "reading", header: "Compteur", align: "right", render: (log) => formatQuantity(log.reading, 0) },
                    { key: "project", header: "Projet", render: (log) => log.projectCode ?? "—" },
                  ]}
                />
              </Panel>
            )}
            {tab === "incidents" && (
              <Panel title="Incidents" subtitle="Conducteur déduit de l'affectation en cours au moment des faits ; une panne ouvre un ticket GMAO.">
                <DataTable
                  rows={incidents}
                  onRowClick={(incident) => router.push(`/fleet/vehicles/${incident.vehicleId}`)}
                  empty={<Empty icon={<AlertOctagon size={22} />} title="Aucun incident" body="—" />}
                  columns={[
                    {
                      key: "incident",
                      header: "Incident",
                      render: (incident) => (
                        <>
                          <strong>
                            {INCIDENT_KIND_LABEL[incident.kind]} — {incident.vehicleCode}
                          </strong>
                          <small>
                            {incident.code} · {incident.description}
                          </small>
                        </>
                      ),
                    },
                    { key: "at", header: "Survenu", render: (incident) => formatDateTime(incident.occurredAt) },
                    { key: "driver", header: "Conducteur", render: (incident) => incident.driverName ?? "Non affecté" },
                    { key: "ticket", header: "GMAO", render: (incident) => incident.maintenanceTicketCode ?? "—" },
                    { key: "status", header: "État", render: (incident) => <StatusChip status={incident.status === "OPEN" ? "pending" : "closed"} label={incident.status === "OPEN" ? "Ouvert" : "Clos"} /> },
                    {
                      key: "close",
                      header: "",
                      render: (incident) => (incident.status === "OPEN" && session.can("fleet.incident.report") ? <Button onClick={() => setClosingIncident(incident)}>Clore</Button> : null),
                    },
                  ]}
                />
              </Panel>
            )}
            {tab === "projects" && (
              <Panel title="Carburant imputé par projet" subtitle="Imputation portée par les pleins ; elle n'est pas ajoutée au consommé projet pour éviter un double compte avec la facture du pétrolier.">
                <DataTable
                  rows={projectCosts.map((row) => ({ ...row, id: row.projectId }))}
                  onRowClick={(row) => router.push(`/projects/${row.projectId}`)}
                  empty={<Empty icon={<Fuel size={22} />} title="Aucune imputation" body="Les pleins pendant une affectation projet y sont imputés." />}
                  columns={[
                    { key: "project", header: "Projet", render: (row) => <strong>{row.projectCode}</strong> },
                    { key: "fills", header: "Pleins", align: "right", render: (row) => String(row.fills) },
                    { key: "liters", header: "Litres", align: "right", render: (row) => formatQuantity(row.liters, 1) },
                    { key: "cost", header: "Montant", align: "right", render: (row) => formatMoney(row.fuelCost, currency) },
                  ]}
                />
              </Panel>
            )}
          </div>
        </>
      )}

      {dialog === "vehicle" && (
        <Modal title="Mise au parc" onClose={() => setDialog(null)}>
          <Feedback error={mutation.error} />
          <VehicleForm saving={mutation.saving} onSubmit={(input) => done(() => fleetApi.createVehicle(input), "Équipement mis au parc (passeport GMAO créé).")} />
        </Modal>
      )}
      {dialog === "assign" && (
        <Modal title="Affecter un véhicule" onClose={() => setDialog(null)}>
          <Feedback error={mutation.error || employees.error} />
          <AssignForm
            vehicles={vehicles.filter((vehicle) => vehicle.status === "ACTIVE" && !vehicle.currentAssignment).map((vehicle) => ({ value: vehicle.id, label: `${vehicle.code} — ${vehicle.make} ${vehicle.model}${vehicle.requiredLicence ? ` (exige ${vehicle.requiredLicence})` : ""} · ${vehicle.lastReading ?? "?"} ${usageUnitLabel(vehicle.usageUnit)}` }))}
            employees={(employees.data ?? []).filter((employee) => employee.status === "ACTIVE").map((employee) => ({ value: employee.id, label: `${employee.firstName} ${employee.lastName} — ${employee.jobTitle}` }))}
            projects={projectOptions}
            saving={mutation.saving}
            onSubmit={(input) => done(() => fleetApi.assign(input), "Véhicule affecté.")}
          />
        </Modal>
      )}
      {dialog === "fuel" && (
        <Modal title="Enregistrer un plein" onClose={() => setDialog(null)}>
          <Feedback error={mutation.error} />
          <FuelForm vehicles={vehicleOptions} projects={projectOptions} saving={mutation.saving} onSubmit={(input) => done(() => fleetApi.recordFuel(input), "Plein enregistré.")} />
        </Modal>
      )}
      {dialog === "incident" && (
        <Modal title="Déclarer un incident" onClose={() => setDialog(null)}>
          <Feedback error={mutation.error} />
          <IncidentForm vehicles={vehicleOptions} saving={mutation.saving} onSubmit={(input) => done(() => fleetApi.reportIncident(input), "Incident déclaré.")} />
        </Modal>
      )}
      {closing && (
        <Modal title={`Restitution — ${closing.vehicleLabel}`} onClose={() => setClosing(null)}>
          <Feedback error={mutation.error} />
          <CloseAssignmentForm start={closing.startReading} saving={mutation.saving} onSubmit={(input) => done(() => fleetApi.closeAssignment(closing.id, input), "Véhicule restitué.")} />
        </Modal>
      )}
      {closingIncident && (
        <Modal title={`Clore ${closingIncident.code}`} onClose={() => setClosingIncident(null)}>
          <Feedback error={mutation.error} />
          <CloseIncidentForm saving={mutation.saving} onSubmit={(input) => done(() => fleetApi.closeIncident(closingIncident.id, input), "Incident clos.")} />
        </Modal>
      )}
    </>
  );
}

function VehicleForm({ saving, onSubmit }: { saving: boolean; onSubmit: (input: Record<string, unknown>) => Promise<void> }): React.ReactElement {
  const [form, setForm] = useState({ kind: "VEHICLE", category: "", registration: "", make: "", model: "", year: "", fuelType: "DIESEL", usageUnit: "KM", requiredLicence: "", acquisitionDate: todayIso(), acquisitionCost: "", initialReading: "", initialReadingAt: "", homeBase: "", serialNumber: "", originJustification: "" });
  const set = (key: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));
  return (
    <Form submitLabel="Mettre au parc" saving={saving} onSubmit={() => onSubmit(Object.fromEntries(Object.entries(form).filter(([, value]) => value !== "")))}>
      <SelectField label="Nature" value={form.kind} onChange={set("kind")} options={Object.entries(VEHICLE_KIND_LABEL).map(([value, label]) => ({ value, label }))} required />
      <TextField label="Catégorie" value={form.category} onChange={set("category")} required placeholder="Pick-up, porteur, pelle…" />
      <TextField label="Marque" value={form.make} onChange={set("make")} required />
      <TextField label="Modèle" value={form.model} onChange={set("model")} required />
      <TextField label="Immatriculation" value={form.registration} onChange={set("registration")} hint="Obligatoire pour un véhicule routier." />
      <TextField label="N° de série / châssis" value={form.serialNumber} onChange={set("serialNumber")} />
      <TextField label="Année" inputMode="numeric" value={form.year} onChange={set("year")} />
      <SelectField label="Énergie" value={form.fuelType} onChange={set("fuelType")} options={Object.entries(FUEL_LABEL).map(([value, label]) => ({ value, label }))} required />
      <SelectField label="Compteur" value={form.usageUnit} onChange={set("usageUnit")} options={[{ value: "KM", label: "Kilomètres" }, { value: "HOURS", label: "Heures moteur" }]} required />
      <DecimalField label="Relevé initial" value={form.initialReading} onChange={set("initialReading")} required />
      <DateField label="Relevé initial au" value={form.initialReadingAt} onChange={set("initialReadingAt")} hint="Par défaut : maintenant (reprise d'un parc existant : date du relevé)." />
      <TextField label="Habilitation exigée" value={form.requiredLicence} onChange={set("requiredLicence")} hint="Nom exact de la compétence RH (ex. Permis C, CACES R482)." />
      <TextField label="Base d'attache" value={form.homeBase} onChange={set("homeBase")} required />
      <DateField label="Acquisition" value={form.acquisitionDate} onChange={set("acquisitionDate")} required />
      <DecimalField label="Coût d'acquisition" value={form.acquisitionCost} onChange={set("acquisitionCost")} />
      <TextAreaField label="Justificatif d'origine" value={form.originJustification} onChange={set("originJustification")} required wide hint="Facture, carte grise, contrat de location… (repris dans le passeport GMAO)." />
    </Form>
  );
}

function AssignForm({
  vehicles,
  employees,
  projects,
  saving,
  onSubmit,
}: {
  vehicles: Array<{ value: string; label: string }>;
  employees: Array<{ value: string; label: string }>;
  projects: Array<{ value: string; label: string }>;
  saving: boolean;
  onSubmit: (input: Record<string, unknown>) => Promise<void>;
}): React.ReactElement {
  const [form, setForm] = useState({ vehicleId: "", employeeId: "", projectId: "", purpose: "", startReading: "" });
  const set = (key: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));
  return (
    <Form submitLabel="Affecter" saving={saving} onSubmit={() => onSubmit({ ...form, projectId: form.projectId || undefined })}>
      <SelectField label="Véhicule disponible" value={form.vehicleId} onChange={set("vehicleId")} options={vehicles} required wide />
      <SelectField label="Chauffeur" value={form.employeeId} onChange={set("employeeId")} options={employees} required />
      <SelectField label="Projet" value={form.projectId} onChange={set("projectId")} options={projects} emptyLabel="— Hors projet —" />
      <DecimalField label="Relevé compteur au départ" value={form.startReading} onChange={set("startReading")} required />
      <TextField label="Motif" value={form.purpose} onChange={set("purpose")} required wide />
    </Form>
  );
}

function FuelForm({ vehicles, projects, saving, onSubmit }: { vehicles: Array<{ value: string; label: string }>; projects: Array<{ value: string; label: string }>; saving: boolean; onSubmit: (input: Record<string, unknown>) => Promise<void> }): React.ReactElement {
  const [form, setForm] = useState({ vehicleId: "", filledAt: new Date().toISOString().slice(0, 16), liters: "", unitPrice: "", reading: "", station: "", projectId: "" });
  const [fullTank, setFullTank] = useState(true);
  const set = (key: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));
  return (
    <Form
      submitLabel="Enregistrer"
      saving={saving}
      onSubmit={() => onSubmit({ ...form, filledAt: new Date(form.filledAt).toISOString(), fullTank, station: form.station || undefined, projectId: form.projectId || undefined })}
    >
      <SelectField label="Véhicule" value={form.vehicleId} onChange={set("vehicleId")} options={vehicles} required wide />
      <TextField type="datetime-local" label="Date et heure" value={form.filledAt} onChange={set("filledAt")} required />
      <DecimalField label="Relevé compteur" value={form.reading} onChange={set("reading")} required />
      <DecimalField label="Litres" value={form.liters} onChange={set("liters")} required />
      <DecimalField label="Prix au litre" value={form.unitPrice} onChange={set("unitPrice")} required />
      <TextField label="Station" value={form.station} onChange={set("station")} />
      <SelectField label="Projet (sinon celui de l'affectation)" value={form.projectId} onChange={set("projectId")} options={projects} emptyLabel="— Automatique —" />
      <Toggle label="Plein complet (réservoir rempli)" checked={fullTank} onChange={setFullTank} />
    </Form>
  );
}

function IncidentForm({ vehicles, saving, onSubmit }: { vehicles: Array<{ value: string; label: string }>; saving: boolean; onSubmit: (input: Record<string, unknown>) => Promise<void> }): React.ReactElement {
  const [form, setForm] = useState({ vehicleId: "", kind: "BREAKDOWN", occurredAt: new Date().toISOString().slice(0, 16), description: "", location: "", cost: "" });
  const [ticket, setTicket] = useState(true);
  const [immobilize, setImmobilize] = useState(false);
  const set = (key: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));
  const technical = form.kind === "BREAKDOWN" || form.kind === "ACCIDENT" || form.kind === "DAMAGE";
  return (
    <Form
      submitLabel="Déclarer"
      saving={saving}
      onSubmit={() => onSubmit({ ...form, occurredAt: new Date(form.occurredAt).toISOString(), location: form.location || undefined, cost: form.cost || undefined, createTicket: technical && ticket, immobilize })}
    >
      <SelectField label="Véhicule" value={form.vehicleId} onChange={set("vehicleId")} options={vehicles} required wide />
      <SelectField label="Nature" value={form.kind} onChange={set("kind")} options={Object.entries(INCIDENT_KIND_LABEL).map(([value, label]) => ({ value, label }))} required />
      <TextField type="datetime-local" label="Survenu le" value={form.occurredAt} onChange={set("occurredAt")} required />
      <TextField label="Lieu" value={form.location} onChange={set("location")} />
      <DecimalField label="Coût estimé" value={form.cost} onChange={set("cost")} />
      <TextAreaField label="Description" value={form.description} onChange={set("description")} required wide />
      {technical && <Toggle label="Ouvrir un ticket de maintenance (GMAO)" checked={ticket} onChange={setTicket} />}
      <Toggle label="Immobiliser le véhicule" checked={immobilize} onChange={setImmobilize} />
    </Form>
  );
}

function CloseAssignmentForm({ start, saving, onSubmit }: { start: string; saving: boolean; onSubmit: (input: { endReading: string; note?: string }) => Promise<void> }): React.ReactElement {
  const [endReading, setEndReading] = useState("");
  const [note, setNote] = useState("");
  return (
    <Form columns={1} submitLabel="Restituer" saving={saving} onSubmit={() => onSubmit({ endReading, note: note || undefined })}>
      <DecimalField label={`Relevé compteur au retour (départ ${start})`} value={endReading} onChange={setEndReading} required />
      <TextAreaField label="Observations" value={note} onChange={setNote} />
    </Form>
  );
}

function CloseIncidentForm({ saving, onSubmit }: { saving: boolean; onSubmit: (input: { note: string; cost?: string }) => Promise<void> }): React.ReactElement {
  const [note, setNote] = useState("");
  const [cost, setCost] = useState("");
  return (
    <Form columns={1} submitLabel="Clore" saving={saving} onSubmit={() => onSubmit({ note, cost: cost || undefined })}>
      <TextAreaField label="Conclusion" value={note} onChange={setNote} required />
      <DecimalField label="Coût définitif" value={cost} onChange={setCost} />
    </Form>
  );
}
