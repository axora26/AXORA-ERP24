"use client";

import React, { useMemo, useState } from "react";
import { BookOpen, Database, Plus, RefreshCw, Scale } from "lucide-react";
import type { AccountingEntryView, AccountingFinancialStatementsView, AccountingTrialBalanceView } from "@axora24/contracts";
import { financeApi } from "../lib/modules/finance";
import { formatDate, formatMoney } from "../lib/format";
import { useMutation, useResource } from "../lib/hooks";
import {
  Button,
  DataTable,
  DateField,
  DecimalField,
  Empty,
  Feedback,
  Form,
  Metric,
  Metrics,
  Modal,
  Panel,
  SelectField,
  StatusChip,
  TextField,
} from "./ui";

type AccountingTab = "accounts" | "entries" | "balance" | "statements";
type Dialog = "account" | "journal" | "entry" | null;
type EntryLine = { accountId: string; label: string; debit: string; credit: string };

const today = () => new Date().toISOString().slice(0, 10);

export function FinanceAccounting({ canManage, canPost }: { canManage: boolean; canPost: boolean }): React.ReactElement {
  const [tab, setTab] = useState<AccountingTab>("accounts");
  const [dialog, setDialog] = useState<Dialog>(null);
  const mutation = useMutation();
  const configuration = useResource(() => financeApi.accountingConfiguration(), []);
  const entries = useResource<AccountingEntryView[]>(() => financeApi.accountingEntries(), [configuration.data?.accounts.length]);
  const balance = useResource<AccountingTrialBalanceView>(() => financeApi.accountingTrialBalance(), [configuration.data?.accounts.length, entries.data?.length]);
  const statements = useResource<AccountingFinancialStatementsView>(() => financeApi.accountingStatements(), [configuration.data?.accounts.length, entries.data?.length]);
  const accounts = configuration.data?.accounts ?? [];
  const journals = configuration.data?.journals ?? [];

  const refresh = async (): Promise<void> => {
    await Promise.all([configuration.reload(), entries.reload(), balance.reload(), statements.reload()]);
  };

  async function bootstrap(): Promise<void> {
    const result = await mutation.run(() => financeApi.accountingBootstrap(), "Plan comptable et journaux initialisés.");
    if (result !== undefined) await refresh();
  }

  async function saveDialog(action: () => Promise<unknown>, success: string): Promise<void> {
    const result = await mutation.run(action, success);
    if (result !== undefined) {
      setDialog(null);
      await refresh();
    }
  }

  const trial = balance.data;
  const accountOptions = useMemo(() => accounts.filter((account) => account.isActive).map((account) => ({ value: account.id, label: `${account.code} — ${account.name}` })), [accounts]);
  const journalOptions = useMemo(() => journals.filter((journal) => journal.isActive).map((journal) => ({ value: journal.id, label: `${journal.code} — ${journal.name}` })), [journals]);

  return (
    <section className="stack accounting-workspace" aria-label="Comptabilité générale">
      <Feedback error={configuration.error || entries.error || balance.error || statements.error || mutation.error} notice={mutation.notice} />
      <Panel
        title="Comptabilité générale"
        subtitle="Plan de comptes, journaux et écritures équilibrées. Chaque écriture source est figée et auditée."
        actions={
          <div className="panel-actions">
            <Button onClick={() => void refresh()}><RefreshCw size={14} aria-hidden="true" /> Actualiser</Button>
            {canManage && accounts.length > 0 && <Button onClick={() => setDialog("account")}><Plus size={14} aria-hidden="true" /> Compte</Button>}
            {canManage && journals.length > 0 && <Button onClick={() => setDialog("journal")}><Plus size={14} aria-hidden="true" /> Journal</Button>}
            {canPost && accounts.length > 0 && journals.length > 0 && <Button variant="primary" onClick={() => setDialog("entry")}><Plus size={14} aria-hidden="true" /> Écriture</Button>}
            {canManage && accounts.length === 0 && <Button variant="primary" onClick={() => void bootstrap()} disabled={mutation.saving}><Database size={14} aria-hidden="true" /> Initialiser</Button>}
          </div>
        }
      >
        {accounts.length === 0 ? (
          <Empty icon={<BookOpen size={24} />} title="Plan comptable non initialisé" body={canManage ? "Initialisez le plan standard AXORA puis adaptez les comptes selon votre conseil comptable." : "Un administrateur Finance doit initialiser le plan comptable."} />
        ) : (
          <>
            <Metrics label="Contrôle de la balance">
              <Metric icon={<BookOpen size={19} />} tone="blue" label="Comptes actifs" value={String(accounts.filter((account) => account.isActive).length)} detail={`${journals.length} journal(aux) configuré(s)`} />
              <Metric icon={<Scale size={19} />} tone="green" label="Total débit" value={formatMoney(trial?.totalDebit ?? "0.00", trial?.currency)} detail="Écritures validées" />
              <Metric icon={<Scale size={19} />} tone={trial && trial.totalDebit !== trial.totalCredit ? "red" : "green"} label="Total crédit" value={formatMoney(trial?.totalCredit ?? "0.00", trial?.currency)} detail={trial && trial.totalDebit === trial.totalCredit ? "Balance équilibrée" : "Écart à contrôler"} />
            </Metrics>
            <nav className="accounting-tabs" aria-label="Vues comptables">
              {([['accounts', 'Plan comptable'], ['entries', 'Journal'], ['balance', 'Balance générale'], ['statements', 'États financiers']] as const).map(([id, label]) => <button type="button" key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>)}
            </nav>
            {tab === "accounts" && <Panel title="Plan comptable" subtitle="Les comptes système sont utilisés automatiquement pour les factures et paiements."><DataTable rows={accounts} empty={<Empty title="Aucun compte" />} columns={[{ key: "code", header: "Compte", render: (account) => <><strong>{account.code}</strong><small>{account.name}</small></> }, { key: "type", header: "Classe", render: (account) => account.type }, { key: "debit", header: "Débit", align: "right", render: (account) => <span className="num">{formatMoney(account.debit, trial?.currency)}</span> }, { key: "credit", header: "Crédit", align: "right", render: (account) => <span className="num">{formatMoney(account.credit, trial?.currency)}</span> }, { key: "balance", header: "Solde", align: "right", render: (account) => <strong className="num">{formatMoney(account.balance, trial?.currency)}</strong> }, { key: "status", header: "État", render: (account) => <StatusChip status={account.isActive ? "done" : "pending"} label={account.isActive ? "Actif" : "Inactif"} /> }]} /></Panel>}
            {tab === "entries" && <Panel title="Journal des écritures" subtitle="Écritures issues des factures, paiements ou saisies autorisées. Débit = crédit sur chaque pièce."><DataTable rows={entries.data ?? []} empty={<Empty title="Aucune écriture" body={canPost ? "Les émissions et paiements généreront automatiquement les premières écritures." : undefined} />} columns={[{ key: "date", header: "Date", render: (entry) => formatDate(entry.entryDate) }, { key: "number", header: "N°", render: (entry) => <><strong>{entry.number}</strong><small>{entry.journalCode} · {entry.description}</small></> }, { key: "source", header: "Origine", render: (entry) => entry.sourceType ? entry.sourceType.replaceAll("_", " ") : "Saisie" }, { key: "debit", header: "Débit", align: "right", render: (entry) => <span className="num">{formatMoney(entry.totalDebit, entry.currency)}</span> }, { key: "credit", header: "Crédit", align: "right", render: (entry) => <span className="num">{formatMoney(entry.totalCredit, entry.currency)}</span> }, { key: "status", header: "État", render: (entry) => <StatusChip status={entry.status === "POSTED" ? "done" : "pending"} label={entry.status === "POSTED" ? "Comptabilisée" : "Extournée"} /> }]} /></Panel>}
            {tab === "balance" && <Panel title="Balance générale" subtitle="Cumul des écritures comptabilisées, par compte et période."><DataTable rows={(trial?.rows ?? []).map((row) => ({ ...row, id: row.accountId }))} empty={<Empty title="Balance vide" />} columns={[{ key: "code", header: "Compte", render: (row) => <><strong>{row.code}</strong><small>{row.name}</small></> }, { key: "type", header: "Classe", render: (row) => row.type }, { key: "debit", header: "Débit", align: "right", render: (row) => <span className="num">{formatMoney(row.debit, trial?.currency)}</span> }, { key: "credit", header: "Crédit", align: "right", render: (row) => <span className="num">{formatMoney(row.credit, trial?.currency)}</span> }, { key: "balance", header: "Solde", align: "right", render: (row) => <strong className="num">{formatMoney(row.balance, trial?.currency)}</strong> }]} /></Panel>}
            {tab === "statements" && statements.data && <div className="module-grid cols-2 financial-statements-grid"><Panel title="Compte de résultat" subtitle="Produits et charges des écritures comptabilisées."><Metrics label="Résultat"><Metric icon={<Scale size={18} />} tone={Number(statements.data.netIncome) >= 0 ? "green" : "red"} label="Résultat net" value={formatMoney(statements.data.netIncome, statements.data.currency)} detail={`Produits ${formatMoney(statements.data.totalRevenue, statements.data.currency)} · Charges ${formatMoney(statements.data.totalExpenses, statements.data.currency)}`} /></Metrics><DataTable rows={statements.data.incomeStatement.map((row) => ({ ...row, id: row.accountId }))} empty={<Empty title="Aucun produit ou charge" />} columns={[{ key: "account", header: "Compte", render: (row) => <><strong>{row.code}</strong><small>{row.name}</small></> }, { key: "amount", header: "Montant", align: "right", render: (row) => <span className="num">{formatMoney(row.amount, statements.data?.currency)}</span> }]} /></Panel><Panel title="Bilan" subtitle="Actif, passif et capitaux propres à la période sélectionnée."><Metrics label="Équilibre"><Metric icon={<Scale size={18} />} tone="blue" label="Actif" value={formatMoney(statements.data.totalAssets, statements.data.currency)} /><Metric icon={<Scale size={18} />} tone="amber" label="Passif + capitaux propres" value={formatMoney((Number(statements.data.totalLiabilities) + Number(statements.data.totalEquity)).toFixed(2), statements.data.currency)} /></Metrics><DataTable rows={statements.data.balanceSheet.map((row) => ({ ...row, id: `${row.accountId}-${row.code}` }))} empty={<Empty title="Bilan vide" />} columns={[{ key: "account", header: "Compte", render: (row) => <><strong>{row.code}</strong><small>{row.name}</small></> }, { key: "amount", header: "Montant", align: "right", render: (row) => <span className="num">{formatMoney(row.amount, statements.data?.currency)}</span> }]} /></Panel></div>}
          </>
        )}
      </Panel>
      {dialog === "account" && <AccountingAccountModal saving={mutation.saving} error={mutation.error} onClose={() => setDialog(null)} onSubmit={(input) => saveDialog(() => financeApi.createAccountingAccount(input), "Compte comptable créé.")} />}
      {dialog === "journal" && <AccountingJournalModal saving={mutation.saving} error={mutation.error} onClose={() => setDialog(null)} onSubmit={(input) => saveDialog(() => financeApi.createAccountingJournal(input), "Journal comptable créé.")} />}
      {dialog === "entry" && <ManualEntryModal saving={mutation.saving} error={mutation.error} currency={trial?.currency ?? "USD"} accounts={accountOptions} journals={journalOptions} onClose={() => setDialog(null)} onSubmit={(input) => saveDialog(() => financeApi.createAccountingEntry(input), "Écriture comptable enregistrée et équilibrée.")} />}
    </section>
  );
}

