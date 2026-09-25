"use client";

import React, { useState } from "react";
import { useParams } from "next/navigation";
import type { SiteIssueView } from "@axora24/contracts";
import { Camera, CheckCircle2, RotateCcw, Wrench } from "lucide-react";
import { CATEGORY_LABEL, ISSUE_STATUS_CHIP, ISSUE_STATUS_LABEL, SEVERITY_LABEL, currentPosition, fieldApi } from "../../../../lib/modules/field";
import { formatDate, formatDateTime } from "../../../../lib/format";
import { useMutation, useResource } from "../../../../lib/hooks";
import { useSession } from "../../../../lib/session";
import { SyncPanel, useFieldQueue } from "../../../../components/field-sync";
import { EvidenceTimeline } from "../../../../components/field-evidence";
import { ActionBar, Button, DetailList, Empty, Feedback, Form, Loading, Modal, PageHeader, Panel, StatusChip, TextAreaField, Toggle } from "../../../../components/ui";

type Dialog = "photo" | "correction" | "close" | "reopen";

export default function SiteIssuePage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const session = useSession();
  const resource = useResource(() => fieldApi.issue(id), [id]);
  const field = useFieldQueue(() => {
    setOverride(null);
    void resource.reload();
  });
  const mutation = useMutation();
  const [override, setOverride] = useState<SiteIssueView | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const issue = override ?? resource.data;

  if (resource.loading && !issue) return <Loading label="Chargement de la réserve…" />;
  if (!issue) return <Feedback error={resource.error || "Réserve introuvable."} />;

  const isDeclarer = issue.correctionSubmittedByUserId === session.user.id;
  const canVerify = session.can("field.issue.close") && issue.status === "CORRECTION_SUBMITTED" && !isDeclarer;
  const pendingHere = field.queue.filter((operation) => JSON.stringify(operation.payload).includes(issue.id)).length;

  async function decide(action: () => Promise<SiteIssueView>, success: string): Promise<void> {
    const updated = await mutation.run(action, success);
    if (updated) {
      setOverride(updated);
      setDialog(null);
    }
  }

  return (
    <>
      <PageHeader
        breadcrumb={`Chantier / Réserves / ${issue.code}`}
        title={issue.title}
        subtitle={`${issue.code} · ${issue.projectCode ?? ""} · créée le ${formatDateTime(issue.createdAt)} par ${issue.createdByName}`}
        actions={
          <>
            <StatusChip status={ISSUE_STATUS_CHIP[issue.status] ?? "open"} label={ISSUE_STATUS_LABEL[issue.status]} />
            {issue.status !== "CLOSED" && session.can("field.evidence.create") && (
              <Button onClick={() => setDialog("photo")}>
                <Camera size={14} aria-hidden="true" /> Photo
              </Button>
            )}
            {issue.status === "OPEN" && session.can("field.issue.manage") && (
              <Button variant="primary" onClick={() => setDialog("correction")}>
                <Wrench size={14} aria-hidden="true" /> Déclarer la correction
              </Button>
            )}
          </>
        }
      />
      <Feedback error={mutation.error} notice={mutation.notice} />
      {(pendingHere > 0 || field.queue.some((operation) => operation.state !== "PENDING")) && <SyncPanel field={field} />}
      <Panel title="Constat">
        <DetailList
          items={[
            { label: "Nature", value: CATEGORY_LABEL[issue.category] },
            { label: "Gravité", value: <StatusChip status={issue.severity.toLowerCase()} label={SEVERITY_LABEL[issue.severity]} /> },
            { label: "Localisation", value: [issue.zoneName, issue.taskName].filter(Boolean).join(" · ") || "—" },
            { label: "Responsable", value: issue.assigneeName },
            { label: "Échéance", value: issue.overdue ? <StatusChip status="overdue" label={formatDate(issue.dueDate)} /> : formatDate(issue.dueDate) },
            { label: "Version", value: `v${issue.version}` },
          ]}
        />
        <p className="inline-note">{issue.description}</p>
        {issue.correctionSubmittedAt && (
          <p className="inline-warning">
            Correction déclarée le {formatDateTime(issue.correctionSubmittedAt)} : « {issue.correctionNote} »
          </p>
        )}
        {issue.closedAt && (
          <p className="inline-note">
            Levée le {formatDateTime(issue.closedAt)} par {issue.closedByName}
            {issue.closureNote ? ` — ${issue.closureNote}` : ""}
          </p>
        )}
        {issue.status === "CORRECTION_SUBMITTED" && (
          <ActionBar
            note={
              isDeclarer
                ? "Vous avez déclaré cette correction : sa vérification revient à une autre personne."
                : "Vérifiez la photo de correction sur place avant de lever la réserve."
            }
          >
            {canVerify && (
              <>
                <Button variant="danger" onClick={() => setDialog("reopen")}>
                  <RotateCcw size={14} aria-hidden="true" /> Refuser la correction
                </Button>
                <Button variant="primary" onClick={() => setDialog("close")}>
                  <CheckCircle2 size={14} aria-hidden="true" /> Lever la réserve
                </Button>
              </>
            )}
          </ActionBar>
        )}
      </Panel>
      <div className="stack">
        <Panel title="Preuves horodatées" subtitle="Append-only : une preuve n'est jamais modifiée ni supprimée">
          {(issue.evidence ?? []).length === 0 ? <Empty title="Aucune preuve" /> : <EvidenceTimeline items={issue.evidence ?? []} />}
        </Panel>
      </div>

      {(dialog === "photo" || dialog === "correction") && (
        <Modal title={dialog === "photo" ? "Ajouter une photo" : "Déclarer la correction"} onClose={() => setDialog(null)}>
          <EvidenceForm
            correction={dialog === "correction"}
            onSubmit={async (photo, note, gps) => {
              const position = gps ? await currentPosition() : null;
              const operations = [
                {
                  type: "evidence.create" as const,
                  projectId: issue.projectId,
                  label: `${dialog === "correction" ? "Photo de correction" : "Photo"} — ${issue.code}`,
                  payload: { projectId: issue.projectId, kind: dialog === "correction" ? "CORRECTION" : "PHOTO", issueId: issue.id, note: note || undefined, takenAt: new Date().toISOString(), ...(position ?? {}) },
                },
                ...(dialog === "correction"
                  ? [
                      {
                        type: "issue.submitCorrection" as const,
                        projectId: issue.projectId,
                        label: `Correction déclarée — ${issue.code}`,
                        baseVersion: issue.version,
                        payload: { issueId: issue.id, note },
                      },
                    ]
                  : []),
              ];
              await field.enqueue(operations, { forClientIndex: 0, blob: photo, name: photo.name });
              setDialog(null);
            }}
          />
        </Modal>
      )}
      {(dialog === "close" || dialog === "reopen") && (
        <Modal title={dialog === "close" ? "Lever la réserve" : "Refuser la correction"} onClose={() => setDialog(null)}>
          <Feedback error={mutation.error} />
          <NoteForm
            required={dialog === "reopen"}
            label={dialog === "close" ? "Lever" : "Refuser"}
            saving={mutation.saving}
            onSubmit={(note) =>
              decide(
                () => (dialog === "close" ? fieldApi.closeIssue(issue.id, issue.version, note || undefined) : fieldApi.reopenIssue(issue.id, note)),
                dialog === "close" ? "Réserve levée." : "Correction refusée : une nouvelle preuve est exigée.",
              )
            }
          />
        </Modal>
      )}
    </>
  );
}

