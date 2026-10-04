"use client";

import React, { useState } from "react";
import { CheckCircle2, CircleDollarSign, Clock3, Plus, ReceiptText } from "lucide-react";
import type { EmployeeAdvanceView } from "@axora24/contracts";
import { hrApi } from "../../../lib/modules/hr";
import { formatDate, formatMoney } from "../../../lib/format";
import { useMutation, useResource } from "../../../lib/hooks";
import { useSession } from "../../../lib/session";
import { Button, DataTable, Empty, Feedback, Form, Loading, Metric, Metrics, Modal, PageHeader, Panel, SelectField, StatusChip, TextAreaField, TextField } from "../../../components/ui";

type Dialog = "request" | { kind: "decision"; advance: EmployeeAdvanceView; approve: boolean } | { kind: "repay"; advance: EmployeeAdvanceView } | null;
type AdvanceFilter = "ALL" | EmployeeAdvanceView["status"];

export default function AdvancesPage(): React.ReactElement {
  const session = useSession();
  const canRequest = session.can("hr.advance.request");
  const data = useResource(
    () => Promise.all([hrApi.advances(), canRequest ? hrApi.employees() : Promise.resolve([])]),
    [canRequest],
  );
  const mutation = useMutation();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [statusFilter, setStatusFilter] = useState<AdvanceFilter>("ALL");
  const [advances, employees] = data.data ?? [[], []];
  const canRead = session.can("hr.advance.read");
  const reload = () => void data.reload();

  if (!canRead) return <Feedback error="L’accès aux avances nécessite la permission RH correspondante." />;
  if (data.loading && !data.data) return <Loading label="Chargement des avances…" />;
  const visibleAdvances = statusFilter === "ALL" ? advances : advances.filter((advance) => advance.status === statusFilter);
  const principal = advances.reduce((sum, advance) => sum + Number(advance.amount), 0);
  const remaining = advances.reduce((sum, advance) => sum + Number(advance.remainingAmount), 0);
  const pending = advances.filter((advance) => advance.status === "REQUESTED").length;
  return <>
    <PageHeader breadcrumb="Ressources humaines / Avances" title="Avances salariés" subtitle="Demandes, approbations et remboursements avec historique append-only" actions={session.can("hr.advance.request") ? <Button onClick={() => setDialog("request")}><Plus size={15} aria-hidden="true" /> Nouvelle avance</Button> : undefined} />
    <Feedback error={data.error || mutation.error} notice={mutation.notice} />
    <Metrics label="Synthèse des avances">
      <Metric icon={<CircleDollarSign size={19} />} tone="blue" label="Principal accordé" value={formatMoney(principal.toFixed(2), advances[0]?.currency)} detail={`${advances.length} avance(s)`} />
      <Metric icon={<Clock3 size={19} />} tone="amber" label="En attente" value={String(pending)} detail="À soumettre à approbation" />
      <Metric icon={<CheckCircle2 size={19} />} tone={remaining > 0 ? "amber" : "green"} label="Reste à recouvrer" value={formatMoney(remaining.toFixed(2), advances[0]?.currency)} detail="Remboursements enregistrés" />
    </Metrics>
    <Panel title="Suivi des avances" subtitle="Les remboursements ne peuvent jamais dépasser le principal." actions={<label className="inline-filter">Filtrer par état<select value={statusFilter} onChange={(event) => setStatusFilter(event.currentTarget.value as AdvanceFilter)}><option value="ALL">Tous les états</option><option value="REQUESTED">Demandées</option><option value="APPROVED">Approuvées</option><option value="PARTIALLY_REPAID">Partiellement remboursées</option><option value="SETTLED">Soldées</option><option value="REJECTED">Rejetées</option><option value="CANCELLED">Annulées</option></select></label>}>
      <DataTable rows={visibleAdvances} empty={<Empty title={statusFilter === "ALL" ? "Aucune avance" : "Aucune avance pour cet état"} />} columns={[
        { key: "employee", header: "Salarié", render: (row) => <><strong>{row.employeeName}</strong><small>{row.reason}</small></> },
        { key: "amount", header: "Principal", align: "right", render: (row) => formatMoney(row.amount, row.currency) },
        { key: "remaining", header: "Reste", align: "right", render: (row) => <strong>{formatMoney(row.remainingAmount, row.currency)}</strong> },
        { key: "requested", header: "Demandée le", render: (row) => formatDate(row.requestedAt) },
        { key: "status", header: "État", render: (row) => <StatusChip status={statusChip(row.status)} label={statusLabel(row.status)} /> },
        { key: "actions", header: "Actions", align: "right", render: (row) => <div className="chip-row">
          {row.status === "REQUESTED" && session.can("hr.advance.approve") && row.requestedByUserId !== session.user.id && <><Button onClick={() => setDialog({ kind: "decision", advance: row, approve: true })}>Approuver</Button><Button variant="ghost" onClick={() => setDialog({ kind: "decision", advance: row, approve: false })}>Rejeter</Button></>}
          {["APPROVED", "PAID", "PARTIALLY_REPAID"].includes(row.status) && session.can("hr.advance.repay") && <Button variant="ghost" onClick={() => setDialog({ kind: "repay", advance: row })}><ReceiptText size={14} aria-hidden="true" /> Rembourser</Button>}
        </div> },
      ]} />
    </Panel>
    {dialog === "request" && <RequestAdvance employees={employees.filter((employee) => employee.status === "ACTIVE" && employee.userId === session.user.id)} saving={mutation.saving} error={mutation.error} onClose={() => setDialog(null)} onSubmit={(input) => void mutation.run(() => hrApi.requestAdvance(input), "Avance demandée.").then((result) => { if (result) { setDialog(null); reload(); } })} />}
    {dialog && typeof dialog === "object" && dialog.kind === "decision" && <DecisionAdvance advance={dialog.advance} approve={dialog.approve} saving={mutation.saving} onClose={() => setDialog(null)} onSubmit={(note) => void mutation.run(() => dialog.approve ? hrApi.approveAdvance(dialog.advance.id, note || undefined) : hrApi.rejectAdvance(dialog.advance.id, note), dialog.approve ? "Avance approuvée." : "Avance rejetée.").then((result) => { if (result) { setDialog(null); reload(); } })} />}
    {dialog && typeof dialog === "object" && dialog.kind === "repay" && <RepayAdvance advance={dialog.advance} saving={mutation.saving} onClose={() => setDialog(null)} onSubmit={(input) => void mutation.run(() => hrApi.repayAdvance(dialog.advance.id, input), "Remboursement enregistré.").then((result) => { if (result) { setDialog(null); reload(); } })} />}
  </>;
}

