"use client";

import React from "react";
import Link from "next/link";
import type { DashboardKpi, DashboardOverview } from "@axora24/contracts";
import { Activity, ArrowRight, BarChart3, ShieldCheck } from "lucide-react";
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
    <Link className="metric-card kpi-link" href={kpi.href} title={exact}>
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
        breadcrumb="Command Center / Vue d'ensemble"
        title={`Bonjour, ${firstName}`}
        subtitle="Situation consolidée de vos opérations, calculée en temps réel sur vos données."
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
            <section className="metrics-grid" aria-label="Indicateurs clés">
              {overview.data.kpis.map((kpi) => (
                <KpiCard key={kpi.key} kpi={kpi} />
              ))}
            </section>
          )}

          <section className="dashboard-grid">
            <Panel title="Activité récente" subtitle="Journal d'audit de votre organisation (append-only)">
              {overview.data.activity === null ? (
                <Empty
                  icon={<ShieldCheck size={22} aria-hidden="true" />}
                  title="Journal d'audit non accessible"
                  body="La permission core.audit.read est requise pour consulter l'activité."
                />
              ) : overview.data.activity.length === 0 ? (
                <Empty title="Aucune activité" body="Les actions de votre équipe apparaîtront ici." />
              ) : (
                <div className="activity-list">
                  {overview.data.activity.map((entry) => (
                    <div key={entry.id}>
                      <span className="activity-icon blue">
                        <Activity size={16} aria-hidden="true" />
                      </span>
                      <p>
                        <strong>{describeAudit(entry.action)}</strong>
                        <small>
                          {entry.actorName ?? "Système"} · {formatDateTime(entry.createdAt)}
                        </small>
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
            <Panel title="Accès rapide" subtitle="Modules autorisés pour votre rôle">
              <ul className="quick-links">
                {visibleGroups(session.can)
                  .flatMap((group) => group.items)
                  .filter((item) => item.href !== "/")
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
          </section>
        </>
      ) : null}
    </>
  );
}
