"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { QhseCorrectiveActionView, QhseFindingView } from "@axora24/contracts";
import { CheckCircle2, Lock, Plus, RotateCcw, Wrench } from "lucide-react";
import { ACTION_STATUS_LABEL, DOMAIN_LABEL, FINDING_STATUS_LABEL, SEVERITY_CHIP, SEVERITY_LABEL, qhseApi } from "../../../../lib/modules/qhse";
import { documentsApi } from "../../../../lib/modules/documents";
import { assetUrl } from "../../../../lib/api";
import { formatDate, formatDateTime } from "../../../../lib/format";
import { useMutation, useResource } from "../../../../lib/hooks";
import { useSession } from "../../../../lib/session";
import { ActionBar, Button, DataTable, DateField, DetailList, Empty, Feedback, Form, Loading, Modal, PageHeader, Panel, StatusChip, TextAreaField, TextField } from "../../../../components/ui";

type Dialog = { kind: "add" } | { kind: "complete" | "verify" | "reject"; action: QhseCorrectiveActionView } | { kind: "close" };

export default function FindingPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const session = useSession();
  const resource = useResource(() => qhseApi.finding(id), [id]);
  const mutation = useMutation();
  const [override, setOverride] = useState<QhseFindingView | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const finding = override ?? resource.data;

  if (resource.loading && !finding) return <Loading label="Chargement de la non-conformité…" />;
  if (!finding) return <Feedback error={resource.error || "Non-conformité introuvable."} />;
  const open = finding.status !== "CLOSED";
  const isCreator = finding.createdByUserId === session.user.id;
  const actions = finding.actions ?? [];
  const allVerified = actions.length > 0 && actions.every((action) => action.status === "VERIFIED");

  async function apply(action: () => Promise<QhseFindingView>, success: string): Promise<void> {
    const updated = await mutation.run(action, success);
    if (updated) {
      setOverride(updated);
      setDialog(null);
    }
  }

  return (
    <>
      <PageHeader
        breadcrumb={`QHSE / Non-conformités / ${finding.code}`}
        title={finding.title}
        subtitle={`${finding.code} · ${DOMAIN_LABEL[finding.category]} · constatée le ${formatDateTime(finding.detectedAt)} par ${finding.createdByName}`}
        actions={
          <>
            <StatusChip status={SEVERITY_CHIP[finding.severity] ?? "high"} label={SEVERITY_LABEL[finding.severity]} />
            <StatusChip status={finding.status === "CLOSED" ? "closed" : finding.status === "OPEN" ? "open" : "in_progress"} label={FINDING_STATUS_LABEL[finding.status]} />
            {open && session.can("qhse.action.manage") && (
              <Button variant="primary" onClick={() => setDialog({ kind: "add" })}>
                <Plus size={14} aria-hidden="true" /> Action corrective
              </Button>
            )}
          </>
        }
      />
      <Feedback error={mutation.error} notice={mutation.notice} />
      <Panel title="Constat" subtitle="Inaltérable : seules les actions correctives évoluent">
        <p className="prose">{finding.description}</p>
        <DetailList
          items={[
            { label: "Projet", value: finding.projectId ? <Link href={`/projects/${finding.projectId}`}>{finding.projectCode}</Link> : "—" },
            { label: "Origine", value: finding.inspectionId ? <Link href={`/qhse/inspections/${finding.inspectionId}`}>{finding.inspectionCode}</Link> : finding.incidentCode ?? "Constat direct" },
            { label: "Actions vérifiées", value: `${finding.verifiedActions} / ${finding.actionCount}` },
            { label: "Actions en retard", value: finding.overdueActions > 0 ? <StatusChip status="overdue" label={String(finding.overdueActions)} /> : "0" },
          ]}
        />
        {finding.closedAt ? (
          <p className="inline-note">
            <Lock size={12} aria-hidden="true" /> Clôturée le {formatDateTime(finding.closedAt)} par {finding.closedByName} — {finding.closureNote}
          </p>
        ) : (
          <ActionBar
            note={
              isCreator
                ? "Vous avez ouvert cette non-conformité : sa clôture revient à une autre personne."
                : allVerified
                  ? "Toutes les actions sont vérifiées : la non-conformité peut être clôturée."
                  : "Clôture possible une fois toutes les actions correctives vérifiées."
            }
          >
            {session.can("qhse.finding.close") && !isCreator && (
              <Button variant="primary" disabled={!allVerified} onClick={() => setDialog({ kind: "close" })}>
                <CheckCircle2 size={14} aria-hidden="true" /> Clôturer
              </Button>
            )}
          </ActionBar>
        )}
      </Panel>
      <div className="stack">
        <Panel title="Actions correctives" subtitle="Responsable et échéance obligatoires ; vérification d'efficacité par une autre personne que celle qui a réalisé l'action">
          <DataTable
            rows={actions}
            empty={<Empty icon={<Wrench size={22} />} title="Aucune action" body="Définissez au moins une action corrective." />}
            columns={[
              {
                key: "desc",
                header: "Action",
                render: (action) => (
                  <>
                    <strong>{action.description}</strong>
                    <small>{action.assigneeName}</small>
                  </>
                ),
              },
              { key: "due", header: "Échéance", render: (action) => (action.overdue ? <StatusChip status="overdue" label={formatDate(action.dueDate)} /> : formatDate(action.dueDate)) },
              {
                key: "done",
                header: "Réalisation",
                render: (action) =>
                  action.completedAt ? (
                    <>
                      {action.completionNote}
                      <small>
                        {action.completedByName} · {formatDateTime(action.completedAt)}
                        {action.file && (
                          <>
                            {" · "}
                            <a href={assetUrl(action.file.url)} target="_blank" rel="noreferrer">
                              preuve
                            </a>
                          </>
                        )}
                      </small>
                    </>
                  ) : action.verificationNote ? (
                    <small className="text-danger">Refusée : {action.verificationNote}</small>
                  ) : (
                    "—"
                  ),
              },
              {
                key: "verified",
                header: "Vérification",
                render: (action) =>
                  action.verifiedAt ? (
                    <>
                      {action.verifiedByName}
                      <small>
                        {formatDateTime(action.verifiedAt)}
                        {action.verificationNote ? ` — ${action.verificationNote}` : ""}
                      </small>
                    </>
                  ) : (
                    "—"
                  ),
              },
              { key: "status", header: "Statut", render: (action) => <StatusChip status={action.status === "VERIFIED" ? "verified" : action.status === "DONE" ? "pending" : "open"} label={ACTION_STATUS_LABEL[action.status]} /> },
              {
                key: "act",
                header: "",
                align: "right",
                render: (action) =>
                  open ? (
                    <span className="chip-row">
                      {action.status === "OPEN" && session.can("qhse.action.manage") && <Button onClick={() => setDialog({ kind: "complete", action })}>Réalisée</Button>}
                      {action.status === "DONE" && session.can("qhse.finding.close") && action.completedByUserId !== session.user.id && (
                        <>
                          <Button variant="ghost" onClick={() => setDialog({ kind: "reject", action })}>
                            <RotateCcw size={13} aria-hidden="true" /> Refuser
                          </Button>
                          <Button onClick={() => setDialog({ kind: "verify", action })}>Vérifier</Button>
                        </>
                      )}
                    </span>
                  ) : null,
              },
            ]}
          />
        </Panel>
      </div>

      {dialog && (
        <Modal
          title={
            dialog.kind === "add"
              ? "Nouvelle action corrective"
              : dialog.kind === "complete"
                ? "Déclarer l'action réalisée"
                : dialog.kind === "verify"
                  ? "Vérifier l'efficacité"
                  : dialog.kind === "reject"
                    ? "Refuser la réalisation"
                    : "Clôturer la non-conformité"
          }
          onClose={() => setDialog(null)}
        >
          <Feedback error={mutation.error} />
          {dialog.kind === "add" ? (
            <AddActionForm saving={mutation.saving} onSubmit={(input) => apply(() => qhseApi.addAction(finding.id, input), "Action corrective ajoutée.")} />
          ) : (
            <NoteForm
              label={dialog.kind === "complete" ? "Déclarer" : dialog.kind === "verify" ? "Vérifier" : dialog.kind === "reject" ? "Refuser" : "Clôturer"}
              required={dialog.kind !== "verify"}
              withPhoto={dialog.kind === "complete"}
              saving={mutation.saving}
              onSubmit={(note, photo) =>
                apply(async () => {
                  if (dialog.kind === "complete") {
                    const file = photo ? await documentsApi.upload(photo) : null;
                    return qhseApi.completeAction(dialog.action.id, { note, fileId: file?.id });
                  }
                  if (dialog.kind === "verify") return qhseApi.verifyAction(dialog.action.id, note || undefined);
                  if (dialog.kind === "reject") return qhseApi.rejectAction(dialog.action.id, note);
                  return qhseApi.closeFinding(finding.id, note);
                }, dialog.kind === "close" ? "Non-conformité clôturée." : "Action mise à jour.")
              }
            />
          )}
        </Modal>
      )}
    </>
  );
}

