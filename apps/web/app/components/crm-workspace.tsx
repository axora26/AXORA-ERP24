"use client";

import React, { useCallback, useEffect, useState, type FormEvent } from "react";
import type {
  CrmLeadView,
  CrmOpportunityView,
  CrmPipelineStageView,
  CrmDashboardView,
} from "@axora24/contracts";
import {
  BadgeCheck,
  Briefcase,
  CircleDollarSign,
  Loader2,
  Plus,
  RefreshCw,
  Target,
} from "lucide-react";
import { ApiError, crmApi, formatAmount } from "../lib/api";
import { crmDirectoryApi } from "../lib/modules/crm";
import { useSession } from "../lib/session";
import { DataTable, Tabs, TextField } from "./ui";
import { CrmDirectory, CrmPagination } from "./crm-directory";
import { CrmActivities } from "./crm-activities";
import { CrmConversion } from "./crm-conversion";

/**
 * Espace CRM (INC-02).
 *
 * Toutes les valeurs affichees ici proviennent de l'API et de la base du
 * tenant connecte — aucune donnee de demonstration, aucun chiffre fabrique.
 * Quand il n'y a pas encore de donnees, l'ecran affiche un etat vide
 * explicite plutot qu'un exemple qui pourrait etre pris pour du reel.
 */

const LEAD_STATUS_LABELS: Record<string, string> = {
  NEW: "Nouveau",
  CONTACTED: "Contacte",
  QUALIFIED: "Qualifie",
  CONVERTED: "Converti",
  DISQUALIFIED: "Disqualifie",
};

interface CrmData {
  dashboard: CrmDashboardView | null;
  stages: CrmPipelineStageView[];
  leads: CrmLeadView[];
  opportunities: CrmOpportunityView[];
}

