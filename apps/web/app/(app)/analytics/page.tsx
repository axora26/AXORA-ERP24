"use client";

import React, { useState } from "react";
import type { AnalyticsCatalogEntry, AnalyticsDashboardView, AnalyticsSeriesView, AnalyticsSnapshotView } from "@axora24/contracts";
import { Camera, Download, LayoutDashboard, Lock, Pencil, Plus, Trash2 } from "lucide-react";
import { analyticsApi, chartGroups, exportUrl, seriesTotal, unitLabel } from "../../lib/modules/analytics";
import { formatDateTime, formatDecimal } from "../../lib/format";
import { useMutation, useResource } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import { MonthlyChart, monthLabel } from "../../components/monthly-chart";
import { Button, CheckboxGroup, DataTable, Empty, Feedback, Form, Loading, Modal, PageHeader, Panel, SelectField, StatusChip, Tabs, TextField, Toggle } from "../../components/ui";

type TabId = "metrics" | "dashboards" | "snapshots";

export default function AnalyticsPage(): React.ReactElement {
  const session = useSession();
  const mutation = useMutation();
  const [tab, setTab] = useState<TabId>("metrics");
  const [months, setMonths] = useState("12");
  const [dashboardId, setDashboardId] = useState<string | null>(null);
  const [editing, setEditing] = useState<AnalyticsDashboardView | "new" | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [openSnapshot, setOpenSnapshot] = useState<AnalyticsSnapshotView | null>(null);

  const data = useResource(async () => {
    const catalog = await analyticsApi.catalog();
    const views = await Promise.all(catalog.filter((entry) => entry.granted).map((entry) => analyticsApi.series(entry.key, Number(months))));
    return { catalog, views };
  }, [months]);
  const dashboards = useResource(() => analyticsApi.dashboards());
  const snapshots = useResource(() => (tab === "snapshots" ? analyticsApi.snapshots() : Promise.resolve([])), [tab]);
  const catalog = data.data?.catalog ?? [];
  const views = data.data?.views ?? [];
  const denied = catalog.filter((entry) => !entry.granted);
  const board = (dashboards.data ?? []).find((entry) => entry.id === dashboardId) ?? null;

  return (
    <>
      <PageHeader
        breadcrumb="Pilotage / Analyses"
        title="Analyses & BI"
        subtitle="Indicateurs mensuels calculés sur les données réelles de l'entreprise active. Chaque indicateur reste soumis à la permission de lecture de son module ; les devises ne sont jamais additionnées."
        onRefresh={() => {
          void data.reload();
          void dashboards.reload();
        }}
        actions={
          <>
            <label className="analytics-period">
              <span>Période</span>
              <select value={months} onChange={(event) => setMonths(event.currentTarget.value)} aria-label="Nombre de mois">
                <option value="6">6 mois</option>
                <option value="12">12 mois</option>
                <option value="24">24 mois</option>
              </select>
            </label>
            {session.can("analytics.snapshot.manage") && (
              <Button onClick={() => setCapturing(true)}>
                <Camera size={15} aria-hidden="true" /> Figer un mois
              </Button>
            )}
          </>
        }
      />
      <Feedback error={data.error || dashboards.error || mutation.error} notice={mutation.notice} />
      <Tabs
        tabs={[
          { id: "metrics", label: "Indicateurs", count: views.length },
          { id: "dashboards", label: "Tableaux de bord", count: dashboards.data?.length ?? 0 },
          { id: "snapshots", label: "Instantanés figés" },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "metrics" &&
        (data.loading && !data.data ? (
          <Loading label="Calcul des indicateurs…" />
        ) : (
          <div className="stack">
            {views.length === 0 && <Empty icon={<Lock size={22} />} title="Aucun indicateur accessible" body="Vos droits ne donnent accès à aucun module source. La permission analytique n'ouvre que les modules que vous pouvez déjà lire." />}
            <div className="analytics-grid">
              {views.map((view) => (
                <MetricCard key={view.metric.key} view={view} months={Number(months)} />
              ))}
            </div>
            {denied.length > 0 && <DeniedNote entries={denied} />}
          </div>
        ))}

      {tab === "dashboards" && (
        <div className="stack">
          <div className="analytics-boards">
            {(dashboards.data ?? []).map((entry) => (
              <button key={entry.id} type="button" className={entry.id === dashboardId ? "active" : ""} onClick={() => setDashboardId(entry.id)}>
                <strong>{entry.name}</strong>
                <small>
                  {entry.mine ? "Mon tableau" : `Partagé par ${entry.ownerName}`} · {entry.metrics.length} indicateur(s)
                  {entry.mine && entry.shared ? " · partagé" : ""}
                </small>
              </button>
            ))}
            {session.can("analytics.dashboard.manage") && (
              <button type="button" className="analytics-new" onClick={() => setEditing("new")}>
                <Plus size={15} aria-hidden="true" /> Nouveau tableau de bord
              </button>
            )}
          </div>
          {(dashboards.data ?? []).length === 0 && !session.can("analytics.dashboard.manage") && <Empty icon={<LayoutDashboard size={22} />} title="Aucun tableau de bord" body="Aucun tableau de bord ne vous est partagé." />}
          {board && (
            <Panel
              title={board.name}
              subtitle={board.mine ? "Vous êtes propriétaire de ce tableau de bord." : `Partagé par ${board.ownerName} — chaque indicateur reste filtré selon vos propres droits.`}
              actions={
                board.mine && session.can("analytics.dashboard.manage") ? (
                  <span className="row-actions">
                    <Button onClick={() => setEditing(board)}>
                      <Pencil size={14} aria-hidden="true" /> Modifier
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={async () => {
                        const done = await mutation.run(() => analyticsApi.deleteDashboard(board.id), "Tableau de bord supprimé.");
                        if (done) {
                          setDashboardId(null);
                          await dashboards.reload();
                        }
                      }}
                    >
                      <Trash2 size={14} aria-hidden="true" /> Supprimer
                    </Button>
                  </span>
                ) : undefined
              }
            >
              <div className="analytics-grid in-panel">
                {board.metrics.map((key) => {
                  const view = views.find((candidate) => candidate.metric.key === key);
                  const entry = catalog.find((candidate) => candidate.key === key);
                  return view ? (
                    <MetricCard key={key} view={view} months={Number(months)} />
                  ) : (
                    <div key={key} className="analytics-locked">
                      <Lock size={16} aria-hidden="true" /> {entry?.label ?? key} — non accessible avec vos droits{entry ? ` (${entry.permission})` : ""}.
                    </div>
                  );
                })}
              </div>
            </Panel>
          )}
        </div>
      )}

      {tab === "snapshots" && (
        <Panel title="Instantanés mensuels figés" subtitle="Valeurs d'un mois calendaire figées à la date de capture (append-only, versionnées). Les indicateurs que vous ne pouvez pas lire restent masqués.">
          {snapshots.loading && !snapshots.data ? (
            <Loading label="Chargement des instantanés…" />
          ) : (
            <DataTable
              rows={snapshots.data ?? []}
              onRowClick={setOpenSnapshot}
              empty={<Empty icon={<Camera size={22} />} title="Aucun instantané" body="Figez un mois pour conserver ses indicateurs tels qu'ils étaient à la date de capture." />}
              columns={[
                { key: "period", header: "Mois", render: (row) => <strong>{monthLabel(row.period)}</strong> },
                { key: "version", header: "Version", align: "right", render: (row) => `v${row.version}` },
                { key: "by", header: "Figé par", render: (row) => `${row.capturedByName} · ${formatDateTime(row.capturedAt)}` },
                { key: "metrics", header: "Indicateurs visibles", align: "right", render: (row) => `${row.metrics.length}${row.hiddenMetrics ? ` (+${row.hiddenMetrics} masqué(s))` : ""}` },
                { key: "flag", header: "", render: (row) => (row.isDemo ? <StatusChip status="pending" label="DEMO" /> : null) },
              ]}
            />
          )}
        </Panel>
      )}

      {capturing && (
        <Modal title="Figer un mois" onClose={() => setCapturing(false)}>
          <Feedback error={mutation.error} />
          <CaptureForm
            saving={mutation.saving}
            onSubmit={async (period) => {
              const result = await mutation.run(() => analyticsApi.capture(period), "Instantané enregistré.");
              if (result) {
                setCapturing(false);
                setTab("snapshots");
                setOpenSnapshot(result);
                await snapshots.reload();
              }
            }}
          />
        </Modal>
      )}

      {openSnapshot && (
        <Modal title={`Instantané ${monthLabel(openSnapshot.period)} — v${openSnapshot.version}`} onClose={() => setOpenSnapshot(null)} wide>
          <p className="field-note">
            Fenêtre du {openSnapshot.periodStart.slice(0, 10)} au {openSnapshot.periodEnd.slice(0, 10)} (exclu), figée le {formatDateTime(openSnapshot.capturedAt)} par {openSnapshot.capturedByName}.
            {openSnapshot.excludedMetrics.length > 0 && ` Non figés faute de droits du capteur : ${openSnapshot.excludedMetrics.join(", ")}.`}
          </p>
          <table className="analytics-snapshot">
            <tbody>
              {openSnapshot.metrics.map((metric) => (
                <tr key={metric.metric}>
                  <th scope="row">{metric.label}</th>
                  <td>{metric.series.length ? metric.series.map((serie) => `${serie.label} : ${formatDecimal(serie.value, metric.unit === "money" ? 2 : 0)} ${unitLabel(metric.unit, serie.key) === serie.key ? "" : unitLabel(metric.unit, serie.key)}`.trim()).join(" · ") : "Aucune donnée"}</td>
                  <td>{metric.sourceRows} enregistrement(s)</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Modal>
      )}

      {editing && (
        <Modal title={editing === "new" ? "Nouveau tableau de bord" : `Modifier « ${editing.name} »`} onClose={() => setEditing(null)}>
          <Feedback error={mutation.error} />
          <DashboardForm
            initial={editing === "new" ? null : editing}
            options={catalog.filter((entry) => entry.granted).map((entry) => ({ value: entry.key, label: entry.label, hint: entry.domainLabel }))}
            saving={mutation.saving}
            onSubmit={async (input) => {
              const result = await mutation.run(() => (editing === "new" ? analyticsApi.createDashboard(input) : analyticsApi.updateDashboard(editing.id, input)), "Tableau de bord enregistré.");
              if (result) {
                setEditing(null);
                setDashboardId(result.id);
                await dashboards.reload();
              }
            }}
          />
        </Modal>
      )}
    </>
  );
}

function MetricCard({ view, months }: { view: AnalyticsSeriesView; months: number }): React.ReactElement {
  const groups = chartGroups(view);
  return (
    <Panel
      className="compact"
      title={view.metric.label}
      subtitle={`${view.metric.domainLabel} — ${view.metric.description}`}
      actions={
        <a className="btn btn-ghost" href={exportUrl(view.metric.key, months)} download>
          <Download size={14} aria-hidden="true" /> CSV
        </a>
      }
    >
      <div className="analytics-card">
        {groups.length === 0 || view.series.length === 0 ? (
          <p className="analytics-empty">Aucune donnée sur la période.</p>
        ) : (
          groups.map((group) => (
            <div key={group.unit || "unit"}>
              {view.metric.unit === "money" && <p className="analytics-currency">{group.unit}</p>}
              <MonthlyChart months={view.months} series={group.series} unit={group.unit} ariaLabel={`${view.metric.label}${view.metric.unit === "money" ? ` en ${group.unit}` : ""}, ${view.months.length} derniers mois`} />
            </div>
          ))
        )}
        <p className="analytics-trace">
          {view.series.map((serie) => `${serie.label} : ${formatDecimal(seriesTotal(serie.values), view.metric.unit === "money" ? 2 : 0)}${view.metric.unit === "money" ? "" : ` ${unitLabel(view.metric.unit, serie.key)}`.trimEnd()}`).join(" · ") || "Total : 0"} · {view.sourceRows} enregistrement(s) source
        </p>
      </div>
    </Panel>
  );
}

function DeniedNote({ entries }: { entries: AnalyticsCatalogEntry[] }): React.ReactElement {
  return (
    <p className="analytics-denied">
      <Lock size={14} aria-hidden="true" /> Indicateurs non accessibles avec vos droits : {entries.map((entry) => `${entry.label} (${entry.permission})`).join(", ")}.
    </p>
  );
}

function CaptureForm({ saving, onSubmit }: { saving: boolean; onSubmit: (period: string) => Promise<void> }): React.ReactElement {
  const current = new Date().toISOString().slice(0, 7);
  const [period, setPeriod] = useState(current);
  const options = Array.from({ length: 12 }, (_, index) => {
    const date = new Date();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() - index);
    const value = date.toISOString().slice(0, 7);
    return { value, label: monthLabel(value) };
  });
  return (
    <Form columns={1} submitLabel="Figer" saving={saving} onSubmit={() => onSubmit(period)}>
      <SelectField label="Mois" value={period} onChange={setPeriod} options={options} required hint="Seuls les indicateurs que vous pouvez lire sont figés ; les autres sont listés comme exclus." />
    </Form>
  );
}

function DashboardForm({
  initial,
  options,
  saving,
  onSubmit,
}: {
  initial: AnalyticsDashboardView | null;
  options: Array<{ value: string; label: string; hint?: string }>;
  saving: boolean;
  onSubmit: (input: { name: string; metrics: string[]; shared: boolean }) => Promise<void>;
}): React.ReactElement {
  const [name, setName] = useState(initial?.name ?? "");
  const [metrics, setMetrics] = useState<string[]>(initial?.metrics.filter((key) => options.some((option) => option.value === key)) ?? []);
  const [shared, setShared] = useState(initial?.shared ?? false);
  return (
    <Form columns={1} submitLabel="Enregistrer" saving={saving} onSubmit={() => onSubmit({ name, metrics, shared })}>
      <TextField label="Nom" value={name} onChange={setName} required />
      <CheckboxGroup label="Indicateurs (12 au plus, parmi ceux que vous pouvez lire)" options={options} selected={metrics} onChange={setMetrics} />
      <Toggle label="Partager avec l'entreprise (chaque lecteur ne voit que ce que ses droits permettent)" checked={shared} onChange={setShared} />
    </Form>
  );
}
