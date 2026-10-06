"use client";

import React, { useState } from "react";
import type { BankAccountView, CreditNoteCreateInput, CreditNoteKind, CreditNoteUpdateInput, CreditNoteView, CreditRefundInput, CustomerInvoiceView, InvoiceLineView, SupplierInvoiceView } from "@axora24/contracts";
import { ArrowDownLeft, ArrowUpRight, FileText, Plus, Printer, Send, XCircle } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { formatDate, formatMoney } from "../lib/format";
import { useMutation, useResource } from "../lib/hooks";
import { financeApi, METHOD_LABEL } from "../lib/modules/finance";
import { newIdempotencyKey } from "../lib/modules/procurement";
import { useSession } from "../lib/session";
import { Button, DataTable, DateField, DecimalField, DetailList, Empty, Feedback, Form, Loading, Modal, Panel, SelectField, StatusChip, Tabs, TextAreaField, TextField } from "./ui";

const LABEL = { DRAFT: "Brouillon", ISSUED: "Émis", CANCELLED: "Annulé" };
const basePath = (kind: CreditNoteKind): string => `/finance/${kind === "CUSTOMER" ? "customer" : "supplier"}-credit-notes`;
const notePath = (note: CreditNoteView): string => `${basePath(note.kind)}/${note.id}`;
type Dialog = "create" | "edit" | "issue" | "cancel" | "refund";
type SourceInvoice = CustomerInvoiceView | SupplierInvoiceView;

/** Compare displayed money without rounding it through a floating-point number. */
function cents(value: string): bigint | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.replace(",", ".").trim());
  return match ? BigInt(match[1]!) * 100n + BigInt((match[2] ?? "").padEnd(2, "0")) : null;
}
function refundable(note: CreditNoteView): string {
  const noteRemaining = (cents(note.total) ?? 0n) - note.refunds.reduce((sum, refund) => sum + (cents(refund.amount) ?? 0n), 0n);
  const invoiceRemaining = cents(note.invoice.refundDue) ?? 0n;
  const amount = noteRemaining < invoiceRemaining ? noteRemaining : invoiceRemaining;
  const safe = amount > 0n ? amount : 0n;
  return `${safe / 100n}.${(safe % 100n).toString().padStart(2, "0")}`;
}

