"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { EnergyAlertView, EnergyAutonomyView } from "@axora24/contracts";
import { BatteryCharging, Coins, Gauge, Leaf, Plus, Zap } from "lucide-react";
import { METER_KIND_LABEL, SOURCE_SERIES, energyApi } from "../../lib/modules/energy";
import { smartApi } from "../../lib/modules/smart";
import { formatDateTime, formatMoney, formatQuantity } from "../../lib/format";
import { useMutation, useResource } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import { StackedBars } from "../../components/bar-chart";
import { Button, DataTable, DecimalField, Empty, Feedback, Form, Loading, Metric, Metrics, Modal, PageHeader, Panel, SelectField, StatusChip, TextAreaField, TextField, Toggle } from "../../components/ui";

type Dialog = "meter" | "storage";
const STORAGE_KEY = "axora.energy.building";

export default function EnergyPage(): React.ReactElement {
  const session = useSession();
  const router = useRouter();
  const mutation = useMutation();
  const [buildingId, setBuildingId] = useState("");
  const [days, setDays] = useState(7);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [acknowledging, setAcknowledging] = useState<EnergyAlertView | null>(null);
  const canManage = session.can("energy.meter.manage");
  const buildings = useResource(() => energyApi.buildings());

  useEffect(() => {
    const list = buildings.data ?? [];
    if (list.length === 0 || list.some((building) => building.id === buildingId)) return;
    let stored = "";
    try {
      stored = window.localStorage.getItem(STORAGE_KEY) ?? "";
    } catch {
      stored = "";
    }
    setBuildingId(list.find((building) => building.id === stored)?.id ?? list.find((building) => building.meters > 0)?.id ?? list[0]!.id);
  }, [buildings.data, buildingId]);

  const data = useResource(
    () => (buildingId ? Promise.all([energyApi.balance(buildingId, days), energyApi.autonomy(buildingId), energyApi.meters(buildingId), energyApi.alerts()]) : Promise.resolve(null)),
    [buildingId, days],
  );
  const [balance, autonomy, meters, alerts] = data.data ?? [null, [], [], []];
  const extras = useResource(() => (dialog && session.can("smart.building.read") ? Promise.all([smartApi.gateways(), smartApi.points()]) : Promise.resolve(null)), [dialog]);

  function chooseBuilding(id: string): void {
    setBuildingId(id);
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* preference facultative */
    }
  }

  async function done(action: () => Promise<unknown>, success: string): Promise<void> {
    const result = await mutation.run(action, success);
    if (result !== undefined) {
      setDialog(null);
      setAcknowledging(null);
      await data.reload();
    }
  }

  const buildingOptions = (buildings.data ?? []).map((building) => ({ value: building.id, label: `${building.code} — ${building.name}` }));
  const hasSources = balance?.series.some((row) => SOURCE_SERIES.some((serie) => row.values[serie.key as keyof typeof row.values]));

  return (
    <>
      <PageHeader
        breadcrumb="Exploitation / Énergie"
        title="Énergie"
        subtitle="Consommations, productions et coûts par compteur. Chaque total indique sa couverture ; une autonomie n'est calculée que sur des données reçues et suffisantes."
        onRefresh={() => void data.reload()}
        actions={
          canManage && (
            <>
              <Button onClick={() => setDialog("storage")} disabled={!buildingId}>
                <BatteryCharging size={15} aria-hidden="true" /> Stockage
              </Button>
              <Button variant="primary" onClick={() => setDialog("meter")} disabled={buildingOptions.length === 0}>
                <Plus size={15} aria-hidden="true" /> Compteur
              </Button>
            </>
          )
        }
      />
      <Feedback error={buildings.error || data.error || mutation.error} notice={mutation.notice} />
      <div className="toolbar-inline">
        <SelectField label="Bâtiment" value={buildingId} onChange={chooseBuilding} options={buildingOptions} emptyLabel="— Choisir —" />
        <div className="range-switch" role="group" aria-label="Période">
          {[7, 30].map((value) => (
            <button key={value} type="button" aria-pressed={days === value} onClick={() => setDays(value)}>
              {value} jours
            </button>
          ))}
        </div>
      </div>
      {buildings.data && buildings.data.length === 0 ? (
        <Empty icon={<Zap size={22} />} title="Aucun bâtiment" body="Créez d'abord un bâtiment dans Smart Building, puis ses compteurs." />
      ) : !balance ? (
        <Loading label="Calcul du bilan énergétique…" />
      ) : (
        <>
          <Metrics label="Bilan énergétique">
            <Metric
              icon={<Zap size={20} />}
              tone="blue"
              label={`Consommation ${days} j`}
              value={balance.consumption.value === null ? "—" : `${formatQuantity(balance.consumption.value, 0)} kWh`}
              detail={
                balance.consumption.value === null
                  ? balance.consumption.detail
                  : `Couverture ${balance.consumption.coverage} % · ${balance.consumptionChangePercent === null ? "comparaison non fiable" : `${Number(balance.consumptionChangePercent) > 0 ? "+" : ""}${balance.consumptionChangePercent.replace(".", ",")} % vs période précédente`}`
              }
            />
            <Metric icon={<Coins size={20} />} tone={balance.costComplete ? "violet" : "amber"} label="Coût énergie" value={formatMoney(balance.cost, balance.currency)} detail={balance.costComplete ? "Au tarif en vigueur chaque jour" : "Incomplet : tarif manquant sur une partie des relevés"} />
            <Metric icon={<Leaf size={20} />} tone="green" label="Part renouvelable" value={balance.renewableSharePercent === null ? "—" : `${balance.renewableSharePercent.replace(".", ",")} %`} detail={balance.renewableSharePercent === null ? "Compteurs PV et injection requis" : "PV autoconsommé / consommation"} />
            <Metric icon={<Gauge size={20} />} tone="blue" label="Intensité" value={balance.intensityKwhPerM2 === null ? "—" : `${balance.intensityKwhPerM2.replace(".", ",")} kWh/m²`} detail={balance.intensityNote} />
          </Metrics>
          {balance.simulatedData && <Feedback error="Une partie des relevés provient d'une passerelle de SIMULATION : ces valeurs ne sont pas des mesures." />}
          <div className="stack">
            <Panel title={hasSources ? "Approvisionnement quotidien" : "Consommation quotidienne"} subtitle={`Jours UTC complets du ${balance.from.slice(0, 10)} au ${new Date(new Date(balance.to).getTime() - 86_400_000).toISOString().slice(0, 10)}`}>
              <StackedBars
                ariaLabel="Énergie par jour"
                unit="kWh"
                rows={balance.series.map((row) => ({ label: row.day.slice(5).split("-").reverse().join("/"), values: row.values }))}
                series={hasSources ? SOURCE_SERIES : [{ key: "CONSUMPTION", label: "Consommation", color: "#1849a9" }]}
              />
            </Panel>
            {autonomy.length > 0 && (
              <Panel title="Autonomie" subtitle="Calculée uniquement si le niveau est récent et les relevés de consommation suffisants — jamais extrapolée.">
                <div className="autonomy-grid" style={{ padding: "8px 21px 20px" }}>
                  {autonomy.map((storage) => (
                    <AutonomyCard key={storage.storageId} storage={storage} />
                  ))}
                </div>
              </Panel>
            )}
            <Panel title="Totaux par nature">
              <DataTable
                rows={balance.totals.map((total) => ({ ...total, id: total.kind }))}
                empty={<Empty icon={<Zap size={22} />} title="Aucun compteur" body="Déclarez les compteurs de ce bâtiment." />}
                columns={[
                  { key: "kind", header: "Nature", render: (total) => <strong>{METER_KIND_LABEL[total.kind]}</strong> },
                  { key: "value", header: "Total", align: "right", render: (total) => `${formatQuantity(total.value, 0)} ${total.unit}` },
                  { key: "coverage", header: "Couverture", align: "right", render: (total) => <StatusChip status={Number(total.coverage) >= 95 ? "passed" : Number(total.coverage) >= 50 ? "warning" : "failed"} label={`${total.coverage.replace(".", ",")} %`} /> },
                  { key: "cost", header: "Coût", align: "right", render: (total) => (total.cost === null ? "Aucun tarif" : `${formatMoney(total.cost, balance.currency)}${total.costComplete ? "" : " (partiel)"}`) },
                ]}
              />
            </Panel>
            <Panel title="Compteurs">
              <DataTable
                rows={meters}
                onRowClick={(meter) => router.push(`/energy/meters/${meter.id}`)}
                empty={<Empty icon={<Zap size={22} />} title="Aucun compteur" body="Un compteur référence un point de comptage identifié." />}
                columns={[
                  {
                    key: "meter",
                    header: "Compteur",
                    render: (meter) => (
                      <>
                        <strong>{meter.name}</strong>
                        <small>
                          {meter.code} · {METER_KIND_LABEL[meter.kind]} · pas {meter.intervalMinutes} min{meter.gatewayCode ? ` · ${meter.gatewayCode}` : " · import"}
                        </small>
                      </>
                    ),
                  },
                  { key: "coverage", header: "Couverture 24 h", align: "right", render: (meter) => <StatusChip status={Number(meter.coverage24h) >= 90 ? "passed" : "warning"} label={`${meter.coverage24h.replace(".", ",")} %`} /> },
                  { key: "last", header: "Dernier intervalle", render: (meter) => (meter.lastPeriodStart ? formatDateTime(meter.lastPeriodStart) : "Jamais") },
                  { key: "tariff", header: "Tarif actuel", align: "right", render: (meter) => (meter.currentTariff ? `${meter.currentTariff.replace(".", ",")} / ${meter.unit}` : "—") },
                  { key: "source", header: "Source", render: (meter) => (meter.simulated ? <StatusChip status="warning" label="Simulateur" /> : <small>{meter.gatewayCode ? "Passerelle" : "Import"}</small>) },
                ]}
              />
            </Panel>
            <Panel title="Alertes ouvertes" subtitle="Dépassement d'intervalle à la réception ; dépassement journalier seulement sur un jour complet.">
              <DataTable
                rows={alerts}
                empty={<Empty icon={<Zap size={22} />} title="Aucune alerte ouverte" body="Les règles se définissent sur chaque compteur." />}
                columns={[
                  {
                    key: "alert",
                    header: "Alerte",
                    render: (alert) => (
                      <>
                        <strong>{alert.message}</strong>
                        <small>
                          {alert.meterCode} · {alert.kind === "DAILY_ABOVE" ? `jour du ${alert.periodStart.slice(0, 10)}` : formatDateTime(alert.periodStart)}
                        </small>
                      </>
                    ),
                  },
                  { key: "value", header: "Valeur / seuil", align: "right", render: (alert) => `${formatQuantity(alert.value, 1)} / ${formatQuantity(alert.threshold, 1)} ${alert.unit}` },
                  {
                    key: "ack",
                    header: "",
                    render: (alert) =>
                      session.can("energy.alert.acknowledge") ? (
                        <Button onClick={() => setAcknowledging(alert)}>Acquitter</Button>
                      ) : null,
                  },
                ]}
              />
            </Panel>
          </div>
        </>
      )}

      {acknowledging && (
        <Modal title={`Acquitter — ${acknowledging.message}`} onClose={() => setAcknowledging(null)}>
          <Feedback error={mutation.error} />
          <NoteForm saving={mutation.saving} onSubmit={(note) => done(() => energyApi.acknowledge(acknowledging.id, note), "Alerte acquittée.")} />
        </Modal>
      )}
      {dialog === "meter" && (
        <Modal title="Nouveau compteur" onClose={() => setDialog(null)}>
          <Feedback error={mutation.error} />
          <MeterForm
            buildings={buildingOptions}
            buildingId={buildingId}
            gateways={(extras.data?.[0] ?? []).map((gateway) => ({ value: gateway.id, label: `${gateway.code} — ${gateway.name}`, buildingId: gateway.buildingId }))}
            saving={mutation.saving}
            onSubmit={(input) => done(() => energyApi.createMeter(input), "Compteur créé.")}
          />
        </Modal>
      )}
      {dialog === "storage" && (
        <Modal title="Nouveau stockage (batterie ou cuve)" onClose={() => setDialog(null)}>
          <Feedback error={mutation.error || extras.error} />
          <StorageForm
            meters={meters.map((meter) => ({ value: meter.id, label: `${meter.code} — ${meter.name} (${meter.unit})` }))}
            points={(extras.data?.[1] ?? []).filter((point) => point.kind === "ANALOG").map((point) => ({ value: point.id, label: `${point.name} — ${point.externalRef} (${point.unit ?? "sans unité"})` }))}
            saving={mutation.saving}
            onSubmit={(input) => done(() => energyApi.createStorage({ ...input, buildingId }), "Stockage déclaré.")}
          />
        </Modal>
      )}
    </>
  );
}

