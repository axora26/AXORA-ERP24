"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { SubcontractRetentionView, SubcontractStatementView } from "@axora24/contracts";
import { Landmark, Receipt, Scale } from "lucide-react";
import { PACKAGE_STATUS_LABEL, STATEMENT_STATUS_CHIP, STATEMENT_STATUS_LABEL, subcontractingApi } from "../../../../lib/modules/subcontracting";
import { formatDate, formatDateTime, formatMoney, formatPercent, todayIso } from "../../../../lib/format";
import { useMutation, useResource } from "../../../../lib/hooks";
import { useSession } from "../../../../lib/session";
import { ActionBar, Button, DataTable, DateField, DecimalField, DetailList, Empty, Feedback, Form, Grid, Loading, Modal, PageHeader, Panel, ProgressBar, SelectField, StatusChip, TextAreaField, TextField } from "../../../../components/ui";

type Dialog = { kind: "prepare" } | { kind: "decide"; statement: SubcontractStatementView } | { kind: "invoice"; statement: SubcontractStatementView } | { kind: "release"; retention: SubcontractRetentionView } | { kind: "close" };

export default function SubcontractPackagePage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const session = useSession();
  const mutation = useMutation();
  const resource = useResource(() => subcontractingApi.package(id), [id]);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const row = resource.data;

  if (resource.loading && !row) return <Loading label="Chargement du lot…" />;
  if (!row) return <Feedback error={resource.error || "Lot introuvable."} />;
  const pending = row.statements?.some((statement) => statement.status === "DRAFT");
  const newProgress = Number(row.livePercent) > Number(row.certifiedPercent);

  async function run(action: () => Promise<unknown>, success: string): Promise<void> {
    const result = await mutation.run(action, success);
    if (result !== undefined) {
      setDialog(null);
      await resource.reload();
    }
  }

  return (
    <>
      <PageHeader
        breadcrumb={`Sous-traitance / ${row.code}`}
        title={row.title}
        subtitle={`${row.code} · ${row.supplierName} · commande ${row.purchaseOrderCode}`}
        onRefresh={() => void resource.reload()}
        actions={<StatusChip status={row.status === "ACTIVE" ? "in_progress" : "done"} label={PACKAGE_STATUS_LABEL[row.status]} />}
      />
      <Feedback error={mutation.error} notice={mutation.notice} />
      {row.status === "ACTIVE" && (session.can("subcontracting.statement.prepare") || session.can("subcontracting.package.manage")) && (
        <ActionBar note={newProgress ? `Avancement réel ${formatPercent(row.livePercent)} > certifié ${formatPercent(row.certifiedPercent)} : une situation peut être préparée.` : "Aucun avancement nouveau : terminez des tâches du lot WBS pour préparer une situation."}>
          {session.can("subcontracting.statement.prepare") && (
            <Button variant="primary" onClick={() => setDialog({ kind: "prepare" })} disabled={!newProgress || pending} title={pending ? "Une situation attend une décision" : undefined}>
              <Scale size={15} aria-hidden="true" /> Préparer la situation
            </Button>
          )}
          {session.can("subcontracting.package.manage") && (
            <Button variant="ghost" onClick={() => setDialog({ kind: "close" })} disabled={pending}>
              Clore le lot
            </Button>
          )}
        </ActionBar>
      )}
      <div className="stack">
        <Grid>
          <Panel title="Lot">
            <DetailList
              items={[
                { label: "Projet / lot WBS", value: <Link href={`/projects/${row.projectId}`}>{`${row.projectCode} · ${row.wbsCode} ${row.wbsName}`}</Link> },
                { label: "Commande support", value: row.purchaseOrderCode },
                { label: "Montant HT (figé)", value: formatMoney(row.amount, row.currency) },
                { label: "Retenue de garantie", value: `${row.retentionRate.replace(".", ",")} % · libération à ${row.retentionReleaseDays} j` },
                { label: "Certifié", value: `${formatMoney(row.certifiedGross, row.currency)} (${formatPercent(row.certifiedPercent)})` },
                { label: "Retenues", value: `${formatMoney(row.retentionHeld, row.currency)} détenue(s) · ${formatMoney(row.retentionReleased, row.currency)} libérée(s)` },
              ]}
            />
            <p className="prose-block">{row.scope}</p>
          </Panel>
          <Panel title="Avancement" subtitle="Dérivé des tâches du lot WBS (poids des tâches terminées) — jamais saisi.">
            <div className="progress-wide" style={{ padding: "18px 21px", display: "grid", gap: 14 }}>
              <div>
                <small>Réel — {row.liveDoneTasks}/{row.liveTotalTasks} tâches terminées</small>
                <ProgressBar value={Number(row.livePercent)} label={`Avancement réel ${formatPercent(row.livePercent)}`} />
              </div>
              <div>
                <small>Certifié par situations approuvées</small>
                <ProgressBar value={Number(row.certifiedPercent)} label={`Avancement certifié ${formatPercent(row.certifiedPercent)}`} />
              </div>
            </div>
          </Panel>
        </Grid>
        <Panel title="Situations">
          <DataTable
            rows={row.statements ?? []}
            empty={<Empty icon={<Scale size={22} />} title="Aucune situation" body="La première situation se prépare dès qu'une tâche du lot est terminée." />}
            columns={[
              {
                key: "statement",
                header: "Situation",
                render: (statement) => (
                  <>
                    <strong>
                      N°{statement.number} · {statement.code}
                    </strong>
                    <small>
                      au {formatDate(statement.periodEnd)} · {statement.doneTasks}/{statement.totalTasks} tâches · préparée par {statement.preparedByName}
                      {statement.decidedByName ? ` · décidée par ${statement.decidedByName}` : ""}
                    </small>
                  </>
                ),
              },
              { key: "percent", header: "Cumul", align: "right", render: (statement) => `${formatPercent(statement.previousPercent)} → ${formatPercent(statement.cumulativePercent)}` },
              { key: "gross", header: "Brut", align: "right", render: (statement) => formatMoney(statement.grossAmount, row.currency) },
              { key: "retention", header: "Retenue", align: "right", render: (statement) => formatMoney(statement.retentionAmount, row.currency) },
              { key: "net", header: "Net", align: "right", render: (statement) => <strong>{formatMoney(statement.netAmount, row.currency)}</strong> },
              { key: "status", header: "État", render: (statement) => <StatusChip status={STATEMENT_STATUS_CHIP[statement.status] ?? "pending"} label={statement.supplierInvoiceCode ? `Facturée ${statement.supplierInvoiceCode}` : STATEMENT_STATUS_LABEL[statement.status]} /> },
              {
                key: "actions",
                header: "",
                render: (statement) =>
                  statement.status === "DRAFT" && session.can("subcontracting.statement.approve") && statement.preparedByUserId !== session.user.id ? (
                    <Button onClick={() => setDialog({ kind: "decide", statement })}>Décider</Button>
                  ) : statement.status === "APPROVED" && !statement.supplierInvoiceId && session.can("finance.payable.manage") ? (
                    <Button onClick={() => setDialog({ kind: "invoice", statement })}>
                      <Receipt size={14} aria-hidden="true" /> Facture
                    </Button>
                  ) : null,
              },
            ]}
          />
        </Panel>
        <Panel title="Retenues de garantie">
          <DataTable
            rows={row.retentions ?? []}
            empty={<Empty icon={<Landmark size={22} />} title="Aucune retenue" body="Constituée à l'approbation de chaque situation." />}
            columns={[
              { key: "statement", header: "Situation", render: (retention) => retention.statementCode },
              { key: "amount", header: "Montant", align: "right", render: (retention) => formatMoney(retention.amount, row.currency) },
              { key: "condition", header: "Condition de libération", render: (retention) => <small className="clamp">{retention.releaseCondition}</small> },
              { key: "due", header: "Échéance", render: (retention) => formatDate(retention.releaseDueDate) },
              {
                key: "status",
                header: "État",
                render: (retention) =>
                  retention.status === "RELEASED" ? (
                    <StatusChip status="done" label={`Libérée ${formatDateTime(retention.releasedAt)}${retention.guaranteeReference ? ` · caution ${retention.guaranteeReference}` : ""}`} />
                  ) : session.can("subcontracting.retention.release") ? (
                    <Button onClick={() => setDialog({ kind: "release", retention })}>Libérer</Button>
                  ) : (
                    <StatusChip status="warning" label="Détenue" />
                  ),
              },
            ]}
          />
        </Panel>
      </div>

      {dialog?.kind === "prepare" && (
        <Modal title="Préparer la situation" onClose={() => setDialog(null)}>
          <Feedback error={mutation.error} />
          <PeriodForm saving={mutation.saving} onSubmit={(periodEnd) => run(() => subcontractingApi.prepareStatement(id, periodEnd), "Situation préparée : montants calculés et figés.")} />
        </Modal>
      )}
      {dialog?.kind === "decide" && (
        <Modal title={`Situation ${dialog.statement.code}`} onClose={() => setDialog(null)}>
          <Feedback error={mutation.error} />
          <DecideForm saving={mutation.saving} onSubmit={(decision, note) => run(() => subcontractingApi.decideStatement(dialog.statement.id, decision, note || undefined), "Décision enregistrée.")} />
        </Modal>
      )}
      {dialog?.kind === "invoice" && (
        <Modal title={`Facture de la situation ${dialog.statement.code}`} onClose={() => setDialog(null)}>
          <Feedback error={mutation.error} />
          <InvoiceForm amountLabel={`Net certifié ${formatMoney(dialog.statement.netAmount, row.currency)}`} withTax saving={mutation.saving} onSubmit={(input) => run(() => subcontractingApi.invoiceStatement(dialog.statement.id, input), "Facture fournisseur enregistrée en Finance.")} />
        </Modal>
      )}
      {dialog?.kind === "release" && (
        <Modal title={`Libérer la retenue ${formatMoney(dialog.retention.amount, row.currency)}`} onClose={() => setDialog(null)}>
          <Feedback error={mutation.error} />
          <ReleaseForm due={dialog.retention.due} dueDate={dialog.retention.releaseDueDate} saving={mutation.saving} onSubmit={(input) => run(() => subcontractingApi.releaseRetention(dialog.retention.id, input), "Retenue libérée, facture de libération enregistrée.")} />
        </Modal>
      )}
      {dialog?.kind === "close" && (
        <Modal title="Clore le lot" onClose={() => setDialog(null)}>
          <Feedback error={mutation.error} />
          <CloseForm saving={mutation.saving} onSubmit={(status, note) => run(() => subcontractingApi.closePackage(id, status, note), "Lot clos.")} />
        </Modal>
      )}
    </>
  );
}