type CrmTab = "pipeline" | "leads" | "opportunities" | "accounts" | "contacts" | "activities";
export function CrmWorkspace(): React.ReactElement {
  const { can } = useSession();
  const tabs: Array<{ id: CrmTab; label: string }> = [
    ...(can("crm.opportunity.read") ? [{ id: "pipeline" as const, label: "Pipeline" }] : []),
    ...(can("crm.lead.read") ? [{ id: "leads" as const, label: "Prospects" }] : []),
    ...(can("crm.opportunity.read") ? [{ id: "opportunities" as const, label: "Opportunités" }] : []),
    ...(can("crm.account.read") ? [{ id: "accounts" as const, label: "Comptes" }] : []),
    ...(can("crm.contact.read") ? [{ id: "contacts" as const, label: "Contacts" }] : []),
    ...(can("crm.activity.read") ? [{ id: "activities" as const, label: "Activités" }] : []),
  ];
  const [active, setActive] = useState<CrmTab>(tabs[0]?.id ?? "pipeline");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [conversion, setConversion] = useState<CrmLeadView | null>(null);
  const [busyId, setBusyId] = useState("");
  const [data, setData] = useState<CrmData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (): Promise<void> => {
    try {
      const [dashboard, stages, leads, opportunities] = await Promise.all([
        can("crm.opportunity.read") ? crmApi.dashboard() : Promise.resolve(null),
        can("crm.opportunity.read") ? crmApi.stages() : Promise.resolve([]),
        can("crm.lead.read") ? crmApi.leads() : Promise.resolve([]),
        can("crm.opportunity.read") ? crmApi.opportunities() : Promise.resolve([]),
      ]);
      setData({ dashboard, stages, leads, opportunities });
      setError("");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }, [can]);

  useEffect(() => {
    void load();
  }, [load]);

  async function changeLeadStatus(id: string, status: "CONTACTED" | "QUALIFIED" | "DISQUALIFIED"): Promise<void> {
    if (busyId) return;
    setBusyId(id); setError("");
    try { await crmDirectoryApi.leadStatus(id, status); await load(); }
    catch (caught) { setError(caught instanceof ApiError ? caught.message : "Modification impossible."); }
    finally { setBusyId(""); }
  }
  async function move(id: string, stageId: string): Promise<void> {
    if (busyId || !stageId) return;
    setBusyId(id); setError("");
    try { await crmApi.moveOpportunity(id, stageId); await load(); }
    catch (caught) { setError(caught instanceof ApiError ? caught.message : "Modification impossible."); }
    finally { setBusyId(""); }
  }

  if (loading) {
    return (
      <div className="crm-loading">
        <Loader2 size={20} className="spin" />
        <span>Chargement des donnees commerciales…</span>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="form-error" role="alert">
        {error || "Donnees indisponibles."}
      </div>
    );
  }

  const { dashboard, stages, leads, opportunities } = data;
  const openStages = stages.filter((stage) => !stage.isWon && !stage.isLost);
  const multipleCurrencies = dashboard?.currency === "MIXED";
  const amountLabel = (amount: string | null) => amount === null ? "Plusieurs devises" : formatAmount(amount, dashboard?.currency ?? "USD");

  return (
    <>
      <section className="welcome-row">
        <div>
          <p className="breadcrumb">Command Center / CRM &amp; Ventes</p>
          <h1>Pipeline commercial</h1>
          <p>Chiffres calcules en direct sur les donnees de votre entreprise.</p>
        </div>
        <button className="secondary-button" onClick={() => void load()}>
          <RefreshCw size={15} />
          <span>Actualiser</span>
        </button>
      </section>

      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}

      <Tabs tabs={tabs} active={active} onChange={tab => { setActive(tab); setQuery(""); setPage(1); }} />
      {active === "pipeline" && dashboard && <>
      <section className="metrics-grid" aria-label="Indicateurs commerciaux">
        <MetricCard
          tone="blue"
          icon={<Target size={20} />}
          label="Prospects ouverts"
          value={dashboard.leads.available ? String(dashboard.leads.open) : "Indisponible"}
          detail={dashboard.leads.available ? `${dashboard.leads.total} au total · ${dashboard.leads.converted} convertis` : "Accès à la prospection requis"}
        />
        <MetricCard
          tone="violet"
          icon={<Briefcase size={20} />}
          label="Opportunites ouvertes"
          value={String(dashboard.opportunities.open)}
          detail={`${dashboard.opportunities.won} gagnees · ${dashboard.opportunities.lost} perdues`}
        />
        <MetricCard
          tone="green"
          icon={<CircleDollarSign size={20} />}
          label="Valeur du pipeline"
          value={amountLabel(dashboard.pipelineValue)}
          detail={multipleCurrencies ? "Montants par devise ci-dessous" : `Pondérée : ${amountLabel(dashboard.weightedPipelineValue)}`}
        />
        <MetricCard
          tone="amber"
          icon={<BadgeCheck size={20} />}
          label="Affaires gagnees"
          value={amountLabel(dashboard.wonValue)}
          detail={`${dashboard.opportunities.won} opportunite(s) cloturee(s)`}
        />
      </section>

      {multipleCurrencies && (
        <section className="panel currency-summary" aria-labelledby="currency-summary-title">
          <div className="panel-head"><div><h2 id="currency-summary-title">Montants par devise</h2><p>Les devises différentes sont présentées séparément, sans conversion.</p></div></div>
          <div className="currency-summary-list">
            {dashboard.currencyBreakdown.map((summary) => <article key={summary.currency}><h3>{summary.currency}</h3><dl><div><dt>Pipeline ouvert</dt><dd>{formatAmount(summary.pipelineValue, summary.currency)}</dd></div><div><dt>Pipeline pondéré</dt><dd>{formatAmount(summary.weightedPipelineValue, summary.currency)}</dd></div><div><dt>Affaires gagnées</dt><dd>{formatAmount(summary.wonValue, summary.currency)}</dd></div></dl></article>)}
          </div>
        </section>
      )}

      <section className="panel pipeline-panel">
        <div className="panel-head">
          <div>
            <h2>Etapes du pipeline</h2>
            <p>Valeur des opportunites ouvertes par etape</p>
          </div>
        </div>
        {/* Zone defilante horizontalement : atteignable au clavier (fleches) et nommee. */}
        <div className="pipeline-track" tabIndex={0} role="region" aria-label="Étapes du pipeline commercial">
          {stages.map((stage) => {
            const entry = dashboard.stages.find((item) => item.stageId === stage.id);
            return (
              <article
                className={`pipeline-stage${stage.isWon ? " won" : ""}${stage.isLost ? " lost" : ""}`}
                key={stage.id}
              >
                <header>
                  <strong>{stage.name}</strong>
                  <span>{stage.probability}%</span>
                </header>
                <b>{entry?.opportunityCount ?? 0}</b>
                {multipleCurrencies ? dashboard.currencyBreakdown.map((summary) => {
                  const amount = summary.stages.find(item => item.stageId === stage.id);
                  return amount && amount.opportunityCount > 0 ? <small key={summary.currency}>{formatAmount(amount.value, summary.currency)}</small> : null;
                }) : <small>{formatAmount(entry?.value ?? "0.00", dashboard.currency)}</small>}
              </article>
            );
          })}
        </div>
      </section>

      </>}
      {active === "leads" && <section className="panel crm-resource-panel"><div className="panel-head"><div><h2>Prospects</h2><p>Qualifiez les demandes et convertissez-les en opportunités</p></div></div>
        {can("crm.lead.manage") && <NewLeadForm onCreated={load} onError={setError} />}
        <div className="crm-filters"><TextField label="Rechercher un prospect" value={query} onChange={value => { setQuery(value); setPage(1); }} placeholder="Entreprise, contact, origine…" /></div>
        <LeadTable leads={leads} query={query} page={page} onPage={setPage} canManage={can("crm.lead.manage")} busyId={busyId} canConvert={can("crm.opportunity.manage") && openStages.length > 0} onStatus={changeLeadStatus} onConvert={setConversion} />
      </section>}
      {active === "opportunities" && <section className="panel crm-resource-panel"><div className="panel-head"><div><h2>Opportunités</h2><p>Montants engagés, devises et étapes du pipeline</p></div></div>
        <div className="crm-filters"><TextField label="Rechercher une opportunité" value={query} onChange={value => { setQuery(value); setPage(1); }} placeholder="Nom, compte, étape…" /></div>
        <OpportunityTable opportunities={opportunities} query={query} page={page} onPage={setPage} stages={stages} canManage={can("crm.opportunity.manage")} busyId={busyId} onMove={move} />
      </section>}
      {active === "accounts" && <CrmDirectory key="accounts" kind="accounts" />}
      {active === "contacts" && <CrmDirectory key="contacts" kind="contacts" />}
      {active === "activities" && <CrmActivities leads={leads} opportunities={opportunities} />}
      {conversion && <CrmConversion lead={conversion} stages={openStages} onClose={() => setConversion(null)} onConverted={async () => { setConversion(null); await load(); setActive("opportunities"); }} />}

    </>
  );
}