function AutonomyCard({ storage }: { storage: EnergyAutonomyView }): React.ReactElement {
  return (
    <article className="autonomy-card">
      <header>
        <strong>{storage.name}</strong>
        {storage.simulatedInputs ? <StatusChip status="warning" label="Entrées simulées" /> : <StatusChip status={storage.state === "COMPUTED" ? "passed" : "not_tested"} label={storage.kind === "BATTERY" ? "Batterie" : "Cuve gasoil"} />}
      </header>
      {storage.state === "COMPUTED" ? <div className="hours">{storage.hours!.replace(".", ",")} h</div> : <div className="reason">{storage.state === "UNBOUNDED" ? "Non bornée" : "Non calculable"} — {storage.reason}</div>}
      <dl>
        {storage.inputs.map((input) => (
          <div key={input.label}>
            <dt>{input.label}</dt>
            <dd>{input.value}</dd>
          </div>
        ))}
      </dl>
      <p className="formula-note">{storage.formula}</p>
      <ul>
        {storage.assumptions.map((assumption) => (
          <li key={assumption}>{assumption}</li>
        ))}
      </ul>
    </article>
  );
}

function NoteForm({ saving, onSubmit }: { saving: boolean; onSubmit: (note: string) => Promise<void> }): React.ReactElement {
  const [note, setNote] = useState("");
  return (
    <Form columns={1} submitLabel="Acquitter" saving={saving} onSubmit={() => onSubmit(note)}>
      <TextAreaField label="Analyse / action engagée" value={note} onChange={setNote} required />
    </Form>
  );
}

