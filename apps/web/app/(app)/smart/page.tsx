"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import type { SmartAlarmView, SmartGatewayTokenView } from "@axora24/contracts";
import { Activity, BellRing, Building, Plus, Radio, RadioTower, SlidersHorizontal } from "lucide-react";
import {
  ALARM_STATUS_CHIP,
  ALARM_STATUS_LABEL,
  CONDITION_LABEL,
  KIND_LABEL,
  LEVEL_STATE_CHIP,
  LEVEL_STATE_LABEL,
  PROTOCOL_LABEL,
  SETPOINT_STATUS_CHIP,
  SETPOINT_STATUS_LABEL,
  SEVERITY_CHIP,
  SEVERITY_LABEL,
  formatValue,
  smartApi,
} from "../../lib/modules/smart";
import { assetsApi } from "../../lib/modules/assets";
import { formatDateTime } from "../../lib/format";
import { useMutation, useResource } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import { Button, DataTable, DecimalField, Empty, Feedback, Form, Loading, Metric, Metrics, Modal, PageHeader, Panel, SelectField, StatusChip, Tabs, TextAreaField, TextField, Toggle } from "../../components/ui";
import { TokenReveal } from "../../components/token-reveal";

type TabId = "alarms" | "points" | "gateways" | "setpoints";
type Dialog = "building" | "gateway" | "point";