export function FinanceCreditNotes({ onChanged }: { onChanged: () => Promise<unknown> }): React.ReactElement {
  const session = useSession();
  const canRead = session.can("finance.credit.read");
  const canSupplier = canRead && session.can("finance.payable.read");
  const canManage = session.can("finance.credit.manage");
  const [kind, setKind] = useState<CreditNoteKind>("CUSTOMER");
  const [selected, setSelected] = useState<CreditNoteView | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const mutation = useMutation();
  const resource = useResource(() => canRead && (kind === "CUSTOMER" || canSupplier) ? api.get<CreditNoteView[]>(basePath(kind)) : Promise.resolve([]), [kind, canRead, canSupplier]);
  const accounts = useResource(() => session.can("finance.refund.manage") ? financeApi.bankAccounts() : Promise.resolve([]), [session.can("finance.refund.manage")]);
  const notes = resource.data ?? [];
  const sourceRead = kind === "CUSTOMER" ? session.can("finance.invoice.read") : canSupplier;

  async function refresh(): Promise<void> {
    await resource.reload();
    if (selected) setSelected(await api.get<CreditNoteView>(notePath(selected)));
  }
  async function open(note: CreditNoteView): Promise<void> {
    if (mutation.saving) return;
    mutation.clear();
    const current = await mutation.run(() => api.get<CreditNoteView>(notePath(note)), "");
    if (current) setSelected(current);
  }
  async function perform(action: () => Promise<CreditNoteView>, message: string): Promise<void> {
    const result = await mutation.run(async () => {
      try { return await action(); }
      catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          await refresh();
          setDialog(null);
          throw new Error("Les données ont changé. La version actuelle a été rechargée ; vérifiez les lignes et les montants avant de reprendre l’opération.");
        }
        throw error;
      }
    }, message);
    if (result) {
      setSelected(result);
      setDialog(null);
      await Promise.all([resource.reload(), onChanged(), accounts.reload()]);
    }
  }
  function show(next: Dialog): void { mutation.clear(); setDialog(next); }
  const activeNote = selected?.kind === kind ? selected : null;

  if (!canRead || (kind === "SUPPLIER" && !canSupplier)) return <Empty title="Accès aux avoirs non autorisé" />;
  return (
    <div className="stack">
      {canSupplier && <Tabs<CreditNoteKind> active={kind} onChange={(next) => { setKind(next); setSelected(null); mutation.clear(); }} tabs={[{ id: "CUSTOMER", label: "Avoirs clients" }, { id: "SUPPLIER", label: "Avoirs fournisseurs" }]} />}
      <Feedback error={resource.error || mutation.error} notice={mutation.notice} />
      <Panel title={kind === "CUSTOMER" ? "Avoirs clients" : "Avoirs fournisseurs"} subtitle="Une correction conserve la facture d’origine. Le numéro de l’avoir est attribué à l’émission." actions={<>
        <Button disabled={mutation.saving} onClick={() => void mutation.run(refresh, "")}><FileText size={14} aria-hidden="true" /> Actualiser les avoirs</Button>
        {canManage && sourceRead && <Button variant="primary" onClick={() => { setSelected(null); show("create"); }}><Plus size={14} aria-hidden="true" /> Préparer un avoir</Button>}
      </>}>
        {canManage && !sourceRead && <p className="field-note">La lecture des factures clients est nécessaire pour sélectionner une facture à corriger.</p>}
        {resource.loading && !resource.data ? <Loading label="Chargement des avoirs…" /> : <DataTable rows={notes} caption={kind === "CUSTOMER" ? "Liste des avoirs clients" : "Liste des avoirs fournisseurs"} onRowClick={(note) => void open(note)} empty={<Empty title="Aucun avoir" body="Préparez une correction à partir d’une facture émise ou validée." />} columns={[
          { key: "code", header: "Avoir", render: (note) => <><strong>{note.code ?? "Brouillon"}</strong><small>Version {note.version} · {note.sourceInvoiceName}</small></> },
          { key: "source", header: "Facture d’origine", render: (note) => note.sourceInvoiceCode ?? "Sans numéro" },
          { key: "date", header: "Émis le", render: (note) => formatDate(note.issueDate) },
          { key: "total", header: "Avoir TTC", align: "right", render: (note) => formatMoney(note.total, note.currency) },
          { key: "status", header: "Statut", render: (note) => <StatusChip status={note.status} label={LABEL[note.status]} /> },
          { key: "open", header: "Détail", render: (note) => <Button disabled={mutation.saving} onClick={() => void open(note)}>Ouvrir {note.code ?? "le brouillon"}</Button> },
        ]} />}
      </Panel>
      {activeNote && <Panel title={`${activeNote.code ?? "Avoir en préparation"} · version ${activeNote.version}`} subtitle={`${activeNote.sourceInvoiceCode ?? "Facture"} · ${activeNote.sourceInvoiceName}`} actions={<>
        <StatusChip status={activeNote.status} label={LABEL[activeNote.status]} />
        {activeNote.status === "DRAFT" && canManage && <Button disabled={mutation.saving} onClick={() => show("edit")}>Modifier le brouillon</Button>}
        {activeNote.status === "DRAFT" && session.can("finance.credit.issue") && <Button variant="primary" disabled={mutation.saving} onClick={() => show("issue")}><Send size={14} aria-hidden="true" /> Émettre l’avoir</Button>}
        {activeNote.status === "DRAFT" && canManage && <Button variant="danger" disabled={mutation.saving} onClick={() => show("cancel")}><XCircle size={14} aria-hidden="true" /> Annuler le brouillon</Button>}
        {activeNote.status === "ISSUED" && <a className="btn btn-secondary" href={api.downloadUrl(`${notePath(activeNote)}/export.pdf`)} target="_blank" rel="noopener noreferrer"><Printer size={14} aria-hidden="true" /> PDF de l’avoir</a>}
        {activeNote.status === "ISSUED" && session.can("finance.refund.manage") && (cents(refundable(activeNote)) ?? 0n) > 0n && <Button variant="primary" disabled={mutation.saving} onClick={() => show("refund")}>{kind === "CUSTOMER" ? <ArrowUpRight size={14} aria-hidden="true" /> : <ArrowDownLeft size={14} aria-hidden="true" />}{kind === "CUSTOMER" ? "Rembourser le client" : "Enregistrer le remboursement fournisseur"}</Button>}
      </>}>
        <DetailList items={[
          { label: "Motif", value: activeNote.reason },
          { label: "Avoir hors taxe", value: formatMoney(activeNote.subtotal, activeNote.currency) },
          { label: "Taxe corrigée", value: formatMoney(activeNote.taxTotal, activeNote.currency) },
          { label: "Avoir TTC", value: formatMoney(activeNote.total, activeNote.currency) },
          { label: "Cumul des avoirs émis sur la facture", value: formatMoney(activeNote.invoice.creditedAmount, activeNote.currency) },
          { label: "Facture nette après avoirs", value: formatMoney(activeNote.invoice.netTotal, activeNote.currency) },
          { label: "Paiements nets des remboursements", value: formatMoney(activeNote.invoice.netPaidAmount, activeNote.currency) },
          { label: "Reste dû sur la facture", value: formatMoney(activeNote.invoice.balanceDue, activeNote.currency) },
          { label: "À rembourser sur la facture", value: formatMoney(activeNote.invoice.refundDue, activeNote.currency) },
          ...(activeNote.cancelReason ? [{ label: "Motif d’annulation", value: activeNote.cancelReason }] : []),
        ]} />
        {activeNote.status === "DRAFT" && <p className="field-note">Ce brouillon n’a pas encore réduit le montant de la facture. Les prix et les taxes proviennent des lignes d’origine.</p>}
        <DataTable rows={activeNote.lines} caption="Lignes de l’avoir" empty={<Empty title="Aucune ligne" />} columns={[
          { key: "line", header: "Désignation", render: (line) => line.description },
          { key: "qty", header: "Quantité corrigée", align: "right", render: (line) => line.quantity },
          { key: "price", header: "PU HT d’origine", align: "right", render: (line) => formatMoney(line.unitPrice, activeNote.currency) },
          { key: "tax", header: "Taxe d’origine", align: "right", render: (line) => `${line.taxRate} %` },
          { key: "amount", header: "Montant HT", align: "right", render: (line) => formatMoney(line.lineTotal, activeNote.currency) },
        ]} />
        <h3>Remboursements enregistrés</h3>
        <DataTable rows={activeNote.refunds} caption="Remboursements de l’avoir" empty={<Empty title="Aucun remboursement" body="Seul un trop-perçu réel de la facture peut être remboursé." />} columns={[
          { key: "code", header: "Pièce", render: (refund) => refund.code },
          { key: "date", header: "Date", render: (refund) => formatDate(refund.refundedAt) },
          { key: "method", header: "Mode", render: (refund) => METHOD_LABEL[refund.method] },
          { key: "reference", header: "Référence", render: (refund) => refund.reference ?? "—" },
          { key: "amount", header: "Montant", align: "right", render: (refund) => formatMoney(refund.amount, refund.currency) },
        ]} />
      </Panel>}
      {(dialog === "create" || dialog === "edit") && <CreditDraftModal key={`${dialog}-${activeNote?.id ?? kind}`} kind={kind} note={dialog === "edit" ? activeNote : null} sourceRead={sourceRead} saving={mutation.saving} error={mutation.error} onClose={() => { if (!mutation.saving) setDialog(null); }} onSubmit={(input) => perform(() => dialog === "edit" && activeNote ? api.patch<CreditNoteView>(notePath(activeNote), input) : api.post<CreditNoteView>(basePath(kind), input), dialog === "edit" ? "Brouillon mis à jour." : "Avoir préparé. Vérifiez les montants avant émission.")} />}
      {(dialog === "issue" || dialog === "cancel") && activeNote && <CreditDecisionModal mode={dialog} note={activeNote} saving={mutation.saving} error={mutation.error} onClose={() => { if (!mutation.saving) setDialog(null); }} onSubmit={(input) => perform(() => api.post<CreditNoteView>(`${notePath(activeNote)}/${dialog}`, input), dialog === "issue" ? "Avoir émis. La facture nette a été recalculée." : "Brouillon annulé.")} />}
      {dialog === "refund" && activeNote && <CreditRefundModal note={activeNote} accounts={accounts.data ?? []} loading={accounts.loading} saving={mutation.saving} error={mutation.error || accounts.error} onClose={() => { if (!mutation.saving) setDialog(null); }} onSubmit={(input) => perform(() => api.post<CreditNoteView>(`${notePath(activeNote)}/refunds`, input), "Remboursement enregistré.")} />}
    </div>
  );
}