function MeterForm({
  buildings,
  buildingId,
  gateways,
  saving,
  onSubmit,
}: {
  buildings: Array<{ value: string; label: string }>;
  buildingId: string;
  gateways: Array<{ value: string; label: string; buildingId: string }>;
  saving: boolean;
  onSubmit: (input: Record<string, unknown>) => Promise<void>;
}): React.ReactElement {
  const [form, setForm] = useState({ buildingId, code: "", name: "", kind: "CONSUMPTION", intervalMinutes: "15", gatewayId: "", externalRef: "" });
  const set = (key: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));
  return (
    <Form
      submitLabel="Créer le compteur"
      saving={saving}
      onSubmit={() => onSubmit({ ...form, intervalMinutes: Number(form.intervalMinutes), gatewayId: form.gatewayId || undefined, externalRef: form.gatewayId ? form.externalRef : undefined })}
    >
      <SelectField label="Bâtiment" value={form.buildingId} onChange={set("buildingId")} options={buildings} required />
      <TextField label="Code" value={form.code} onChange={set("code")} required />
      <TextField label="Nom" value={form.name} onChange={set("name")} required wide />
      <SelectField label="Nature" value={form.kind} onChange={set("kind")} options={Object.entries(METER_KIND_LABEL).map(([value, label]) => ({ value, label }))} required />
      <SelectField label="Pas de temps" value={form.intervalMinutes} onChange={set("intervalMinutes")} options={["5", "10", "15", "30", "60"].map((value) => ({ value, label: `${value} min` }))} required />
      <SelectField label="Passerelle (sinon import)" value={form.gatewayId} onChange={set("gatewayId")} options={gateways.filter((gateway) => gateway.buildingId === form.buildingId)} emptyLabel="— Import de relevés —" />
      {form.gatewayId && <TextField label="Référence côté passerelle" value={form.externalRef} onChange={set("externalRef")} required />}
    </Form>
  );
}

