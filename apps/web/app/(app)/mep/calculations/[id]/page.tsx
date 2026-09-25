"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { CalculationRevisionView, EngineeringCalculationView } from "@axora24/contracts";
import { CheckCircle2, GitBranch } from "lucide-react";
import { CALC_STATUS_CHIP, CALC_STATUS_LABEL, mepApi } from "../../../../lib/modules/mep";
import { formatDateTime } from "../../../../lib/format";
import { useMutation, useResource } from "../../../../lib/hooks";
import { useSession } from "../../../../lib/session";
import { ActionBar, Button, DataTable, DetailList, Feedback, Form, Loading, Modal, PageHeader, Panel, StatusChip, TextAreaField, TextField } from "../../../../components/ui";

export default function CalculationPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const session = useSession();
  const resource = useResource(() => mepApi.calculation(id), [id]);
  const mutation = useMutation();
  const [override, setOverride] = useState<EngineeringCalculationView | null>(null);
  const [dialog, setDialog] = useState<"revise" | "validate" | null>(null);
  const calculation = override ?? resource.data;

  if (resource.loading && !calculation) return <Loading label="Chargement de la note de calcul…" />;
  if (!calculation) return <Feedback error={resource.error || "Note de calcul introuvable."} />;
  const current = calculation.current;
  const isAuthor = current.authorUserId === session.user.id;

  async function apply(action: () => Promise<EngineeringCalculationView>, success: string): Promise<void> {
    const updated = await mutation.run(action, success);
    if (updated) {
      setOverride(updated);
      setDialog(null);
    }
  }

  return (
    <>
      <PageHeader
        breadcrumb={`MEP / Notes de calcul / ${calculation.code}`}
        title={calculation.title}
        subtitle={`${calculation.code} · ${calculation.calcTitle} · révision ${calculation.currentRevision}`}
        actions={
          <>
            <StatusChip status={CALC_STATUS_CHIP[current.status] ?? "pending"} label={CALC_STATUS_LABEL[current.status]} />
            {session.can("mep.calculation.manage") && (
              <Button onClick={() => setDialog("revise")}>
                <GitBranch size={14} aria-hidden="true" /> Nouvelle révision
              </Button>
            )}
          </>
        }
      />
      <Feedback error={mutation.error} notice={mutation.notice} />
      <Panel title={`Révision ${current.revision} — calcul vérifiable`} subtitle={`Noyau ${current.kernelVersion} · rédigée par ${current.authorName} le ${formatDateTime(current.createdAt)}`}>
        <RevisionDetail revision={current} />
        <DetailList
          items={[
            { label: "Équipement", value: calculation.equipmentId ? <Link href={`/mep/equipment/${calculation.equipmentId}`}>{calculation.equipmentTag}</Link> : "—" },
            { label: "Système", value: calculation.systemCode ?? "—" },
            { label: "Révision applicable", value: calculation.validatedRevision ? `Révision ${calculation.validatedRevision}` : <StatusChip status="pending" label="Aucune validée" /> },
            { label: "Validation", value: current.validatedAt ? `${current.validatedByName} · ${formatDateTime(current.validatedAt)}${current.validationNote ? ` — ${current.validationNote}` : ""}` : "—" },
          ]}
        />
        {current.status === "DRAFT" && (
          <ActionBar
            note={
              isAuthor
                ? "Vous êtes l'auteur de cette révision : sa validation revient à un autre ingénieur."
                : current.sources
                  ? "Vérifiez les entrées, leurs sources et la formule substituée avant de valider."
                  : "Les sources des valeurs d'entrée doivent être citées avant validation (nouvelle révision)."
            }
          >
            {session.can("mep.calculation.validate") && !isAuthor && (
              <Button variant="primary" disabled={!current.sources} onClick={() => setDialog("validate")}>
                <CheckCircle2 size={14} aria-hidden="true" /> Valider
              </Button>
            )}
          </ActionBar>
        )}
      </Panel>
      <div className="stack">
        <Panel title="Historique des révisions" subtitle="Une révision n'est jamais réécrite : chaque changement d'hypothèse est conservé">
          <DataTable
            rows={calculation.revisions ?? []}
            empty={null}
            columns={[
              { key: "rev", header: "Rév.", render: (revision) => <strong>{revision.revision}</strong> },
              { key: "inputs", header: "Entrées", render: (revision) => revision.inputs.map((input) => `${input.symbol} = ${input.value} ${input.unit}`).join(" · ") },
              { key: "outputs", header: "Résultats", render: (revision) => revision.outputs.map((output) => `${output.symbol} = ${output.value} ${output.unit}`).join(" · ") },
              {
                key: "who",
                header: "Auteur / motif",
                render: (revision) => (
                  <>
                    {revision.authorName}
                    <small>{revision.notes ?? "—"}</small>
                  </>
                ),
              },
              { key: "status", header: "Statut", render: (revision) => <StatusChip status={CALC_STATUS_CHIP[revision.status] ?? "pending"} label={CALC_STATUS_LABEL[revision.status]} /> },
            ]}
          />
        </Panel>
      </div>
      {dialog === "revise" && (
        <Modal title="Nouvelle révision" onClose={() => setDialog(null)} wide>
          <Feedback error={mutation.error} />
          <ReviseForm revision={current} saving={mutation.saving} onSubmit={(input) => apply(() => mepApi.revise(calculation.id, input), "Nouvelle révision calculée.")} />
        </Modal>
      )}
      {dialog === "validate" && (
        <Modal title={`Valider la révision ${current.revision}`} onClose={() => setDialog(null)}>
          <Feedback error={mutation.error} />
          <ValidateForm saving={mutation.saving} onSubmit={(note) => apply(() => mepApi.validate(calculation.id, note || undefined), "Révision validée : elle devient applicable.")} />
        </Modal>
      )}
    </>
  );
}