function AddActionForm({ saving, onSubmit }: { saving: boolean; onSubmit: (input: { description: string; assigneeName: string; dueDate: string }) => Promise<void> }): React.ReactElement {
  const [description, setDescription] = useState("");
  const [assigneeName, setAssigneeName] = useState("");
  const [dueDate, setDueDate] = useState(new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10));
  return (
    <Form submitLabel="Ajouter" saving={saving} onSubmit={() => onSubmit({ description, assigneeName, dueDate })}>
      <TextAreaField label="Action" value={description} onChange={setDescription} required />
      <TextField label="Responsable" value={assigneeName} onChange={setAssigneeName} required />
      <DateField label="Échéance" value={dueDate} onChange={setDueDate} required />
    </Form>
  );
}

function NoteForm({ label, required, withPhoto, saving, onSubmit }: { label: string; required: boolean; withPhoto: boolean; saving: boolean; onSubmit: (note: string, photo: File | null) => Promise<void> }): React.ReactElement {
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  return (
    <Form columns={1} submitLabel={label} saving={saving} onSubmit={() => onSubmit(note, photo)}>
      <TextAreaField label={required ? "Commentaire (obligatoire)" : "Commentaire"} value={note} onChange={setNote} required={required} />
      {withPhoto && (
        <div className="field wide">
          <label htmlFor="action-photo">Preuve (photo ou PDF, facultative)</label>
          <input id="action-photo" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => setPhoto(event.currentTarget.files?.[0] ?? null)} />
        </div>
      )}
    </Form>
  );
}
