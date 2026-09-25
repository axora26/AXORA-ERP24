"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import type { MaintenanceTicketView } from "@axora24/contracts";
import { Activity, CalendarClock, Gauge, Plus, Siren, Timer, Wrench } from "lucide-react";
import {
  ASSET_STATUS_CHIP,
  ASSET_STATUS_LABEL,
  CRITICALITY_CHIP,
  CRITICALITY_LABEL,
  ORIGIN_LABEL,
  PRIORITY_CHIP,
  PRIORITY_LABEL,
  TICKET_STATUS_CHIP,
  TICKET_STATUS_LABEL,
  WO_STATUS_LABEL,
  WO_TYPE_LABEL,
  assetsApi,
  formatAvailability,
  formatHours,
} from "../../lib/modules/assets";
import { commissioningApi } from "../../lib/modules/commissioning";
import { hrApi } from "../../lib/modules/hr";
import { formatDate, formatDateTime, formatMoney, formatPercent, todayIso } from "../../lib/format";
import { useMutation, useResource } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import {
  Button,
  DataTable,
  DateField,
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
  Toggle,
} from "../../components/ui";

type TabId = "assets" | "workorders" | "tickets" | "plans";
type Dialog = "commissioning" | "manual" | "ticket" | "plan";

const CRITICALITY_OPTIONS = Object.entries(CRITICALITY_LABEL).map(([value, label]) => ({ value, label }));
const PRIORITY_OPTIONS = Object.entries(PRIORITY_LABEL).map(([value, label]) => ({ value, label }));