function AccountingAccountModal({ saving, error, onClose, onSubmit }: { saving: boolean; error: string; onClose: () => void; onSubmit: (input: Record<string, unknown>) => Promise<void> }): React.ReactElement {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState("EXPENSE");
  return <Modal title="Nouveau compte comptable" onClose={onClose}><Feedback error={error} /><Form submitLabel="Créer le compte" saving={saving} onSubmit={() => onSubmit({ code, name, type })}><TextField label="Code" value={code} onChange={setCode} required placeholder="Ex. 623000" /><TextField label="Libellé" value={name} onChange={setName} required /><SelectField label="Classe" value={type} onChange={setType} required options={[{ value: "ASSET", label: "Actif" }, { value: "LIABILITY", label: "Passif" }, { value: "EQUITY", label: "Capitaux propres" }, { value: "REVENUE", label: "Produit" }, { value: "EXPENSE", label: "Charge" }]} /></Form></Modal>;
}

function AccountingJournalModal({ saving, error, onClose, onSubmit }: { saving: boolean; error: string; onClose: () => void; onSubmit: (input: Record<string, unknown>) => Promise<void> }): React.ReactElement {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState("GENERAL");
  return <Modal title="Nouveau journal" onClose={onClose}><Feedback error={error} /><Form submitLabel="Créer le journal" saving={saving} onSubmit={() => onSubmit({ code, name, type })}><TextField label="Code" value={code} onChange={setCode} required placeholder="Ex. OD2" /><TextField label="Libellé" value={name} onChange={setName} required /><SelectField label="Type" value={type} onChange={setType} required options={[{ value: "SALES", label: "Ventes" }, { value: "PURCHASES", label: "Achats" }, { value: "BANK", label: "Banque" }, { value: "CASH", label: "Caisse" }, { value: "GENERAL", label: "Opérations diverses" }]} /></Form></Modal>;
}

