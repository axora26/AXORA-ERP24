"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { SiteDailyLogView } from "@axora24/contracts";
import { Camera, ClipboardList, HardHat, Image as ImageIcon, MapPin, Plus } from "lucide-react";
import { projectsApi } from "../../lib/modules/projects";
import { CATEGORY_LABEL, ISSUE_STATUS_LABEL, SEVERITY_LABEL, ISSUE_STATUS_CHIP, fieldApi, currentPosition } from "../../lib/modules/field";
import { assetUrl } from "../../lib/api";
import { formatDate, formatDateTime } from "../../lib/format";
import { useResource } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import { SyncPanel, useFieldQueue } from "../../components/field-sync";
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
  Toggle,
} from "../../components/ui";

type TabId = "issues" | "logs" | "photos" | "zones";
type Dialog = "issue" | "evidence" | "log" | "zone";
const PROJECT_KEY = "axora.field.project";

export default function FieldPage(): React.ReactElement {
  const session = useSession();
  const router = useRouter();
  const projects = useResource(() => projectsApi.list());
  const [projectId, setProjectId] = useState("");
  const [tab, setTab] = useState<TabId>("issues");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const list = projects.data ?? [];
    if (projectId || list.length === 0) return;
    let stored = "";
    try {
      stored = window.localStorage.getItem(PROJECT_KEY) ?? "";
    } catch {
      stored = "";
    }
    const preferred = list.find((project) => project.id === stored) ?? list.find((project) => project.status === "IN_PROGRESS") ?? list[0];
    if (preferred) setProjectId(preferred.id);
  }, [projects.data, projectId]);

  const data = useResource(
    () =>
      projectId
        ? Promise.all([fieldApi.issues(projectId), fieldApi.logs(projectId), fieldApi.evidence(projectId), fieldApi.zones(projectId), projectsApi.detail(projectId)])
        : Promise.resolve(null),
    [projectId],
  );
  const field = useFieldQueue(() => void data.reload());
  const [issues, logs, evidence, zones, project] = data.data ?? [[], [], [], [], null];

  function choose(id: string): void {
    setProjectId(id);
    try {
      window.localStorage.setItem(PROJECT_KEY, id);
    } catch {
      // Preference d'affichage uniquement.
    }
  }

  const open = issues.filter((issue) => issue.status !== "CLOSED");
  const overdue = open.filter((issue) => issue.overdue).length;
  const toVerify = issues.filter((issue) => issue.status === "CORRECTION_SUBMITTED").length;
  const today = new Date().toISOString().slice(0, 10);
  const todayLog = logs.find((log) => log.logDate === today) ?? null;

  return (
    <>
      <PageHeader
        breadcrumb="Projets & chantiers / Chantier"
        title="Chantier"
        subtitle="Journal quotidien, photos horodatées, réserves suivies jusqu'à leur levée — utilisable sans réseau."
        onRefresh={() => void data.reload()}
        actions={
          projectId && (
            <>
              {session.can("field.log.manage") && (
                <Button onClick={() => setDialog("log")}>
                  <ClipboardList size={15} aria-hidden="true" /> Journal du jour
                </Button>
              )}
              {session.can("field.evidence.create") && (
                <Button onClick={() => setDialog("evidence")}>
                  <Camera size={15} aria-hidden="true" /> Photo / observation
                </Button>
              )}
              {session.can("field.issue.manage") && (
                <Button variant="primary" onClick={() => setDialog("issue")}>
                  <Plus size={15} aria-hidden="true" /> Réserve
                </Button>
              )}
            </>
          )
        }
      />
      <Feedback error={projects.error || data.error || error} />
      {projects.loading && !projects.data ? (
        <Loading label="Chargement des chantiers…" />
      ) : (projects.data ?? []).length === 0 ? (
        <Empty icon={<HardHat size={22} />} title="Aucun projet" body="Le suivi de chantier s'appuie sur un projet existant." />
      ) : (
        <>
          <div className="toolbar">
            <SelectField
              label="Chantier"
              value={projectId}
              onChange={choose}
              options={(projects.data ?? []).map((candidate) => ({ value: candidate.id, label: `${candidate.code} — ${candidate.name}` }))}
            />
          </div>
          <SyncPanel field={field} />
          <Metrics label="Synthèse chantier">
            <Metric icon={<HardHat size={20} />} tone={overdue > 0 ? "red" : open.length > 0 ? "amber" : "green"} label="Réserves ouvertes" value={String(open.length)} detail={`${overdue} en retard`} />
            <Metric icon={<ClipboardList size={20} />} tone="violet" label="Corrections à vérifier" value={String(toVerify)} detail="Vérification par un tiers" />
            <Metric
              icon={<ClipboardList size={20} />}
              tone={todayLog ? "green" : "amber"}
              label="Journal du jour"
              value={todayLog ? (todayLog.status === "SIGNED" ? "Signé" : "Brouillon") : "À saisir"}
              detail={todayLog ? `${todayLog.workforceCount} déclarés · ${todayLog.clockedInCount} pointés` : formatDate(today)}
            />
            <Metric icon={<ImageIcon size={20} />} tone="blue" label="Preuves horodatées" value={String(evidence.length)} detail="Photos et observations" />
          </Metrics>

          <Tabs<TabId>
            active={tab}
            onChange={setTab}
            tabs={[
              { id: "issues", label: "Réserves", count: issues.length },
              { id: "logs", label: "Journal", count: logs.length },
              { id: "photos", label: "Photos", count: evidence.length },
              { id: "zones", label: "Zones", count: zones.length },
            ]}
          />
          <div className="stack">
            {data.loading && !data.data ? (
              <Loading label="Chargement du chantier…" />
            ) : (
              <>
                {tab === "issues" && (
                  <Panel title="Réserves" subtitle="Responsable et échéance obligatoires ; levée uniquement sur photo de correction vérifiée">
                    <DataTable
                      rows={issues}
                      onRowClick={(issue) => router.push(`/field/issues/${issue.id}`)}
                      empty={<Empty icon={<HardHat size={22} />} title="Aucune réserve" />}
                      columns={[
                        {
                          key: "title",
                          header: "Réserve",
                          render: (issue) => (
                            <>
                              <strong>{issue.title}</strong>
                              <small>
                                {issue.code} · {CATEGORY_LABEL[issue.category]}
                                {issue.zoneName ? ` · ${issue.zoneName}` : ""}
                              </small>
                            </>
                          ),
                        },
                        { key: "severity", header: "Gravité", render: (issue) => <StatusChip status={issue.severity.toLowerCase()} label={SEVERITY_LABEL[issue.severity]} /> },
                        { key: "who", header: "Responsable", render: (issue) => issue.assigneeName },
                        { key: "due", header: "Échéance", render: (issue) => (issue.overdue ? <StatusChip status="overdue" label={formatDate(issue.dueDate)} /> : formatDate(issue.dueDate)) },
                        { key: "proofs", header: "Preuves", align: "right", render: (issue) => String(issue.evidenceCount) },
                        { key: "status", header: "Statut", render: (issue) => <StatusChip status={ISSUE_STATUS_CHIP[issue.status] ?? "open"} label={ISSUE_STATUS_LABEL[issue.status]} /> },
                      ]}
                    />
                  </Panel>
                )}
                {tab === "logs" && (
                  <Panel title="Journal de chantier" subtitle="Un journal par jour ; figé après signature du responsable">
                    <DataTable
                      rows={logs}
                      onRowClick={(log) => router.push(`/field/logs/${log.id}`)}
                      empty={<Empty icon={<ClipboardList size={22} />} title="Aucun journal" />}
                      columns={[
                        { key: "date", header: "Date", render: (log) => <strong>{formatDate(log.logDate)}</strong> },
                        { key: "weather", header: "Météo", render: (log) => [log.weather, log.temperature].filter(Boolean).join(" · ") || "—" },
                        { key: "staff", header: "Effectif", align: "right", render: (log) => `${log.workforceCount} déclarés · ${log.clockedInCount} pointés` },
                        { key: "summary", header: "Travaux", render: (log) => <span className="clamp">{log.summary}</span> },
                        { key: "status", header: "Statut", render: (log) => <StatusChip status={log.status === "SIGNED" ? "verified" : "draft"} label={log.status === "SIGNED" ? `Signé · ${log.signedByName}` : "Brouillon"} /> },
                      ]}
                    />
                  </Panel>
                )}
                {tab === "photos" && (
                  <Panel title="Photos et observations" subtitle="Horodatées à la prise de vue et rattachées à une réserve, une tâche, une zone ou un journal">
                    {evidence.length === 0 ? (
                      <Empty icon={<ImageIcon size={22} />} title="Aucune preuve" />
                    ) : (
                      <div className="evidence-grid">
                        {evidence.map((item) => (
                          <figure key={item.id} className={`evidence-card kind-${item.kind.toLowerCase()}`}>
                            {item.file ? <img src={assetUrl(item.file.url)} alt={item.note ?? "Photo de chantier"} loading="lazy" /> : <div className="evidence-note">{item.note}</div>}
                            <figcaption>
                              <strong>{item.kind === "CORRECTION" ? "Correction" : item.kind === "PHOTO" ? "Photo" : "Observation"}</strong>
                              <span>{[item.issueCode, item.taskName, item.zoneName].filter(Boolean).join(" · ") || "Journal"}</span>
                              <small>
                                {formatDateTime(item.takenAt)} · {item.createdByName}
                                {item.latitude ? " · GPS" : ""}
                              </small>
                            </figcaption>
                          </figure>
                        ))}
                      </div>
                    )}
                  </Panel>
                )}
                {tab === "zones" && (
                  <Panel
                    title="Zones"
                    actions={
                      session.can("field.log.manage") && (
                        <Button onClick={() => setDialog("zone")}>
                          <Plus size={14} aria-hidden="true" /> Zone
                        </Button>
                      )
                    }
                  >
                    <DataTable
                      rows={zones}
                      empty={<Empty icon={<MapPin size={22} />} title="Aucune zone" body="Découpez le chantier (niveaux, bâtiments, locaux) pour localiser les réserves." />}
                      columns={[
                        { key: "code", header: "Code", render: (zone) => <strong>{zone.code}</strong> },
                        { key: "name", header: "Zone", render: (zone) => zone.name },
                        { key: "open", header: "Réserves ouvertes", align: "right", render: (zone) => String(zone.openIssues) },
                      ]}
                    />
                  </Panel>
                )}
              </>
            )}
          </div>
        </>
      )}

      {dialog && projectId && (
        <FieldDialog
          dialog={dialog}
          projectId={projectId}
          zones={zones.map((zone) => ({ value: zone.id, label: `${zone.code} — ${zone.name}` }))}
          tasks={(project?.tasks ?? []).map((task) => ({ value: task.id, label: task.name }))}
          issues={open.map((issue) => ({ value: issue.id, label: `${issue.code} — ${issue.title}` }))}
          todayLog={todayLog}
          onClose={() => setDialog(null)}
          onEnqueue={async (operations, blob) => {
            setError("");
            const ids = await field.enqueue(operations, blob);
            setDialog(null);
            return ids;
          }}
          onZone={async (code, name) => {
            try {
              await fieldApi.createZone({ projectId, code, name });
              setDialog(null);
              await data.reload();
            } catch (caught) {
              setError(caught instanceof Error ? caught.message : "Création impossible.");
            }
          }}
        />
      )}
    </>
  );
}

