"use client";

import React, { useState } from "react";
import type { BankAccountView, PaymentView } from "@axora24/contracts";
import { METHOD_LABEL } from "../lib/modules/finance";
import { newIdempotencyKey } from "../lib/modules/procurement";
import { formatDate, formatMoney } from "../lib/format";
import { DataTable, DateField, DecimalField, Empty, Feedback, Form, Modal, SelectField, TextField } from "./ui";

/** Formulaire de paiement : cle d'idempotence fixee a l'ouverture (un double envoi ne paie jamais deux fois). */
export function PaymentModal({
  title,
  currency,
  balanceDue,
  accounts,
  saving,
  error,
  onClose,
  onSubmit,
}: {
  title: string;
  currency: string;
  balanceDue: string;
  accounts: BankAccountView[];
  saving: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (input: { bankAccountId: string; amount: string; method: string; paidAt?: string; reference?: string; idempotencyKey: string }) => Promise<void>;
}): React.ReactElement {
  const [idempotencyKey] = useState(() => newIdempotencyKey("pay"));
  const eligible = accounts.filter((account) => account.isActive && account.currency === currency);
  const [bankAccountId, setBankAccountId] = useState(eligible[0]?.id ?? "");
  const [amount, setAmount] = useState(balanceDue);
  const [method, setMethod] = useState("TRANSFER");
  const [paidAt, setPaidAt] = useState("");
  const [reference, setReference] = useState("");
  return (
    <Modal title={title} onClose={onClose}>
      <Feedback error={error} />
      {eligible.length === 0 && <p className="inline-warning">Aucun compte de trésorerie en {currency} : créez-en un (aucune conversion de change implicite).</p>}
      <Form
        submitLabel="Enregistrer le paiement"
        saving={saving}
        onSubmit={() =>
          onSubmit({
            bankAccountId,
            amount: amount.replace(",", "."),
            method,
            paidAt: paidAt || undefined,
            reference: reference || undefined,
            idempotencyKey,
          })
        }
      >
        <SelectField
          label="Compte"
          value={bankAccountId}
          onChange={setBankAccountId}
          required
          options={eligible.map((account) => ({ value: account.id, label: `${account.name} (${formatMoney(account.balance, account.currency)})` }))}
        />
        <DecimalField label={`Montant (${currency})`} value={amount} onChange={setAmount} required hint={`Reste dû : ${formatMoney(balanceDue, currency)}`} />
        <SelectField label="Mode" value={method} onChange={setMethod} required options={Object.entries(METHOD_LABEL).map(([value, label]) => ({ value, label }))} />
        <DateField label="Date de valeur" value={paidAt} onChange={setPaidAt} />
        <TextField label="Référence (virement, chèque…)" value={reference} onChange={setReference} wide />
      </Form>
    </Modal>
  );
}

export function PaymentsTable({ payments }: { payments: PaymentView[] }): React.ReactElement {
  return (
    <DataTable
      rows={payments}
      empty={<Empty title="Aucun paiement" />}
      columns={[
        { key: "code", header: "Pièce", render: (payment) => <strong>{payment.code}</strong> },
        { key: "date", header: "Date", render: (payment) => formatDate(payment.paidAt) },
        { key: "method", header: "Mode", render: (payment) => `${METHOD_LABEL[payment.method]}${payment.reference ? ` · ${payment.reference}` : ""}` },
        { key: "account", header: "Compte", render: (payment) => payment.bankAccountName },
        { key: "amount", header: "Montant", align: "right", render: (payment) => <span className="num">{formatMoney(payment.amount, payment.currency)}</span> },
      ]}
    />
  );
}
