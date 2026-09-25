"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { CommissioningActivityView } from "@axora24/contracts";
import { CheckCircle2, FlaskConical, PackageCheck, Plus, Trash2, Wrench } from "lucide-react";
import { PUNCH_STATUS_LABEL, STAGES, STAGE_CHIP, STAGE_LABEL, TEST_KIND_LABEL, commissioningApi } from "../../../lib/modules/commissioning";
import { documentsApi } from "../../../lib/modules/documents";
import { assetUrl } from "../../../lib/api";
import { formatDateTime } from "../../../lib/format";
import { useMutation, useResource } from "../../../lib/hooks";
import { useSession } from "../../../lib/session";
import { ActionBar, Button, CheckboxGroup, DataTable, Empty, Feedback, Form, Loading, Modal, PageHeader, Panel, SelectField, StatusChip, TextAreaField, TextField } from "../../../components/ui";

type Dialog = { kind: "test" } | { kind: "correct"; punchItemId: string } | { kind: "accept" } | { kind: "handover" };
interface MeasurementDraft {
  key: number;
  name: string;
  unit: string;
  min: string;
  max: string;
  measured: string;
}
let draftKey = 0;

export default function CommissioningActivityPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const session = useSession();
  const resource = useResource(() => commissioningApi.get(id), [id]);
  const mutation = useMutation();
  const [override, setOverride] = useState<CommissioningActivityView | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const activity = override ?? resource.data;

  if (resource.loading && !activity) return <Loading label="Chargement de la mise en service…" />;
  if (!activity) return <Feedback error={resource.error || "Mise en service introuvable."} />;
  const done = activity.status === "ACCEPTED" || activity.status === "HANDED_OVER";
  const canManage = session.can("commissioning.activity.manage") && !done;
  const isLastTester = activity.lastTesterUserId === session.user.id;
  const stageIndex = STAGES.findIndex((stage) => stage.key === activity.stage);

  async function apply(action: () => Promise<CommissioningActivityView>, success: string): Promise<void> {
    const updated = await mutation.run(action, success);
    if (updated) {
      setOverride(updated);
      setDialog(null);
    }
  }

  return (
    <>
      <PageHeader
        breadcrumb={`Mise en service / ${activity.code}`}
        title={`${activity.equipmentTag} — ${activity.equipmentName}`}
        subtitle={`${activity.code} · système ${activity.systemCode} · ${activity.projectCode ?? ""}`}
        actions={
          <>
            <StatusChip status={STAGE_CHIP[activity.stage] ?? "planned"} label={STAGE_LABEL[activity.stage]} />
            {canManage && (
              <Button variant="primary" onClick={() => setDialog({ kind: "test" })}>
                <FlaskConical size={14} aria-hidden="true" /> Fiche d&apos;essai
              </Button>
            )}
          </>
        }
      />
      <Feedback error={mutation.error} notice={mutation.notice} />
      <Panel title="Séquence de mise en service" subtitle="Garde applicative et base de données : aucune étape ne peut être contournée">
        <ol className="stepper">
          {STAGES.map((stage, index) => (
            <li key={stage.key} className={index < stageIndex ? "done" : index === stageIndex ? "current" : ""}>
              <span>{index + 1}</span>
              {stage.label}
            </li>
          ))}
        </ol>
        {activity.blockers.length > 0 && (
          <p className="inline-warning">
            Réception impossible : {activity.blockers.join(" · ")}
          </p>
        )}
        {activity.status === "IN_PROGRESS" && activity.blockers.length === 0 && (
          <ActionBar note={isLastTester ? "Vous avez réalisé le dernier essai : la réception revient à une autre personne." : "Toutes les étapes sont franchies : la réception peut être prononcée."}>
            {session.can("commissioning.activity.accept") && !isLastTester && (
              <Button variant="primary" onClick={() => setDialog({ kind: "accept" })}>
                <CheckCircle2 size={14} aria-hidden="true" /> Réceptionner
              </Button>
            )}
          </ActionBar>
        )}
        {activity.status === "ACCEPTED" && (
          <ActionBar note={`Réceptionné le ${formatDateTime(activity.acceptedAt)} par ${activity.acceptedByName} — ${activity.acceptanceNote ?? ""}`}>
            {session.can("commissioning.activity.accept") && (
              <Button variant="primary" onClick={() => setDialog({ kind: "handover" })}>
                <PackageCheck size={14} aria-hidden="true" /> Remettre au client (DOE)
              </Button>
            )}
          </ActionBar>
        )}
        {activity.status === "HANDED_OVER" && (
          <p className="inline-note">
            Remis le {formatDateTime(activity.handedOverAt)} à {activity.handoverRecipient} — DOE :{" "}
            {(activity.documents ?? []).map((document, index) => (
              <React.Fragment key={document.id}>
                {index > 0 && ", "}
                <Link href={`/documents/${document.id}`}>{document.code}</Link>
              </React.Fragment>
            ))}
          </p>
        )}
      </Panel>
      <div className="stack">
        <Panel title="Fiches d'essai" subtitle="Résultat calculé sur les bornes d'acceptation ; fiches inaltérables">
          {(activity.tests ?? []).length === 0 ? (
            <Empty icon={<FlaskConical size={22} />} title="Aucun essai" body="Commencez par le précommissioning." />
          ) : (
            <ol className="test-sheets">
              {(activity.tests ?? []).map((test) => (
                <li key={test.id} className={test.outcome === "PASS" ? "pass" : "fail"}>
                  <header>
                    <strong>
                      #{test.sequence} {TEST_KIND_LABEL[test.kind]}
                    </strong>
                    <StatusChip status={test.outcome === "PASS" ? "passed" : "failed"} label={test.outcome === "PASS" ? "Conforme" : "Non conforme"} />
                    <small>
                      {test.performedByName} · {formatDateTime(test.performedAt)}
                    </small>
                  </header>
                  {test.measurements.length > 0 && (
                    <table className="calc-table">
                      <tbody>
                        {test.measurements.map((measurement) => (
                          <tr key={measurement.name}>
                            <td>{measurement.name}</td>
                            <td className="num">
                              [{measurement.min ?? "—"} ; {measurement.max ?? "—"}] {measurement.unit}
                            </td>
                            <td className="num">
                              <strong>
                                {measurement.measured} {measurement.unit}
                              </strong>
                            </td>
                            <td>{measurement.pass ? "✓" : "✗"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {test.checks.length > 0 && (
                    <ul className="checks">
                      {test.checks.map((check) => (
                        <li key={check.label} className={check.ok ? "ok" : "ko"}>
                          {check.ok ? "✓" : "✗"} {check.label}
                        </li>
                      ))}
                    </ul>
                  )}
                  {test.notes && <p>{test.notes}</p>}
                  {test.files.map((file) => (
                    <a key={file.id} href={assetUrl(file.url)} target="_blank" rel="noreferrer">
                      {file.originalName}
                    </a>
                  ))}
                </li>
              ))}
            </ol>
          )}
        </Panel>
        <Panel title="Anomalies (réserves de mise en service)" subtitle="Chaque anomalie est rattachée à l'équipement et à l'essai qui l'a révélée ; soldée uniquement par un retest réussi">
          <DataTable
            rows={activity.punchItems ?? []}
            empty={<Empty title="Aucune anomalie" />}
            columns={[
              {
                key: "desc",
                header: "Anomalie",
                render: (item) => (
                  <>
                    <strong>{item.description}</strong>
                    <small>
                      Révélée par l&apos;essai #{item.testSequence} · gravité {item.severity}
                    </small>
                  </>
                ),
              },
              {
                key: "fix",
                header: "Correction",
                render: (item) =>
                  item.correctedAt ? (
                    <>
                      {item.correctionNote}
                      <small>
                        {item.correctedByName} · {formatDateTime(item.correctedAt)}
                      </small>
                    </>
                  ) : (
                    "—"
                  ),
              },
              { key: "status", header: "Statut", render: (item) => <StatusChip status={item.status === "CLOSED" ? "closed" : item.status === "CORRECTED" ? "warning" : "critical"} label={`${PUNCH_STATUS_LABEL[item.status]}${item.closedByTestSequence ? ` (#${item.closedByTestSequence})` : ""}`} /> },
              {
                key: "act",
                header: "",
                align: "right",
                render: (item) =>
                  item.status === "OPEN" && canManage ? (
                    <Button onClick={() => setDialog({ kind: "correct", punchItemId: item.id })}>
                      <Wrench size={13} aria-hidden="true" /> Corrigée
                    </Button>
                  ) : null,
              },
            ]}
          />
        </Panel>
        <Panel title="Procédure">
          <p className="prose">{activity.procedure}</p>
        </Panel>
      </div>

      {dialog?.kind === "test" && (
        <Modal title="Fiche d'essai" onClose={() => setDialog(null)} wide>
          <Feedback error={mutation.error} />
          <TestForm activity={activity} saving={mutation.saving} onSubmit={(input) => apply(() => commissioningApi.recordTest(activity.id, input), "Fiche d'essai enregistrée.")} />
        </Modal>
      )}
      {dialog?.kind === "correct" && (
        <Modal title="Déclarer la correction" onClose={() => setDialog(null)}>
          <Feedback error={mutation.error} />
          <NoteForm label="Déclarer corrigée" noteLabel="Correction réalisée" saving={mutation.saving} onSubmit={(note) => apply(() => commissioningApi.correct(dialog.punchItemId, { note }), "Correction déclarée : un retest est requis.")} />
        </Modal>
      )}
      {dialog?.kind === "accept" && (
        <Modal title="Réceptionner l'équipement" onClose={() => setDialog(null)}>
          <Feedback error={mutation.error} />
          <NoteForm label="Réceptionner" noteLabel="Avis de réception (obligatoire)" saving={mutation.saving} onSubmit={(note) => apply(() => commissioningApi.accept(activity.id, note), "Équipement réceptionné : il passe en exploitation.")} />
        </Modal>
      )}
      {dialog?.kind === "handover" && (
        <Modal title="Remise au client" onClose={() => setDialog(null)}>
          <Feedback error={mutation.error} />
          <HandoverForm projectId={activity.projectId} saving={mutation.saving} onSubmit={(input) => apply(() => commissioningApi.handover(activity.id, input), "Installation remise au client avec son DOE.")} />
        </Modal>
      )}
    </>
  );
}

function TestForm({ activity, saving, onSubmit }: { activity: CommissioningActivityView; saving: boolean; onSubmit: (input: Record<string, unknown>) => Promise<void> }): React.ReactElement {
  const suggested = activity.stage === "PRECOMMISSIONING" ? "PRECOMMISSIONING" : activity.stage === "RETEST" ? "RETEST" : "FUNCTIONAL";
  const [kind, setKind] = useState(suggested);
  const [measurements, setMeasurements] = useState<MeasurementDraft[]>([]);
  const [checks, setChecks] = useState<string>("");
  const [okChecks, setOkChecks] = useState<string[]>([]);
  const [anomaly, setAnomaly] = useState("");
  const [severity, setSeverity] = useState("MAJOR");
  const [notes, setNotes] = useState("");
  const checkLabels = checks.split("\n").map((line) => line.trim()).filter(Boolean);
  const willFail = checkLabels.some((label) => !okChecks.includes(label)) || measurements.some((row) => row.measured && ((row.min && Number(row.measured) < Number(row.min)) || (row.max && Number(row.measured) > Number(row.max))));
  const update = (key: number, field: keyof MeasurementDraft, value: string) => setMeasurements((rows) => rows.map((row) => (row.key === key ? { ...row, [field]: value } : row)));
  const clean = (value: string) => value.replace(",", ".").trim();

  return (
    <Form
      submitLabel="Enregistrer la fiche"
      saving={saving}
      onSubmit={() =>
        onSubmit({
          kind,
          measurements: measurements.filter((row) => row.name && row.measured).map((row) => ({ name: row.name, unit: row.unit, min: clean(row.min) || undefined, max: clean(row.max) || undefined, measured: clean(row.measured) })),
          checks: checkLabels.map((label) => ({ label, ok: okChecks.includes(label) })),
          notes: notes || undefined,
          ...(willFail && anomaly ? { anomalies: [{ description: anomaly, severity }] } : {}),
        })
      }
    >
      <SelectField
        label="Type d'essai"
        value={kind}
        onChange={setKind}
        required
        options={[
          { value: "PRECOMMISSIONING", label: "Précommissioning" },
          { value: "FUNCTIONAL", label: "Essai fonctionnel" },
          { value: "RETEST", label: "Retest après correction" },
        ]}
      />
      <TextAreaField label="Contrôles visuels (un par ligne)" value={checks} onChange={setChecks} rows={3} />
      {checkLabels.length > 0 && <CheckboxGroup label="Contrôles conformes" options={checkLabels.map((label) => ({ value: label, label }))} selected={okChecks} onChange={setOkChecks} />}
      <div className="field wide">
        <label>Mesures (bornes d&apos;acceptation)</label>
        {measurements.map((row) => (
          <div key={row.key} className="measure-row">
            <input className="inline-select" aria-label="Grandeur" placeholder="Grandeur" value={row.name} onChange={(event) => update(row.key, "name", event.currentTarget.value)} />
            <input className="inline-select narrow" aria-label="Unité" placeholder="Unité" value={row.unit} onChange={(event) => update(row.key, "unit", event.currentTarget.value)} />
            <input className="inline-select narrow" aria-label="Minimum" placeholder="Min" inputMode="decimal" value={row.min} onChange={(event) => update(row.key, "min", event.currentTarget.value)} />
            <input className="inline-select narrow" aria-label="Maximum" placeholder="Max" inputMode="decimal" value={row.max} onChange={(event) => update(row.key, "max", event.currentTarget.value)} />
            <input className="inline-select narrow" aria-label="Mesuré" placeholder="Mesuré" inputMode="decimal" value={row.measured} onChange={(event) => update(row.key, "measured", event.currentTarget.value)} />
            <Button variant="ghost" title="Retirer" onClick={() => setMeasurements((rows) => rows.filter((candidate) => candidate.key !== row.key))}>
              <Trash2 size={13} aria-hidden="true" />
            </Button>
          </div>
        ))}
        <Button
          variant="ghost"
          onClick={() => {
            draftKey += 1;
            setMeasurements((rows) => [...rows, { key: draftKey, name: "", unit: "", min: "", max: "", measured: "" }]);
          }}
        >
          <Plus size={13} aria-hidden="true" /> Mesure
        </Button>
      </div>
      {willFail && (
        <>
          <TextAreaField label="Anomalie constatée (obligatoire si non conforme)" value={anomaly} onChange={setAnomaly} required />
          <SelectField
            label="Gravité"
            value={severity}
            onChange={setSeverity}
            options={[
              { value: "MINOR", label: "Mineure" },
              { value: "MAJOR", label: "Majeure" },
              { value: "CRITICAL", label: "Critique" },
            ]}
          />
        </>
      )}
      <TextField label="Observations" value={notes} onChange={setNotes} wide />
    </Form>
  );
}

function NoteForm({ label, noteLabel, saving, onSubmit }: { label: string; noteLabel: string; saving: boolean; onSubmit: (note: string) => Promise<void> }): React.ReactElement {
  const [note, setNote] = useState("");
  return (
    <Form columns={1} submitLabel={label} saving={saving} onSubmit={() => onSubmit(note)}>
      <TextAreaField label={noteLabel} value={note} onChange={setNote} required />
    </Form>
  );
}

function HandoverForm({ projectId, saving, onSubmit }: { projectId: string; saving: boolean; onSubmit: (input: { recipient: string; documentIds: string[] }) => Promise<void> }): React.ReactElement {
  const documents = useResource(() => documentsApi.list({ projectId, status: "APPROVED" }).catch(() => []), [projectId]);
  const [recipient, setRecipient] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  return (
    <Form columns={1} submitLabel="Remettre" saving={saving} onSubmit={() => onSubmit({ recipient, documentIds: selected })}>
      <TextField label="Destinataire (client / exploitant)" value={recipient} onChange={setRecipient} required />
      <CheckboxGroup
        label="Documents du DOE (approuvés uniquement)"
        options={(documents.data ?? []).map((document) => ({ value: document.id, label: `${document.code} — ${document.title}`, hint: `Indice ${document.approvedRevision ?? document.currentRevision}` }))}
        selected={selected}
        onChange={setSelected}
      />
      {(documents.data ?? []).length === 0 && <p className="inline-warning">Aucun document approuvé sur ce projet : faites viser le DOE dans la GED.</p>}
    </Form>
  );
}
