"use client";

import React, { useState } from "react";
import { BookOpen, Database, RefreshCw, Scale } from "lucide-react";
import type { AccountingEntryView, AccountingTrialBalanceView } from "@axora24/contracts";
import { financeApi } from "../lib/modules/finance";
import { formatDate, formatMoney } from "../lib/format";
import { useMutation, useResource } from "../lib/hooks";
import { Button, DataTable, Empty, Feedback, Metric, Metrics, Panel, StatusChip } from "./ui";

type AccountingTab = "accounts" | "entries" | "balance";

export function FinanceAccounting({ canManage, canPost }: { canManage: boolean; canPost: boolean }): React.ReactElement {
  const [tab, setTab] = useState<AccountingTab>("accounts");
  const mutation = useMutation();
  const configuration = useResource(() => financeApi.accountingConfiguration(), []);
  const entries = useResource<AccountingEntryView[]>(() => financeApi.accountingEntries(), [configuration.data?.accounts.length]);
  const balance = useResource<AccountingTrialBalanceView>(() => financeApi.accountingTrialBalance(), [configuration.data?.accounts.length, entries.data?.length]);
  const accounts = configuration.data?.accounts ?? [];
  const journals = configuration.data?.journals ?? [];

  async function bootstrap(): Promise<void> {
    const result = await mutation.run(() => financeApi.accountingBootstrap(), "Plan comptable et journaux initialisés.");
    if (result !== undefined) {
      await configuration.reload();
      await entries.reload();
      await balance.reload();
    }
  }

  const trial = balance.data;
  return (
    <section className="stack accounting-workspace" aria-label="Comptabilité générale">
      <Feedback error={configuration.error || entries.error || balance.error || mutation.error} notice={mutation.notice} />
      <Panel
        title="Comptabilité générale"
        subtitle="Plan de comptes, journaux et écritures équilibrées. Chaque écriture source est figée et auditée."
        actions={
          <div className="panel-actions">
            <Button onClick={() => void Promise.all([configuration.reload(), entries.reload(), balance.reload()])}>
              <RefreshCw size={14} aria-hidden="true" /> Actualiser
            </Button>
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
              {([['accounts', 'Plan comptable'], ['entries', 'Journal'], ['balance', 'Balance générale']] as const).map(([id, label]) => <button type="button" key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>)}
            </nav>
            {tab === "accounts" && <Panel title="Plan comptable" subtitle="Les comptes système sont utilisés automatiquement pour les factures et paiements."><DataTable rows={accounts} empty={<Empty title="Aucun compte" />} columns={[{ key: "code", header: "Compte", render: (account) => <><strong>{account.code}</strong><small>{account.name}</small></> }, { key: "type", header: "Classe", render: (account) => account.type }, { key: "debit", header: "Débit", align: "right", render: (account) => <span className="num">{formatMoney(account.debit, trial?.currency)}</span> }, { key: "credit", header: "Crédit", align: "right", render: (account) => <span className="num">{formatMoney(account.credit, trial?.currency)}</span> }, { key: "balance", header: "Solde", align: "right", render: (account) => <strong className="num">{formatMoney(account.balance, trial?.currency)}</strong> }, { key: "status", header: "État", render: (account) => <StatusChip status={account.isActive ? "done" : "pending"} label={account.isActive ? "Actif" : "Inactif"} /> }]} /></Panel>}
            {tab === "entries" && <Panel title="Journal des écritures" subtitle="Écritures issues des factures, paiements ou saisies autorisées. Débit = crédit sur chaque pièce."><DataTable rows={entries.data ?? []} empty={<Empty title="Aucune écriture" body={canPost ? "Les émissions et paiements généreront automatiquement les premières écritures." : undefined} />} columns={[{ key: "date", header: "Date", render: (entry) => formatDate(entry.entryDate) }, { key: "number", header: "N°", render: (entry) => <><strong>{entry.number}</strong><small>{entry.journalCode} · {entry.description}</small></> }, { key: "source", header: "Origine", render: (entry) => entry.sourceType ? entry.sourceType.replaceAll("_", " ") : "Saisie" }, { key: "debit", header: "Débit", align: "right", render: (entry) => <span className="num">{formatMoney(entry.totalDebit, entry.currency)}</span> }, { key: "credit", header: "Crédit", align: "right", render: (entry) => <span className="num">{formatMoney(entry.totalCredit, entry.currency)}</span> }, { key: "status", header: "État", render: (entry) => <StatusChip status={entry.status === "POSTED" ? "done" : "pending"} label={entry.status === "POSTED" ? "Comptabilisée" : "Extournée"} /> }]} /></Panel>}
            {tab === "balance" && <Panel title="Balance générale" subtitle="Cumul des écritures comptabilisées, par compte et période."><DataTable rows={(trial?.rows ?? []).map((row) => ({ ...row, id: row.accountId }))} empty={<Empty title="Balance vide" />} columns={[{ key: "code", header: "Compte", render: (row) => <><strong>{row.code}</strong><small>{row.name}</small></> }, { key: "type", header: "Classe", render: (row) => row.type }, { key: "debit", header: "Débit", align: "right", render: (row) => <span className="num">{formatMoney(row.debit, trial?.currency)}</span> }, { key: "credit", header: "Crédit", align: "right", render: (row) => <span className="num">{formatMoney(row.credit, trial?.currency)}</span> }, { key: "balance", header: "Solde", align: "right", render: (row) => <strong className="num">{formatMoney(row.balance, trial?.currency)}</strong> }]} /></Panel>}
          </>
        )}
      </Panel>
    </section>
  );
}