export default function AssetsPage(): React.ReactElement {
  const session = useSession();
  const router = useRouter();
  const mutation = useMutation();
  const [tab, setTab] = useState<TabId>("assets");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [decision, setDecision] = useState<{ kind: "convert" | "reject"; ticket: MaintenanceTicketView } | null>(null);
  const canManage = session.can("assets.asset.manage");
  const canWork = session.can("assets.workorder.manage");
  const data = useResource(() => Promise.all([assetsApi.summary(), assetsApi.list(), assetsApi.workOrders(), assetsApi.tickets(), assetsApi.plans()]));
  const [summary, assets, workOrders, tickets, plans] = data.data ?? [null, [], [], [], []];
  const candidates = useResource(
    () => (dialog === "commissioning" && session.can("commissioning.activity.read") ? commissioningApi.list() : Promise.resolve([])),
    [dialog],
  );
  const employees = useResource(() => (decision?.kind === "convert" && session.can("hr.employee.read") ? hrApi.employees() : Promise.resolve([])), [decision?.kind]);
  const assetOptions = assets.filter((asset) => asset.status !== "RETIRED").map((asset) => ({ value: asset.id, label: `${asset.code} — ${asset.name}` }));
  const eligible = (candidates.data ?? []).filter(
    (activity) => (activity.status === "ACCEPTED" || activity.status === "HANDED_OVER") && !assets.some((asset) => asset.commissioningActivityId === activity.id),
  );

  async function done(action: () => Promise<unknown>, success: string, open?: (result: { id: string }) => string): Promise<void> {
    const result = await mutation.run(action, success);
    if (result !== undefined) {
      setDialog(null);
      setDecision(null);
      if (open && result && typeof result === "object" && "id" in result) router.push(open(result as { id: string }));
      else await data.reload();
    }
  }

  const fleet = summary?.fleet;
  return (
    <>
      <PageHeader
        breadcrumb="Exploitation / Actifs & GMAO"
        title="Actifs & maintenance"
        subtitle="Passeports d'actifs issus des mises en service, préventif, tickets et ordres de travail — MTBF et MTTR calculés sur l'historique réel."
        onRefresh={() => void data.reload()}
        actions={
          <>
            {session.can("assets.ticket.create") && (
              <Button variant="danger" onClick={() => setDialog("ticket")}>
                <Siren size={15} aria-hidden="true" /> Signaler une panne
              </Button>
            )}
            {canManage && (
              <Button onClick={() => setDialog("manual")}>
                <Plus size={15} aria-hidden="true" /> Actif existant
              </Button>
            )}
            {canManage && (
              <Button variant="primary" onClick={() => setDialog("commissioning")}>
                <Plus size={15} aria-hidden="true" /> Passeport depuis une mise en service
              </Button>
            )}
          </>
        }
      />
      <Feedback error={data.error || mutation.error} notice={mutation.notice} />
      {data.loading && !data.data ? (
        <Loading label="Chargement de la maintenance…" />
      ) : (
        <>
          {summary && fleet && (
            <Metrics label="Indicateurs de maintenance">
              <Metric icon={<Activity size={20} />} tone="blue" label="Actifs suivis" value={String(summary.assets)} detail={`${summary.inService} en service · maintenance ${formatMoney(summary.maintenanceCost, summary.currency)}`} />
              <Metric
                icon={<Wrench size={20} />}
                tone={summary.overdueWorkOrders > 0 ? "red" : summary.openWorkOrders > 0 ? "amber" : "green"}
                label="OT ouverts"
                value={String(summary.openWorkOrders)}
                detail={`${summary.overdueWorkOrders} en retard · ${summary.openTickets} ticket(s) à qualifier · ${summary.onTimeRate === null ? "—" : formatPercent(summary.onTimeRate)} dans les délais`}
              />
              <Metric
                icon={<Gauge size={20} />}
                tone={fleet.availabilityPercent !== null && Number(fleet.availabilityPercent) < 98 ? "amber" : "green"}
                label="Disponibilité du parc"
                value={formatAvailability(fleet.availabilityPercent)}
                detail={`${fleet.failures} panne(s) · arrêt cumulé ${formatHours(fleet.downtimeHours)}`}
              />
              <Metric icon={<Timer size={20} />} tone="violet" label="MTBF / MTTR" value={`${formatHours(fleet.mtbfHours)} / ${formatHours(fleet.mttrHours)}`} detail={fleet.failures === 0 ? "Aucune panne enregistrée : non calculable" : "Sur OT correctifs clôturés"} />
            </Metrics>
          )}
          <Tabs
            tabs={[
              { id: "assets", label: "Actifs", count: assets.length },
              { id: "workorders", label: "Ordres de travail", count: workOrders.filter((order) => order.status === "OPEN" || order.status === "IN_PROGRESS").length },
              { id: "tickets", label: "Tickets", count: tickets.filter((ticket) => ticket.status === "OPEN").length },
              { id: "plans", label: "Préventif", count: plans.length },
            ]}
            active={tab}
            onChange={setTab}
          />
          <div className="stack">
            {tab === "assets" && (
              <Panel title="Parc d'actifs">
                <DataTable
                  rows={assets}
                  onRowClick={(asset) => router.push(`/assets/${asset.id}`)}
                  empty={<Empty icon={<Activity size={22} />} title="Aucun actif" body="Un passeport d'actif naît d'une mise en service réceptionnée, ou d'un existant repris avec justification." />}
                  columns={[
                    {
                      key: "asset",
                      header: "Actif",
                      render: (asset) => (
                        <>
                          <strong>{asset.name}</strong>
                          <small>
                            {asset.code}
                            {asset.equipmentTag ? ` · ${asset.equipmentTag}` : ""} · {asset.location}
                          </small>
                        </>
                      ),
                    },
                    { key: "origin", header: "Origine", render: (asset) => <small>{asset.commissioningCode ? `${ORIGIN_LABEL[asset.origin]} ${asset.commissioningCode}` : ORIGIN_LABEL[asset.origin]}</small> },
                    { key: "criticality", header: "Criticité", render: (asset) => <StatusChip status={CRITICALITY_CHIP[asset.criticality] ?? "low"} label={CRITICALITY_LABEL[asset.criticality]} /> },
                    { key: "status", header: "État", render: (asset) => <StatusChip status={ASSET_STATUS_CHIP[asset.status] ?? "planned"} label={ASSET_STATUS_LABEL[asset.status]} /> },
                    { key: "mtbf", header: "MTBF", align: "right", render: (asset) => formatHours(asset.reliability.mtbfHours) },
                    { key: "availability", header: "Disponibilité", align: "right", render: (asset) => formatAvailability(asset.reliability.availabilityPercent) },
                    { key: "open", header: "OT ouverts", align: "right", render: (asset) => String(asset.openWorkOrders) },
                  ]}
                />
              </Panel>
            )}
            {tab === "workorders" && (
              <Panel
                title="Ordres de travail"
                actions={
                  canWork && (
                    <Button onClick={() => void done(() => assetsApi.generate(0), "Préventif échu généré (une seule fois par échéance).")}>
                      <CalendarClock size={15} aria-hidden="true" /> Générer le préventif échu
                    </Button>
                  )
                }
              >
                <DataTable
                  rows={workOrders}
                  onRowClick={(order) => router.push(`/assets/work-orders/${order.id}`)}
                  empty={<Empty icon={<Wrench size={22} />} title="Aucun ordre de travail" body="Les OT naissent du préventif échu ou d'un ticket qualifié." />}
                  columns={[
                    {
                      key: "order",
                      header: "OT",
                      render: (order) => (
                        <>
                          <strong>{order.title}</strong>
                          <small>
                            {order.code} · {order.assetCode} — {order.assetName}
                          </small>
                        </>
                      ),
                    },
                    { key: "type", header: "Type", render: (order) => WO_TYPE_LABEL[order.type] },
                    { key: "priority", header: "Priorité", render: (order) => <StatusChip status={PRIORITY_CHIP[order.priority] ?? "planned"} label={PRIORITY_LABEL[order.priority]} /> },
                    { key: "due", header: "Échéance", render: (order) => (order.overdue ? <StatusChip status="overdue" label={`En retard · ${formatDate(order.dueDate)}`} /> : formatDate(order.dueDate)) },
                    { key: "status", header: "Statut", render: (order) => <StatusChip status={order.status} label={WO_STATUS_LABEL[order.status]} /> },
                    { key: "cost", header: "Coût", align: "right", render: (order) => formatMoney(order.totalCost, order.currency) },
                  ]}
                />
              </Panel>
            )}
            {tab === "tickets" && (
              <Panel title="Tickets de maintenance" subtitle="Un ticket ne devient un OT correctif que par décision explicite ; un rejet est motivé.">
                <DataTable
                  rows={tickets}
                  empty={<Empty icon={<Siren size={22} />} title="Aucun ticket" body="Les exploitants signalent ici les pannes et anomalies." />}
                  columns={[
                    {
                      key: "ticket",
                      header: "Ticket",
                      render: (ticket) => (
                        <>
                          <strong>{ticket.title}</strong>
                          <small>
                            {ticket.code} · {ticket.assetCode} — {ticket.assetName} · {ticket.reportedByName}
                          </small>
                        </>
                      ),
                    },
                    { key: "priority", header: "Priorité", render: (ticket) => <StatusChip status={PRIORITY_CHIP[ticket.priority] ?? "planned"} label={PRIORITY_LABEL[ticket.priority]} /> },
                    { key: "failure", header: "Panne constatée", render: (ticket) => (ticket.failureAt ? formatDateTime(ticket.failureAt) : "Sans arrêt") },
                    {
                      key: "status",
                      header: "Décision",
                      render: (ticket) =>
                        ticket.workOrderId ? (
                          <a href={`/assets/work-orders/${ticket.workOrderId}`}>{ticket.workOrderCode}</a>
                        ) : (
                          <>
                            <StatusChip status={TICKET_STATUS_CHIP[ticket.status] ?? "pending"} label={TICKET_STATUS_LABEL[ticket.status]} />
                            {ticket.decisionNote && <small className="clamp">{ticket.decisionNote}</small>}
                          </>
                        ),
                    },
                    {
                      key: "actions",
                      header: "",
                      render: (ticket) =>
                        canWork && ticket.status === "OPEN" ? (
                          <span className="row-actions">
                            <Button variant="primary" onClick={() => setDecision({ kind: "convert", ticket })}>
                              Créer l'OT
                            </Button>
                            <Button variant="ghost" onClick={() => setDecision({ kind: "reject", ticket })}>
                              Rejeter
                            </Button>
                          </span>
                        ) : null,
                    },
                  ]}
                />
              </Panel>
            )}
            {tab === "plans" && (
              <Panel
                title="Plans de maintenance préventive"
                actions={
                  canManage && (
                    <Button onClick={() => setDialog("plan")} disabled={assetOptions.length === 0}>
                      <Plus size={15} aria-hidden="true" /> Plan préventif
                    </Button>
                  )
                }
              >
                <DataTable
                  rows={plans}
                  empty={<Empty icon={<CalendarClock size={22} />} title="Aucun plan préventif" body="Définissez une périodicité par actif ; les OT sont générés à l'échéance." />}
                  columns={[
                    {
                      key: "plan",
                      header: "Plan",
                      render: (plan) => (
                        <>
                          <strong>{plan.title}</strong>
                          <small>{plan.assetCode}</small>
                        </>
                      ),
                    },
                    { key: "interval", header: "Périodicité", render: (plan) => `Tous les ${plan.intervalDays} j` },
                    { key: "next", header: "Prochaine échéance", render: (plan) => (plan.due ? <StatusChip status="overdue" label={`Échu · ${formatDate(plan.nextDueDate)}`} /> : formatDate(plan.nextDueDate)) },
                    { key: "hours", header: "Durée estimée", align: "right", render: (plan) => formatHours(plan.estimatedHours) },
                  ]}
                />
              </Panel>
            )}
          </div>
        </>
      )}

      {dialog === "commissioning" && (
        <Modal title="Passeport depuis une mise en service" onClose={() => setDialog(null)}>
          <Feedback error={mutation.error || candidates.error} />
          <CommissioningForm
            options={eligible.map((activity) => ({ value: activity.id, label: `${activity.code} — ${activity.equipmentTag} ${activity.equipmentName}` }))}
            saving={mutation.saving}
            onSubmit={(input) => done(() => assetsApi.fromCommissioning(input), "Passeport d'actif créé.", (asset) => `/assets/${asset.id}`)}
          />
        </Modal>
      )}
      {dialog === "manual" && (
        <Modal title="Reprendre un actif existant" onClose={() => setDialog(null)}>
          <Feedback error={mutation.error} />
          <ManualForm saving={mutation.saving} onSubmit={(input) => done(() => assetsApi.manual(input), "Actif créé.", (asset) => `/assets/${asset.id}`)} />
        </Modal>
      )}
      {dialog === "ticket" && (
        <Modal title="Signaler une panne ou une anomalie" onClose={() => setDialog(null)}>
          <Feedback error={mutation.error} />
          <TicketForm assets={assetOptions} saving={mutation.saving} onSubmit={(input) => done(() => assetsApi.createTicket(input), "Ticket enregistré.")} />
        </Modal>
      )}
      {dialog === "plan" && (
        <Modal title="Nouveau plan préventif" onClose={() => setDialog(null)}>
          <Feedback error={mutation.error} />
          <PlanForm assets={assetOptions} saving={mutation.saving} onSubmit={(input) => done(() => assetsApi.createPlan(input), "Plan préventif créé.")} />
        </Modal>
      )}
      {decision?.kind === "convert" && (
        <Modal title={`Créer l'OT correctif — ${decision.ticket.code}`} onClose={() => setDecision(null)}>
          <Feedback error={mutation.error} />
          <ConvertForm
            employees={(employees.data ?? []).filter((employee) => employee.status === "ACTIVE").map((employee) => ({ value: employee.id, label: `${employee.firstName} ${employee.lastName} — ${employee.jobTitle}` }))}
            saving={mutation.saving}
            onSubmit={(input) => done(() => assetsApi.convertTicket(decision.ticket.id, input), "OT correctif créé.", (order) => `/assets/work-orders/${order.id}`)}
          />
        </Modal>
      )}
      {decision?.kind === "reject" && (
        <Modal title={`Rejeter le ticket ${decision.ticket.code}`} onClose={() => setDecision(null)}>
          <Feedback error={mutation.error} />
          <NoteForm label="Motif du rejet" submitLabel="Rejeter" saving={mutation.saving} onSubmit={(note) => done(() => assetsApi.rejectTicket(decision.ticket.id, note), "Ticket rejeté.")} />
        </Modal>
      )}
    </>
  );
}