function PeriodForm({ saving, onSubmit }: { saving: boolean; onSubmit: (periodEnd: string) => Promise<void> }): React.ReactElement {
  const [periodEnd, setPeriodEnd] = useState(todayIso());
  return (
    <Form columns={1} submitLabel="Préparer" saving={saving} onSubmit={() => onSubmit(periodEnd)}>
      <DateField label="Arrêtée au" value={periodEnd} onChange={setPeriodEnd} required hint="L'avancement est lu sur les tâches terminées du lot WBS au moment de la préparation." />
    </Form>
  );
}

function DecideForm({ saving, onSubmit }: { saving: boolean; onSubmit: (decision: string, note: string) => Promise<void> }): React.ReactElement {
  const [decision, setDecision] = useState("APPROVED");
  const [note, setNote] = useState("");
  return (
    <Form columns={1} submitLabel="Valider" saving={saving} onSubmit={() => onSubmit(decision, note)}>
      <SelectField label="Décision" value={decision} onChange={setDecision} options={[{ value: "APPROVED", label: "Approuver" }, { value: "REJECTED", label: "Rejeter" }]} required />
      <TextAreaField label="Note" value={note} onChange={setNote} />
    </Form>
  );
}

function InvoiceForm({ amountLabel, withTax, saving, onSubmit }: { amountLabel: string; withTax?: boolean; saving: boolean; onSubmit: (input: Record<string, unknown>) => Promise<void> }): React.ReactElement {
  const [supplierReference, setReference] = useState("");
  const [invoiceDate, setDate] = useState(todayIso());
  const [taxRate, setTax] = useState("16");
  return (
    <Form submitLabel="Enregistrer la facture" saving={saving} onSubmit={() => onSubmit({ supplierReference, invoiceDate, ...(withTax ? { taxRate } : {}) })}>
      <TextField label="N° de facture du sous-traitant" value={supplierReference} onChange={setReference} required hint={amountLabel} />
      <DateField label="Date de facture" value={invoiceDate} onChange={setDate} required />
      {withTax && <DecimalField label="TVA (%)" value={taxRate} onChange={setTax} required />}
    </Form>
  );
}