export default function SmartBuildingPage(): React.ReactElement {
  const session = useSession();
  const router = useRouter();
  const mutation = useMutation();
  const [tab, setTab] = useState<TabId>("alarms");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [acknowledging, setAcknowledging] = useState<SmartAlarmView | null>(null);
  const [issued, setIssued] = useState<SmartGatewayTokenView | null>(null);
  const canManage = session.can("smart.building.manage");
  const data = useResource(() => Promise.all([smartApi.summary(), smartApi.alarms(), smartApi.points(), smartApi.gateways(), smartApi.buildings(), smartApi.setpoints()]));
  const [summary, alarms, points, gateways, buildings, setpoints] = data.data ?? [null, [], [], [], [], []];
  const assets = useResource(() => (dialog === "point" && session.can("assets.asset.read") ? assetsApi.list() : Promise.resolve([])), [dialog]);

  async function done(action: () => Promise<unknown>, success: string): Promise<unknown> {
    const result = await mutation.run(action, success);
    if (result !== undefined) {
      setDialog(null);
      setAcknowledging(null);
      await data.reload();
    }
    return result;
  }

  return (
    <>
      <PageHeader
        breadcrumb="Exploitation / Smart Building"
        title="Smart Building (GTB)"
        subtitle="Télémétrie, alarmes et consignes des équipements techniques. Chaque passerelle affiche séparément ce qui est prouvé : protocole, connecteur, réseau, lecture et écriture réelles."
        onRefresh={() => void data.reload()}
        actions={
          canManage && (
            <>
              <Button onClick={() => setDialog("building")}>
                <Building size={15} aria-hidden="true" /> Bâtiment
              </Button>
              <Button onClick={() => setDialog("gateway")} disabled={buildings.length === 0}>
                <RadioTower size={15} aria-hidden="true" /> Passerelle
              </Button>
              <Button variant="primary" onClick={() => setDialog("point")} disabled={gateways.length === 0}>
                <Plus size={15} aria-hidden="true" /> Point
              </Button>
            </>
          )
        }
      />
      <Feedback error={data.error || mutation.error} notice={mutation.notice} />
      {data.loading && !data.data ? (
        <Loading label="Chargement de la GTB…" />
      ) : (
        <>
          {summary && (
            <Metrics label="Indicateurs Smart Building">
              <Metric
                icon={<BellRing size={20} />}
                tone={summary.criticalAlarms > 0 ? "red" : summary.activeAlarms > 0 ? "amber" : "green"}
                label="Alarmes en cours"
                value={String(summary.activeAlarms)}
                detail={`${summary.criticalAlarms} critique(s) non acquittée(s)`}
              />
              <Metric icon={<Activity size={20} />} tone={summary.stalePoints > 0 ? "amber" : "green"} label="Points suivis" value={String(summary.points)} detail={`${summary.stalePoints} sans donnée depuis 1 h · ${summary.readings24h} lectures / 24 h`} />
              <Metric
                icon={<Radio size={20} />}
                tone={summary.physicalReadTested > 0 ? "green" : "amber"}
                label="Lecture réelle attestée"
                value={`${summary.physicalReadTested} / ${summary.gateways - summary.simulatedGateways}`}
                detail={`passerelle(s) terrain · écriture attestée : ${summary.physicalWriteTested} · ${summary.simulatedGateways} simulateur(s) exclu(s)`}
              />
              <Metric icon={<SlidersHorizontal size={20} />} tone="violet" label="Consignes en attente" value={String(summary.pendingSetpoints)} detail="Confirmées uniquement par relecture du point" />
            </Metrics>
          )}
          <Tabs
            tabs={[
              { id: "alarms", label: "Alarmes", count: alarms.length },
              { id: "points", label: "Points", count: points.length },
              { id: "gateways", label: "Passerelles", count: gateways.length },
              { id: "setpoints", label: "Consignes", count: setpoints.length },
            ]}
            active={tab}
            onChange={setTab}
          />
          <div className="stack">
            {tab === "alarms" && (
              <Panel title="Alarmes en cours" subtitle="Chaque alarme fige le seuil et la lecture qui l'ont déclenchée ; elle ne se lève que sur une lecture revenue à la normale.">
                <DataTable
                  rows={alarms}
                  onRowClick={(alarm) => router.push(`/smart/points/${alarm.pointId}`)}
                  empty={<Empty icon={<BellRing size={22} />} title="Aucune alarme en cours" body="Les règles de seuil sont évaluées à chaque lecture reçue." />}
                  columns={[
                    {
                      key: "alarm",
                      header: "Alarme",
                      render: (alarm) => (
                        <>
                          <strong>{alarm.message}</strong>
                          <small>
                            {alarm.pointName} · {alarm.buildingCode} / {alarm.gatewayCode} · {alarm.pointRef}
                          </small>
                        </>
                      ),
                    },
                    { key: "severity", header: "Gravité", render: (alarm) => <StatusChip status={SEVERITY_CHIP[alarm.severity] ?? "warning"} label={SEVERITY_LABEL[alarm.severity]} /> },
                    {
                      key: "trigger",
                      header: "Déclenchement",
                      render: (alarm) => (
                        <>
                          {formatValue(alarm.triggerValue, alarm.unit)} ({CONDITION_LABEL[alarm.condition]} {formatValue(alarm.threshold, alarm.unit)})
                          <small>{formatDateTime(alarm.triggerReadingAt)}</small>
                        </>
                      ),
                    },
                    { key: "status", header: "État", render: (alarm) => <StatusChip status={ALARM_STATUS_CHIP[alarm.status] ?? "warning"} label={ALARM_STATUS_LABEL[alarm.status]} /> },
                    {
                      key: "actions",
                      header: "",
                      render: (alarm) =>
                        alarm.status === "ACTIVE" && session.can("smart.alarm.acknowledge") ? (
                          <Button
                            onClick={() => {
                              setAcknowledging(alarm);
                            }}
                          >
                            Acquitter
                          </Button>
                        ) : alarm.acknowledgedByName ? (
                          <small>
                            Acquittée par {alarm.acknowledgedByName}
                          </small>
                        ) : null,
                    },
                  ]}
                />
              </Panel>
            )}
            {tab === "points" && (
              <Panel title="Points de télémétrie">
                <DataTable
                  rows={points}
                  onRowClick={(point) => router.push(`/smart/points/${point.id}`)}
                  empty={<Empty icon={<Activity size={22} />} title="Aucun point" body="Déclarez les points (objets BACnet, registres Modbus, topics MQTT…) de chaque passerelle." />}
                  columns={[
                    {
                      key: "point",
                      header: "Point",
                      render: (point) => (
                        <>
                          <strong>{point.name}</strong>
                          <small>
                            {point.buildingCode} / {point.gatewayCode} · {point.externalRef}
                            {point.assetCode ? ` · actif ${point.assetCode}` : ""}
                          </small>
                        </>
                      ),
                    },
                    { key: "kind", header: "Type", render: (point) => `${KIND_LABEL[point.kind]}${point.writable ? " · écriture" : ""}` },
                    { key: "value", header: "Dernière valeur", align: "right", render: (point) => <strong>{formatValue(point.lastValue, point.unit, point.kind)}</strong> },
                    {
                      key: "freshness",
                      header: "Fraîcheur",
                      render: (point) =>
                        point.stale ? <StatusChip status="overdue" label={point.lastReadingAt ? `Muet depuis ${formatDateTime(point.lastReadingAt)}` : "Jamais reçu"} /> : <small>{formatDateTime(point.lastReadingAt)}</small>,
                    },
                    { key: "source", header: "Source", render: (point) => (point.simulated ? <StatusChip status="warning" label="Simulateur" /> : <small>Passerelle terrain</small>) },
                    { key: "alarms", header: "Alarmes", align: "right", render: (point) => (point.activeAlarms > 0 ? <StatusChip status="critical" label={String(point.activeAlarms)} /> : "0") },
                  ]}
                />
              </Panel>
            )}
            {tab === "gateways" && (
              <Panel title="Passerelles" subtitle="Protocole supporté · connecteur développé · passerelle joignable · lecture réelle testée · écriture réelle testée">
                <DataTable
                  rows={gateways}
                  onRowClick={(gateway) => router.push(`/smart/gateways/${gateway.id}`)}
                  empty={<Empty icon={<RadioTower size={22} />} title="Aucune passerelle" body="Une passerelle reçoit un jeton pour pousser ses lectures vers l'API." />}
                  columns={[
                    {
                      key: "gateway",
                      header: "Passerelle",
                      render: (gateway) => (
                        <>
                          <strong>{gateway.name}</strong>
                          <small>
                            {gateway.code} · {gateway.buildingCode} · {PROTOCOL_LABEL[gateway.protocol]}
                            {gateway.simulated ? " · SIMULATEUR" : ""}
                          </small>
                        </>
                      ),
                    },
                    ...(["protocol", "connector", "network", "read", "write"] as const).map((key, index) => ({
                      key,
                      header: ["Protocole", "Connecteur", "Réseau", "Lecture", "Écriture"][index]!,
                      render: (gateway: (typeof gateways)[number]) => {
                        const level = gateway.levels.find((candidate) => candidate.key === key)!;
                        return <StatusChip status={LEVEL_STATE_CHIP[level.state] ?? "not_tested"} label={LEVEL_STATE_LABEL[level.state]} />;
                      },
                    })),
                    { key: "readings", header: "Lectures 24 h", align: "right" as const, render: (gateway) => String(gateway.readings24h) },
                  ]}
                />
              </Panel>
            )}
            {tab === "setpoints" && (
              <Panel title="Consignes" subtitle="Une consigne acquittée par la passerelle n'est pas « appliquée » : seule une relecture du point dans la tolérance la confirme.">
                <DataTable
                  rows={setpoints}
                  onRowClick={(setpoint) => router.push(`/smart/points/${setpoint.pointId}`)}
                  empty={<Empty icon={<SlidersHorizontal size={22} />} title="Aucune consigne" body="Les points en écriture acceptent des consignes motivées." />}
                  columns={[
                    {
                      key: "setpoint",
                      header: "Consigne",
                      render: (setpoint) => (
                        <>
                          <strong>
                            {setpoint.pointName} → {formatValue(setpoint.requestedValue, setpoint.unit)}
                          </strong>
                          <small>
                            {setpoint.reason} · {setpoint.requestedByName}
                          </small>
                        </>
                      ),
                    },
                    { key: "requested", header: "Demandée", render: (setpoint) => formatDateTime(setpoint.requestedAt) },
                    { key: "status", header: "État", render: (setpoint) => <StatusChip status={SETPOINT_STATUS_CHIP[setpoint.status] ?? "pending"} label={SETPOINT_STATUS_LABEL[setpoint.status]} /> },
                    { key: "readback", header: "Relecture", align: "right", render: (setpoint) => (setpoint.confirmValue ? `${formatValue(setpoint.confirmValue, setpoint.unit)} · ${formatDateTime(setpoint.confirmReadingAt)}` : "—") },
                  ]}
                />
              </Panel>
            )}
          </div>
        </>
      )}

      {acknowledging && (
        <Modal title={`Acquitter — ${acknowledging.message}`} onClose={() => setAcknowledging(null)}>
          <Feedback error={mutation.error} />
          <NoteForm saving={mutation.saving} onSubmit={(note) => done(() => smartApi.acknowledge(acknowledging.id, note), "Alarme acquittée.").then(() => undefined)} />
        </Modal>
      )}
      {dialog === "building" && (
        <Modal title="Nouveau bâtiment" onClose={() => setDialog(null)}>
          <Feedback error={mutation.error} />
          <BuildingForm saving={mutation.saving} onSubmit={(input) => done(() => smartApi.createBuilding(input), "Bâtiment créé.").then(() => undefined)} />
        </Modal>
      )}
      {dialog === "gateway" && (
        <Modal title="Nouvelle passerelle" onClose={() => setDialog(null)}>
          <Feedback error={mutation.error} />
          <GatewayForm
            buildings={buildings.map((building) => ({ value: building.id, label: `${building.code} — ${building.name}` }))}
            saving={mutation.saving}
            onSubmit={async (input) => {
              const created = await mutation.run(() => smartApi.createGateway(input), "Passerelle créée.");
              if (created) {
                setDialog(null);
                setIssued(created);
                await data.reload();
              }
            }}
          />
        </Modal>
      )}
      {dialog === "point" && (
        <Modal title="Nouveau point" onClose={() => setDialog(null)}>
          <Feedback error={mutation.error} />
          <PointForm
            gateways={gateways.map((gateway) => ({ value: gateway.id, label: `${gateway.code} — ${gateway.name} (${PROTOCOL_LABEL[gateway.protocol]})` }))}
            assets={(assets.data ?? []).map((asset) => ({ value: asset.id, label: `${asset.code} — ${asset.name}` }))}
            saving={mutation.saving}
            onSubmit={(input) => done(() => smartApi.createPoint(input), "Point créé.").then(() => undefined)}
          />
        </Modal>
      )}
      {issued && <TokenReveal issued={issued} onClose={() => setIssued(null)} />}
    </>
  );
}

