"use client";

import React from "react";
import Link from "next/link";
import type { DashboardKpi, DashboardOverview } from "@axora24/contracts";
import { ArrowRight, BarChart3, Clock3, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import { api } from "../lib/api";
import { formatCompactMoney, formatDateTime, formatMoney } from "../lib/format";
import { visibleGroups } from "../lib/navigation";
import { useResource } from "../lib/hooks";
import { useSession } from "../lib/session";
import { Empty, Feedback, Loading, Panel } from "../components/ui";
import { describeAudit } from "../lib/audit-labels";

function KpiCard({ kpi, featured = false }: { kpi: DashboardKpi; featured?: boolean }): React.ReactElement {
  const [first, ...others] = kpi.amounts;
  const value =
    kpi.kind === "money"
      ? first
        ? formatCompactMoney(first.amount, first.currency)
        : "0"
      : kpi.kind === "percent"
        ? `${kpi.value} %`
        : kpi.value;
  const exact = kpi.kind === "money" && first ? formatMoney(first.amount, first.currency) : undefined;
  return (
    <Link
      className={`command-metric kpi-link tone-${kpi.tone} ${featured ? "command-metric-featured" : ""}`}
      href={kpi.href}
      title={exact}
    >
      <div className={`metric-icon ${kpi.tone}`}>
        <BarChart3 size={featured ? 22 : 18} aria-hidden="true" />
      </div>
      <div className="metric-label">{kpi.label}</div>
      <strong>{value}</strong>
      <small className={kpi.tone}>
        {others.length > 0 &&
          `+ ${others.map((amount) => formatCompactMoney(amount.amount, amount.currency)).join(" · ")} · `}
        {kpi.detail}
      </small>
      <ArrowRight className="metric-arrow" size={16} aria-hidden="true" />
    </Link>
  );
}

export default function OverviewPage(): React.ReactElement {
  const session = useSession();
  const overview = useResource(() => api.get<DashboardOverview>("/dashboard/overview"));
  const [showAllKpis, setShowAllKpis] = React.useState(false);
  const firstName = (session.user.fullName ?? "").trim().split(" ")[0] || session.user.email;
  const allKpis = overview.data?.kpis ?? [];
  const visibleKpis = showAllKpis ? allKpis : allKpis.slice(0, 5);
  const hiddenKpiCount = Math.max(0, allKpis.length - visibleKpis.length);
  const quickActions = visibleGroups(session.can)
    .flatMap((group) => group.items)
    .filter((item) => item.href !== "/")
    .slice(0, 4);
  const canPilotCrm = session.can("crm.nextaction.manage") || session.can("crm.account.read");

  return (
    <>
      <header className="command-hero">
        <div className="command-hero-copy">
          <p className="command-greeting">Bonjour, {firstName}</p>
          <h1>Command Center</h1>
          <p>Une lecture directe de votre activité, des engagements et des opérations autorisées.</p>
        </div>
        <div className="command-hero-meta">
          {overview.data && (
            <div className="command-freshness">
              <Clock3 size={16} aria-hidden="true" />
              <span>Données sécurisées</span>
              <time dateTime={overview.data.generatedAt}>Actualisé {formatDateTime(overview.data.generatedAt)}</time>
            </div>
          )}
          <div className="command-hero-actions">
            <button className="secondary-button" type="button" onClick={() => void overview.reload()}>
              <RefreshCw size={15} aria-hidden="true" />
              <span>Actualiser</span>
            </button>
            {canPilotCrm && (
              <Link className="command-primary-action" href="/crm">
                <Sparkles size={16} aria-hidden="true" />
                Piloter le CRM
                <ArrowRight size={15} aria-hidden="true" />
              </Link>
            )}
          </div>
        </div>
      </header>
      <Feedback error={overview.error} />

      {overview.loading && !overview.data ? (
        <Loading label="Calcul des indicateurs…" />
      ) : overview.data ? (
        <>
          {overview.data.kpis.length === 0 ? (
            <Panel>
              <Empty
                title="Aucun indicateur accessible"
                body="Votre rôle ne donne accès à aucun module métier. Contactez un administrateur."
              />
            </Panel>
          ) : (
            <section className="command-overview" aria-label="Situation exécutive">
              <div className="command-overview-head">
                <div>
                  <h2>Situation exécutive</h2>
                  <p>Indicateurs métier disponibles dans votre périmètre et conservés dans leur devise d’origine.</p>
                </div>
                <div className="command-overview-count">
                  <span>{overview.data.kpis.length} indicateur{overview.data.kpis.length > 1 ? "s" : ""}</span>
                  {overview.data.kpis.length > 5 && (
                    <button type="button" onClick={() => setShowAllKpis((current) => !current)}>
                      {showAllKpis ? "Réduire les indicateurs" : `Afficher les ${hiddenKpiCount} autres indicateurs`}
                    </button>
                  )}
                </div>
              </div>
              <div className="command-kpi-layout">
                <KpiCard kpi={visibleKpis[0]!} featured />
                {visibleKpis.length > 1 && (
                  <div className="command-metric-grid">
                    {visibleKpis.slice(1).map((kpi) => (
                      <KpiCard key={kpi.key} kpi={kpi} />
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}

          <section className="command-board">
            <Panel
              className="activity-panel"
              title="Activité récente"
              subtitle="Dernières opérations autorisées et traçables dans votre périmètre"
            >
              {overview.data.activity === null ? (
                <Empty
                  icon={<ShieldCheck size={22} aria-hidden="true" />}
                  title="Journal d'audit non accessible"
                  body="La permission core.audit.read est requise pour consulter l'activité."
                />
              ) : overview.data.activity.length === 0 ? (
                <Empty title="Aucune activité" body="Les actions de votre équipe apparaîtront ici." />
              ) : (
                <ol className="activity-stream" aria-label="Activité récente">
                  {overview.data.activity.slice(0, 6).map((entry) => (
                    <li key={entry.id}>
                      <span className="activity-marker" aria-hidden="true" />
                      <div className="activity-copy">
                        <strong>{describeAudit(entry.action)}</strong>
                        <small>{entry.actorName ?? "Système"} · {entry.resourceType}</small>
                      </div>
                      <time dateTime={entry.createdAt}>{formatDateTime(entry.createdAt)}</time>
                    </li>
                  ))}
                </ol>
              )}
            </Panel>
            <aside className="command-side" aria-label="Actions et contexte">
              <Panel className="command-actions-panel" title="Actions rapides" subtitle="Accès directs selon vos permissions">
                <ul className="quick-links" aria-label="Actions rapides">
                  {quickActions.map((item) => (
                    <li key={item.href}>
                      <Link href={item.href}>
                        <span className="quick-link-icon"><item.icon size={17} aria-hidden="true" /></span>
                        <span className="quick-link-copy">
                          <strong>{item.label}</strong>
                          <small>Ouvrir le module</small>
                        </span>
                        <ArrowRight size={15} aria-hidden="true" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </Panel>
              <div className="command-principles" role="note">
                <ShieldCheck size={19} aria-hidden="true" />
                <div>
                  <strong>Contexte fiable</strong>
                  <span>Permissions serveur, audit et isolation société restent appliqués à chaque donnée affichée.</span>
                </div>
              </div>
            </aside>
          </section>
        </>
      ) : null}
    </>
  );
}
