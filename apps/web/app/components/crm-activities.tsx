"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import type { CrmActivityView, CrmLeadView, CrmOpportunityView, CrmPage, CrmRelatedType } from "@axora24/contracts";
import { ApiError } from "../lib/api";
import { crmDirectoryApi } from "../lib/modules/crm";
import { useSession } from "../lib/session";
import { DataTable, Form, Modal, SelectField, TextAreaField, TextField } from "./ui";
import { CrmPagination } from "./crm-directory";

const TYPES = [{ value: "NOTE", label: "Note" }, { value: "CALL", label: "Appel" }, { value: "MEETING", label: "Réunion" }, { value: "EMAIL", label: "Courriel" }, { value: "TASK", label: "Tâche" }];
const TYPE_LABELS: Record<string, string> = { ...Object.fromEntries(TYPES.map(t => [t.value, t.label])), STAGE_CHANGE: "Changement dâ€â„¢étape", CONVERSION: "Conversion" };
const RELATED_LABELS: Record<string, string> = { Lead: "Prospect", Opportunity: "Opportunité", Account: "Compte", Contact: "Contact" };
export function CrmActivities({ leads, opportunities }: { leads: CrmLeadView[]; opportunities: CrmOpportunityView[] }): React.ReactElement {
  const { can } = useSession();
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<CrmPage<CrmActivityView> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    try { const query = new URLSearchParams({ q, page: String(page), pageSize: "20", ...(type ? { type } : {}) }); const next = await crmDirectoryApi.activityPage(query.toString()); if (request === generation.current) { setData(next); setError(""); } }
    catch (caught) { if (request === generation.current) setError(caught instanceof ApiError ? caught.message : "Chargement impossible."); }
    finally { if (request === generation.current) setLoading(false); }
  }, [q, page, type]);
  useEffect(() => { const timeout = window.setTimeout(() => void load(), 250); return () => window.clearTimeout(timeout); }, [load]);
  return <section className="panel crm-resource-panel"><div className="panel-head"><div><h2>Activités commerciales</h2><p>Échanges, tâches et historique des transitions</p></div>{can("crm.activity.create") && <button className="primary-inline-button" type="button" onClick={() => setCreating(true)}>Nouvelle activité</button>}</div>
    <div className="crm-filters"><TextField label="Rechercher" value={q} onChange={v => { setQ(v); setPage(1); }} placeholder="Objet, contenu…" /><SelectField label="Type dâ€â„¢activité" value={type} onChange={v => { setType(v); setPage(1); }} emptyLabel="Tous les types" options={[...TYPES, { value: "STAGE_CHANGE", label: "Changement dâ€â„¢étape" }, { value: "CONVERSION", label: "Conversion" }]} /><button className="secondary-button" type="button" onClick={() => void load()} disabled={loading}>Actualiser</button></div>
    {error && <div className="form-error" role="alert">{error}</div>}{!data ? <p role="status">{loading ? "Chargement…" : "Les activités sont indisponibles."}</p> : <><div aria-busy={loading}><DataTable rows={data.items} caption="Historique des activités commerciales" empty={<p className="panel-note">Aucune activité ne correspond à  votre recherche.</p>} columns={[
      { key: "date", header: "Date", render: row => <time dateTime={row.occurredAt}>{new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" }).format(new Date(row.occurredAt))}</time> },
      { key: "type", header: "Type", render: row => TYPE_LABELS[row.type] ?? row.type },
      { key: "subject", header: "Activité", render: row => <><strong>{row.subject}</strong>{row.body && <p className="crm-activity-body">{row.body}</p>}</> },
      { key: "related", header: "Fiche liée", render: row => <>{RELATED_LABELS[row.relatedType] ?? row.relatedType}<small className="table-subtext">{row.relatedType === "Lead" ? leads.find(l => l.id === row.relatedId)?.companyName ?? "Fiche historique" : row.relatedType === "Opportunity" ? opportunities.find(o => o.id === row.relatedId)?.name ?? "Fiche historique" : "Fiche associée"}</small></> },
    ]} /></div><CrmPagination page={data.page} pages={data.totalPages} total={data.total} onChange={setPage} /></>}
    {creating && <ActivityEditor leads={leads} opportunities={opportunities} onClose={() => setCreating(false)} onSaved={async () => { setCreating(false); await load(); }} />}
  </section>;
}

function ActivityEditor({ leads, opportunities, onClose, onSaved }: { leads: CrmLeadView[]; opportunities: CrmOpportunityView[]; onClose: () => void; onSaved: () => Promise<void> }): React.ReactElement {
  const { can } = useSession();
  const [type, setType] = useState("NOTE");
  const [relatedType, setRelatedType] = useState<CrmRelatedType | "">("");
  const [relatedId, setRelatedId] = useState("");
  const [options, setOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let active = true; setOptions([]); setLoading(true);
    const promise = relatedType === "Account" ? crmDirectoryApi.accounts().then(items => items.map(i => ({ value: i.id, label: i.name }))) : relatedType === "Contact" ? crmDirectoryApi.contacts().then(items => items.map(i => ({ value: i.id, label: i.fullName }))) : Promise.resolve(relatedType === "Lead" ? leads.map(l => ({ value: l.id, label: `${l.companyName} · ${l.contactName}` })) : relatedType === "Opportunity" ? opportunities.map(o => ({ value: o.id, label: o.name })) : []);
    void promise.then(items => { if (active) { setOptions(items); setError(""); } }).catch(() => { if (active) setError("Les fiches liées sont indisponibles. Réessayez en changeant le type de fiche."); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [relatedType, leads, opportunities]);
  async function submit(): Promise<void> {
    if (saving || !relatedType || !relatedId) return;
    setSaving(true); setError("");
    try { await crmDirectoryApi.createActivity({ type: type as "NOTE", relatedType, relatedId, subject: subject.trim(), ...(body.trim() ? { body: body.trim() } : {}) }); await onSaved(); }
    catch (caught) { setError(caught instanceof ApiError ? caught.message : "Enregistrement impossible."); }
    finally { setSaving(false); }
  }
  return <Modal title="Nouvelle activité" onClose={() => !saving && onClose()}><>{error && <div className="form-error" role="alert">{error}</div>}<Form columns={2} onSubmit={() => void submit()} saving={saving || loading} submitLabel="Enregistrer">
    <SelectField label="Type dâ€â„¢activité" value={type} onChange={setType} options={TYPES} required /><SelectField label="Type de fiche liée" value={relatedType} onChange={v => { setRelatedType(v as CrmRelatedType); setRelatedId(""); }} required options={(["Lead", "Opportunity", "Account", "Contact"] as CrmRelatedType[]).filter(t => can(`crm.${t.toLowerCase()}.read`)).map(t => ({ value: t, label: RELATED_LABELS[t]! }))} />
    <SelectField label="Fiche liée" value={relatedId} onChange={setRelatedId} options={options} required wide disabled={loading || !relatedType} hint={relatedType && !loading && options.length === 0 ? "Créez dâ€â„¢abord une fiche de ce type." : undefined} /><TextField label="Objet" value={subject} onChange={setSubject} required maxLength={300} wide /><TextAreaField label="Contenu" value={body} onChange={setBody} maxLength={10000} wide />
  </Form></></Modal>;
}