function NoteForm({ saving, onSubmit }: { saving: boolean; onSubmit: (note: string) => Promise<void> }): React.ReactElement {
  const [note, setNote] = useState("");
  return (
    <Form columns={1} submitLabel="Acquitter" saving={saving} onSubmit={() => onSubmit(note)}>
      <TextAreaField label="Prise en compte (action engagée)" value={note} onChange={setNote} required />
    </Form>
  );
}

function BuildingForm({ saving, onSubmit }: { saving: boolean; onSubmit: (input: Record<string, unknown>) => Promise<void> }): React.ReactElement {
  const [form, setForm] = useState({ code: "", name: "", address: "" });
  const set = (key: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));
  return (
    <Form submitLabel="Créer" saving={saving} onSubmit={() => onSubmit({ ...form, address: form.address || undefined })}>
      <TextField label="Code" value={form.code} onChange={set("code")} required />
      <TextField label="Nom" value={form.name} onChange={set("name")} required />
      <TextField label="Adresse" value={form.address} onChange={set("address")} wide />
    </Form>
  );
}

function GatewayForm({ buildings, saving, onSubmit }: { buildings: Array<{ value: string; label: string }>; saving: boolean; onSubmit: (input: Record<string, unknown>) => Promise<void> }): React.ReactElement {
  const [form, setForm] = useState({ buildingId: "", code: "", name: "", protocol: "BACNET_IP", endpoint: "" });
  const [simulated, setSimulated] = useState(false);
  const set = (key: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));
  return (
    <Form submitLabel="Créer et obtenir le jeton" saving={saving} onSubmit={() => onSubmit({ ...form, endpoint: form.endpoint || undefined, simulated })}>
      <SelectField label="Bâtiment" value={form.buildingId} onChange={set("buildingId")} options={buildings} required wide />
      <TextField label="Code" value={form.code} onChange={set("code")} required />
      <TextField label="Nom" value={form.name} onChange={set("name")} required />
      <SelectField label="Protocole terrain" value={form.protocol} onChange={set("protocol")} options={Object.entries(PROTOCOL_LABEL).map(([value, label]) => ({ value, label }))} required />
      <TextField label="Adresse déclarée" value={form.endpoint} onChange={set("endpoint")} hint="Information : n'est jamais une preuve d'accessibilité." />
      <Toggle label="Passerelle de simulation (démo, recette) — définitif" checked={simulated} onChange={setSimulated} />
    </Form>
  );
}