function ManualEntryModal({ saving, error, currency, accounts, journals, onClose, onSubmit }: { saving: boolean; error: string; currency: string; accounts: Array<{ value: string; label: string }>; journals: Array<{ value: string; label: string }>; onClose: () => void; onSubmit: (input: Record<string, unknown>) => Promise<void> }): React.ReactElement {
  const [journalId, setJournalId] = useState(journals[0]?.value ?? "");
  const [entryDate, setEntryDate] = useState(today());
  const [description, setDescription] = useState("");
  const [lines, setLines] = useState<EntryLine[]>([
    { accountId: accounts[0]?.value ?? "", label: "", debit: "", credit: "" },
    { accountId: accounts[1]?.value ?? accounts[0]?.value ?? "", label: "", debit: "", credit: "" },
  ]);
  const updateLine = (index: number, key: keyof EntryLine, value: string) => setLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, [key]: value, ...(key === "debit" && value ? { credit: "" } : {}), ...(key === "credit" && value ? { debit: "" } : {}) } : line));
  const addLine = () => setLines((current) => [...current, { accountId: accounts[0]?.value ?? "", label: "", debit: "", credit: "" }]);
  const removeLine = (index: number) => setLines((current) => current.length > 2 ? current.filter((_, lineIndex) => lineIndex !== index) : current);
  const debit = lines.reduce((sum, line) => sum + Number(line.debit.replace(",", ".") || 0), 0);
  const credit = lines.reduce((sum, line) => sum + Number(line.credit.replace(",", ".") || 0), 0);
  const balanced = Math.abs(debit - credit) < 0.005 && debit > 0;
  return <Modal title="Saisir une écriture" wide onClose={onClose}><Feedback error={error} /><Form submitLabel={balanced ? "Comptabiliser" : "Équilibrez l'écriture"} saving={saving} submitDisabled={!balanced} onSubmit={() => onSubmit({ journalId, entryDate, description, currency, lines: lines.map((line) => ({ ...line, debit: line.debit.replace(",", ".") || "0", credit: line.credit.replace(",", ".") || "0" })) })}>
    <SelectField label="Journal" value={journalId} onChange={setJournalId} required options={journals} />
    <DateField label="Date" value={entryDate} onChange={setEntryDate} required />
    <TextField label="Libellé de l'écriture" value={description} onChange={setDescription} required wide placeholder="Ex. Régularisation fournisseur" />
    <div className="accounting-entry-lines field wide">
      <div className="accounting-line-head"><span>Compte</span><span>Libellé</span><span>Débit ({currency})</span><span>Crédit ({currency})</span><span className="sr-only">Action</span></div>
      {lines.map((line, index) => <div className="accounting-line" key={index}><SelectField label={`Compte ligne ${index + 1}`} value={line.accountId} onChange={(value) => updateLine(index, "accountId", value)} required options={accounts} /><TextField label={`Libellé ligne ${index + 1}`} value={line.label} onChange={(value) => updateLine(index, "label", value)} required placeholder="Libellé" /><DecimalField label={`Débit ligne ${index + 1}`} value={line.debit} onChange={(value) => updateLine(index, "debit", value)} placeholder="0.00" /><DecimalField label={`Crédit ligne ${index + 1}`} value={line.credit} onChange={(value) => updateLine(index, "credit", value)} placeholder="0.00" /><button className="icon-button" type="button" onClick={() => removeLine(index)} disabled={lines.length <= 2} aria-label={`Supprimer la ligne ${index + 1}`}>×</button></div>)}
      <div className="accounting-entry-total"><Button type="button" onClick={addLine}><Plus size={14} aria-hidden="true" /> Ajouter une ligne</Button><strong>Débit {debit.toFixed(2)} · Crédit {credit.toFixed(2)} {balanced ? "· équilibrée" : "· à équilibrer"}</strong></div>
    </div>
  </Form></Modal>;
}