function ReleaseForm({ due, dueDate, saving, onSubmit }: { due: boolean; dueDate: string; saving: boolean; onSubmit: (input: Record<string, unknown>) => Promise<void> }): React.ReactElement {
  const [form, setForm] = useState({ note: "", guaranteeReference: "", supplierReference: "", invoiceDate: todayIso() });
  const set = (key: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));
  return (
    <Form submitLabel="Libérer" saving={saving} onSubmit={() => onSubmit({ ...form, guaranteeReference: form.guaranteeReference || undefined })}>
      {!due && <TextField label="Caution bancaire (libération anticipée)" value={form.guaranteeReference} onChange={set("guaranteeReference")} required hint={`Échéance normale le ${formatDate(dueDate)}.`} />}
      <TextField label="N° de facture de libération" value={form.supplierReference} onChange={set("supplierReference")} required />
      <DateField label="Date de facture" value={form.invoiceDate} onChange={set("invoiceDate")} required />
      <TextAreaField label="Motif / constat (réserves levées…)" value={form.note} onChange={set("note")} required wide />
    </Form>
  );
}

function CloseForm({ saving, onSubmit }: { saving: boolean; onSubmit: (status: string, note: string) => Promise<void> }): React.ReactElement {
  const [status, setStatus] = useState("COMPLETED");
  const [note, setNote] = useState("");
  return (
    <Form columns={1} submitLabel="Clore" saving={saving} onSubmit={() => onSubmit(status, note)}>
      <SelectField label="Issue" value={status} onChange={setStatus} options={[{ value: "COMPLETED", label: "Terminé (réception)" }, { value: "TERMINATED", label: "Résilié" }]} required />
      <TextAreaField label="Motif" value={note} onChange={setNote} required />
    </Form>
  );
}

