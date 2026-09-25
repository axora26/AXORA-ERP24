"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { ManagedDocumentView } from "@axora24/contracts";
import { Archive, CheckCircle2, Download, Send, Upload, XCircle } from "lucide-react";
import { CATEGORY_LABEL, DOCUMENT_STATUS_CHIP, DOCUMENT_STATUS_LABEL, documentsApi, formatBytes } from "../../../lib/modules/documents";
import { assetUrl } from "../../../lib/api";
import { formatDateTime } from "../../../lib/format";
import { useMutation, useResource } from "../../../lib/hooks";
import { useSession } from "../../../lib/session";
import { ActionBar, Button, DataTable, DetailList, Feedback, Form, Loading, Modal, PageHeader, Panel, StatusChip, TextAreaField } from "../../../components/ui";

type Dialog = "version" | "approve" | "reject" | "archive";

export default function DocumentPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const session = useSession();
  const resource = useResource(() => documentsApi.get(id), [id]);
  const mutation = useMutation();
  const [override, setOverride] = useState<ManagedDocumentView | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const document = override ?? resource.data;

  if (resource.loading && !document) return <Loading label="Chargement du document…" />;
  if (!document) return <Feedback error={resource.error || "Document introuvable."} />;

  const versions = document.versions ?? [];
  const latest = versions[0];
  const isAuthor = latest ? latest.uploadedByUserId === session.user.id || latest.submittedByUserId === session.user.id : false;
  const canManage = session.can("documents.document.manage") && document.status !== "ARCHIVED";
  const canDecide = session.can("documents.document.approve") && document.status === "SUBMITTED" && !isAuthor;
  const applicable = versions.find((version) => version.status === "APPROVED");

  async function apply(action: () => Promise<ManagedDocumentView>, success: string): Promise<void> {
    const updated = await mutation.run(action, success);
    if (updated) {
      setOverride(updated);
      setDialog(null);
    }
  }

  return (
    <>
      <PageHeader
        breadcrumb={`GED / ${document.code}`}
        title={document.title}
        subtitle={`${document.code} · ${CATEGORY_LABEL[document.category]} · indice ${document.currentRevision}`}
        actions={
          <>
            <StatusChip status={DOCUMENT_STATUS_CHIP[document.status] ?? "draft"} label={DOCUMENT_STATUS_LABEL[document.status]} />
            {latest && (
              <a className="btn btn-secondary" href={assetUrl(latest.file.url)} target="_blank" rel="noreferrer">
                <Download size={14} aria-hidden="true" /> Ouvrir l&apos;indice {latest.revision}
              </a>
            )}
            {canManage && document.status !== "SUBMITTED" && (
              <Button variant="primary" onClick={() => setDialog("version")}>
                <Upload size={14} aria-hidden="true" /> Nouvelle révision
              </Button>
            )}
          </>
        }
      />
      <Feedback error={mutation.error} notice={mutation.notice} />
      <Panel title="Fiche">
        <DetailList
          items={[
            { label: "Projet", value: document.projectId ? <Link href={`/projects/${document.projectId}`}>{document.projectCode}</Link> : "Entreprise" },
            { label: "Dossier", value: document.folderName ?? "—" },
            { label: "Indice applicable", value: applicable ? <strong>{applicable.revision}</strong> : <StatusChip status="pending" label="Aucun indice approuvé" /> },
            { label: "Mots-clés", value: document.keywords ?? "—" },
          ]}
        />
        {document.status === "ARCHIVED" && <p className="inline-warning">Archivé le {formatDateTime(document.archivedAt)} : consultable, plus révisable.</p>}
        {(document.status === "DRAFT" || document.status === "SUBMITTED" || (document.status !== "ARCHIVED" && session.can("documents.document.approve"))) && (
          <ActionBar
            note={
              document.status === "DRAFT"
                ? "Brouillon : soumettez l'indice au visa d'un tiers."
                : document.status === "SUBMITTED"
                  ? isAuthor
                    ? "Vous avez déposé ou soumis cet indice : son visa revient à une autre personne."
                    : "Indice en attente de visa."
                  : "Archivez le document quand il n'est plus applicable (il reste consultable)."
            }
          >
            {document.status === "DRAFT" && canManage && (
              <Button variant="primary" onClick={() => void apply(() => documentsApi.submit(document.id), "Indice soumis au visa.")}>
                <Send size={14} aria-hidden="true" /> Soumettre au visa
              </Button>
            )}
            {canDecide && (
              <>
                <Button variant="danger" onClick={() => setDialog("reject")}>
                  <XCircle size={14} aria-hidden="true" /> Refuser
                </Button>
                <Button variant="primary" onClick={() => setDialog("approve")}>
                  <CheckCircle2 size={14} aria-hidden="true" /> Approuver
                </Button>
              </>
            )}
            {session.can("documents.document.approve") && document.status !== "SUBMITTED" && (
              <Button variant="ghost" onClick={() => setDialog("archive")}>
                <Archive size={14} aria-hidden="true" /> Archiver
              </Button>
            )}
          </ActionBar>
        )}
      </Panel>
      <div className="stack">
        <Panel title="Historique des révisions" subtitle="Chaque indice est conservé intact (empreinte SHA-256) ; une révision n'écrase jamais la précédente">
          <DataTable
            rows={versions}
            empty={null}
            columns={[
              { key: "rev", header: "Indice", render: (version) => <strong>{version.revision}</strong> },
              {
                key: "file",
                header: "Fichier",
                render: (version) => (
                  <>
                    <a href={assetUrl(version.file.url)} target="_blank" rel="noreferrer">
                      {version.fileName}
                    </a>
                    <small>
                      {formatBytes(version.file.size)} · SHA-256 {version.file.sha256.slice(0, 12)}…
                    </small>
                  </>
                ),
              },
              {
                key: "note",
                header: "Objet de la révision",
                render: (version) => (
                  <>
                    {version.changeNote ?? "—"}
                    <small>
                      par {version.uploadedByName} le {formatDateTime(version.createdAt)}
                    </small>
                  </>
                ),
              },
              {
                key: "decision",
                header: "Visa",
                render: (version) =>
                  version.decidedAt ? (
                    <>
                      {version.decidedByName}
                      <small>
                        {formatDateTime(version.decidedAt)}
                        {version.decisionNote ? ` — ${version.decisionNote}` : ""}
                      </small>
                    </>
                  ) : (
                    "—"
                  ),
              },
              { key: "status", header: "Statut", render: (version) => <StatusChip status={DOCUMENT_STATUS_CHIP[version.status] ?? "draft"} label={DOCUMENT_STATUS_LABEL[version.status]} /> },
            ]}
          />
        </Panel>
      </div>

      {dialog === "version" && (
        <Modal title={`Nouvelle révision (indice suivant de ${document.currentRevision})`} onClose={() => setDialog(null)}>
          <Feedback error={mutation.error} />
          <VersionForm
            saving={mutation.saving}
            onSubmit={(file, changeNote) =>
              apply(async () => {
                const stored = await documentsApi.upload(file);
                return documentsApi.addVersion(document.id, { fileId: stored.id, changeNote });
              }, "Nouvelle révision déposée en brouillon.")
            }
          />
        </Modal>
      )}
      {(dialog === "approve" || dialog === "reject" || dialog === "archive") && (
        <Modal title={dialog === "approve" ? "Approuver l'indice" : dialog === "reject" ? "Refuser l'indice" : "Archiver le document"} onClose={() => setDialog(null)}>
          <Feedback error={mutation.error} />
          <NoteForm
            required={dialog !== "approve"}
            label={dialog === "approve" ? "Approuver" : dialog === "reject" ? "Refuser" : "Archiver"}
            saving={mutation.saving}
            onSubmit={(note) =>
              apply(
                () =>
                  dialog === "approve"
                    ? documentsApi.approve(document.id, note || undefined)
                    : dialog === "reject"
                      ? documentsApi.reject(document.id, note)
                      : documentsApi.archive(document.id, note),
                dialog === "approve" ? "Indice approuvé : il devient applicable." : dialog === "reject" ? "Indice refusé." : "Document archivé.",
              )
            }
          />
        </Modal>
      )}
    </>
  );
}

function VersionForm({ saving, onSubmit }: { saving: boolean; onSubmit: (file: File, changeNote: string) => Promise<void> }): React.ReactElement {
  const [file, setFile] = useState<File | null>(null);
  const [changeNote, setChangeNote] = useState("");
  return (
    <Form columns={1} submitLabel="Déposer la révision" saving={saving} onSubmit={() => (file ? onSubmit(file, changeNote) : undefined)}>
      <div className="field wide">
        <label htmlFor="version-file">Fichier *</label>
        <input id="version-file" type="file" required onChange={(event) => setFile(event.currentTarget.files?.[0] ?? null)} />
      </div>
      <TextAreaField label="Objet de la révision (obligatoire)" value={changeNote} onChange={setChangeNote} required />
    </Form>
  );
}

function NoteForm({ required, label, saving, onSubmit }: { required: boolean; label: string; saving: boolean; onSubmit: (note: string) => Promise<void> }): React.ReactElement {
  const [note, setNote] = useState("");
  return (
    <Form columns={1} submitLabel={label} saving={saving} onSubmit={() => onSubmit(note)}>
      <TextAreaField label={required ? "Motif (obligatoire)" : "Commentaire de visa"} value={note} onChange={setNote} required={required} />
    </Form>
  );
}
