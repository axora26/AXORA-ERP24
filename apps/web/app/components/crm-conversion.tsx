"use client";
import React, { useEffect, useState } from "react";
import type { CrmAccountView, CrmContactView, CrmLeadView, CrmPipelineStageView } from "@axora24/contracts";
import { ApiError } from "../lib/api";
import { crmDirectoryApi } from "../lib/modules/crm";
import { useSession } from "../lib/session";
import { Form, Modal, SelectField, TextField } from "./ui";

export function CrmConversion({ lead, stages, onClose, onConverted }: { lead: CrmLeadView; stages: CrmPipelineStageView[]; onClose: () => void; onConverted: () => Promise<void> }): React.ReactElement {
  const { can, companies, activeCompanyId } = useSession();
  const [name, setName] = useState(lead.companyName);
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(companies.find(c => c.id === activeCompanyId)?.currency ?? "USD");
  const [stageId, setStageId] = useState(stages[0]?.id ?? "");
  const [date, setDate] = useState("");
  const [accountId, setAccountId] = useState("");
  const [contactId, setContactId] = useState("");
  const [accounts, setAccounts] = useState<CrmAccountView[]>([]);
  const [contacts, setContacts] = useState<CrmContactView[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    if (can("crm.account.read")) void crmDirectoryApi.accounts().then(v => { if (active) setAccounts(v); }).catch(() => { if (active) setError("Les comptes existants sont indisponibles. Vous pouvez réessayer en rouvrant cette fenêtre."); });
    if (can("crm.contact.read")) void crmDirectoryApi.contacts().then(v => { if (active) setContacts(v); }).catch(() => { if (active) setError("Les contacts existants sont indisponibles. Vous pouvez réessayer en rouvrant cette fenêtre."); });
    return () => { active = false; };
  }, [can]);
  async function convert(): Promise<void> {
    if (saving) return;
    const decimal = amount.trim().replace(",", ".");
    if (!/^\d{1,16}(\.\d{1,2})?$/.test(decimal)) { setError("Saisissez un montant positif ou nul, avec au maximum deux décimales."); return; }
    if (!/^[A-Z]{3}$/.test(currency)) { setError("La devise doit contenir trois lettres, par exemple USD, EUR ou XOF."); return; }
    setSaving(true); setError("");
    try { await crmDirectoryApi.convert(lead.id, { opportunityName: name.trim(), amount: decimal, currency, stageId, ...(date ? { expectedCloseDate: date } : {}), ...(accountId ? { accountId } : {}), ...(contactId ? { contactId } : {}) }); await onConverted(); }
    catch (caught) { setError(caught instanceof ApiError ? caught.message : "Conversion impossible."); }
    finally { setSaving(false); }
  }
  return <Modal title={`Convertir le prospect ${lead.companyName}`} onClose={() => !saving && onClose()} wide><p className="panel-note">La conversion crée une opportunité et conserve l’historique du prospect. Vous pouvez réutiliser un compte et son contact.</p><>{error && <div className="form-error" role="alert">{error}</div>}<Form columns={2} onSubmit={() => void convert()} saving={saving} submitLabel="Créer l’opportunité">
    <TextField label="Nom de l’opportunité" value={name} onChange={setName} required maxLength={300} wide /><TextField label="Montant" inputMode="decimal" value={amount} onChange={setAmount} required placeholder="12500.00" hint="Maximum deux décimales" /><TextField label="Devise" value={currency} onChange={v => setCurrency(v.toUpperCase())} required minLength={3} maxLength={3} hint="Code ISO : USD, EUR, XOF…" /><SelectField label="Étape initiale" value={stageId} onChange={setStageId} options={stages.map(s => ({ value: s.id, label: s.name }))} required /><TextField label="Clôture prévue" type="date" value={date} onChange={setDate} />
    {can("crm.account.read") && <SelectField label="Compte client" value={accountId} onChange={v => { setAccountId(v); setContactId(""); }} emptyLabel="Créer ou réutiliser depuis le prospect" options={accounts.map(a => ({ value: a.id, label: a.name }))} />}{accountId && can("crm.contact.read") && <SelectField label="Contact du compte" value={contactId} onChange={setContactId} emptyLabel="Créer ou réutiliser depuis le prospect" options={contacts.filter(c => c.accountId === accountId).map(c => ({ value: c.id, label: c.fullName }))} />}
  </Form></></Modal>;
}