function MetricCard({
  tone,
  icon,
  label,
  value,
  detail,
}: {
  tone: "blue" | "green" | "amber" | "violet";
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
}): React.ReactElement {
  return (
    <article className="metric-card">
      <div className={`metric-icon ${tone}`}>{icon}</div>
      <div className="metric-label">{label}</div>
      <strong>{value}</strong>
      <small className={tone}>{detail}</small>
    </article>
  );
}

function NewLeadForm({
  onCreated,
  onError,
}: {
  onCreated: () => Promise<void>;
  onError: (message: string) => void;
}): React.ReactElement {
  const [contactName, setContactName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [source, setSource] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    onError("");
    try {
      await crmApi.createLead({
        contactName,
        companyName,
        ...(source.trim() ? { source: source.trim() } : {}),
        ...(email.trim() ? { email: email.trim() } : {}),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
      });
      setContactName("");
      setCompanyName("");
      setSource(""); setEmail(""); setPhone("");
      await onCreated();
    } catch (caught) {
      onError(caught instanceof ApiError ? caught.message : "Creation impossible.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="inline-form" onSubmit={submit}>
      <label className="sr-only" htmlFor="lead-company">
        Entreprise
      </label>
      <input
        id="lead-company"
        placeholder="Entreprise"
        value={companyName}
        onChange={(event) => setCompanyName(event.currentTarget.value)}
        required
      />
      <label className="sr-only" htmlFor="lead-contact">
        Contact
      </label>
      <input
        id="lead-contact"
        placeholder="Contact"
        value={contactName}
        onChange={(event) => setContactName(event.currentTarget.value)}
        required
      />
      <label className="sr-only" htmlFor="lead-source">
        Origine
      </label>
      <input
        id="lead-source"
        placeholder="Origine (optionnel)"
        value={source}
        onChange={(event) => setSource(event.currentTarget.value)}
      />
      <label className="sr-only" htmlFor="lead-email">Courriel</label><input id="lead-email" type="email" placeholder="Courriel (optionnel)" value={email} onChange={e => setEmail(e.currentTarget.value)} maxLength={300} />
      <label className="sr-only" htmlFor="lead-phone">Téléphone</label><input id="lead-phone" type="tel" placeholder="Téléphone (optionnel)" value={phone} onChange={e => setPhone(e.currentTarget.value)} maxLength={300} />
      <button type="submit" disabled={saving}>
        <Plus size={15} />
        {saving ? "Ajout…" : "Ajouter"}
      </button>
    </form>
  );
}

function LeadTable({ leads, query, page, onPage, canManage, canConvert, busyId, onStatus, onConvert }: { leads: CrmLeadView[]; query: string; page: number; onPage: (page: number) => void; canManage: boolean; canConvert: boolean; busyId: string; onStatus: (id: string, status: "CONTACTED" | "QUALIFIED" | "DISQUALIFIED") => Promise<void>; onConvert: (lead: CrmLeadView) => void }): React.ReactElement {
  const filtered = leads.filter(lead => [lead.companyName, lead.contactName, lead.email, lead.phone, lead.source, LEAD_STATUS_LABELS[lead.status]].join(" ").toLocaleLowerCase("fr").includes(query.toLocaleLowerCase("fr")));
  const pages = Math.ceil(filtered.length / 20);
  return <><DataTable rows={filtered.slice((page - 1) * 20, page * 20)} caption="Liste des prospects" empty={<p className="panel-note">Aucun prospect ne correspond à  votre recherche.</p>} columns={[
    { key: "company", header: "Entreprise / Contact", render: lead => <><strong>{lead.companyName}</strong><small className="table-subtext">{lead.contactName}</small></> },
    { key: "details", header: "Coordonnées / Origine", render: lead => <>{lead.email ?? lead.phone ?? "—"}<small className="table-subtext">{lead.source ?? "Origine non renseignée"}</small></> },
    { key: "status", header: "Statut", render: lead => LEAD_STATUS_LABELS[lead.status] ?? lead.status },
    { key: "actions", header: "Actions", render: lead => ["CONVERTED", "DISQUALIFIED"].includes(lead.status) ? "Clôturé" : <div className="crm-row-actions">{canManage && <select aria-label={`Statut de ${lead.companyName}`} value={lead.status} disabled={!!busyId} onChange={e => void onStatus(lead.id, e.currentTarget.value as "CONTACTED")}><option value="NEW" disabled>Nouveau</option><option value="CONTACTED">Contacté</option><option value="QUALIFIED">Qualifié</option><option value="DISQUALIFIED">Disqualifié</option></select>}{canManage && canConvert && <button className="link-button" type="button" disabled={!!busyId} onClick={() => onConvert(lead)} aria-label={`Convertir ${lead.companyName}`}>Convertir</button>}</div> },
  ]} /><CrmPagination page={page} pages={pages} total={filtered.length} onChange={onPage} /></>;
}
function OpportunityTable({ opportunities, query, page, onPage, stages, canManage, busyId, onMove }: { opportunities: CrmOpportunityView[]; query: string; page: number; onPage: (page: number) => void; stages: CrmPipelineStageView[]; canManage: boolean; busyId: string; onMove: (id: string, stageId: string) => Promise<void> }): React.ReactElement {
  const filtered = opportunities.filter(item => [item.name, item.accountName, item.stageName, item.currency].join(" ").toLocaleLowerCase("fr").includes(query.toLocaleLowerCase("fr")));
  return <><DataTable rows={filtered.slice((page - 1) * 20, page * 20)} caption="Liste des opportunités" empty={<p className="panel-note">Aucune opportunité ne correspond à  votre recherche.</p>} columns={[
    { key: "name", header: "Opportunité / Compte", render: item => <><strong>{item.name}</strong><small className="table-subtext">{item.accountName ?? "Sans compte"}</small></> },
    { key: "amount", header: "Montant", render: item => formatAmount(item.amount, item.currency) },
    { key: "date", header: "Clôture prévue", render: item => item.expectedCloseDate ? new Intl.DateTimeFormat("fr-FR").format(new Date(item.expectedCloseDate)) : "—" },
    { key: "status", header: "État", render: item => item.status === "WON" ? "Gagnée" : item.status === "LOST" ? "Perdue" : "Ouverte" },
    { key: "stage", header: "Étape", render: item => canManage && item.status === "OPEN" ? <select aria-label={`Étape de ${item.name}`} value={item.stageId} disabled={!!busyId} onChange={e => void onMove(item.id, e.currentTarget.value)}>{stages.map(stage => <option key={stage.id} value={stage.id}>{stage.name}{stage.isWon ? " · Gagnée" : stage.isLost ? " · Perdue" : ""}</option>)}</select> : item.stageName },
  ]} /><CrmPagination page={page} pages={Math.ceil(filtered.length / 20)} total={filtered.length} onChange={onPage} /></>;
}
