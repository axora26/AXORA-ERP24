"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { ProjectWbsNodeView, TimesheetView } from "@axora24/contracts";
import { CheckCircle2, Plus, Save, Send, Trash2, XCircle } from "lucide-react";
import { TIMESHEET_STATUS_LABEL, addDays, hrApi } from "../../../../lib/modules/hr";
import { projectsApi } from "../../../../lib/modules/projects";
import { formatDate, formatDateTime, formatMoney } from "../../../../lib/format";
import { useMutation, useResource } from "../../../../lib/hooks";
import { useSession } from "../../../../lib/session";
import { ActionBar, Button, DataTable, DetailList, Empty, Feedback, Form, Loading, Modal, PageHeader, Panel, StatusChip, TextAreaField } from "../../../../components/ui";

interface DraftEntry {
  key: string;
  workDate: string;
  hours: string;
  projectId: string;
  wbsItemId: string;
  description: string;
}

const DAY_NAMES = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
let draftCounter = 0;

function toDrafts(sheet: TimesheetView): DraftEntry[] {
  return sheet.entries.map((entry) => ({
    key: entry.id,
    workDate: entry.workDate.slice(0, 10),
    hours: entry.hours,
    projectId: entry.projectId ?? "",
    wbsItemId: entry.wbsItemId ?? "",
    description: entry.description ?? "",
  }));
}

