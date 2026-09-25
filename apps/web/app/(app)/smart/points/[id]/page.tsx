"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { SmartPointDetailView } from "@axora24/contracts";
import { BellPlus, SlidersHorizontal, XCircle } from "lucide-react";
import {
  ALARM_STATUS_CHIP,
  ALARM_STATUS_LABEL,
  CONDITION_LABEL,
  KIND_LABEL,
  SETPOINT_STATUS_CHIP,
  SETPOINT_STATUS_LABEL,
  SEVERITY_CHIP,
  SEVERITY_LABEL,
  formatValue,
  smartApi,
} from "../../../../lib/modules/smart";
import { formatDateTime } from "../../../../lib/format";
import { useMutation, useResource } from "../../../../lib/hooks";
import { useSession } from "../../../../lib/session";
import { Button, DataTable, DecimalField, DetailList, Empty, Feedback, Form, Grid, Loading, Modal, PageHeader, Panel, SelectField, StatusChip, TextField } from "../../../../components/ui";
import { TrendChart } from "../../../../components/trend-chart";

const RANGES = [
  { hours: 1, label: "1 h" },
  { hours: 24, label: "24 h" },
  { hours: 24 * 7, label: "7 j" },
  { hours: 24 * 30, label: "30 j" },
];

type Dialog = "rule" | "setpoint";