function CreditDraftModal({ kind, note, sourceRead, saving, error, onClose, onSubmit }: {
  kind: CreditNoteKind; note: CreditNoteView | null; sourceRead: boolean; saving: boolean; error: string; onClose: () => void; onSubmit: (input: CreditNoteCreateInput | CreditNoteUpdateInput) => Promise<void>;
}): React.ReactElement {
  const sources = useResource<SourceInvoice[]>(() => sourceRead ? kind === "CUSTOMER" ? financeApi.invoices() : financeApi.payables() : Promise.resolve([]), [kind, sourceRead]);
  const eligible = (sources.data ?? []).filter((invoice) => ["ISSUED", "APPROVED", "PARTIALLY_PAID", "PAID"].includes(invoice.status));
  const [invoiceId, setInvoiceId] = useState(note?.sourceInvoiceId ?? "");
  const [reason, setReason] = useState(note?.reason ?? "");
  const [quantities, setQuantities] = useState<Record<string, string>>(() => Object.fromEntries((note?.lines ?? []).map((line) => [line.sourceInvoiceLineId, line.quantity])));
  const [validation, setValidation] = useState<Record<string, string>>({});
  const invoice = eligible.find((item) => item.id === invoiceId);
  const lines: InvoiceLineView[] = invoice?.lines ?? (note?.lines ?? []).map((line) => ({ ...line, id: line.sourceInvoiceLineId }));
  const currency = invoice?.currency ?? note?.currency ?? "";
  async function submit(): Promise<void> {
    const errors: Record<string, string> = {};
    if (!invoiceId) errors.invoiceId = "Sélectionnez une facture émise ou validée.";
    if (!reason.trim()) errors.reason = "Indiquez le motif de la correction.";
    const selectedLines = lines.filter((line) => (quantities[line.id] ?? "").trim() !== "" && (quantities[line.id] ?? "").replace(",", ".").trim() !== "0");
    for (const line of selectedLines) {
      const quantity = (quantities[line.id] ?? "").replace(",", ".").trim();
      if (!/^\d+(?:\.\d+)?$/.test(quantity) || !/[1-9]/.test(quantity)) errors[line.id] = "Saisissez une quantité strictement positive.";
    }
    if (!selectedLines.length) errors.lines = "Sélectionnez au moins une ligne avec une quantité positive.";
    setValidation(errors);
    if (Object.keys(errors).length) return;
    const input = { reason: reason.trim(), lines: selectedLines.map((line) => ({ sourceInvoiceLineId: line.id, quantity: (quantities[line.id] ?? "").replace(",", ".").trim() })) };
    await onSubmit(note ? { ...input, expectedVersion: note.version } : { ...input, invoiceId });
  }
  return <Modal title={note ? `Modifier l’avoir · version ${note.version}` : kind === "CUSTOMER" ? "Préparer un avoir client" : "Préparer un avoir fournisseur"} wide onClose={onClose}>
    <Feedback error={error || sources.error || validation.lines} />
    {sources.loading && !sources.data ? <Loading label="Chargement des factures d’origine…" /> : <Form submitLabel={note ? "Enregistrer la nouvelle version" : "Préparer le brouillon"} saving={saving} onSubmit={submit}>
      {note ? <div className="field wide"><strong>Facture d’origine : {note.sourceInvoiceCode ?? "Sans numéro"}</strong><small className="field-note">{note.sourceInvoiceName} · {note.currency}</small></div> : <SelectField label="Facture d’origine" value={invoiceId} onChange={(id) => { setInvoiceId(id); setQuantities({}); setValidation({}); }} required error={validation.invoiceId} wide options={eligible.map((item) => ({ value: item.id, label: `${item.code ?? "Facture"} · ${"customerName" in item ? item.customerName : item.supplierName} · ${formatMoney(item.total, item.currency)}` }))} />}
      <TextAreaField label="Motif de l’avoir" value={reason} onChange={setReason} required error={validation.reason} hint="Ce motif accompagne la correction de la facture." />
      <div className="field wide">
        <p className="field-note">Renseignez seulement les quantités à corriger. Les prix, taxes et arrondis de la facture d’origine sont conservés. Le cumul des avoirs émis ne peut dépasser les quantités facturées.</p>
        <DataTable rows={lines} caption="Choix des quantités à corriger" empty={<Empty title="Sélectionnez une facture d’origine" />} columns={[
          { key: "description", header: "Ligne d’origine", render: (line) => line.description },
          { key: "source-quantity", header: invoice ? "Quantité facturée" : "Quantité du brouillon", align: "right", render: (line) => line.quantity },
          { key: "price", header: "PU HT", align: "right", render: (line) => formatMoney(line.unitPrice, currency) },
          { key: "tax", header: "Taxe", align: "right", render: (line) => `${line.taxRate} %` },
          { key: "quantity", header: "Quantité à corriger", render: (line) => <DecimalField id={`credit-qty-${line.id}`} label={`Quantité à corriger : ${line.description}`} value={quantities[line.id] ?? ""} onChange={(value) => setQuantities((current) => ({ ...current, [line.id]: value }))} error={validation[line.id]} disabled={saving} /> },
        ]} />
      </div>
    </Form>}
  </Modal>;
}