function RevisionDetail({ revision }: { revision: CalculationRevisionView }): React.ReactElement {
  return (
    <div className="calc-sheet">
      <div>
        <h3>Données d&apos;entrée</h3>
        <table className="calc-table">
          <tbody>
            {revision.inputs.map((input) => (
              <tr key={input.name}>
                <td className="symbol">{input.symbol}</td>
                <td>{input.label}</td>
                <td className="num">{input.value}</td>
                <td>{input.unit}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {revision.sources && (
          <p className="calc-sources">
            <strong>Sources :</strong> {revision.sources}
          </p>
        )}
      </div>
      <div>
        <h3>Formule</h3>
        <p className="formula-box">{revision.formula}</p>
        <h3>Substitution</h3>
        <p className="formula-box">{revision.substitution}</p>
        <h3>Résultats</h3>
        <table className="calc-table result">
          <tbody>
            {revision.outputs.map((output) => (
              <tr key={`${output.name}-${output.unit}`}>
                <td className="symbol">{output.symbol}</td>
                <td>{output.label}</td>
                <td className="num">
                  <strong>{output.value}</strong>
                </td>
                <td>{output.unit}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3>Hypothèses</h3>
        <ul className="calc-assumptions">
          {revision.assumptions.map((assumption) => (
            <li key={assumption}>{assumption}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ReviseForm({ revision, saving, onSubmit }: { revision: CalculationRevisionView; saving: boolean; onSubmit: (input: { inputs: Record<string, string>; sources?: string; notes: string }) => Promise<void> }): React.ReactElement {
  const [inputs, setInputs] = useState<Record<string, string>>(Object.fromEntries(revision.inputs.map((input) => [input.name, input.value])));
  const [sources, setSources] = useState(revision.sources ?? "");
  const [notes, setNotes] = useState("");
  return (
    <Form
      submitLabel="Calculer la révision"
      saving={saving}
      onSubmit={() => onSubmit({ inputs: Object.fromEntries(Object.entries(inputs).map(([key, value]) => [key, value.replace(",", ".").trim()])), sources: sources || undefined, notes })}
    >
      {revision.inputs.map((input) => (
        <TextField key={input.name} label={`${input.symbol} — ${input.label} (${input.unit})`} value={inputs[input.name] ?? ""} onChange={(next) => setInputs((current) => ({ ...current, [input.name]: next }))} required />
      ))}
      <TextAreaField label="Sources des valeurs d'entrée" value={sources} onChange={setSources} />
      <TextAreaField label="Motif de la révision (obligatoire)" value={notes} onChange={setNotes} required />
    </Form>
  );
}

function ValidateForm({ saving, onSubmit }: { saving: boolean; onSubmit: (note: string) => Promise<void> }): React.ReactElement {
  const [note, setNote] = useState("");
  return (
    <Form columns={1} submitLabel="Valider" saving={saving} onSubmit={() => onSubmit(note)}>
      <TextAreaField label="Avis de l'ingénieur vérificateur" value={note} onChange={setNote} />
    </Form>
  );
}