export default function SmartPointPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const session = useSession();
  const mutation = useMutation();
  const [hours, setHours] = useState(24);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [override, setOverride] = useState<SmartPointDetailView | null>(null);
  const resource = useResource(() => smartApi.point(id), [id]);
  const trend = useResource(() => smartApi.trend(id, hours), [id, hours]);
  const point = override ?? resource.data;

  if (resource.loading && !point) return <Loading label="Chargement du point…" />;
  if (!point) return <Feedback error={resource.error || "Point introuvable."} />;
  const canManage = session.can("smart.building.manage");
  const canWrite = session.can("smart.setpoint.request") && point.writable;
  const pending = point.setpoints.find((setpoint) => ["REQUESTED", "DISPATCHED", "ACKNOWLEDGED"].includes(setpoint.status));

  async function apply(action: () => Promise<SmartPointDetailView>, success: string): Promise<void> {
    const updated = await mutation.run(action, success);
    if (updated) {
      setOverride(updated);
      setDialog(null);
    }
  }

  async function refresh(action: () => Promise<unknown>, success: string): Promise<void> {
    const result = await mutation.run(action, success);
    if (result !== undefined) {
      setDialog(null);
      setOverride(await smartApi.point(id));
    }
  }

  return (
    <>
      <PageHeader
        breadcrumb={`Smart Building / ${point.gatewayCode} / ${point.externalRef}`}
        title={point.name}
        subtitle={`${point.buildingCode} · passerelle ${point.gatewayCode} · ${point.externalRef} · ${KIND_LABEL[point.kind]}${point.writable ? " · écriture" : ""}`}
        onRefresh={() => {
          setOverride(null);
          void resource.reload();
          void trend.reload();
        }}
        actions={
          <>
            {point.simulated && <StatusChip status="warning" label="Données simulées" />}
            {canManage && (
              <Button onClick={() => setDialog("rule")}>
                <BellPlus size={15} aria-hidden="true" /> Règle d'alarme
              </Button>
            )}
            {canWrite && (
              <Button variant="primary" onClick={() => setDialog("setpoint")} disabled={Boolean(pending)} title={pending ? "Une consigne est déjà en cours sur ce point" : undefined}>
                <SlidersHorizontal size={15} aria-hidden="true" /> Consigne
              </Button>
            )}
          </>
        }
      />
      <Feedback error={mutation.error || trend.error} notice={mutation.notice} />
      <div className="stack">
        <Grid>
          <Panel title="Valeur courante">
            <div className="live-value">
              <strong>{formatValue(point.lastValue, point.unit, point.kind)}</strong>
              <small>{point.lastReadingAt ? `reçue le ${formatDateTime(point.lastReadingAt)}` : "aucune lecture reçue"}</small>
              {point.stale && <StatusChip status="overdue" label="Muet depuis plus d'1 h" />}
            </div>
            <DetailList
              items={[
                { label: "Plage plausible", value: point.minPlausible !== null || point.maxPlausible !== null ? `${point.minPlausible ?? "−∞"} … ${point.maxPlausible ?? "+∞"} ${point.unit ?? ""}` : "Non définie" },
                { label: "Actif (GMAO)", value: point.assetId ? <Link href={`/assets/${point.assetId}`}>{point.assetCode}</Link> : "—" },
                { label: "Passerelle", value: <Link href={`/smart/gateways/${point.gatewayId}`}>{point.gatewayCode}</Link> },
                ...(point.writable ? [{ label: "Tolérance de relecture", value: `± ${point.writeTolerance ?? "0"} ${point.unit ?? ""}` }] : []),
              ]}
            />
          </Panel>
          <Panel className="compact" title="Règles d'alarme" subtitle="Seuil immuable : pour le changer, désactivez la règle et créez-en une autre.">
            <DataTable
              rows={point.rules}
              empty={<Empty icon={<BellPlus size={22} />} title="Aucune règle" body="Aucune alarme ne peut se déclencher sur ce point." />}
              columns={[
                {
                  key: "rule",
                  header: "Règle",
                  render: (rule) => (
                    <>
                      <strong>{rule.message}</strong>
                      <small>
                        {CONDITION_LABEL[rule.condition]} {formatValue(rule.threshold, point.unit)}
                        {rule.active ? "" : " · inactive"}
                      </small>
                    </>
                  ),
                },
                { key: "severity", header: "Gravité", render: (rule) => <StatusChip status={SEVERITY_CHIP[rule.severity] ?? "warning"} label={SEVERITY_LABEL[rule.severity]} /> },
                {
                  key: "active",
                  header: "",
                  render: (rule) =>
                    canManage ? (
                      <Button variant="ghost" onClick={() => void apply(() => smartApi.setRuleActive(rule.id, !rule.active), rule.active ? "Règle désactivée." : "Règle réactivée.")}>
                        {rule.active ? "Désactiver" : "Réactiver"}
                      </Button>
                    ) : rule.active ? (
                      "Active"
                    ) : (
                      "Inactive"
                    ),
                },
              ]}
            />
          </Panel>
        </Grid>
        <Panel
          title="Tendance"
          subtitle={trend.data ? `${trend.data.bucket === "hour" ? "Moyenne horaire avec enveloppe min/max" : "Lectures brutes"}${trend.data.badReadings > 0 ? ` · ${trend.data.badReadings} lecture(s) hors plage exclue(s)` : ""}` : undefined}
          actions={
            <div className="range-switch" role="group" aria-label="Période">
              {RANGES.map((range) => (
                <button key={range.hours} type="button" aria-pressed={hours === range.hours} onClick={() => setHours(range.hours)}>
                  {range.label}
                </button>
              ))}
            </div>
          }
        >
          {trend.data ? (
            <TrendChart
              series={trend.data.series}
              unit={point.unit}
              from={trend.data.from}
              to={trend.data.to}
              ariaLabel={`Tendance ${point.name}`}
              thresholds={point.rules.filter((rule) => rule.active && rule.condition !== "EQUALS").map((rule) => ({ value: rule.threshold, label: rule.message, tone: rule.severity === "CRITICAL" ? "red" : "amber" }))}
            />
          ) : (
            <Loading label="Calcul de la tendance…" />
          )}
        </Panel>
        {point.writable && (
          <Panel title="Consignes" subtitle="Demandée → transmise → acquittée par la passerelle → confirmée uniquement par relecture du point.">
            <DataTable
              rows={point.setpoints}
              empty={<Empty icon={<SlidersHorizontal size={22} />} title="Aucune consigne" body="Chaque consigne est motivée et tracée." />}
              columns={[
                {
                  key: "value",
                  header: "Consigne",
                  render: (setpoint) => (
                    <>
                      <strong>{formatValue(setpoint.requestedValue, setpoint.unit)}</strong>
                      <small>
                        {setpoint.reason} · {setpoint.requestedByName} · {formatDateTime(setpoint.requestedAt)}
                      </small>
                    </>
                  ),
                },
                { key: "status", header: "État", render: (setpoint) => <StatusChip status={SETPOINT_STATUS_CHIP[setpoint.status] ?? "pending"} label={SETPOINT_STATUS_LABEL[setpoint.status]} /> },
                {
                  key: "readback",
                  header: "Relecture",
                  render: (setpoint) => (setpoint.confirmValue ? `${formatValue(setpoint.confirmValue, setpoint.unit)} à ${formatDateTime(setpoint.confirmReadingAt)}` : setpoint.gatewayNote ?? "—"),
                },
                {
                  key: "cancel",
                  header: "",
                  render: (setpoint) =>
                    canWrite && ["REQUESTED", "DISPATCHED", "ACKNOWLEDGED"].includes(setpoint.status) ? (
                      <Button variant="ghost" onClick={() => void refresh(() => smartApi.cancelSetpoint(setpoint.id), "Consigne annulée.")}>
                        <XCircle size={14} aria-hidden="true" /> Annuler
                      </Button>
                    ) : null,
                },
              ]}
            />
          </Panel>
        )}
        <Panel title="Historique des alarmes">
          <DataTable
            rows={point.alarms}
            empty={<Empty icon={<BellPlus size={22} />} title="Aucune alarme" body="Aucun seuil n'a été franchi." />}
            columns={[
              { key: "message", header: "Alarme", render: (alarm) => <strong>{alarm.message}</strong> },
              { key: "trigger", header: "Déclenchée", render: (alarm) => `${formatValue(alarm.triggerValue, alarm.unit)} (${CONDITION_LABEL[alarm.condition]} ${alarm.threshold}) · ${formatDateTime(alarm.triggerReadingAt)}` },
              { key: "status", header: "État", render: (alarm) => <StatusChip status={ALARM_STATUS_CHIP[alarm.status] ?? "warning"} label={ALARM_STATUS_LABEL[alarm.status]} /> },
              {
                key: "end",
                header: "Suivi",
                render: (alarm) =>
                  alarm.clearedAt ? `Normale ${formatValue(alarm.clearValue, alarm.unit)} · ${formatDateTime(alarm.clearedAt)}` : alarm.acknowledgedByName ? `${alarm.acknowledgedByName} : ${alarm.acknowledgeNote ?? ""}` : "—",
              },
            ]}
          />
        </Panel>
        <Panel title="Dernières lectures reçues">
          <DataTable
            rows={point.recent.map((reading) => ({ ...reading, id: reading.ts }))}
            empty={<Empty icon={<SlidersHorizontal size={22} />} title="Aucune lecture" body="Les lectures arrivent par l'API de la passerelle." />}
            columns={[
              { key: "ts", header: "Horodatage", render: (reading) => formatDateTime(reading.ts) },
              { key: "value", header: "Valeur", align: "right", render: (reading) => formatValue(reading.value, point.unit, point.kind) },
              { key: "quality", header: "Qualité", render: (reading) => <StatusChip status={reading.quality === "GOOD" ? "passed" : reading.quality === "BAD" ? "failed" : "warning"} label={reading.quality === "GOOD" ? "Bonne" : reading.quality === "BAD" ? "Hors plage / invalide" : "Incertaine"} /> },
            ]}
          />
        </Panel>
      </div>

      {dialog === "rule" && (
        <Modal title="Nouvelle règle d'alarme" onClose={() => setDialog(null)}>
          <Feedback error={mutation.error} />
          <RuleForm kind={point.kind} saving={mutation.saving} onSubmit={(input) => apply(() => smartApi.createRule({ pointId: id, ...input }), "Règle créée.")} />
        </Modal>
      )}
      {dialog === "setpoint" && (
        <Modal title={`Consigne — ${point.name}`} onClose={() => setDialog(null)}>
          <Feedback error={mutation.error} />
          <SetpointForm unit={point.unit} saving={mutation.saving} onSubmit={(value, reason) => refresh(() => smartApi.requestSetpoint({ pointId: id, value, reason }), "Consigne demandée : en attente de la passerelle.")} />
        </Modal>
      )}
    </>
  );
}