function CreditDecisionModal({ mode, note, saving, error, onClose, onSubmit }: {
  mode: "issue" | "cancel"; note: CreditNoteView; saving: boolean; error: string; onClose: () => void; onSubmit: (input: { expectedVersion: number; issueDate?: string; reason?: string }) => Promise<void>;
}): React.ReactElement {
  const [issueDate, setIssueDate] = useState(() => new Date().toLocaleDateString("en-CA"));
  const [reason, setReason] = useState("");
  return <Modal title={mode === "issue" ? "Émettre l’avoir" : "Annuler le brouillon"} onClose={onClose}>
    <Feedback error={error} />
    <p>{mode === "issue" ? `L’émission attribue un numéro définitif et corrige la facture ${note.sourceInvoiceCode ?? "d’origine"} de ${formatMoney(note.total, note.currency)}. L’avoir émis et ses lignes sont conservés.` : "Le brouillon annulé est conservé dans l’historique. Il ne corrige pas la facture."}</p>
    <Form saving={saving} submitLabel={mode === "issue" ? "Confirmer l’émission" : "Confirmer l’annulation"} onSubmit={() => onSubmit(mode === "issue" ? { expectedVersion: note.version, issueDate } : { expectedVersion: note.version, reason: reason.trim() })}>
      {mode === "issue" ? <DateField label="Date d’émission" value={issueDate} onChange={setIssueDate} required /> : <TextAreaField label="Motif d’annulation" value={reason} onChange={setReason} required />}
    </Form>
  </Modal>;
}