function CommissioningForm({ options, saving, onSubmit }: { options: Array<{ value: string; label: string }>; saving: boolean; onSubmit: (input: Record<string, unknown>) => Promise<void> }): React.ReactElement {
  const [commissioningActivityId, setActivity] = useState("");
  const [serialNumber, setSerial] = useState("");
  const [criticality, setCriticality] = useState("MEDIUM");
  const [warrantyEndsAt, setWarranty] = useState("");
  return (
    <Form submitLabel="Créer le passeport" saving={saving} onSubmit={() => onSubmit({ commissioningActivityId, serialNumber: serialNumber || undefined, criticality, warrantyEndsAt: warrantyEndsAt || undefined })}>
      <SelectField label="Mise en service réceptionnée" value={commissioningActivityId} onChange={setActivity} required wide options={options} hint={options.length === 0 ? "Aucune mise en service réceptionnée sans passeport." : undefined} />
      <TextField label="N° de série" value={serialNumber} onChange={setSerial} />
      <SelectField label="Criticité" value={criticality} onChange={setCriticality} options={CRITICALITY_OPTIONS} required />
      <DateField label="Fin de garantie" value={warrantyEndsAt} onChange={setWarranty} />
    </Form>
  );
}

function ManualForm({ saving, onSubmit }: { saving: boolean; onSubmit: (input: Record<string, unknown>) => Promise<void> }): React.ReactElement {
  const [form, setForm] = useState({ name: "", location: "", installedAt: "", originJustification: "", manufacturer: "", model: "", serialNumber: "", criticality: "MEDIUM" });
  const set = (key: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));
  return (
    <Form submitLabel="Créer l'actif" saving={saving} onSubmit={() => onSubmit(Object.fromEntries(Object.entries(form).filter(([, value]) => value !== "")))}>
      <TextField label="Désignation" value={form.name} onChange={set("name")} required wide />
      <TextField label="Localisation" value={form.location} onChange={set("location")} required />
      <DateField label="En service depuis" value={form.installedAt} onChange={set("installedAt")} required />
      <TextField label="Fabricant" value={form.manufacturer} onChange={set("manufacturer")} />
      <TextField label="Modèle" value={form.model} onChange={set("model")} />
      <TextField label="N° de série" value={form.serialNumber} onChange={set("serialNumber")} />
      <SelectField label="Criticité" value={form.criticality} onChange={set("criticality")} options={CRITICALITY_OPTIONS} required />
      <TextAreaField label="Justification de l'origine" value={form.originJustification} onChange={set("originJustification")} required wide hint="Obligatoire : un actif hors mise en service doit prouver d'où il vient (inventaire, reprise de contrat…)." />
    </Form>
  );
}

