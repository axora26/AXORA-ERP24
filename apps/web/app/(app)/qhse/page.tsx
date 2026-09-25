"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import type { SafetyIncidentView, WorkPermitView } from "@axora24/contracts";
import { AlertTriangle, ClipboardCheck, Flame, HeartPulse, ListChecks, Megaphone, Plus, ShieldAlert, ShieldCheck } from "lucide-react";
import {
  DOMAIN_LABEL,
  FINDING_STATUS_LABEL,
  INCIDENT_STATUS_LABEL,
  INCIDENT_TYPE_LABEL,
  INSPECTION_STATUS_LABEL,
  PERMIT_STATUS_LABEL,
  PERMIT_TYPE_LABEL,
  SEVERITY_CHIP,
  SEVERITY_LABEL,
  parseChecklist,
  qhseApi,
} from "../../lib/modules/qhse";
import { projectsApi } from "../../lib/modules/projects";
import { hrApi } from "../../lib/modules/hr";
import { formatDate, formatDateTime } from "../../lib/format";
import { useMutation, useResource } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import {
  Button,
  CheckboxGroup,
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

type TabId = "inspections" | "findings" | "incidents" | "permits" | "toolbox" | "templates";
type Dialog = "inspection" | "finding" | "incident" | "permit" | "toolbox" | "template";

export default function QhsePage(): React.ReactElement {
  const session = useSession();
  const router = useRouter();
  const mutation = useMutation();
  const [projectId, setProjectId] = useState("");
  const [tab, setTab] = useState<TabId>("inspections");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [decision, setDecision] = useState<{ kind: "investigate" | "permit-approve" | "permit-reject"; incident?: SafetyIncidentView; permit?: WorkPermitView } | null>(null);
  const projects = useResource(() => (session.can("projects.project.read") ? projectsApi.list().catch(() => []) : Promise.resolve([])));
  const data = useResource(
    () =>
      Promise.all([
        qhseApi.summary(projectId || undefined),
        qhseApi.inspections(projectId || undefined),
        qhseApi.findings(projectId || undefined),
        qhseApi.incidents(projectId || undefined),
        qhseApi.permits(projectId || undefined),
        qhseApi.toolbox(projectId || undefined),
        qhseApi.templates(),
      ]),
    [projectId],
  );
  const [summary, inspections, findings, incidents, permits, toolbox, templates] = data.data ?? [null, [], [], [], [], [], []];
  const projectOptions = (projects.data ?? []).map((project) => ({ value: project.id, label: `${project.code} — ${project.name}` }));

  async function done(action: () => Promise<unknown>, success: string, open?: (result: { id: string }) => string): Promise<void> {
    const result = await mutation.run(action, success);
    if (result !== undefined) {
      setDialog(null);
      setDecision(null);
      if (open && result && typeof result === "object" && "id" in result) router.push(open(result as { id: string }));
      else await data.reload();
    }
  }

  return (
    <>
      <PageHeader
        breadcrumb="Projets & chantiers / QHSE"
        title="QHSE"
        subtitle="Inspections, non-conformités, actions correctives, incidents et permis de travail — constats inaltérables, clôture par un tiers."
        onRefresh={() => void data.reload()}
        actions={
          <>
            {session.can("qhse.incident.report") && (
              <Button variant="danger" onClick={() => setDialog("incident")}>
                <HeartPulse size={15} aria-hidden="true" /> Déclarer un incident
              </Button>
            )}
            {session.can("qhse.finding.create") && (
              <Button onClick={() => setDialog("finding")}>
                <AlertTriangle size={15} aria-hidden="true" /> Non-conformité
              </Button>
            )}
            {session.can("qhse.inspection.manage") && (
              <Button variant="primary" onClick={() => setDialog("inspection")}>
                <ClipboardCheck size={15} aria-hidden="true" /> Inspection
              </Button>
            )}
          </>
        }
      />
      <Feedback error={data.error || mutation.error} notice={mutation.notice} />
      <div className="toolbar">
        <SelectField label="Projet" value={projectId} onChange={setProjectId} options={projectOptions} emptyLabel="Tous les projets" />
      </div>
      {data.loading && !data.data ? (
        <Loading label="Chargement QHSE…" />
      ) : (
        <>
          {summary && (
            <Metrics label="Indicateurs QHSE">
              <Metric
                icon={<ShieldAlert size={20} />}
                tone={summary.criticalOpenFindings > 0 ? "red" : summary.openFindings > 0 ? "amber" : "green"}
                label="Non-conformités ouvertes"
                value={String(summary.openFindings)}
                detail={`${summary.criticalOpenFindings} critique(s) · ${summary.overdueActions} action(s) en retard · ${summary.actionsToVerify} à vérifier`}
              />
              <Metric
                icon={<HeartPulse size={20} />}
                tone={summary.lostTimeIncidents12m > 0 ? "red" : "green"}
                label="Jours sans accident avec arrêt"
                value={summary.daysSinceLastLostTime === null ? "—" : String(summary.daysSinceLastLostTime)}
                detail={summary.daysSinceLastLostTime === null ? "Aucun accident avec arrêt déclaré" : `${summary.incidents30d} événement(s) sur 30 jours`}
              />
              <Metric
                icon={<ShieldCheck size={20} />}
                tone="violet"
                label="Taux de fréquence (12 mois)"
                value={summary.frequencyRate ?? "—"}
                detail={summary.frequencyRate === null ? "Aucune heure validée : non calculable" : `${summary.lostTimeIncidents12m} AT avec arrêt · ${summary.hoursWorked12m} h validées`}
              />
              <Metric
                icon={<ClipboardCheck size={20} />}
                tone="blue"
                label="Conformité des inspections (30 j)"
                value={summary.averageConformity30d ? `${summary.averageConformity30d} %` : "—"}
                detail={`${summary.inspectionsCompleted30d} inspection(s) · ${summary.activePermits} permis actif(s)`}
              />
            </Metrics>
          )}
          <Tabs<TabId>
            active={tab}
            onChange={setTab}
            tabs={[
              { id: "inspections", label: "Inspections", count: inspections.length },
              { id: "findings", label: "Non-conformités", count: findings.length },
              { id: "incidents", label: "Incidents", count: incidents.length },
              { id: "permits", label: "Permis de travail", count: permits.length },
              { id: "toolbox", label: "Quarts d'heure sécurité", count: toolbox.length },
              { id: "templates", label: "Checklists", count: templates.length },
            ]}
          />
          <div className="stack">
            {tab === "inspections" && (
              <Panel title="Inspections" subtitle="Chaque point non conforme ouvre automatiquement une non-conformité à la clôture">
                <DataTable
                  rows={inspections}
                  onRowClick={(inspection) => router.push(`/qhse/inspections/${inspection.id}`)}
                  empty={<Empty icon={<ClipboardCheck size={22} />} title="Aucune inspection" />}
                  columns={[
                    {
                      key: "title",
                      header: "Inspection",
                      render: (inspection) => (
                        <>
                          <strong>{inspection.title}</strong>
                          <small>
                            {inspection.code} · {DOMAIN_LABEL[inspection.domain]} · {inspection.projectCode}
                          </small>
                        </>
                      ),
                    },
                    { key: "date", header: "Prévue le", render: (inspection) => formatDate(inspection.scheduledAt) },
                    { key: "who", header: "Inspecteur", render: (inspection) => inspection.inspectorName },
                    { key: "progress", header: "Points", align: "right", render: (inspection) => `${inspection.answered}/${inspection.total}${inspection.nonConform ? ` · ${inspection.nonConform} NC` : ""}` },
                    { key: "rate", header: "Conformité", align: "right", render: (inspection) => (inspection.conformityRate ? `${inspection.conformityRate} %` : "—") },
                    { key: "status", header: "Statut", render: (inspection) => <StatusChip status={inspection.status === "COMPLETED" ? "done" : inspection.status.toLowerCase()} label={INSPECTION_STATUS_LABEL[inspection.status]} /> },
                  ]}
                />
              </Panel>
            )}
            {tab === "findings" && (
              <Panel title="Non-conformités" subtitle="Constat inaltérable ; clôture par une autre personne que le créateur, après vérification de toutes les actions">
                <DataTable
                  rows={findings}
                  onRowClick={(finding) => router.push(`/qhse/findings/${finding.id}`)}
                  empty={<Empty icon={<AlertTriangle size={22} />} title="Aucune non-conformité" />}
                  columns={[
                    {
                      key: "title",
                      header: "Non-conformité",
                      render: (finding) => (
                        <>
                          <strong>{finding.title}</strong>
                          <small>
                            {finding.code} · {DOMAIN_LABEL[finding.category]}
                            {finding.inspectionCode ? ` · ${finding.inspectionCode}` : ""}
                            {finding.incidentCode ? ` · ${finding.incidentCode}` : ""}
                          </small>
                        </>
                      ),
                    },
                    { key: "sev", header: "Gravité", render: (finding) => <StatusChip status={SEVERITY_CHIP[finding.severity] ?? "high"} label={SEVERITY_LABEL[finding.severity]} /> },
                    { key: "date", header: "Constatée le", render: (finding) => formatDate(finding.detectedAt) },
                    {
                      key: "actions",
                      header: "Actions",
                      align: "right",
                      render: (finding) => (
                        <>
                          {finding.verifiedActions}/{finding.actionCount} vérifiée(s)
                          {finding.overdueActions > 0 && <small className="text-danger">{finding.overdueActions} en retard</small>}
                        </>
                      ),
                    },
                    { key: "status", header: "Statut", render: (finding) => <StatusChip status={finding.status === "CLOSED" ? "closed" : finding.status === "OPEN" ? "open" : "in_progress"} label={FINDING_STATUS_LABEL[finding.status]} /> },
                  ]}
                />
              </Panel>
            )}
            {tab === "incidents" && (
              <Panel title="Incidents et accidents" subtitle="Faits déclarés inaltérables, jamais supprimés ; jours d'arrêt uniquement prolongeables">
                <DataTable
                  rows={incidents}
                  empty={<Empty icon={<HeartPulse size={22} />} title="Aucun incident déclaré" />}
                  columns={[
                    {
                      key: "what",
                      header: "Événement",
                      render: (incident) => (
                        <>
                          <strong>{INCIDENT_TYPE_LABEL[incident.type]}</strong>
                          <small>
                            {incident.code} · {incident.location}
                            {incident.projectCode ? ` · ${incident.projectCode}` : ""}
                          </small>
                        </>
                      ),
                    },
                    { key: "when", header: "Survenu le", render: (incident) => formatDateTime(incident.occurredAt) },
                    { key: "desc", header: "Faits", render: (incident) => <span className="clamp">{incident.description}</span> },
                    { key: "days", header: "Arrêt", align: "right", render: (incident) => (incident.lostDays ? `${incident.lostDays} j` : "—") },
                    { key: "status", header: "Statut", render: (incident) => <StatusChip status={incident.status === "CLOSED" ? "closed" : incident.status === "REPORTED" ? "critical" : "in_progress"} label={INCIDENT_STATUS_LABEL[incident.status]} /> },
                    {
                      key: "act",
                      header: "",
                      align: "right",
                      render: (incident) =>
                        session.can("qhse.incident.manage") && incident.status !== "CLOSED" ? (
                          <span className="chip-row">
                            <Button variant="ghost" onClick={() => setDecision({ kind: "investigate", incident })}>
                              Analyse
                            </Button>
                            {incident.status === "INVESTIGATED" && <Button onClick={() => void done(() => qhseApi.closeIncident(incident.id), "Incident clôturé.")}>Clôturer</Button>}
                          </span>
                        ) : null,
                    },
                  ]}
                />
              </Panel>
            )}
            {tab === "permits" && (
              <Panel
                title="Permis de travail"
                subtitle="Délivrés par une autre personne que le demandeur, pour une fenêtre de 14 jours maximum"
                actions={
                  session.can("qhse.permit.request") && (
                    <Button onClick={() => setDialog("permit")}>
                      <Flame size={14} aria-hidden="true" /> Demander un permis
                    </Button>
                  )
                }
              >
                <DataTable
                  rows={permits}
                  empty={<Empty icon={<Flame size={22} />} title="Aucun permis" />}
                  columns={[
                    {
                      key: "type",
                      header: "Permis",
                      render: (permit) => (
                        <>
                          <strong>{PERMIT_TYPE_LABEL[permit.type]}</strong>
                          <small>
                            {permit.code} · {permit.description}
                          </small>
                        </>
                      ),
                    },
                    { key: "window", header: "Validité", render: (permit) => `${formatDateTime(permit.validFrom)} → ${formatDateTime(permit.validTo)}` },
                    { key: "who", header: "Demandeur", render: (permit) => permit.requestedByName },
                    {
                      key: "status",
                      header: "Statut",
                      render: (permit) =>
                        permit.active ? (
                          <StatusChip status="active" label="Actif" />
                        ) : permit.expired ? (
                          <StatusChip status="overdue" label="Expiré" />
                        ) : (
                          <StatusChip status={permit.status === "REQUESTED" ? "pending" : permit.status.toLowerCase()} label={PERMIT_STATUS_LABEL[permit.status]} />
                        ),
                    },
                    {
                      key: "act",
                      header: "",
                      align: "right",
                      render: (permit) => (
                        <span className="chip-row">
                          {permit.status === "REQUESTED" && session.can("qhse.permit.approve") && permit.requestedByUserId !== session.user.id && (
                            <>
                              <Button variant="ghost" onClick={() => setDecision({ kind: "permit-reject", permit })}>
                                Refuser
                              </Button>
                              <Button onClick={() => setDecision({ kind: "permit-approve", permit })}>Délivrer</Button>
                            </>
                          )}
                          {permit.status === "APPROVED" && session.can("qhse.permit.request") && (
                            <Button variant="ghost" onClick={() => void done(() => qhseApi.closePermit(permit.id), "Permis clôturé : fin des travaux.")}>
                              Fin de travaux
                            </Button>
                          )}
                        </span>
                      ),
                    },
                  ]}
                />
              </Panel>
            )}
            {tab === "toolbox" && (
              <Panel
                title="Quarts d'heure sécurité"
                subtitle="Émargement des participants (employés RH), inaltérable"
                actions={
                  session.can("qhse.toolbox.manage") && (
                    <Button onClick={() => setDialog("toolbox")}>
                      <Megaphone size={14} aria-hidden="true" /> Enregistrer une causerie
                    </Button>
                  )
                }
              >
                <DataTable
                  rows={toolbox}
                  empty={<Empty icon={<Megaphone size={22} />} title="Aucune causerie enregistrée" />}
                  columns={[
                    {
                      key: "topic",
                      header: "Thème",
                      render: (meeting) => (
                        <>
                          <strong>{meeting.topic}</strong>
                          <small>{meeting.content}</small>
                        </>
                      ),
                    },
                    { key: "when", header: "Date", render: (meeting) => formatDateTime(meeting.heldAt) },
                    { key: "by", header: "Animateur", render: (meeting) => meeting.facilitatorName },
                    { key: "who", header: "Participants", render: (meeting) => `${meeting.attendees.length} — ${meeting.attendees.map((attendee) => attendee.name).join(", ")}` },
                  ]}
                />
              </Panel>
            )}
            {tab === "templates" && (
              <Panel
                title="Checklists d'inspection"
                actions={
                  session.can("qhse.inspection.manage") && (
                    <Button onClick={() => setDialog("template")}>
                      <Plus size={14} aria-hidden="true" /> Checklist
                    </Button>
                  )
                }
              >
                <DataTable
                  rows={templates}
                  empty={<Empty icon={<ListChecks size={22} />} title="Aucune checklist" />}
                  columns={[
                    {
                      key: "name",
                      header: "Checklist",
                      render: (template) => (
                        <>
                          <strong>{template.name}</strong>
                          <small>
                            {template.code} · {DOMAIN_LABEL[template.domain]}
                          </small>
                        </>
                      ),
                    },
                    { key: "items", header: "Points", align: "right", render: (template) => `${template.items.length} (${template.items.filter((item) => item.critical).length} critique(s))` },
                  ]}
                />
              </Panel>
            )}
          </div>
        </>
      )}

      {dialog && (
        <QhseDialog
          dialog={dialog}
          projects={projectOptions}
          defaultProject={projectId}
          templates={templates.map((template) => ({ value: template.id, label: `${template.code} — ${template.name}` }))}
          incidents={incidents.map((incident) => ({ value: incident.id, label: `${incident.code} — ${INCIDENT_TYPE_LABEL[incident.type]}` }))}
          saving={mutation.saving}
          error={mutation.error}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      )}
      {decision && (
        <Modal
          title={decision.kind === "investigate" ? `Analyse de ${decision.incident?.code}` : decision.kind === "permit-approve" ? `Délivrer ${decision.permit?.code}` : `Refuser ${decision.permit?.code}`}
          onClose={() => setDecision(null)}
        >
          <Feedback error={mutation.error} />
          <DecisionForm
            kind={decision.kind}
            currentLostDays={decision.incident?.lostDays ?? 0}
            saving={mutation.saving}
            onSubmit={(note, lostDays) =>
              done(
                () =>
                  decision.kind === "investigate"
                    ? qhseApi.investigateIncident(decision.incident!.id, { summary: note, ...(lostDays !== undefined ? { lostDays } : {}) })
                    : decision.kind === "permit-approve"
                      ? qhseApi.approvePermit(decision.permit!.id, note || undefined)
                      : qhseApi.rejectPermit(decision.permit!.id, note),
                decision.kind === "investigate" ? "Analyse enregistrée." : decision.kind === "permit-approve" ? "Permis délivré." : "Permis refusé.",
              )
            }
          />
        </Modal>
      )}
    </>
  );
}

function DecisionForm({
  kind,
  currentLostDays,
  saving,
  onSubmit,
}: {
  kind: "investigate" | "permit-approve" | "permit-reject";
  currentLostDays: number;
  saving: boolean;
  onSubmit: (note: string, lostDays?: number) => Promise<void>;
}): React.ReactElement {
  const [note, setNote] = useState("");
  const [lostDays, setLostDays] = useState(String(currentLostDays));
  return (
    <Form columns={1} submitLabel={kind === "investigate" ? "Enregistrer l'analyse" : kind === "permit-approve" ? "Délivrer" : "Refuser"} saving={saving} onSubmit={() => onSubmit(note, kind === "investigate" ? Number(lostDays) : undefined)}>
      <TextAreaField label={kind === "investigate" ? "Causes et enseignements" : kind === "permit-approve" ? "Conditions particulières" : "Motif du refus"} value={note} onChange={setNote} required={kind !== "permit-approve"} />
      {kind === "investigate" && <TextField label="Jours d'arrêt (prolongation uniquement)" value={lostDays} onChange={setLostDays} />}
    </Form>
  );
}

function QhseDialog({
  dialog,
  projects,
  defaultProject,
  templates,
  incidents,
  saving,
  error,
  onClose,
  onDone,
}: {
  dialog: Dialog;
  projects: Array<{ value: string; label: string }>;
  defaultProject: string;
  templates: Array<{ value: string; label: string }>;
  incidents: Array<{ value: string; label: string }>;
  saving: boolean;
  error: string;
  onClose: () => void;
  onDone: (action: () => Promise<unknown>, success: string, open?: (result: { id: string }) => string) => Promise<void>;
}): React.ReactElement {
  const session = useSession();
  const now = new Date();
  const local = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  const [values, setValues] = useState<Record<string, string>>({
    projectId: defaultProject,
    domain: "SAFETY",
    category: "SAFETY",
    severity: "MAJOR",
    type: dialog === "permit" ? "HOT_WORK" : "NEAR_MISS",
    scheduledAt: now.toISOString().slice(0, 10),
    occurredAt: local(now),
    heldAt: local(now),
    validFrom: local(now),
    validTo: local(new Date(now.getTime() + 8 * 3_600_000)),
    lostDays: "0",
  });
  const [attendees, setAttendees] = useState<string[]>([]);
  const employees = useResource(() => (dialog === "toolbox" && session.can("hr.employee.read") ? hrApi.employees().catch(() => []) : Promise.resolve([])), [dialog]);
  const set = (field: string) => (value: string) => setValues((current) => ({ ...current, [field]: value }));
  const value = (field: string) => values[field] ?? "";
  const iso = (field: string) => (value(field) ? new Date(value(field)).toISOString() : undefined);

  let title = "";
  let body: React.ReactNode = null;
  switch (dialog) {
    case "inspection":
      title = "Planifier une inspection";
      body = (
        <Form
          submitLabel="Planifier"
          saving={saving}
          onSubmit={() =>
            onDone(
              () => qhseApi.createInspection({ projectId: value("projectId"), templateId: value("templateId"), title: value("title"), scheduledAt: value("scheduledAt") }),
              "Inspection planifiée.",
              (result) => `/qhse/inspections/${result.id}`,
            )
          }
        >
          <SelectField label="Projet" value={value("projectId")} onChange={set("projectId")} required options={projects} />
          <SelectField label="Checklist" value={value("templateId")} onChange={set("templateId")} required options={templates} />
          <TextField label="Intitulé" value={value("title")} onChange={set("title")} required placeholder="Visite sécurité semaine 39" />
          <DateField label="Date prévue" value={value("scheduledAt")} onChange={set("scheduledAt")} required />
          {templates.length === 0 && <p className="inline-warning">Créez d&apos;abord une checklist (onglet Checklists).</p>}
        </Form>
      );
      break;
    case "finding":
      title = "Ouvrir une non-conformité";
      body = (
        <Form
          submitLabel="Enregistrer le constat"
          saving={saving}
          onSubmit={() =>
            onDone(
              () =>
                qhseApi.createFinding({
                  projectId: value("projectId") || undefined,
                  incidentId: value("incidentId") || undefined,
                  title: value("title"),
                  description: value("description"),
                  category: value("category"),
                  severity: value("severity"),
                }),
              "Non-conformité ouverte.",
              (result) => `/qhse/findings/${result.id}`,
            )
          }
        >
          <TextField label="Intitulé" value={value("title")} onChange={set("title")} required wide />
          <TextAreaField label="Constat (inaltérable après enregistrement)" value={value("description")} onChange={set("description")} required />
          <SelectField label="Domaine" value={value("category")} onChange={set("category")} required options={Object.entries(DOMAIN_LABEL).map(([key, label]) => ({ value: key, label }))} />
          <SelectField label="Gravité" value={value("severity")} onChange={set("severity")} required options={Object.entries(SEVERITY_LABEL).map(([key, label]) => ({ value: key, label }))} />
          <SelectField label="Projet" value={value("projectId")} onChange={set("projectId")} options={projects} emptyLabel="Aucun" />
          <SelectField label="Incident lié" value={value("incidentId")} onChange={set("incidentId")} options={incidents} emptyLabel="Aucun" />
        </Form>
      );
      break;
    case "incident":
      title = "Déclarer un incident";
      body = (
        <Form
          submitLabel="Déclarer"
          saving={saving}
          onSubmit={() =>
            onDone(
              () =>
                qhseApi.reportIncident({
                  projectId: value("projectId") || undefined,
                  type: value("type"),
                  severity: value("severity"),
                  occurredAt: iso("occurredAt"),
                  location: value("location"),
                  description: value("description"),
                  injuredPerson: value("injuredPerson") || undefined,
                  immediateActions: value("immediateActions") || undefined,
                  lostDays: Number(value("lostDays") || "0"),
                }),
              "Incident déclaré : les faits sont conservés tels quels.",
            )
          }
        >
          <SelectField label="Type" value={value("type")} onChange={set("type")} required options={Object.entries(INCIDENT_TYPE_LABEL).map(([key, label]) => ({ value: key, label }))} />
          <SelectField label="Gravité" value={value("severity")} onChange={set("severity")} required options={Object.entries(SEVERITY_LABEL).map(([key, label]) => ({ value: key, label }))} />
          <TextField label="Survenu le (date et heure)" value={value("occurredAt")} onChange={set("occurredAt")} required placeholder="2026-09-25T10:30" />
          <TextField label="Lieu" value={value("location")} onChange={set("location")} required />
          <TextAreaField label="Faits (inaltérables)" value={value("description")} onChange={set("description")} required />
          <TextField label="Personne concernée" value={value("injuredPerson")} onChange={set("injuredPerson")} />
          <TextField label="Jours d'arrêt" value={value("lostDays")} onChange={set("lostDays")} />
          <TextAreaField label="Mesures immédiates" value={value("immediateActions")} onChange={set("immediateActions")} />
          <SelectField label="Projet" value={value("projectId")} onChange={set("projectId")} options={projects} emptyLabel="Aucun" />
        </Form>
      );
      break;
    case "permit":
      title = "Demander un permis de travail";
      body = (
        <Form
          submitLabel="Demander"
          saving={saving}
          onSubmit={() =>
            onDone(
              () =>
                qhseApi.requestPermit({
                  projectId: value("projectId"),
                  type: value("type"),
                  description: value("description"),
                  precautions: value("precautions"),
                  validFrom: iso("validFrom"),
                  validTo: iso("validTo"),
                }),
              "Permis demandé : il doit être délivré par un responsable.",
            )
          }
        >
          <SelectField label="Projet" value={value("projectId")} onChange={set("projectId")} required options={projects} />
          <SelectField label="Type" value={value("type")} onChange={set("type")} required options={Object.entries(PERMIT_TYPE_LABEL).map(([key, label]) => ({ value: key, label }))} />
          <TextField label="Travaux" value={value("description")} onChange={set("description")} required wide />
          <TextAreaField label="Mesures de prévention" value={value("precautions")} onChange={set("precautions")} required />
          <TextField label="Début" value={value("validFrom")} onChange={set("validFrom")} required />
          <TextField label="Fin" value={value("validTo")} onChange={set("validTo")} required />
        </Form>
      );
      break;
    case "toolbox":
      title = "Quart d'heure sécurité";
      body = (
        <Form
          submitLabel="Enregistrer"
          saving={saving}
          onSubmit={() =>
            onDone(
              () => qhseApi.recordToolbox({ projectId: value("projectId"), heldAt: iso("heldAt"), topic: value("topic"), content: value("content"), attendeeEmployeeIds: attendees }),
              "Causerie enregistrée.",
            )
          }
        >
          <SelectField label="Projet" value={value("projectId")} onChange={set("projectId")} required options={projects} />
          <TextField label="Date et heure" value={value("heldAt")} onChange={set("heldAt")} required />
          <TextField label="Thème" value={value("topic")} onChange={set("topic")} required wide />
          <TextAreaField label="Messages clés" value={value("content")} onChange={set("content")} required />
          <CheckboxGroup
            label="Participants"
            options={(employees.data ?? []).filter((employee) => employee.status === "ACTIVE").map((employee) => ({ value: employee.id, label: employee.fullName, hint: employee.jobTitle }))}
            selected={attendees}
            onChange={setAttendees}
          />
        </Form>
      );
      break;
    case "template":
      title = "Nouvelle checklist";
      body = (
        <Form
          submitLabel="Créer"
          saving={saving}
          onSubmit={() => onDone(() => qhseApi.createTemplate({ code: value("code"), name: value("name"), domain: value("domain"), items: parseChecklist(value("items")) }), "Checklist créée.")}
        >
          <TextField label="Code" value={value("code")} onChange={set("code")} required placeholder="SEC-01" />
          <TextField label="Nom" value={value("name")} onChange={set("name")} required />
          <SelectField label="Domaine" value={value("domain")} onChange={set("domain")} required options={Object.entries(DOMAIN_LABEL).map(([key, label]) => ({ value: key, label }))} />
          <TextAreaField label="Points de contrôle (un par ligne, « ! » en tête = critique)" value={value("items")} onChange={set("items")} required rows={8} />
        </Form>
      );
      break;
  }

  return (
    <Modal title={title} onClose={onClose} wide={dialog !== "inspection"}>
      <Feedback error={error} />
      {body}
    </Modal>
  );
}
