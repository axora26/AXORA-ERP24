"use client";

import React, { useState } from "react";
import { useParams } from "next/navigation";
import type { SubcontractorView } from "@axora24/contracts";
import { BadgeCheck, Ban, FilePlus2 } from "lucide-react";
import { SUBCONTRACTOR_STATUS_CHIP, SUBCONTRACTOR_STATUS_LABEL, SUB_DOCUMENT_LABEL, subcontractingApi } from "../../../../lib/modules/subcontracting";
import { formatDate, formatDateTime, formatMoney, todayIso } from "../../../../lib/format";
import { useMutation, useResource } from "../../../../lib/hooks";
import { useSession } from "../../../../lib/session";
import { ActionBar, Button, DataTable, DateField, DetailList, Empty, Feedback, Form, Grid, Loading, Modal, PageHeader, Panel, SelectField, StatusChip, TextAreaField, TextField } from "../../../../components/ui";

type Dialog = "document" | "qualify" | "suspend";

export default function SubcontractorPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const session = useSession();
  const mutation = useMutation();
  const resource = useResource(() => subcontractingApi.subcontractor(id), [id]);
  const [override, setOverride] = useState<SubcontractorView | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const row = override ?? resource.data;

  if (resource.loading && !row) return <Loading label="Chargement du sous-traitant…" />;
  if (!row) return <Feedback error={resource.error || "Sous-traitant introuvable."} />;

  async function apply(action: () => Promise<SubcontractorView>, success: string): Promise<void> {
    const updated = await mutation.run(action, success);
    if (updated) {
      setOverride(updated);
      setDialog(null);
    }
  }

  return (
    <>
      <PageHeader
        breadcrumb={`Sous-traitance / ${row.supplierCode}`}
        title={row.supplierName}
        subtitle={`${row.trades}${row.workforce ? ` · ${row.workforce} personnes` : ""}`}
        onRefresh={() => {
          setOverride(null);
          void resource.reload();
        }}
        actions={<StatusChip status={SUBCONTRACTOR_STATUS_CHIP[row.status] ?? "pending"} label={SUBCONTRACTOR_STATUS_LABEL[row.status]} />}
      />
      <Feedback error={mutation.error} notice={mutation.notice} />
      <ActionBar note="Qualification décidée par une autre personne que celle qui a créé la fiche ; pièces obligatoires en vigueur.">
        {session.can("subcontracting.package.manage") && (
          <Button onClick={() => setDialog("document")}>
            <FilePlus2 size={15} aria-hidden="true" /> Pièce de vigilance
          </Button>
        )}
        {session.can("subcontracting.subcontractor.qualify") && row.status !== "QUALIFIED" && (
          <Button variant="primary" onClick={() => setDialog("qualify")} disabled={!row.compliant} title={!row.compliant ? "Pièces obligatoires manquantes ou échues" : undefined}>
            <BadgeCheck size={15} aria-hidden="true" /> Qualifier
          </Button>
        )}
        {session.can("subcontracting.subcontractor.qualify") && row.status === "QUALIFIED" && (
          <Button variant="danger" onClick={() => setDialog("suspend")}>
            <Ban size={15} aria-hidden="true" /> Suspendre
          </Button>
        )}
      </ActionBar>
      <div className="stack">
        <Grid>
          <Panel title="Fiche">
            <DetailList
              items={[
                { label: "Fournisseur (Achats)", value: `${row.supplierCode} — ${row.supplierName}` },
                { label: "Décision", value: row.decidedByName ? `${SUBCONTRACTOR_STATUS_LABEL[row.status]} par ${row.decidedByName} le ${formatDateTime(row.decidedAt)}` : "Non décidée" },
                { label: "Motif", value: row.decisionNote ?? "—" },
                { label: "Lots confiés", value: String(row.packages) },
                { label: "Montant contracté", value: formatMoney(row.contractedAmount, row.currency) },
                { label: "Retenues détenues", value: formatMoney(row.retentionHeld, row.currency) },
              ]}
            />
          </Panel>
          <Panel className="compact" title="Obligation de vigilance" subtitle="Exigée pour qualifier, confier un lot et approuver une situation.">
            <DataTable
              rows={row.compliance.map((item) => ({ ...item, id: item.kind }))}
              empty={<Empty icon={<FilePlus2 size={22} />} title="—" body="—" />}
              columns={[
                { key: "kind", header: "Pièce", render: (item) => <strong>{SUB_DOCUMENT_LABEL[item.kind]}{item.required ? "" : " (facultative)"}</strong> },
                { key: "state", header: "État", render: (item) => <StatusChip status={item.state === "VALID" ? "passed" : item.state === "EXPIRING" ? "warning" : "failed"} label={item.state === "VALID" ? "À jour" : item.state === "EXPIRING" ? "Échéance < 30 j" : item.state === "EXPIRED" ? "Échue" : "Absente"} /> },
                { key: "until", header: "Validité", render: (item) => (item.validUntil ? formatDate(item.validUntil) : "—") },
              ]}
            />
          </Panel>
        </Grid>
        <Panel title="Historique des pièces">
          <DataTable
            rows={row.documents ?? []}
            empty={<Empty icon={<FilePlus2 size={22} />} title="Aucune pièce" body="RCCM, attestations fiscale et sociale, assurance RC." />}
            columns={[
              { key: "kind", header: "Pièce", render: (document) => SUB_DOCUMENT_LABEL[document.kind] },
              { key: "reference", header: "Référence", render: (document) => document.reference },
              { key: "issuer", header: "Émetteur", render: (document) => document.issuer ?? "—" },
              { key: "validity", header: "Validité", render: (document) => `${formatDate(document.validFrom)} → ${formatDate(document.validUntil)}` },
            ]}
          />
        </Panel>
      </div>

      {dialog === "document" && (
        <Modal title="Pièce de vigilance" onClose={() => setDialog(null)}>
          <Feedback error={mutation.error} />
          <DocumentForm saving={mutation.saving} onSubmit={(input) => apply(() => subcontractingApi.addDocument(id, input), "Pièce enregistrée.")} />
        </Modal>
      )}
      {(dialog === "qualify" || dialog === "suspend") && (
        <Modal title={dialog === "qualify" ? "Qualifier le sous-traitant" : "Suspendre le sous-traitant"} onClose={() => setDialog(null)}>
          <Feedback error={mutation.error} />
          <NoteForm label={dialog === "qualify" ? "Motif (références vérifiées, visite…)" : "Motif de suspension"} submitLabel={dialog === "qualify" ? "Qualifier" : "Suspendre"} saving={mutation.saving} onSubmit={(note) => apply(() => subcontractingApi.decide(id, dialog === "qualify" ? "QUALIFIED" : "SUSPENDED", note), "Décision enregistrée.")} />
        </Modal>
      )}
    </>
  );
}

function DocumentForm({ saving, onSubmit }: { saving: boolean; onSubmit: (input: Record<string, unknown>) => Promise<void> }): React.ReactElement {
  const [form, setForm] = useState({ kind: "RCCM", reference: "", issuer: "", validFrom: todayIso(), validUntil: "" });
  const set = (key: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));
  return (
    <Form submitLabel="Enregistrer" saving={saving} onSubmit={() => onSubmit({ ...form, issuer: form.issuer || undefined })}>
      <SelectField label="Pièce" value={form.kind} onChange={set("kind")} options={Object.entries(SUB_DOCUMENT_LABEL).map(([value, label]) => ({ value, label }))} required />
      <TextField label="Référence" value={form.reference} onChange={set("reference")} required />
      <TextField label="Émetteur" value={form.issuer} onChange={set("issuer")} />
      <DateField label="Valide du" value={form.validFrom} onChange={set("validFrom")} required />
      <DateField label="Valide jusqu'au" value={form.validUntil} onChange={set("validUntil")} required />
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
