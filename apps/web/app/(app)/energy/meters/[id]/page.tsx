"use client";

import React, { useState } from "react";
import { useParams } from "next/navigation";
import type { EnergyIngestResult, EnergyMeterDetailView } from "@axora24/contracts";
import { BellPlus, Coins, Upload } from "lucide-react";
import { METER_KIND_LABEL, energyApi, parseIntervalLines } from "../../../../lib/modules/energy";
import { formatDate, formatDateTime, formatQuantity, todayIso } from "../../../../lib/format";
import { useMutation, useResource } from "../../../../lib/hooks";
import { useSession } from "../../../../lib/session";
import { StackedBars } from "../../../../components/bar-chart";
import { ActionBar, Button, DataTable, DateField, DecimalField, DetailList, Empty, Feedback, Form, Grid, Loading, Modal, PageHeader, Panel, SelectField, StatusChip, TextAreaField, TextField } from "../../../../components/ui";

type Dialog = "tariff" | "rule" | "import";

export default function EnergyMeterPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const session = useSession();
  const mutation = useMutation();
  const resource = useResource(() => energyApi.meter(id), [id]);
  const [override, setOverride] = useState<EnergyMeterDetailView | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [report, setReport] = useState<EnergyIngestResult | null>(null);
  const meter = override ?? resource.data;

  if (resource.loading && !meter) return <Loading label="Chargement du compteur…" />;
  if (!meter) return <Feedback error={resource.error || "Compteur introuvable."} />;
  const canManage = session.can("energy.meter.manage");

  async function apply(action: () => Promise<EnergyMeterDetailView>, success: string): Promise<void> {
    const updated = await mutation.run(action, success);
    if (updated) {
      setOverride(updated);
      setDialog(null);
    }
  }

  return (
    <>
      <PageHeader
        breadcrumb={`Énergie / ${meter.buildingCode} / ${meter.code}`}
        title={meter.name}
        subtitle={`${meter.code} · ${METER_KIND_LABEL[meter.kind]} · pas ${meter.intervalMinutes} min · ${meter.gatewayCode ? `passerelle ${meter.gatewayCode} (${meter.externalRef})` : "alimenté par import de relevés"}`}
        onRefresh={() => {
          setOverride(null);
          void resource.reload();
        }}
        actions={meter.simulated ? <StatusChip status="warning" label="Passerelle de simulation" /> : undefined}
      />
      <Feedback error={mutation.error} notice={mutation.notice} />
      {(canManage || session.can("energy.interval.import")) && (
        <ActionBar note="Relevés append-only : un rejeu identique est ignoré, une valeur contradictoire est refusée et signalée.">
          {session.can("energy.interval.import") && (
            <Button variant="primary" onClick={() => setDialog("import")}>
              <Upload size={15} aria-hidden="true" /> Importer des relevés
            </Button>
          )}
          {canManage && (
            <>
              <Button onClick={() => setDialog("tariff")}>
                <Coins size={15} aria-hidden="true" /> Nouveau tarif
              </Button>
              <Button onClick={() => setDialog("rule")}>
                <BellPlus size={15} aria-hidden="true" /> Règle d'alerte
              </Button>
            </>
          )}
        </ActionBar>
      )}
      {report && (
        <Panel title="Résultat du dernier import">
          <DetailList
            items={[
              { label: "Acceptés", value: String(report.accepted) },
              { label: "Doublons ignorés", value: String(report.duplicates) },
              { label: "Conflits refusés", value: report.conflicts.length ? report.conflicts.slice(0, 5).map((conflict) => `${formatDateTime(conflict.periodStart)} : ${conflict.value} ≠ ${conflict.existing}`).join(" · ") : "0" },
              { label: "Rejetés", value: report.rejected.length ? report.rejected.slice(0, 5).map((row) => `#${row.index + 1} ${row.reason}`).join(" · ") : "0" },
              { label: "Alertes levées", value: String(report.alertsRaised) },
            ]}
          />
        </Panel>
      )}
      <div className="stack">
        <Grid>
          <Panel title="Compteur">
            <DetailList
              items={[
                { label: "Unité", value: meter.unit },
                { label: "Couverture 24 h", value: <StatusChip status={Number(meter.coverage24h) >= 90 ? "passed" : "warning"} label={`${meter.coverage24h.replace(".", ",")} %`} /> },
                { label: "Dernier intervalle", value: meter.lastPeriodStart ? formatDateTime(meter.lastPeriodStart) : "Jamais" },
                { label: "Actif GMAO", value: meter.assetCode ?? "—" },
                { label: "Tarif actuel", value: meter.currentTariff ? `${meter.currentTariff.replace(".", ",")} / ${meter.unit}` : "Aucun" },
              ]}
            />
          </Panel>
          <Panel title="Tarifs (historisés)" subtitle="Un nouveau tarif prend effet à sa date ; les coûts passés restent calculés au tarif de leur jour.">
            <DataTable
              rows={[...meter.tariffs].reverse()}
              empty={<Empty icon={<Coins size={22} />} title="Aucun tarif" body="Sans tarif, le coût n'est pas calculé (jamais supposé)." />}
              columns={[
                { key: "from", header: "À partir du", render: (tariff) => formatDate(tariff.validFrom) },
                { key: "price", header: "Prix unitaire", align: "right", render: (tariff) => `${tariff.unitPrice.replace(".", ",")} / ${meter.unit}` },
                { key: "note", header: "Référence", render: (tariff) => tariff.note ?? "—" },
              ]}
            />
          </Panel>
        </Grid>
        <Panel title="30 derniers jours" subtitle="Total journalier (UTC) ; un jour incomplet est signalé dans le tableau.">
          <StackedBars
            ariaLabel={`Relevés journaliers ${meter.code}`}
            unit={meter.unit}
            rows={meter.daily.map((row) => ({ label: row.day.slice(5).split("-").reverse().join("/"), values: { value: row.value } }))}
            series={[{ key: "value", label: METER_KIND_LABEL[meter.kind]!, color: meter.kind === "PV_PRODUCTION" ? "#f5b100" : meter.kind === "GENSET_FUEL" || meter.kind === "GENSET_PRODUCTION" ? "#7a5af8" : "#1849a9" }]}
          />
          <DataTable
            rows={[...meter.daily].reverse().map((row) => ({ ...row, id: row.day }))}
            empty={<Empty icon={<Upload size={22} />} title="Aucun relevé" body="Importez des relevés ou raccordez une passerelle." />}
            columns={[
              { key: "day", header: "Jour", render: (row) => formatDate(row.day) },
              { key: "value", header: "Total", align: "right", render: (row) => `${formatQuantity(row.value, 2)} ${meter.unit}` },
              { key: "coverage", header: "Intervalles", align: "right", render: (row) => (row.intervals === row.expected ? `${row.intervals} / ${row.expected}` : <StatusChip status="warning" label={`${row.intervals} / ${row.expected} — incomplet`} />) },
            ]}
          />
        </Panel>
        <Grid>
          <Panel className="compact" title="Règles d'alerte">
            <DataTable
              rows={meter.rules}
              empty={<Empty icon={<BellPlus size={22} />} title="Aucune règle" body="Pic d'intervalle ou dépassement journalier." />}
              columns={[
                {
                  key: "rule",
                  header: "Règle",
                  render: (rule) => (
                    <>
                      <strong>{rule.message}</strong>
                      <small>
                        {rule.kind === "INTERVAL_ABOVE" ? "Intervalle" : "Jour complet"} &gt; {rule.threshold.replace(".", ",")} {meter.unit}
                        {rule.active ? "" : " · inactive"}
                      </small>
                    </>
                  ),
                },
                {
                  key: "toggle",
                  header: "",
                  render: (rule) =>
                    canManage ? (
                      <Button variant="ghost" onClick={() => void apply(() => energyApi.setRuleActive(rule.id, !rule.active), rule.active ? "Règle désactivée." : "Règle réactivée.")}>
                        {rule.active ? "Désactiver" : "Réactiver"}
                      </Button>
                    ) : null,
                },
              ]}
            />
          </Panel>
          <Panel className="compact" title="Derniers intervalles reçus">
            <DataTable
              rows={meter.recent.map((row) => ({ ...row, id: row.periodStart }))}
              empty={<Empty icon={<Upload size={22} />} title="Aucun intervalle" body="—" />}
              columns={[
                { key: "start", header: "Début", render: (row) => formatDateTime(row.periodStart) },
                { key: "value", header: "Valeur", align: "right", render: (row) => `${row.value.replace(".", ",")} ${meter.unit}` },
                { key: "source", header: "Source", render: (row) => (row.simulated ? <StatusChip status="warning" label="Simulé" /> : row.source === "GATEWAY" ? "Passerelle" : "Import") },
              ]}
            />
          </Panel>
        </Grid>
      </div>

      {dialog === "tariff" && (
        <Modal title="Nouveau tarif" onClose={() => setDialog(null)}>
          <Feedback error={mutation.error} />
          <TariffForm unit={meter.unit} saving={mutation.saving} onSubmit={(input) => apply(() => energyApi.addTariff(id, input), "Tarif enregistré.")} />
        </Modal>
      )}
      {dialog === "rule" && (
        <Modal title="Nouvelle règle d'alerte" onClose={() => setDialog(null)}>
          <Feedback error={mutation.error} />
          <RuleForm unit={meter.unit} saving={mutation.saving} onSubmit={(input) => apply(() => energyApi.addRule(id, input), "Règle créée.")} />
        </Modal>
      )}
      {dialog === "import" && (
        <Modal title="Importer des relevés" onClose={() => setDialog(null)}>
          <Feedback error={mutation.error} />
          <ImportForm
            intervalMinutes={meter.intervalMinutes}
            saving={mutation.saving}
            onSubmit={async (intervals) => {
              const result = await mutation.run(() => energyApi.importIntervals(id, intervals), "Import traité.");
              if (result) {
                setReport(result);
                setDialog(null);
                setOverride(await energyApi.meter(id));
              }
            }}
          />
        </Modal>
      )}
    </>
  );
}