function PointForm({
  gateways,
  assets,
  saving,
  onSubmit,
}: {
  gateways: Array<{ value: string; label: string }>;
  assets: Array<{ value: string; label: string }>;
  saving: boolean;
  onSubmit: (input: Record<string, unknown>) => Promise<void>;
}): React.ReactElement {
  const [form, setForm] = useState({ gatewayId: "", externalRef: "", name: "", kind: "ANALOG", unit: "", assetId: "", minPlausible: "", maxPlausible: "", writeTolerance: "" });
  const [writable, setWritable] = useState(false);
  const set = (key: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));
  return (
    <Form
      submitLabel="Créer le point"
      saving={saving}
      onSubmit={() => onSubmit({ ...Object.fromEntries(Object.entries(form).filter(([, value]) => value !== "")), writable, ...(writable ? {} : { writeTolerance: undefined }) })}
    >
      <SelectField label="Passerelle" value={form.gatewayId} onChange={set("gatewayId")} options={gateways} required wide />
      <TextField label="Référence côté passerelle" value={form.externalRef} onChange={set("externalRef")} required hint="Objet BACnet, registre Modbus, topic MQTT, adresse KNX…" />
      <TextField label="Nom" value={form.name} onChange={set("name")} required />
      <SelectField label="Type" value={form.kind} onChange={set("kind")} options={Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }))} required />
      <TextField label="Unité" value={form.unit} onChange={set("unit")} />
      <DecimalField label="Minimum plausible" value={form.minPlausible} onChange={set("minPlausible")} />
      <DecimalField label="Maximum plausible" value={form.maxPlausible} onChange={set("maxPlausible")} />
      <SelectField label="Actif (GMAO)" value={form.assetId} onChange={set("assetId")} options={assets} emptyLabel="— Aucun —" />
      <Toggle label="Point en écriture (consignes)" checked={writable} onChange={setWritable} />
      {writable && <DecimalField label="Tolérance de relecture" value={form.writeTolerance} onChange={set("writeTolerance")} hint="Écart admis pour confirmer une consigne." />}
    </Form>
  );
}
