"use client";

import React, { useMemo, useState } from "react";
import type { BankAccountView, BankStatementEntryView, PaymentView } from "@axora24/contracts";
import { financeApi } from "../lib/modules/finance";
import { formatDate, formatMoney } from "../lib/format";
import { useMutation, useResource } from "../lib/hooks";
import { Button, DataTable, Empty, Feedback, SelectField, TextAreaField } from "./ui";

export function BankReconciliation({ accounts, payments, canManage }: { accounts: BankAccountView[]; payments: PaymentView[]; canManage: boolean }): React.ReactElement {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [raw, setRaw] = useState("");
  const statements = useResource(() => financeApi.bankStatements(accountId || undefined), [accountId]);
  const mutation = useMutation();
  const account = accounts.find((item) => item.id === accountId);
  const candidate = useMemo(() => (entry: BankStatementEntryView) => payments.find((payment) => payment.bankAccountId === entry.bankAccountId && Math.abs(Number(payment.amount) - Math.abs(Number(entry.amount))) < 0.005), [payments]);

  function parseCsv(): Array<Record<string, unknown>> {
    return raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line, index) => {
      const [externalId, bookedAt, description, amount, currency] = line.split(";").map((value) => value?.trim() ?? "");
      if (!externalId || !bookedAt || !description || !amount) throw new Error(`Ligne ${index + 1} invalide. Format : référence;date;description;montant;devise`);
      return { externalId, bookedAt, description, amount, currency: currency || account?.currency || "CDF" };
    });
  }

  return <div className="stack">
    <Feedback error={statements.error || mutation.error} notice={mutation.notice} />
    {canManage && <div className="reconciliation-import">
      <SelectField label="Compte à rapprocher" value={accountId} onChange={setAccountId} options={accounts.map((item) => ({ value: item.id, label: `${item.code} · ${item.name}` }))} />
      <TextAreaField label="Lignes de relevé (CSV séparé par ; )" value={raw} onChange={setRaw} placeholder="RELEVE-001;2026-10-04;Virement client;150000;CDF" hint="Une ligne : référence externe ; date ISO ; libellé ; montant ; devise. Les doublons sont ignorés." />
      <div className="actions"><Button variant="primary" disabled={mutation.saving || !accountId || !raw.trim()} onClick={() => void mutation.run(async () => { const result = await financeApi.importBankStatement({ bankAccountId: accountId, entries: parseCsv() }); setRaw(""); await statements.reload(); return result; }, "Relevé importé, doublons ignorés.")}>Importer le relevé</Button></div>
    </div>}
    <DataTable rows={statements.data ?? []} empty={<Empty title="Aucune ligne de relevé" body="Importez un relevé pour commencer le rapprochement transactionnel." />} columns={[
      { key: "entry", header: "Opération", render: (entry) => <><strong>{entry.description}</strong><small>{entry.externalId} · {formatDate(entry.bookedAt)}</small></> },
      { key: "amount", header: "Montant", align: "right", render: (entry) => <span className={Number(entry.amount) < 0 ? "text-danger num" : "text-success num"}>{formatMoney(entry.amount, entry.currency)}</span> },
      { key: "status", header: "État", render: (entry) => entry.status === "MATCHED" ? <span className="status-chip status-done">Rapprochée</span> : entry.status === "IGNORED" ? <span className="status-chip">Ignorée</span> : <span className="status-chip status-pending">À rapprocher</span> },
      { key: "action", header: "Action", render: (entry) => { const payment = candidate(entry); return entry.status === "UNMATCHED" && canManage && payment ? <Button variant="ghost" onClick={() => void mutation.run(async () => { const result = await financeApi.matchBankStatement(entry.id, payment.id); await statements.reload(); return result; }, "Transaction rapprochée.")}>Rapprocher {payment.reference ?? payment.code}</Button> : entry.status === "UNMATCHED" ? "Aucun paiement correspondant" : entry.matchedPaymentId ?? "—"; } },
    ]} />
  </div>;
}