function TariffForm({ unit, saving, onSubmit }: { unit: string; saving: boolean; onSubmit: (input: Record<string, unknown>) => Promise<void> }): React.ReactElement {
  const [validFrom, setValidFrom] = useState(todayIso());
  const [unitPrice, setUnitPrice] = useState("");
  const [note, setNote] = useState("");
  return (
    <Form submitLabel="Enregistrer" saving={saving} onSubmit={() => onSubmit({ validFrom, unitPrice, note: note || undefined })}>
      <DateField label="À partir du" value={validFrom} onChange={setValidFrom} required />
      <DecimalField label={`Prix par ${unit}`} value={unitPrice} onChange={setUnitPrice} required />
      <TextField label="Référence (contrat, facture)" value={note} onChange={setNote} wide />
    </Form>
  );
}

function RuleForm({ unit, saving, onSubmit }: { unit: string; saving: boolean; onSubmit: (input: Record<string, unknown>) => Promise<void> }): React.ReactElement {
  const [form, setForm] = useState({ kind: "DAILY_ABOVE", threshold: "", message: "" });
  const set = (key: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));
  return (
    <Form submitLabel="Créer" saving={saving} onSubmit={() => onSubmit(form)}>
      <SelectField label="Type" value={form.kind} onChange={set("kind")} options={[{ value: "DAILY_ABOVE", label: "Total journalier au-dessus de" }, { value: "INTERVAL_ABOVE", label: "Intervalle au-dessus de" }]} required />
      <DecimalField label={`Seuil (${unit})`} value={form.threshold} onChange={set("threshold")} required />
      <TextField label="Message" value={form.message} onChange={set("message")} required wide />
    </Form>
  );
}

function ImportForm({ intervalMinutes, saving, onSubmit }: { intervalMinutes: number; saving: boolean; onSubmit: (intervals: Array<{ start: string; value: string }>) => Promise<void> }): React.ReactElement {
  const [text, setText] = useState("");
  const parsed = parseIntervalLines(text);
  return (
    <Form columns={1} submitLabel={`Importer ${parsed.intervals.length} relevé(s)`} saving={saving} onSubmit={() => onSubmit(parsed.intervals)}>
      <TextAreaField
        label="Relevés (une ligne « début;valeur »)"
        value={text}
        onChange={setText}
        rows={8}
        required
        hint={`Début d'intervalle ISO-8601 aligné sur ${intervalMinutes} min, valeur décimale. Exemple : 2026-09-24T00:00:00Z;12.5`}
      />
      {parsed.errors.length > 0 && <p className="form-error">{parsed.errors.slice(0, 5).join(" · ")}</p>}
    </Form>
  );
}
