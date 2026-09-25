"use client";

import React, { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import type { SmartGatewayTokenView, SmartGatewayView } from "@axora24/contracts";
import { FlaskConical, KeyRound, Power, Unplug } from "lucide-react";
import { KIND_LABEL, LEVEL_STATE_CHIP, LEVEL_STATE_LABEL, PROTOCOL_LABEL, formatValue, smartApi } from "../../../../lib/modules/smart";
import { formatDateTime } from "../../../../lib/format";
import { useMutation, useResource } from "../../../../lib/hooks";
import { useSession } from "../../../../lib/session";
import { ActionBar, Button, DataTable, DecimalField, DetailList, Empty, Feedback, Form, Grid, Loading, Modal, PageHeader, Panel, SelectField, StatusChip, TextAreaField, Toggle } from "../../../../components/ui";
import { TokenReveal } from "../../../../components/token-reveal";

type Dialog = "read" | "write";

export default function GatewayPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const session = useSession();
  const mutation = useMutation();
  const resource = useResource(() => Promise.all([smartApi.gateway(id), smartApi.points(id), smartApi.setpoints()]), [id]);
  const [override, setOverride] = useState<SmartGatewayView | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [issued, setIssued] = useState<SmartGatewayTokenView | null>(null);
  const [loaded, points, setpoints] = resource.data ?? [null, [], []];
  const gateway = override ?? loaded;

  if (resource.loading && !gateway) return <Loading label="Chargement de la passerelle…" />;
  if (!gateway) return <Feedback error={resource.error || "Passerelle introuvable."} />;
  const canManage = session.can("smart.building.manage");
  const canTest = session.can("smart.gateway.test") && !gateway.simulated;
  const confirmed = setpoints.filter((setpoint) => setpoint.status === "CONFIRMED" && points.some((point) => point.id === setpoint.pointId));

  async function apply(action: () => Promise<SmartGatewayView>, success: string): Promise<void> {
    const updated = await mutation.run(action, success);
    if (updated) {
      setOverride(updated);
      setDialog(null);
    }
  }

  const sample = `curl -X POST ${typeof window === "undefined" ? "" : window.location.origin.replace(":3100", ":4000")}/api/v1/smart/gateway/readings \\
  -H "Authorization: Bearer ${gateway.tokenPrefix}…" -H "Content-Type: application/json" \\
  -d '{"readings":[{"ref":"${points[0]?.externalRef ?? "analog-input:1"}","ts":"2026-09-25T08:00:00Z","value":"21.4"}]}'`;

  return (
    <>
      <PageHeader
        breadcrumb={`Smart Building / ${gateway.code}`}
        title={gateway.name}
        subtitle={`${gateway.code} · ${gateway.buildingCode} · ${PROTOCOL_LABEL[gateway.protocol]}${gateway.endpoint ? ` · ${gateway.endpoint}` : ""}`}
        onRefresh={() => {
          setOverride(null);
          void resource.reload();
        }}
        actions={
          <>
            {gateway.simulated && <StatusChip status="warning" label="Simulateur" />}
            <StatusChip status={gateway.active ? "active" : "archived"} label={gateway.active ? "Active" : "Désactivée"} />
          </>
        }
      />
      <Feedback error={mutation.error} notice={mutation.notice} />
      {(canManage || canTest) && (
        <ActionBar note={gateway.simulated ? "Passerelle de simulation : aucun essai réel ne peut y être attesté." : "Les essais réels se font sur site, point à point, avec un instrument de référence."}>
          {canTest && (
            <>
              <Button onClick={() => setDialog("read")} disabled={points.length === 0}>
                <FlaskConical size={15} aria-hidden="true" /> Attester un essai de lecture
              </Button>
              <Button onClick={() => setDialog("write")} disabled={confirmed.length === 0} title={confirmed.length === 0 ? "Aucune consigne confirmée par relecture" : undefined}>
                <FlaskConical size={15} aria-hidden="true" /> Attester un essai d'écriture
              </Button>
            </>
          )}
          {canManage && (
            <>
              <Button
                onClick={async () => {
                  const rotated = await mutation.run(() => smartApi.rotateToken(id), "Nouveau jeton émis : l'ancien est révoqué.");
                  if (rotated) {
                    setOverride(rotated.gateway);
                    setIssued(rotated);
                  }
                }}
              >
                <KeyRound size={15} aria-hidden="true" /> Renouveler le jeton
              </Button>
              <Button variant={gateway.active ? "danger" : "secondary"} onClick={() => void apply(() => smartApi.updateGateway(id, { active: !gateway.active }), gateway.active ? "Passerelle désactivée." : "Passerelle réactivée.")}>
                <Power size={15} aria-hidden="true" /> {gateway.active ? "Désactiver" : "Réactiver"}
              </Button>
            </>
          )}
        </ActionBar>
      )}
      <div className="stack">
        <Grid>
          <Panel title="Connectivité — cinq niveaux distincts" subtitle="Aucun niveau n'est déduit d'un autre ; un flux de données n'est pas une preuve physique.">
            <ul className="connector-states">
              {gateway.levels.map((level) => (
                <li key={level.key} className={level.state === "SIMULATED" ? "simulated" : ""}>
                  <span>
                    <Unplug size={13} aria-hidden="true" /> {level.label}
                  </span>
                  <StatusChip status={LEVEL_STATE_CHIP[level.state] ?? "not_tested"} label={LEVEL_STATE_LABEL[level.state]} />
                  <small>
                    {level.detail}
                    {level.evidenceAt ? ` — ${formatDateTime(level.evidenceAt)}` : ""}
                  </small>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="Intégration">
            <DetailList
              items={[
                { label: "Jeton", value: `${gateway.tokenPrefix}… (empreinte seule conservée)` },
                { label: "Dernier contact", value: gateway.lastSeenAt ? formatDateTime(gateway.lastSeenAt) : "Jamais" },
                { label: "Points", value: String(gateway.points) },
                { label: "Lectures 24 h", value: String(gateway.readings24h) },
              ]}
            />
            <pre className="code-sample">{sample}</pre>
          </Panel>
        </Grid>
        <Panel title="Points">
          <DataTable
            rows={points}
            onRowClick={(point) => router.push(`/smart/points/${point.id}`)}
            empty={<Empty icon={<Unplug size={22} />} title="Aucun point" body="Déclarez les points de cette passerelle depuis la vue Smart Building." />}
            columns={[
              {
                key: "point",
                header: "Point",
                render: (point) => (
                  <>
                    <strong>{point.name}</strong>
                    <small>{point.externalRef}</small>
                  </>
                ),
              },
              { key: "kind", header: "Type", render: (point) => `${KIND_LABEL[point.kind]}${point.writable ? " · écriture" : ""}` },
              { key: "value", header: "Dernière valeur", align: "right", render: (point) => formatValue(point.lastValue, point.unit, point.kind) },
              { key: "at", header: "Reçue", render: (point) => (point.stale ? <StatusChip status="overdue" label={point.lastReadingAt ? formatDateTime(point.lastReadingAt) : "Jamais"} /> : formatDateTime(point.lastReadingAt)) },
            ]}
          />
        </Panel>
        <Panel title="Essais réels attestés" subtitle="Append-only : un essai échoué reste dans l'historique.">
          <DataTable
            rows={gateway.tests ?? []}
            empty={<Empty icon={<FlaskConical size={22} />} title="Aucun essai attesté" body={gateway.simulated ? "Impossible sur un simulateur." : "Lecture et écriture restent « non testées » tant qu'aucun essai n'est attesté."} />}
            columns={[
              {
                key: "test",
                header: "Essai",
                render: (test) => (
                  <>
                    <strong>
                      {test.kind === "READ" ? "Lecture" : "Écriture"} — {test.pointName}
                    </strong>
                    <small>{test.evidence}</small>
                  </>
                ),
              },
              {
                key: "values",
                header: "Valeurs",
                render: (test) =>
                  test.kind === "READ" ? `Relevé ${test.observedValue} / référence ${test.referenceValue} ± ${test.tolerance}` : `Relecture ${test.observedValue} (${formatDateTime(test.observedAt)})`,
              },
              { key: "outcome", header: "Verdict", render: (test) => <StatusChip status={test.outcome === "PASS" ? "passed" : "failed"} label={test.outcome === "PASS" ? "Réussi" : "Échoué"} /> },
              { key: "by", header: "Attesté par", render: (test) => `${test.performedByName} · ${formatDateTime(test.performedAt)}` },
            ]}
          />
        </Panel>
      </div>

      {dialog === "read" && (
        <Modal title="Essai de lecture point à point" onClose={() => setDialog(null)}>
          <Feedback error={mutation.error} />
          <ReadTestForm
            points={points.map((point) => ({ value: point.id, label: `${point.name} — dernière valeur ${formatValue(point.lastValue, point.unit, point.kind)}` }))}
            saving={mutation.saving}
            onSubmit={(input) => apply(() => smartApi.attest(id, { kind: "READ", ...input }), "Essai de lecture enregistré (verdict calculé par le serveur).")}
          />
        </Modal>
      )}
      {dialog === "write" && (
        <Modal title="Essai d'écriture" onClose={() => setDialog(null)}>
          <Feedback error={mutation.error} />
          <WriteTestForm
            setpoints={confirmed.map((setpoint) => ({ value: setpoint.id, label: `${setpoint.pointName} → ${formatValue(setpoint.requestedValue, setpoint.unit)} (relu ${formatValue(setpoint.confirmValue, setpoint.unit)})` }))}
            saving={mutation.saving}
            onSubmit={(input) => apply(() => smartApi.attest(id, { kind: "WRITE", ...input }), "Essai d'écriture enregistré.")}
          />
        </Modal>
      )}
      {issued && <TokenReveal issued={issued} onClose={() => setIssued(null)} />}
    </>
  );
}

function ReadTestForm({ points, saving, onSubmit }: { points: Array<{ value: string; label: string }>; saving: boolean; onSubmit: (input: Record<string, unknown>) => Promise<void> }): React.ReactElement {
  const [form, setForm] = useState({ pointId: "", referenceValue: "", tolerance: "", evidence: "" });
  const set = (key: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));
  return (
    <Form submitLabel="Enregistrer l'essai" saving={saving} onSubmit={() => onSubmit(form)}>
      <SelectField label="Point" value={form.pointId} onChange={set("pointId")} options={points} required wide hint="La dernière lecture reçue (moins de 15 min) est comparée à votre mesure." />
      <DecimalField label="Valeur de référence mesurée" value={form.referenceValue} onChange={set("referenceValue")} required />
      <DecimalField label="Tolérance admise" value={form.tolerance} onChange={set("tolerance")} required />
      <TextAreaField label="Preuve (instrument, certificat, conditions)" value={form.evidence} onChange={set("evidence")} required wide />
    </Form>
  );
}

function WriteTestForm({ setpoints, saving, onSubmit }: { setpoints: Array<{ value: string; label: string }>; saving: boolean; onSubmit: (input: Record<string, unknown>) => Promise<void> }): React.ReactElement {
  const [setpointId, setSetpoint] = useState("");
  const [observed, setObserved] = useState(true);
  const [evidence, setEvidence] = useState("");
  return (
    <Form columns={1} submitLabel="Enregistrer l'essai" saving={saving} onSubmit={() => onSubmit({ setpointId, physicallyObserved: observed, evidence })}>
      <SelectField label="Consigne confirmée par relecture" value={setpointId} onChange={setSetpoint} options={setpoints} required />
      <Toggle label="Effet constaté physiquement sur l'équipement" checked={observed} onChange={setObserved} />
      <TextAreaField label="Preuve (constat sur site)" value={evidence} onChange={setEvidence} required />
    </Form>
  );
}