export default function TimesheetPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const session = useSession();
  const resource = useResource(() => hrApi.timesheet(id), [id]);
  const projects = useResource(() => (session.can("projects.project.read") ? projectsApi.list().catch(() => []) : Promise.resolve([])));
  const mutation = useMutation();
  const [override, setOverride] = useState<TimesheetView | null>(null);
  const [drafts, setDrafts] = useState<DraftEntry[] | null>(null);
  const [leaves, setLeaves] = useState<Record<string, ProjectWbsNodeView[]>>({});
  const [dialog, setDialog] = useState<"validate" | "reject" | null>(null);
  const sheet = override ?? resource.data;

  const editable = Boolean(sheet && session.can("hr.timesheet.manage") && (sheet.status === "DRAFT" || sheet.status === "REJECTED"));
  const rows = drafts ?? (sheet ? toDrafts(sheet) : []);
  const projectIds = [...new Set(rows.map((row) => row.projectId).filter(Boolean))].join(",");

  useEffect(() => {
    for (const projectId of projectIds.split(",").filter(Boolean)) {
      if (leaves[projectId]) continue;
      void projectsApi
        .detail(projectId)
        .then((project) => setLeaves((current) => ({ ...current, [projectId]: project.wbs.filter((node) => node.isLeaf) })))
        .catch(() => setLeaves((current) => ({ ...current, [projectId]: [] })));
    }
  }, [projectIds, leaves]);

  if (resource.loading && !sheet) return <Loading label="Chargement de la feuille de temps…" />;
  if (!sheet) return <Feedback error={resource.error || "Feuille de temps introuvable."} />;

  const weekDays = Array.from({ length: 7 }, (_, index) => addDays(sheet.weekStart, index));
  const isEmployee = sheet.employeeUserId === session.user.id;
  const isSubmitter = sheet.submittedByUserId === session.user.id;
  const canDecide = session.can("hr.timesheet.validate") && sheet.status === "SUBMITTED" && !isEmployee && !isSubmitter;
  const projectOptions = (projects.data ?? []).filter((project) => project.status !== "COMPLETED" && project.status !== "CANCELLED");

  function update(key: string, field: keyof DraftEntry, value: string): void {
    setDrafts(rows.map((row) => (row.key === key ? { ...row, [field]: value, ...(field === "projectId" ? { wbsItemId: "" } : {}) } : row)));
  }

  async function apply(action: () => Promise<TimesheetView>, success: string): Promise<void> {
    const updated = await mutation.run(action, success);
    if (updated) {
      setOverride(updated);
      setDrafts(null);
      setDialog(null);
    }
  }

  const save = () =>
    apply(
      () =>
        hrApi.setEntries(
          sheet.id,
          rows
            .filter((row) => row.hours.trim())
            .map((row) => ({
              workDate: row.workDate,
              hours: row.hours.replace(",", ".").trim(),
              projectId: row.projectId || undefined,
              wbsItemId: row.wbsItemId || undefined,
              description: row.description || undefined,
            })),
        ),
      "Heures enregistrées.",
    );

  return (
    <>
      <PageHeader
        breadcrumb={`RH / Feuilles de temps / ${sheet.employeeName}`}
        title={`Semaine du ${formatDate(sheet.weekStart)}`}
        subtitle={`${sheet.employeeName} · ${sheet.totalHours} h déclarées · ${sheet.attendanceHours} h pointées`}
        actions={<StatusChip status={sheet.status === "SUBMITTED" ? "pending" : sheet.status} label={TIMESHEET_STATUS_LABEL[sheet.status]} />}
      />
      <Feedback error={mutation.error} notice={mutation.notice} />
      <Panel title="Synthèse">
        <DetailList
          items={[
            { label: "Heures déclarées", value: <strong>{sheet.totalHours} h</strong> },
            {
              label: "Heures pointées (badge)",
              value: sheet.attendanceHours === sheet.totalHours ? `${sheet.attendanceHours} h` : <StatusChip status="warning" label={`${sheet.attendanceHours} h — écart à justifier`} />,
            },
            { label: "Soumise le", value: formatDateTime(sheet.submittedAt) },
            { label: "Décision", value: sheet.decidedAt ? `${formatDateTime(sheet.decidedAt)}${sheet.decisionNote ? ` — ${sheet.decisionNote}` : ""}` : "—" },
          ]}
        />
        {sheet.status === "REJECTED" && <p className="inline-warning">Feuille rejetée : corrigez les heures puis soumettez-la à nouveau.</p>}
        {(sheet.status === "SUBMITTED" || sheet.status === "DRAFT") && (
          <ActionBar
            note={
              sheet.status === "DRAFT"
                ? "Brouillon : les heures ne sont ni valorisées ni prises en paie avant validation."
                : isEmployee || isSubmitter
                  ? "Vous êtes l'employé ou l'auteur de la soumission : la validation revient à un autre responsable."
                  : "La validation fige le coût des heures (heures × coût horaire) et l'impute aux projets."
            }
          >
            {sheet.status === "DRAFT" && session.can("hr.timesheet.manage") && (
              <Button variant="primary" onClick={() => void apply(() => hrApi.submitTimesheet(sheet.id), "Feuille soumise pour validation.")} disabled={drafts !== null || sheet.entries.length === 0}>
                <Send size={14} aria-hidden="true" /> Soumettre
              </Button>
            )}
            {canDecide && (
              <>
                <Button variant="danger" onClick={() => setDialog("reject")}>
                  <XCircle size={14} aria-hidden="true" /> Rejeter
                </Button>
                <Button variant="primary" onClick={() => setDialog("validate")}>
                  <CheckCircle2 size={14} aria-hidden="true" /> Valider
                </Button>
              </>
            )}
          </ActionBar>
        )}
      </Panel>

      <div className="stack">
        <Panel
          title="Heures par jour et par chantier"
          subtitle="Imputation sur un élément WBS terminal du projet ; 24 h maximum par jour"
          actions={
            editable && (
              <>
                <Button
                  onClick={() => {
                    draftCounter += 1;
                    setDrafts([...rows, { key: `new-${draftCounter}`, workDate: sheet.weekStart.slice(0, 10), hours: "", projectId: "", wbsItemId: "", description: "" }]);
                  }}
                >
                  <Plus size={14} aria-hidden="true" /> Ligne
                </Button>
                <Button variant="primary" onClick={() => void save()} disabled={drafts === null || mutation.saving}>
                  <Save size={14} aria-hidden="true" /> Enregistrer
                </Button>
              </>
            )
          }
        >
          {editable ? (
            rows.length === 0 ? (
              <Empty title="Aucune heure saisie" body="Ajoutez une ligne par jour et par chantier." />
            ) : (
              <div className="table-scroll">
                <table className="data-table entry-editor">
                  <thead>
                    <tr>
                      <th>Jour</th>
                      <th>Heures</th>
                      <th>Chantier</th>
                      <th>Élément WBS</th>
                      <th>Description</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.key}>
                        <td>
                          <select className="inline-select" aria-label="Jour" value={row.workDate} onChange={(event) => update(row.key, "workDate", event.currentTarget.value)}>
                            {weekDays.map((day, index) => (
                              <option key={day} value={day}>
                                {DAY_NAMES[index]} {formatDate(day)}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input className="inline-select narrow" aria-label="Heures" inputMode="decimal" value={row.hours} placeholder="8" onChange={(event) => update(row.key, "hours", event.currentTarget.value)} />
                        </td>
                        <td>
                          <select className="inline-select" aria-label="Chantier" value={row.projectId} onChange={(event) => update(row.key, "projectId", event.currentTarget.value)}>
                            <option value="">Hors projet</option>
                            {projectOptions.map((project) => (
                              <option key={project.id} value={project.id}>
                                {project.code} — {project.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <select
                            className="inline-select"
                            aria-label="Élément WBS"
                            value={row.wbsItemId}
                            disabled={!row.projectId}
                            onChange={(event) => update(row.key, "wbsItemId", event.currentTarget.value)}
                          >
                            <option value="">—</option>
                            {(leaves[row.projectId] ?? []).map((node) => (
                              <option key={node.id} value={node.id}>
                                {node.code} — {node.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input className="inline-select" aria-label="Description" value={row.description} onChange={(event) => update(row.key, "description", event.currentTarget.value)} />
                        </td>
                        <td>
                          <Button variant="ghost" title="Retirer la ligne" onClick={() => setDrafts(rows.filter((candidate) => candidate.key !== row.key))}>
                            <Trash2 size={14} aria-hidden="true" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : (
            <DataTable
              rows={sheet.entries}
              empty={<Empty title="Aucune heure saisie" />}
              columns={[
                { key: "day", header: "Jour", render: (entry) => formatDate(entry.workDate) },
                { key: "hours", header: "Heures", align: "right", render: (entry) => <span className="num">{entry.hours} h</span> },
                { key: "project", header: "Chantier", render: (entry) => (entry.projectId ? <Link href={`/projects/${entry.projectId}`}>{entry.projectCode}</Link> : "Hors projet") },
                { key: "desc", header: "Description", render: (entry) => entry.description ?? "—" },
                { key: "cost", header: "Coût figé", align: "right", render: (entry) => (entry.costAmount === null ? "—" : <span className="num">{formatMoney(entry.costAmount)}</span>) },
              ]}
            />
          )}
        </Panel>
      </div>

      {dialog && (
        <Modal title={dialog === "validate" ? "Valider la feuille de temps" : "Rejeter la feuille de temps"} onClose={() => setDialog(null)}>
          <Feedback error={mutation.error} />
          <DecisionForm
            required={dialog === "reject"}
            label={dialog === "validate" ? "Valider" : "Rejeter"}
            saving={mutation.saving}
            onSubmit={(note) =>
              apply(
                () => (dialog === "validate" ? hrApi.validateTimesheet(sheet.id, note || undefined) : hrApi.rejectTimesheet(sheet.id, note)),
                dialog === "validate" ? "Feuille validée : coûts figés et imputés aux projets." : "Feuille rejetée.",
              )
            }
          />
        </Modal>
      )}
    </>
  );
}

function DecisionForm({ required, label, saving, onSubmit }: { required: boolean; label: string; saving: boolean; onSubmit: (note: string) => Promise<void> }): React.ReactElement {
  const [note, setNote] = useState("");
  return (
    <Form columns={1} submitLabel={label} saving={saving} onSubmit={() => onSubmit(note)}>
      <TextAreaField label={required ? "Motif (obligatoire)" : "Commentaire"} value={note} onChange={setNote} required={required} />
    </Form>
  );
}