function RuleForm({ kind, saving, onSubmit }: { kind: string; saving: boolean; onSubmit: (input: Record<string, unknown>) => Promise<void> }): React.ReactElement {
  const [form, setForm] = useState({ condition: kind === "ANALOG" ? "ABOVE" : "EQUALS", threshold: "", severity: "WARNING", message: "" });
  const set = (key: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));
  const conditions = kind === "ANALOG" ? Object.entries(CONDITION_LABEL) : [["EQUALS", CONDITION_LABEL.EQUALS!] as [string, string]];
  return (
    <Form submitLabel="Créer la règle" saving={saving} onSubmit={() => onSubmit(form)}>
      <SelectField label="Condition" value={form.condition} onChange={set("condition")} options={conditions.map(([value, label]) => ({ value, label }))} required />
      <DecimalField label="Seuil" value={form.threshold} onChange={set("threshold")} required />
      <SelectField label="Gravité" value={form.severity} onChange={set("severity")} options={Object.entries(SEVERITY_LABEL).map(([value, label]) => ({ value, label }))} required />
      <TextField label="Message d'alarme" value={form.message} onChange={set("message")} required wide />
    </Form>
  );
}

function SetpointForm({ unit, saving, onSubmit }: { unit: string | null; saving: boolean; onSubmit: (value: string, reason: string) => Promise<void> }): React.ReactElement {
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  return (
    <Form columns={1} submitLabel="Demander la consigne" saving={saving} onSubmit={() => onSubmit(value, reason)}>
      <DecimalField label={`Valeur${unit ? ` (${unit})` : ""}`} value={value} onChange={setValue} required />
      <TextField label="Motif" value={reason} onChange={setReason} required />
    </Form>
  );
}
