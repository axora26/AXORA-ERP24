"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { QhseInspectionItemView, QhseInspectionView } from "@axora24/contracts";
import { CheckCircle2, Lock } from "lucide-react";
import { DOMAIN_LABEL, INSPECTION_STATUS_LABEL, RESULT_LABEL, qhseApi } from "../../../../lib/modules/qhse";
import { documentsApi } from "../../../../lib/modules/documents";
import { assetUrl } from "../../../../lib/api";
import { formatDate, formatDateTime } from "../../../../lib/format";
import { useMutation, useResource } from "../../../../lib/hooks";
import { useSession } from "../../../../lib/session";
import { ActionBar, Button, DetailList, Feedback, Form, Loading, Modal, PageHeader, Panel, StatusChip, TextAreaField } from "../../../../components/ui";

export default function InspectionPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const session = useSession();
  const resource = useResource(() => qhseApi.inspection(id), [id]);
  const mutation = useMutation();
  const [override, setOverride] = useState<QhseInspectionView | null>(null);
  const [answering, setAnswering] = useState<{ item: QhseInspectionItemView; result: string } | null>(null);
  const inspection = override ?? resource.data;

  if (resource.loading && !inspection) return <Loading label="Chargement de l'inspection…" />;
  if (!inspection) return <Feedback error={resource.error || "Inspection introuvable."} />;
  const editable = inspection.status !== "COMPLETED" && inspection.inspectorUserId === session.user.id && session.can("qhse.inspection.manage");

  async function apply(action: () => Promise<QhseInspectionView>, success?: string): Promise<void> {
    const updated = await mutation.run(action, success);
    if (updated) {
      setOverride(updated);
      setAnswering(null);
    }
  }

  return (
    <>
      <PageHeader
        breadcrumb={`QHSE / Inspections / ${inspection.code}`}
        title={inspection.title}
        subtitle={`${inspection.code} · ${DOMAIN_LABEL[inspection.domain]} · ${inspection.projectCode} · prévue le ${formatDate(inspection.scheduledAt)}`}
        actions={<StatusChip status={inspection.status === "COMPLETED" ? "done" : inspection.status.toLowerCase()} label={INSPECTION_STATUS_LABEL[inspection.status]} />}
      />
      <Feedback error={mutation.error} notice={mutation.notice} />
      <Panel title="Synthèse">
        <DetailList
          items={[
            { label: "Inspecteur", value: inspection.inspectorName },
            { label: "Points renseignés", value: `${inspection.answered} / ${inspection.total}` },
            { label: "Non conformes", value: inspection.nonConform > 0 ? <StatusChip status="critical" label={String(inspection.nonConform)} /> : "0" },
            { label: "Taux de conformité", value: inspection.conformityRate ? <strong>{inspection.conformityRate} %</strong> : "Calculé à la clôture" },
          ]}
        />
        {inspection.status === "COMPLETED" ? (
          <p className="inline-note">
            <Lock size={12} aria-hidden="true" /> Terminée le {formatDateTime(inspection.completedAt)} : checklist figée, une non-conformité ouverte par point non conforme.
          </p>
        ) : (
          <ActionBar
            note={
              editable
                ? "La clôture exige tous les points renseignés ; chaque point non conforme ouvrira automatiquement une non-conformité."
                : "Seul l'inspecteur désigné renseigne et clôture cette inspection."
            }
          >
            {editable && (
              <Button variant="primary" disabled={inspection.answered < inspection.total || mutation.saving} onClick={() => void apply(() => qhseApi.completeInspection(inspection.id), "Inspection clôturée.")}>
                <CheckCircle2 size={14} aria-hidden="true" /> Clôturer l&apos;inspection
              </Button>
            )}
          </ActionBar>
        )}
      </Panel>
      <div className="stack">
        <Panel title="Checklist">
          <ol className="checklist">
            {(inspection.items ?? []).map((item) => (
              <li key={item.id} className={item.result ? `answered result-${item.result.toLowerCase()}` : ""}>
                <div className="checklist-label">
                  <span className="checklist-position">{item.position}</span>
                  <div>
                    <strong>{item.label}</strong>
                    {item.critical && <StatusChip status="critical" label="Critique" />}
                    {item.comment && <p>{item.comment}</p>}
                    {item.answeredAt && (
                      <small>
                        {item.answeredByName} · {formatDateTime(item.answeredAt)}
                        {item.findingCode && (
                          <>
                            {" · "}
                            <Link href={`/qhse/findings/${item.findingId}`}>{item.findingCode}</Link>
                          </>
                        )}
                      </small>
                    )}
                  </div>
                  {item.file && (
                    <a href={assetUrl(item.file.url)} target="_blank" rel="noreferrer">
                      <img className="checklist-photo" src={assetUrl(item.file.url)} alt={`Photo du point ${item.position}`} />
                    </a>
                  )}
                </div>
                <div className="checklist-results" role="group" aria-label={`Résultat du point ${item.position}`}>
                  {(["CONFORM", "NON_CONFORM", "NOT_APPLICABLE"] as const).map((result) => (
                    <button
                      key={result}
                      type="button"
                      className={`result-btn ${result.toLowerCase()} ${item.result === result ? "selected" : ""}`}
                      disabled={!editable || mutation.saving}
                      onClick={() => (result === "CONFORM" ? void apply(() => qhseApi.answer(inspection.id, item.id, { result })) : setAnswering({ item, result }))}
                    >
                      {RESULT_LABEL[result]}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ol>
        </Panel>
      </div>
      {answering && (
        <Modal title={`${RESULT_LABEL[answering.result]} — point ${answering.item.position}`} onClose={() => setAnswering(null)}>
          <Feedback error={mutation.error} />
          <AnswerForm
            required={answering.result === "NON_CONFORM"}
            saving={mutation.saving}
            onSubmit={(comment, photo) =>
              apply(async () => {
                const file = photo ? await documentsApi.upload(photo) : null;
                return qhseApi.answer(inspection.id, answering.item.id, { result: answering.result, comment: comment || undefined, fileId: file?.id });
              })
            }
          />
        </Modal>
      )}
    </>
  );
}

function AnswerForm({ required, saving, onSubmit }: { required: boolean; saving: boolean; onSubmit: (comment: string, photo: File | null) => Promise<void> }): React.ReactElement {
  const [comment, setComment] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  return (
    <Form columns={1} submitLabel="Enregistrer" saving={saving} onSubmit={() => onSubmit(comment, photo)}>
      <TextAreaField label={required ? "Constat (obligatoire, repris dans la non-conformité)" : "Justification"} value={comment} onChange={setComment} required={required} />
      <div className="field wide">
        <label htmlFor="answer-photo">Photo (facultative)</label>
        <input id="answer-photo" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(event) => setPhoto(event.currentTarget.files?.[0] ?? null)} />
      </div>
    </Form>
  );
}
