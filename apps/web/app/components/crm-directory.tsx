"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import type { CrmAccountView, CrmContactView, CrmPage } from "@axora24/contracts";
import { ApiError } from "../lib/api";
import { crmError, isStaleRecord } from "../lib/crm-error";
import { crmDirectoryApi } from "../lib/modules/crm";
import { useSession } from "../lib/session";
import { DataTable, Form, Modal, SelectField, TextField } from "./ui";

type RecordView = CrmAccountView | CrmContactView;
export function CrmPagination({ page, pages, total, onChange }: { page: number; pages: number; total: number; onChange: (page: number) => void }): React.ReactElement {
  return <nav className="crm-pagination" aria-label="Pagination"><span>{total} résultat{total > 1 ? "s" : ""} · Page {page} sur {Math.max(1, pages)}</span><div><button type="button" className="secondary-button" disabled={page <= 1} onClick={() => onChange(page - 1)}>Précédente</button><button type="button" className="secondary-button" disabled={page >= pages} onClick={() => onChange(page + 1)}>Suivante</button></div></nav>;
}

export function CrmDirectory({ kind }: { kind: "accounts" | "contacts" }): React.ReactElement {
  const { can } = useSession();
  const contacts = kind === "contacts";
  const manage = can(contacts ? "crm.contact.manage" : "crm.account.manage");
  const [q, setQ] = useState("");
  const [archived, setArchived] = useState("false");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<CrmPage<RecordView> | null>(null);
  const [accounts, setAccounts] = useState<CrmAccountView[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState<RecordView | "new" | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<RecordView | null>(null);
  const [saving, setSaving] = useState(false);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    try {
      const query = new URLSearchParams({ q, archived, page: String(page), pageSize: "20" }).toString();
      const next = contacts ? await crmDirectoryApi.contactPage(query) : await crmDirectoryApi.accountPage(query);
      if (request === generation.current) { setData(next); setError(""); }
    } catch (caught) { if (request === generation.current) setError(caught instanceof ApiError ? caught.message : "Chargement impossible."); }
    finally { if (request === generation.current) setLoading(false); }
  }, [q, archived, page, contacts]);
  useEffect(() => { const timeout = window.setTimeout(() => void load(), 250); return () => window.clearTimeout(timeout); }, [load]);
  useEffect(() => {
    if (!contacts || !can("crm.account.read")) return;
    let active = true;
    void crmDirectoryApi.accounts().then(next => { if (active) setAccounts(next); }).catch(() => { if (active) setError("La liste des comptes est indisponible. Actualisez avant de modifier une association."); });
    return () => { active = false; };
  }, [contacts, can]);
  async function archive(): Promise<void> {
    if (!archiveTarget || saving) return;
    setSaving(true);
    try {
      const restore = !!archiveTarget.archivedAt;
      if (contacts) await crmDirectoryApi.archiveContact(archiveTarget.id, archiveTarget.version, restore);
      else await crmDirectoryApi.archiveAccount(archiveTarget.id, archiveTarget.version, restore);
      setArchiveTarget(null); await load();
    } catch (caught) { setError(crmError(caught, "Action impossible.")); setArchiveTarget(null); }
    finally { setSaving(false); }
  }
  const nameOf = (row: RecordView) => "fullName" in row ? row.fullName : row.name;
  return <section className="panel crm-resource-panel" aria-label={contacts ? "Contacts" : "Comptes"}>
    <div className="panel-head"><div><h2>{contacts ? "Contacts" : "Comptes clients"}</h2><p>{contacts ? "Interlocuteurs et coordonnées de vos comptes" : "Entreprises clientes et partenaires commerciaux"}</p></div>{manage && <button className="primary-inline-button" type="button" onClick={() => setEditor("new")}>{contacts ? "Nouveau contact" : "Nouveau compte"}</button>}</div>
    <div className="crm-filters"><TextField label="Rechercher" value={q} onChange={value => { setQ(value); setPage(1); }} placeholder={contacts ? "Nom, courriel, fonction…" : "Nom, ville, secteur…"} /><SelectField label="État des fiches" value={archived} onChange={value => { setArchived(value || "false"); setPage(1); }} options={[{ value: "false", label: "Actives" }, { value: "true", label: "Archivées" }, { value: "all", label: "Toutes" }]} /><button className="secondary-button" type="button" onClick={() => void load()} disabled={loading}>Actualiser</button></div>
    {error && <div className="form-error" role="alert">{error}</div>}
    {!data ? <p role="status">{loading ? "Chargement…" : "Les fiches sont indisponibles. Réessayez avec Actualiser."}</p> : <>
      <div aria-busy={loading}><DataTable<RecordView> caption={contacts ? "Répertoire des contacts" : "Répertoire des comptes"} rows={data.items} empty={<p className="panel-note">Aucune fiche ne correspond à  votre recherche.</p>} columns={[
        { key: "name", header: contacts ? "Contact" : "Compte", render: row => <strong>{nameOf(row)}</strong> },
        { key: "detail", header: contacts ? "Compte / Fonction" : "Ville / Secteur", render: row => "fullName" in row ? <>{accounts.find(account => account.id === row.accountId)?.name ?? (row.accountId ? "Compte associé" : "Sans compte")}<small className="table-subtext">{row.jobTitle ?? "—"}{row.isPrimary ? " · Principal" : ""}</small></> : <>{[row.city, row.country].filter(Boolean).join(", ") || "—"}<small className="table-subtext">{row.industry ?? "—"}</small></> },
        { key: "email", header: "Courriel / Téléphone", render: row => <>{row.email ? <a href={`mailto:${row.email}`}>{row.email}</a> : "—"}<small className="table-subtext">{row.phone ?? "—"}</small></> },
        { key: "state", header: "État", render: row => row.archivedAt ? "Archivée" : "Active" },
        { key: "actions", header: "Actions", render: row => manage ? <div className="crm-row-actions">{!row.archivedAt && <button type="button" className="link-button" aria-label={`Modifier ${nameOf(row)}`} onClick={() => setEditor(row)}>Modifier</button>}<button type="button" className="link-button" aria-label={`${row.archivedAt ? "Restaurer" : "Archiver"} ${nameOf(row)}`} onClick={() => setArchiveTarget(row)}>{row.archivedAt ? "Restaurer" : "Archiver"}</button></div> : "Lecture seule" },
      ]} /></div><CrmPagination page={data.page} pages={data.totalPages} total={data.total} onChange={setPage} />
    </>}
    {editor && <DirectoryEditor kind={kind} record={editor === "new" ? undefined : editor} accounts={accounts} onClose={() => setEditor(null)} onSaved={async () => { setEditor(null); await load(); }} />}
    {archiveTarget && <Modal title={archiveTarget.archivedAt ? "Restaurer la fiche" : "Archiver la fiche"} onClose={() => !saving && setArchiveTarget(null)}><p>{archiveTarget.archivedAt ? "Cette fiche sera de nouveau disponible pour les opérations commerciales." : "Cette fiche sera masquée dans les listes actives. Vous pourrez la restaurer depuis les fiches archivées."}</p><p><strong>{nameOf(archiveTarget)}</strong></p><div className="module-form-actions"><button className="secondary-button" type="button" disabled={saving} onClick={() => setArchiveTarget(null)}>Annuler</button><button className="primary-inline-button" type="button" disabled={saving} onClick={() => void archive()}>{saving ? "Enregistrement…" : archiveTarget.archivedAt ? "Restaurer" : "Archiver"}</button></div></Modal>}
  </section>;
}