function CreditRefundModal({ note, accounts, loading, saving, error, onClose, onSubmit }: {
  note: CreditNoteView; accounts: BankAccountView[]; loading: boolean; saving: boolean; error: string; onClose: () => void; onSubmit: (input: CreditRefundInput) => Promise<void>;
}): React.ReactElement {
  const [idempotencyKey] = useState(() => newIdempotencyKey("credit-refund"));
  const eligible = accounts.filter((account) => account.isActive && account.currency === note.currency);
  const [bankAccountId, setBankAccountId] = useState(eligible[0]?.id ?? "");
  const [amount, setAmount] = useState(refundable(note));
  const [method, setMethod] = useState<CreditRefundInput["method"]>("TRANSFER");
  const [refundedAt, setRefundedAt] = useState(() => new Date().toLocaleDateString("en-CA"));
  const [reference, setReference] = useState("");
  const [amountError, setAmountError] = useState("");
  const maximum = refundable(note);
  async function submit(): Promise<void> {
    const value = cents(amount);
    if (value === null || value <= 0n || value > (cents(maximum) ?? 0n)) { setAmountError(`Saisissez un montant positif inférieur ou égal à ${formatMoney(maximum, note.currency)}.`); return; }
    setAmountError("");
    await onSubmit({ bankAccountId, amount: amount.replace(",", ".").trim(), refundedAt, method, reference: reference.trim() || undefined, idempotencyKey });
  }
  return <Modal title={note.kind === "CUSTOMER" ? "Rembourser le client" : "Enregistrer le remboursement reçu du fournisseur"} onClose={onClose}>
    <Feedback error={error} />
    <p>{note.kind === "CUSTOMER" ? "Le remboursement débite le compte sélectionné." : "Le remboursement reçu crédite le compte sélectionné."} Le montant est limité au trop-perçu de la facture et au solde remboursable de cet avoir.</p>
    {loading ? <Loading label="Chargement des comptes de trésorerie…" /> : eligible.length === 0 ? <Empty title={`Aucun compte actif en ${note.currency}`} body="Créez un compte de trésorerie dans la devise de la facture avant d’enregistrer le remboursement." /> : <Form submitLabel="Enregistrer le remboursement" saving={saving} onSubmit={submit}>
      <SelectField label="Compte de trésorerie" value={bankAccountId} onChange={setBankAccountId} required options={eligible.map((account) => ({ value: account.id, label: `${account.name} · ${formatMoney(account.balance, account.currency)}` }))} />
      <DecimalField label={`Montant (${note.currency})`} value={amount} onChange={setAmount} required error={amountError} hint={`Maximum remboursable sur cet avoir : ${formatMoney(maximum, note.currency)}`} />
      <SelectField label="Mode de remboursement" value={method} onChange={(value) => setMethod(value as CreditRefundInput["method"])} required options={Object.entries(METHOD_LABEL).map(([value, label]) => ({ value, label }))} />
      <DateField label="Date de valeur" value={refundedAt} onChange={setRefundedAt} required />
      <TextField label="Référence" value={reference} onChange={setReference} wide />
    </Form>}
  </Modal>;
}