function TicketForm({ assets, saving, onSubmit }: { assets: Array<{ value: string; label: string }>; saving: boolean; onSubmit: (input: Record<string, unknown>) => Promise<void> }): React.ReactElement {
  const [assetId, setAsset] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("NORMAL");
  const [stopped, setStopped] = useState(false);
  const [failureAt, setFailureAt] = useState("");
  return (
    <Form
      submitLabel="Signaler"
      saving={saving}
      onSubmit={() => onSubmit({ assetId, title, description, priority, ...(stopped && failureAt ? { failureAt: new Date(failureAt).toISOString(), outOfService: true } : {}) })}
    >
      <SelectField label="Actif" value={assetId} onChange={setAsset} required wide options={assets} />
      <TextField label="Objet" value={title} onChange={setTitle} required />
      <SelectField label="Priorité" value={priority} onChange={setPriority} options={PRIORITY_OPTIONS} required />
      <TextAreaField label="Description" value={description} onChange={setDescription} required wide />
      <Toggle label="L'actif est à l'arrêt" checked={stopped} onChange={setStopped} />
      {stopped && <TextField type="datetime-local" label="Arrêt constaté le" value={failureAt} onChange={setFailureAt} required />}
    </Form>
  );
}

function PlanForm({ assets, saving, onSubmit }: { assets: Array<{ value: string; label: string }>; saving: boolean; onSubmit: (input: Record<string, unknown>) => Promise<void> }): React.ReactElement {
  const [form, setForm] = useState({ assetId: "", title: "", instructions: "", intervalDays: "90", firstDueDate: todayIso(), estimatedHours: "" });
  const set = (key: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));
  return (
    <Form
      submitLabel="Créer le plan"
      saving={saving}
      onSubmit={() => onSubmit({ ...form, intervalDays: Number(form.intervalDays), estimatedHours: form.estimatedHours || undefined })}
    >
      <SelectField label="Actif" value={form.assetId} onChange={set("assetId")} required wide options={assets} />
      <TextField label="Intitulé" value={form.title} onChange={set("title")} required wide />
      <TextField label="Périodicité (jours)" inputMode="numeric" value={form.intervalDays} onChange={set("intervalDays")} required />
      <DateField label="Première échéance" value={form.firstDueDate} onChange={set("firstDueDate")} required />
      <DecimalField label="Durée estimée (h)" value={form.estimatedHours} onChange={set("estimatedHours")} />
      <TextAreaField label="Gamme opératoire" value={form.instructions} onChange={set("instructions")} required wide />
    </Form>
  );
}