function EvidenceForm({ correction, onSubmit }: { correction: boolean; onSubmit: (photo: File, note: string, gps: boolean) => Promise<void> }): React.ReactElement {
  const [photo, setPhoto] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [gps, setGps] = useState(false);
  const [saving, setSaving] = useState(false);
  return (
    <Form
      columns={1}
      submitLabel={correction ? "Déclarer la correction" : "Ajouter"}
      saving={saving}
      onSubmit={async () => {
        if (!photo) return;
        setSaving(true);
        try {
          await onSubmit(photo, note, gps);
        } finally {
          setSaving(false);
        }
      }}
    >
      <div className="field wide">
        <label htmlFor="issue-photo">{correction ? "Photo de la correction *" : "Photo *"}</label>
        <input id="issue-photo" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" required onChange={(event) => setPhoto(event.currentTarget.files?.[0] ?? null)} />
      </div>
      <TextAreaField label={correction ? "Travaux réalisés (obligatoire)" : "Légende"} value={note} onChange={setNote} required={correction} />
      <Toggle label="Joindre la position GPS" checked={gps} onChange={setGps} />
    </Form>
  );
}

function NoteForm({ required, label, saving, onSubmit }: { required: boolean; label: string; saving: boolean; onSubmit: (note: string) => Promise<void> }): React.ReactElement {
  const [note, setNote] = useState("");
  return (
    <Form columns={1} submitLabel={label} saving={saving} onSubmit={() => onSubmit(note)}>
      <TextAreaField label={required ? "Motif (obligatoire)" : "Commentaire de vérification"} value={note} onChange={setNote} required={required} />
    </Form>
  );
}