function StorageForm({
  meters,
  points,
  saving,
  onSubmit,
}: {
  meters: Array<{ value: string; label: string }>;
  points: Array<{ value: string; label: string }>;
  saving: boolean;
  onSubmit: (input: Record<string, unknown>) => Promise<void>;
}): React.ReactElement {
  const [form, setForm] = useState({ name: "", kind: "BATTERY", usableCapacity: "", levelPointId: "", reserve: "", drainMeterId: "" });
  const [percent, setPercent] = useState(true);
  const set = (key: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));
  return (
    <Form submitLabel="Déclarer" saving={saving} onSubmit={() => onSubmit({ ...form, reserve: form.reserve || undefined, levelIsPercent: percent })}>
      <TextField label="Nom" value={form.name} onChange={set("name")} required />
      <SelectField label="Type" value={form.kind} onChange={set("kind")} options={[{ value: "BATTERY", label: "Batterie (kWh)" }, { value: "FUEL_TANK", label: "Cuve gasoil (L)" }]} required />
      <DecimalField label="Capacité utile" value={form.usableCapacity} onChange={set("usableCapacity")} required />
      <SelectField label="Point de niveau (GTB)" value={form.levelPointId} onChange={set("levelPointId")} options={points} required wide />
      <Toggle label="Niveau exprimé en %" checked={percent} onChange={setPercent} />
      <DecimalField label="Réserve non exploitable" value={form.reserve} onChange={set("reserve")} hint="Dans l'unité du niveau." />
      <SelectField label="Compteur qui la vide" value={form.drainMeterId} onChange={set("drainMeterId")} options={meters} required wide />
    </Form>
  );
}