function ConvertForm({ employees, saving, onSubmit }: { employees: Array<{ value: string; label: string }>; saving: boolean; onSubmit: (input: Record<string, unknown>) => Promise<void> }): React.ReactElement {
  const [dueDate, setDueDate] = useState(todayIso());
  const [assignedEmployeeId, setEmployee] = useState("");
  const [instructions, setInstructions] = useState("");
  return (
    <Form submitLabel="Créer l'OT" saving={saving} onSubmit={() => onSubmit({ dueDate, assignedEmployeeId: assignedEmployeeId || undefined, instructions: instructions || undefined })}>
      <DateField label="Échéance" value={dueDate} onChange={setDueDate} required />
      <SelectField label="Technicien" value={assignedEmployeeId} onChange={setEmployee} options={employees} emptyLabel="— Non affecté —" />
      <TextAreaField label="Consignes (sinon description du ticket)" value={instructions} onChange={setInstructions} wide />
    </Form>
  );
}

function NoteForm({ label, submitLabel, saving, onSubmit }: { label: string; submitLabel: string; saving: boolean; onSubmit: (note: string) => Promise<void> }): React.ReactElement {
  const [note, setNote] = useState("");
  return (
    <Form columns={1} submitLabel={submitLabel} saving={saving} onSubmit={() => onSubmit(note)}>
      <TextAreaField label={label} value={note} onChange={setNote} required />
    </Form>
  );
}
