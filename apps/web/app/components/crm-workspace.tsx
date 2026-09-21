"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type {
  CrmLeadView,
  CrmOpportunityView,
  CrmPipelineStageView,
  CrmDashboardView,
} from "@axora24/contracts";
import {
  ArrowRight,
  BadgeCheck,
  Briefcase,
  CircleDollarSign,
  Loader2,
  Plus,
  RefreshCw,
  Target,
  UserPlus,
} from "lucide-react";
import { ApiError, crmApi, formatAmount } from "../lib/api";

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
  dashboard: CrmDashboardView;
  stages: CrmPipelineStageView[];
  leads: CrmLeadView[];
  opportunities: CrmOpportunityView[];
}

export function CrmWorkspace(): React.ReactElement {
  const [data, setData] = useState<CrmData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyLeadId, setBusyLeadId] = useState("");

  const load = useCallback(async (): Promise<void> => {
    try {
      const [dashboard, stages, leads, opportunities] = await Promise.all([
        crmApi.dashboard(),
        crmApi.stages(),
        crmApi.leads(),
        crmApi.opportunities(),
      ]);
      setData({ dashboard, stages, leads, opportunities });
      setError("");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function convert(lead: CrmLeadView): Promise<void> {
    setBusyLeadId(lead.id);
    setError("");
    try {
      await crmApi.convertLead(lead.id, { amount: "0" });
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Conversion impossible.");
    } finally {
      setBusyLeadId("");
    }
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

      <section className="metrics-grid" aria-label="Indicateurs commerciaux">
        <MetricCard
          tone="blue"
          icon={<Target size={20} />}
          label="Prospects ouverts"
          value={String(dashboard.leads.open)}
          detail={`${dashboard.leads.total} au total · ${dashboard.leads.converted} convertis`}
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
          value={formatAmount(dashboard.pipelineValue, dashboard.currency)}
          detail={`Ponderee : ${formatAmount(dashboard.weightedPipelineValue, dashboard.currency)}`}
        />
        <MetricCard
          tone="amber"
          icon={<BadgeCheck size={20} />}
          label="Affaires gagnees"
          value={formatAmount(dashboard.wonValue, dashboard.currency)}
          detail={`${dashboard.opportunities.won} opportunite(s) cloturee(s)`}
        />
      </section>

      <section className="panel pipeline-panel">
        <div className="panel-head">
          <div>
            <h2>Etapes du pipeline</h2>
            <p>Valeur des opportunites ouvertes par etape</p>
          </div>
        </div>
        <div className="pipeline-track">
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
                <small>{formatAmount(entry?.value ?? "0.00", dashboard.currency)}</small>
              </article>
            );
          })}
        </div>
      </section>

      <section className="dashboard-grid crm-grid">
        <article className="panel">
          <div className="panel-head">
            <div>
              <h2>Prospects</h2>
              <p>Convertir cree automatiquement compte, contact et opportunite</p>
            </div>
          </div>
          <NewLeadForm onCreated={load} onError={setError} />
          {leads.length === 0 ? (
            <EmptyState
              icon={<UserPlus size={22} />}
              title="Aucun prospect"
              body="Creez votre premier prospect pour demarrer le pipeline."
            />
          ) : (
            <ul className="crm-list">
              {leads.slice(0, 8).map((lead) => (
                <li key={lead.id}>
                  <div>
                    <strong>{lead.companyName}</strong>
                    <small>
                      {lead.contactName}
                      {lead.source ? ` · ${lead.source}` : ""}
                    </small>
                  </div>
                  <div className="crm-list-actions">
                    <span className={`status-chip status-${lead.status.toLowerCase()}`}>
                      {LEAD_STATUS_LABELS[lead.status] ?? lead.status}
                    </span>
                    {lead.status !== "CONVERTED" && lead.status !== "DISQUALIFIED" && (
                      <button
                        type="button"
                        className="link-button"
                        disabled={busyLeadId === lead.id}
                        onClick={() => void convert(lead)}
                      >
                        {busyLeadId === lead.id ? "Conversion…" : "Convertir"}
                        <ArrowRight size={14} />
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="panel">
          <div className="panel-head">
            <div>
              <h2>Opportunites</h2>
              <p>Etape courante et montant engage</p>
            </div>
          </div>
          {opportunities.length === 0 ? (
            <EmptyState
              icon={<Briefcase size={22} />}
              title="Aucune opportunite"
              body="Convertissez un prospect qualifie pour ouvrir une opportunite."
            />
          ) : (
            <ul className="crm-list">
              {opportunities.slice(0, 8).map((opportunity) => (
                <li key={opportunity.id}>
                  <div>
                    <strong>{opportunity.name}</strong>
                    <small>{opportunity.accountName ?? "Sans compte"}</small>
                  </div>
                  <div className="crm-list-actions">
                    <span className="amount">
                      {formatAmount(opportunity.amount, opportunity.currency)}
                    </span>
                    <span className={`status-chip status-${opportunity.status.toLowerCase()}`}>
                      {opportunity.stageName}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {openStages.length === 0 && (
            <p className="panel-note">
              Aucune etape ouverte configuree : creez-en une avant d&apos;ajouter des opportunites.
            </p>
          )}
        </article>
      </section>
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

function EmptyState({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}): React.ReactElement {
  return (
    <div className="empty-state">
      {icon}
      <strong>{title}</strong>
      <small>{body}</small>
    </div>
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
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSaving(true);
    onError("");
    try {
      await crmApi.createLead({
        contactName,
        companyName,
        ...(source.trim() ? { source: source.trim() } : {}),
      });
      setContactName("");
      setCompanyName("");
      setSource("");
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
      <button type="submit" disabled={saving}>
        <Plus size={15} />
        {saving ? "Ajout…" : "Ajouter"}
      </button>
    </form>
  );
}
