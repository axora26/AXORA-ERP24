"use client";

import React from "react";
import Link from "next/link";
import type { DashboardKpi, DashboardOverview } from "@axora24/contracts";
import { ArrowRight, BarChart3, Clock3, LayoutGrid, ShieldCheck } from "lucide-react";
import { api } from "../lib/api";
import { formatCompactMoney, formatDateTime, formatMoney } from "../lib/format";
import { visibleGroups } from "../lib/navigation";
import { useResource } from "../lib/hooks";
import { useSession } from "../lib/session";
import { Empty, Feedback, Loading, PageHeader, Panel } from "../components/ui";
import { describeAudit } from "../lib/audit-labels";

function KpiCard({ kpi }: { kpi: DashboardKpi }): React.ReactElement {
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
    <Link className={`command-metric kpi-link tone-${kpi.tone}`} href={kpi.href} title={exact}>
      <div className={`metric-icon ${kpi.tone}`}>
        <BarChart3 size={20} aria-hidden="true" />
      </div>
      <div className="metric-label">{kpi.label}</div>
      <strong>{value}</strong>
      <small className={kpi.tone}>
        {others.length > 0 &&
          `+ ${others.map((amount) => formatCompactMoney(amount.amount, amount.currency)).join(" · ")} · `}
        {kpi.detail}
      </small>
    </Link>
  );
}

export default function OverviewPage(): React.ReactElement {
  const session = useSession();
  const overview = useResource(() => api.get<DashboardOverview>("/dashboard/overview"));
  const firstName = (session.user.fullName ?? "").trim().split(" ")[0] || session.user.email;

  return (
    <>
      <PageHeader
        breadcrumb="Command Center"
        title={`Bonjour, ${firstName}`}
        subtitle="Votre tableau de départ : indicateurs autorisés, événements à examiner et accès opérationnels."
        onRefresh={() => void overview.reload()}
      />
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
            <section className="command-metrics" aria-label="Indicateurs disponibles">
              {overview.data.kpis.map((kpi) => (
                <KpiCard key={kpi.key} kpi={kpi} />
              ))}
            </section>
          )}

          <section className="command-board">
            <Panel
              className="attention-panel"
              title="File d’attention"
              subtitle={`Derniers événements autorisés · actualisé ${formatDateTime(overview.data.generatedAt)}`}
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
                <ol className="attention-queue" aria-label="File d’attention">
                  {overview.data.activity.slice(0, 6).map((entry, index) => (
                    <li key={entry.id}>
                      <time dateTime={entry.createdAt}>{formatDateTime(entry.createdAt)}</time>
                      <span className="attention-marker" aria-hidden="true" />
                      <div>
                        <strong>{describeAudit(entry.action)}</strong>
                        <small>{entry.actorName ?? "Système"} · {entry.resourceType}</small>
                      </div>
                      <span className="attention-rank" aria-label={`Position ${index + 1}`}>{String(index + 1).padStart(2, "0")}</span>
                    </li>
                  ))}
                </ol>
              )}
            </Panel>
            <aside className="command-side" aria-label="Outils de départ">
            <Panel title="Accès opérationnels" subtitle="Six raccourcis maximum, filtrés par vos permissions">
              <ul className="quick-links" aria-label="Raccourcis modules">
                {visibleGroups(session.can)
                  .flatMap((group) => group.items)
                  .filter((item) => item.href !== "/")
                  .slice(0, 6)
                  .map((item) => (
                    <li key={item.href}>
                      <Link href={item.href}>
                        <span>
                          <item.icon size={15} aria-hidden="true" /> {item.label}
                        </span>
                        <ArrowRight size={14} aria-hidden="true" />
                      </Link>
                    </li>
                  ))}
              </ul>
            </Panel>
            <div className="command-principles" role="note">
              <LayoutGrid size={18} aria-hidden="true" />
              <div>
                <strong>Lecture orientée décision</strong>
                <span>Les montants restent séparés par devise et aucune valeur absente n’est extrapolée.</span>
              </div>
              <Clock3 size={16} aria-hidden="true" />
            </div>
            </aside>
          </section>
        </>
      ) : null}
    </>
  );
}
