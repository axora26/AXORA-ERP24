"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import type { AssetView } from "@axora24/contracts";
import { Ban, FileText, Wrench } from "lucide-react";
import {
  ASSET_STATUS_CHIP,
  ASSET_STATUS_LABEL,
  CRITICALITY_CHIP,
  CRITICALITY_LABEL,
  ORIGIN_LABEL,
  PRIORITY_CHIP,
  PRIORITY_LABEL,
  WO_STATUS_LABEL,
  WO_TYPE_LABEL,
  assetsApi,
  formatAvailability,
  formatHours,
} from "../../../lib/modules/assets";
import { formatDate, formatMoney } from "../../../lib/format";
import { useMutation, useResource } from "../../../lib/hooks";
import { useSession } from "../../../lib/session";
import { Button, DataTable, DetailList, Empty, Feedback, Grid, Loading, PageHeader, Panel, StatusChip } from "../../../components/ui";

export default function AssetPassportPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const session = useSession();
  const resource = useResource(() => assetsApi.get(id), [id]);
  const mutation = useMutation();
  const [override, setOverride] = useState<AssetView | null>(null);
  const asset = override ?? resource.data;

  if (resource.loading && !asset) return <Loading label="Chargement du passeport…" />;
  if (!asset) return <Feedback error={resource.error || "Actif introuvable."} />;
  const canManage = session.can("assets.asset.manage") && asset.status !== "RETIRED";
  const reliability = asset.reliability;

  async function setStatus(status: "IN_SERVICE" | "OUT_OF_SERVICE" | "RETIRED", success: string): Promise<void> {
    const updated = await mutation.run(() => assetsApi.update(id, { status }), success);
    if (updated) setOverride(updated);
  }

  return (
    <>
      <PageHeader
        breadcrumb={`Actifs & GMAO / ${asset.code}`}
        title={asset.name}
        subtitle={`${asset.code}${asset.equipmentTag ? ` · repère ${asset.equipmentTag}` : ""} · ${asset.location}`}
        onRefresh={() => {
          setOverride(null);
          void resource.reload();
        }}
        actions={
          <>
            <StatusChip status={ASSET_STATUS_CHIP[asset.status] ?? "planned"} label={ASSET_STATUS_LABEL[asset.status]} />
            {canManage && (
              <Button variant="ghost" onClick={() => void setStatus("RETIRED", "Actif réformé.")} disabled={asset.openWorkOrders > 0} title={asset.openWorkOrders > 0 ? "Des OT sont encore ouverts" : undefined}>
                <Ban size={15} aria-hidden="true" /> Réformer
              </Button>
            )}
          </>
        }
      />
      <Feedback error={mutation.error} notice={mutation.notice} />
      <div className="stack">
        <Grid>
          <Panel title="Passeport">
            <DetailList
              items={[
                {
                  label: "Origine",
                  value: asset.commissioningActivityId ? (
                    <Link href={`/commissioning/${asset.commissioningActivityId}`}>
                      {ORIGIN_LABEL[asset.origin]} {asset.commissioningCode}
                    </Link>
                  ) : (
                    <>
                      {ORIGIN_LABEL[asset.origin]}
                      <small>{asset.originJustification}</small>
                    </>
                  ),
                },
                { label: "Projet", value: asset.projectId ? <Link href={`/projects/${asset.projectId}`}>{asset.projectCode}</Link> : "Hors projet" },
                { label: "Équipement MEP", value: asset.equipmentId ? <Link href={`/mep/equipment/${asset.equipmentId}`}>{asset.equipmentTag}</Link> : "—" },
                { label: "Fabricant / modèle", value: [asset.manufacturer, asset.model].filter(Boolean).join(" · ") || "—" },
                { label: "N° de série", value: asset.serialNumber ?? "—" },
                { label: "En service depuis", value: formatDate(asset.installedAt) },
                { label: "Garantie", value: asset.warrantyEndsAt ? `${asset.underWarranty ? "Sous garantie" : "Échue"} — ${formatDate(asset.warrantyEndsAt)}` : "Non renseignée" },
                { label: "Criticité", value: <StatusChip status={CRITICALITY_CHIP[asset.criticality] ?? "low"} label={CRITICALITY_LABEL[asset.criticality]} /> },
                { label: "Coût de maintenance cumulé", value: formatMoney(asset.maintenanceCost, asset.currency) },
              ]}
            />
          </Panel>
          <Panel title="Fiabilité" subtitle="Calculée sur les OT correctifs clôturés (panne → remise en service), jamais estimée.">
            <dl className="reliability-grid">
              <div>
                <dt>Pannes</dt>
                <dd>{reliability.failures}</dd>
              </div>
              <div>
                <dt>MTBF</dt>
                <dd>{formatHours(reliability.mtbfHours)}</dd>
              </div>
              <div>
                <dt>MTTR</dt>
                <dd>{formatHours(reliability.mttrHours)}</dd>
              </div>
              <div>
                <dt>Disponibilité</dt>
                <dd>{formatAvailability(reliability.availabilityPercent)}</dd>
              </div>
            </dl>
            <p className="formula-note">
              Période observée {formatHours(reliability.periodHours)} · arrêt cumulé {formatHours(reliability.downtimeHours)}
              {"\n"}
              {reliability.formula}
            </p>
          </Panel>
        </Grid>

        <Panel title="Documents de remise (DOE)">
          {asset.documents && asset.documents.length > 0 ? (
            <ul className="evidence-list">
              {asset.documents.map((document) => (
                <li key={document.id}>
                  <FileText size={15} aria-hidden="true" /> <Link href={`/documents/${document.id}`}>{document.code}</Link> — {document.title}
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon={<FileText size={22} />} title="Aucun document de remise" body={asset.commissioningActivityId ? "La mise en service n'a pas encore été remise au client avec son DOE." : "Actif repris d'un existant."} />
          )}
        </Panel>

        <Panel title="Plans préventifs">
          <DataTable
            rows={asset.plans ?? []}
            empty={<Empty icon={<Wrench size={22} />} title="Aucun plan préventif" body="Créez un plan depuis l'onglet Préventif." />}
            columns={[
              { key: "title", header: "Plan", render: (plan) => <strong>{plan.title}</strong> },
              { key: "interval", header: "Périodicité", render: (plan) => `Tous les ${plan.intervalDays} j` },
              { key: "next", header: "Prochaine échéance", render: (plan) => (plan.due ? <StatusChip status="overdue" label={`Échu · ${formatDate(plan.nextDueDate)}`} /> : formatDate(plan.nextDueDate)) },
            ]}
          />
        </Panel>

        <Panel title="Historique d'intervention">
          <DataTable
            rows={asset.workOrders ?? []}
            onRowClick={(order) => router.push(`/assets/work-orders/${order.id}`)}
            empty={<Empty icon={<Wrench size={22} />} title="Aucun ordre de travail" body="L'historique se constitue au fil des OT préventifs et correctifs." />}
            columns={[
              {
                key: "order",
                header: "OT",
                render: (order) => (
                  <>
                    <strong>{order.title}</strong>
                    <small>
                      {order.code} · {WO_TYPE_LABEL[order.type]}
                    </small>
                  </>
                ),
              },
              { key: "priority", header: "Priorité", render: (order) => <StatusChip status={PRIORITY_CHIP[order.priority] ?? "planned"} label={PRIORITY_LABEL[order.priority]} /> },
              { key: "due", header: "Échéance", render: (order) => formatDate(order.dueDate) },
              { key: "status", header: "Statut", render: (order) => <StatusChip status={order.status} label={WO_STATUS_LABEL[order.status]} /> },
              { key: "cost", header: "Coût", align: "right", render: (order) => formatMoney(order.totalCost, asset.currency) },
            ]}
          />
        </Panel>
      </div>
    </>
  );
}