function FieldDialog({
  dialog,
  projectId,
  zones,
  tasks,
  issues,
  todayLog,
  onClose,
  onEnqueue,
  onZone,
}: {
  dialog: Dialog;
  projectId: string;
  zones: Array<{ value: string; label: string }>;
  tasks: Array<{ value: string; label: string }>;
  issues: Array<{ value: string; label: string }>;
  todayLog: SiteDailyLogView | null;
  onClose: () => void;
  onEnqueue: ReturnType<typeof useFieldQueue>["enqueue"];
  onZone: (code: string, name: string) => Promise<void>;
}): React.ReactElement {
  const inTwoWeeks = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
  const [values, setValues] = useState<Record<string, string>>({
    category: "QUALITY",
    severity: "MEDIUM",
    dueDate: inTwoWeeks,
    kind: "PHOTO",
    logDate: new Date().toISOString().slice(0, 10),
    weather: todayLog?.weather ?? "",
    temperature: todayLog?.temperature ?? "",
    workforceCount: todayLog ? String(todayLog.workforceCount) : "",
    summary: todayLog?.summary ?? "",
    safetyNotes: todayLog?.safetyNotes ?? "",
  });
  const [photo, setPhoto] = useState<File | null>(null);
  const [gps, setGps] = useState(false);
  const [saving, setSaving] = useState(false);
  const set = (field: string) => (value: string) => setValues((current) => ({ ...current, [field]: value }));
  const value = (field: string) => values[field] ?? "";

  async function submit(action: () => Promise<void>): Promise<void> {
    setSaving(true);
    try {
      await action();
    } finally {
      setSaving(false);
    }
  }

  const photoInput = (label: string, required: boolean) => (
    <div className="field wide">
      <label htmlFor="field-photo">
        {label}
        {required ? " *" : ""}
      </label>
      <input id="field-photo" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" required={required} onChange={(event) => setPhoto(event.currentTarget.files?.[0] ?? null)} />
      <small className="field-note">L'heure de prise de vue est enregistrée sur l'appareil, même hors ligne.</small>
    </div>
  );

  let title = "";
  let body: React.ReactNode = null;
  switch (dialog) {
    case "issue":
      title = "Nouvelle réserve";
      body = (
        <Form
          submitLabel="Enregistrer"
          saving={saving}
          onSubmit={() =>
            submit(async () => {
              const position = gps ? await currentPosition() : null;
              const takenAt = new Date().toISOString();
              const issueClientId = `issue-${crypto.randomUUID()}`;
              const operations = [
                {
                  clientId: issueClientId,
                  type: "issue.create" as const,
                  projectId,
                  label: `Réserve « ${value("title")} »`,
                  payload: {
                    projectId,
                    title: value("title"),
                    description: value("description"),
                    category: value("category"),
                    severity: value("severity"),
                    zoneId: value("zoneId") || undefined,
                    taskId: value("taskId") || undefined,
                    assigneeName: value("assigneeName"),
                    dueDate: value("dueDate"),
                  },
                },
                ...(photo
                  ? [
                      {
                        type: "evidence.create" as const,
                        projectId,
                        label: `Photo de la réserve « ${value("title")} »`,
                        payload: { projectId, kind: "PHOTO", issueClientId, takenAt, note: value("title"), ...(position ?? {}) },
                      },
                    ]
                  : []),
              ];
              await onEnqueue(operations, photo ? { forClientIndex: 1, blob: photo, name: photo.name } : undefined);
            })
          }
        >
          <TextField label="Intitulé" value={value("title")} onChange={set("title")} required wide />
          <TextAreaField label="Constat" value={value("description")} onChange={set("description")} required />
          <SelectField label="Nature" value={value("category")} onChange={set("category")} required options={Object.entries(CATEGORY_LABEL).map(([key, label]) => ({ value: key, label }))} />
          <SelectField label="Gravité" value={value("severity")} onChange={set("severity")} required options={Object.entries(SEVERITY_LABEL).map(([key, label]) => ({ value: key, label }))} />
          <SelectField label="Zone" value={value("zoneId")} onChange={set("zoneId")} options={zones} emptyLabel="Non localisée" />
          <SelectField label="Tâche" value={value("taskId")} onChange={set("taskId")} options={tasks} emptyLabel="Aucune" />
          <TextField label="Responsable de la levée" value={value("assigneeName")} onChange={set("assigneeName")} required placeholder="Entreprise ou personne" />
          <DateField label="Échéance" value={value("dueDate")} onChange={set("dueDate")} required />
          {photoInput("Photo du constat", false)}
          <Toggle label="Joindre la position GPS" checked={gps} onChange={setGps} />
        </Form>
      );
      break;
    case "evidence":
      title = "Photo ou observation";
      body = (
        <Form
          submitLabel="Enregistrer"
          saving={saving}
          onSubmit={() =>
            submit(async () => {
              const position = gps && value("kind") === "PHOTO" ? await currentPosition() : null;
              await onEnqueue(
                [
                  {
                    type: "evidence.create",
                    projectId,
                    label: value("kind") === "PHOTO" ? "Photo de chantier" : "Observation",
                    payload: {
                      projectId,
                      kind: value("kind"),
                      note: value("note") || undefined,
                      issueId: value("issueId") || undefined,
                      taskId: value("taskId") || undefined,
                      zoneId: value("zoneId") || undefined,
                      dailyLogId: !value("issueId") && !value("taskId") && !value("zoneId") && todayLog?.status === "DRAFT" ? todayLog.id : undefined,
                      takenAt: new Date().toISOString(),
                      ...(position ?? {}),
                    },
                  },
                ],
                value("kind") === "PHOTO" && photo ? { forClientIndex: 0, blob: photo, name: photo.name } : undefined,
              );
            })
          }
        >
          <SelectField
            label="Type"
            value={value("kind")}
            onChange={set("kind")}
            required
            options={[
              { value: "PHOTO", label: "Photo" },
              { value: "OBSERVATION", label: "Observation écrite" },
            ]}
          />
          <SelectField label="Réserve" value={value("issueId")} onChange={set("issueId")} options={issues} emptyLabel="Aucune" />
          <SelectField label="Tâche" value={value("taskId")} onChange={set("taskId")} options={tasks} emptyLabel="Aucune" />
          <SelectField label="Zone" value={value("zoneId")} onChange={set("zoneId")} options={zones} emptyLabel="Aucune" />
          {value("kind") === "PHOTO" && photoInput("Photo", true)}
          <TextAreaField label={value("kind") === "PHOTO" ? "Légende" : "Observation"} value={value("note")} onChange={set("note")} required={value("kind") === "OBSERVATION"} />
          {value("kind") === "PHOTO" && <Toggle label="Joindre la position GPS" checked={gps} onChange={setGps} />}
          <p className="inline-note">Sans réserve, tâche ni zone, la preuve est rattachée au journal du jour (s'il est en brouillon).</p>
        </Form>
      );
      break;
    case "log":
      title = todayLog ? "Compléter le journal" : "Journal de chantier";
      body =
        todayLog?.status === "SIGNED" && value("logDate") === todayLog.logDate ? (
          <p className="inline-note">Le journal du jour est signé et figé.</p>
        ) : (
          <Form
            submitLabel="Enregistrer"
            saving={saving}
            onSubmit={() =>
              submit(() =>
                onEnqueue([
                  {
                    type: "log.save",
                    projectId,
                    label: `Journal du ${formatDate(value("logDate"))}`,
                    ...(todayLog && value("logDate") === todayLog.logDate ? { baseVersion: todayLog.version } : {}),
                    payload: {
                      projectId,
                      logDate: value("logDate"),
                      weather: value("weather") || undefined,
                      temperature: value("temperature") || undefined,
                      workforceCount: Number(value("workforceCount") || "0"),
                      summary: value("summary"),
                      safetyNotes: value("safetyNotes") || undefined,
                    },
                  },
                ]).then(() => undefined),
              )
            }
          >
            <DateField label="Date" value={value("logDate")} onChange={set("logDate")} required />
            <TextField label="Effectif présent" value={value("workforceCount")} onChange={set("workforceCount")} required placeholder="12" />
            <TextField label="Météo" value={value("weather")} onChange={set("weather")} placeholder="Ensoleillé" />
            <TextField label="Température" value={value("temperature")} onChange={set("temperature")} placeholder="27 °C" />
            <TextAreaField label="Travaux réalisés" value={value("summary")} onChange={set("summary")} required />
            <TextAreaField label="Sécurité / événements" value={value("safetyNotes")} onChange={set("safetyNotes")} />
          </Form>
        );
      break;
    case "zone":
      title = "Nouvelle zone";
      body = (
        <Form submitLabel="Créer" saving={saving} onSubmit={() => submit(() => onZone(value("code"), value("name")))}>
          <TextField label="Code" value={value("code")} onChange={set("code")} required placeholder="N1" />
          <TextField label="Nom" value={value("name")} onChange={set("name")} required placeholder="Niveau 1" />
        </Form>
      );
      break;
  }

  return (
    <Modal title={title} onClose={onClose} wide={dialog === "issue" || dialog === "log"}>
      {body}
    </Modal>
  );
}