function DirectoryEditor({ kind, record, accounts, onClose, onSaved }: { kind: "accounts" | "contacts"; record?: RecordView; accounts: CrmAccountView[]; onClose: () => void; onSaved: () => Promise<void> }): React.ReactElement {
  const contacts = kind === "contacts";
  const existingContact = record && "fullName" in record ? record : undefined;
  const existingAccount = record && "name" in record ? record : undefined;
  const [fields, setFields] = useState({ name: existingAccount?.name ?? existingContact?.fullName ?? "", email: record?.email ?? "", phone: record?.phone ?? "", city: existingAccount?.city ?? "", country: existingAccount?.country ?? "", industry: existingAccount?.industry ?? "", website: existingAccount?.website ?? "", jobTitle: existingContact?.jobTitle ?? "", accountId: existingContact?.accountId ?? "", isPrimary: existingContact?.isPrimary ?? false });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const set = (key: keyof typeof fields, value: string | boolean) => setFields(current => ({ ...current, [key]: value }));
  async function submit(): Promise<void> {
    if (saving || conflict) return;
    setSaving(true); setError("");
    try {
      if (contacts) {
        const input = { fullName: fields.name.trim(), email: fields.email.trim() || null, phone: fields.phone.trim() || null, jobTitle: fields.jobTitle.trim() || null, accountId: fields.accountId || null, isPrimary: fields.isPrimary };
        if (record) await crmDirectoryApi.updateContact(record.id, { ...input, expectedVersion: record.version }); else await crmDirectoryApi.createContact(input);
      } else {
        const input = { name: fields.name.trim(), email: fields.email.trim() || null, phone: fields.phone.trim() || null, city: fields.city.trim() || null, country: fields.country.trim() || null, industry: fields.industry.trim() || null, website: fields.website.trim() || null };
        if (record) await crmDirectoryApi.updateAccount(record.id, { ...input, expectedVersion: record.version }); else await crmDirectoryApi.createAccount(input);
      }
      await onSaved();
    } catch (caught) { const stale = isStaleRecord(caught); setConflict(stale); setError(stale ? "Cette fiche a été modifiée ailleurs. Fermez puis actualisez la liste pour retrouver la dernière version." : crmError(caught, "Enregistrement impossible.")); }
    finally { setSaving(false); }
  }
  return <Modal title={`${record ? "Modifier" : "Créer"} ${contacts ? "un contact" : "un compte"}`} onClose={() => !saving && onClose()} wide><>{error && <div className="form-error" role="alert">{error}</div>}<Form columns={2} onSubmit={() => void submit()} saving={saving || conflict} submitLabel="Enregistrer">
    <TextField label={contacts ? "Nom complet" : "Nom de l’entreprise"} value={fields.name} onChange={v => set("name", v)} required maxLength={300} />
    {contacts ? <SelectField label="Compte associé" value={fields.accountId} onChange={v => set("accountId", v)} emptyLabel="Sans compte" options={[...accounts.map(a => ({ value: a.id, label: a.name })), ...(existingContact?.accountId && !accounts.some(a => a.id === existingContact.accountId) ? [{ value: existingContact.accountId, label: "Compte actuellement associé" }] : [])]} /> : <TextField label="Secteur d’activité" value={fields.industry} onChange={v => set("industry", v)} maxLength={300} />}
    <TextField label="Courriel" type="email" value={fields.email} onChange={v => set("email", v)} maxLength={300} /><TextField label="Téléphone" type="tel" value={fields.phone} onChange={v => set("phone", v)} maxLength={300} />
    {contacts ? <><TextField label="Fonction" value={fields.jobTitle} onChange={v => set("jobTitle", v)} maxLength={300} /><label className="crm-checkbox"><input type="checkbox" checked={fields.isPrimary} onChange={e => set("isPrimary", e.currentTarget.checked)} />Contact principal du compte</label></> : <><TextField label="Ville" value={fields.city} onChange={v => set("city", v)} maxLength={300} /><TextField label="Pays" value={fields.country} onChange={v => set("country", v)} maxLength={300} /><TextField label="Site web" type="url" value={fields.website} onChange={v => set("website", v)} placeholder="https://…" maxLength={300} /></>}
  </Form></></Modal>;
}