function RequestAdvance({ employees, saving, error, onClose, onSubmit }: { employees: Array<{ id: string; firstName: string; lastName: string; currency: string }>; saving: boolean; error: string; onClose: () => void; onSubmit: (input: { employeeId: string; amount: string; reason: string }) => void }): React.ReactElement {
  const [employeeId, setEmployeeId] = useState(employees[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  return <Modal title="Nouvelle avance" onClose={onClose}><Feedback error={error} /><Form submitLabel="Demander l’avance" saving={saving} onSubmit={() => onSubmit({ employeeId, amount: amount.replace(",", "."), reason })}><SelectField label="Salarié" value={employeeId} onChange={setEmployeeId} options={employees.map((employee) => ({ value: employee.id, label: `${employee.firstName} ${employee.lastName}` }))} required /><TextField label="Montant" inputMode="decimal" value={amount} onChange={setAmount} required placeholder="0.00" /><TextAreaField label="Motif" value={reason} onChange={setReason} required wide /></Form></Modal>;
}

function DecisionAdvance({ advance, approve, saving, onClose, onSubmit }: { advance: EmployeeAdvanceView; approve: boolean; saving: boolean; onClose: () => void; onSubmit: (note: string) => void }): React.ReactElement {
  const [note, setNote] = useState("");
  return <Modal title={approve ? "Approuver l’avance" : "Rejeter l’avance"} onClose={onClose}><p className="inline-note">{advance.employeeName} · {formatMoney(advance.amount, advance.currency)}</p><Form submitLabel={approve ? "Approuver" : "Rejeter"} saving={saving} onSubmit={() => onSubmit(note)}><TextAreaField label={approve ? "Note (facultatif)" : "Motif du rejet"} value={note} onChange={setNote} required={!approve} wide /></Form></Modal>;
}

function RepayAdvance({ advance, saving, onClose, onSubmit }: { advance: EmployeeAdvanceView; saving: boolean; onClose: () => void; onSubmit: (input: { amount: string; method: "PAYROLL" | "BANK" | "CASH"; repaymentDate: string; note?: string }) => void }): React.ReactElement {
  const [amount, setAmount] = useState(advance.remainingAmount);
  const [method, setMethod] = useState<"PAYROLL" | "BANK" | "CASH">("PAYROLL");
  const [repaymentDate, setRepaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  return <Modal title="Enregistrer un remboursement" onClose={onClose}><p className="inline-note">Reste à rembourser : <strong>{formatMoney(advance.remainingAmount, advance.currency)}</strong></p><Form submitLabel="Enregistrer" saving={saving} onSubmit={() => onSubmit({ amount: amount.replace(",", "."), method, repaymentDate, note: note || undefined })}><TextField label="Montant remboursé" inputMode="decimal" value={amount} onChange={setAmount} required /><SelectField label="Mode" value={method} onChange={(value) => setMethod(value as typeof method)} options={[{ value: "PAYROLL", label: "Retenue sur paie" }, { value: "BANK", label: "Virement bancaire" }, { value: "CASH", label: "Caisse" }]} required /><TextField label="Date" type="date" value={repaymentDate} onChange={setRepaymentDate} required /><TextAreaField label="Note" value={note} onChange={setNote} wide /></Form></Modal>;
}

function statusLabel(status: EmployeeAdvanceView["status"]): string { return ({ REQUESTED: "Demandée", APPROVED: "Approuvée", REJECTED: "Rejetée", PAID: "Payée", PARTIALLY_REPAID: "Partiellement remboursée", SETTLED: "Soldée", CANCELLED: "Annulée" })[status]; }
function statusChip(status: EmployeeAdvanceView["status"]): string { return status === "SETTLED" ? "done" : status === "REJECTED" || status === "CANCELLED" ? "cancelled" : status === "REQUESTED" ? "pending" : "in_progress"; }
