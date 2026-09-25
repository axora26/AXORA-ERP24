"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import type { MepEquipmentView } from "@axora24/contracts";
import { CALC_STATUS_CHIP, CALC_STATUS_LABEL, DISCIPLINE_LABEL, EQUIPMENT_STATUS_CHIP, EQUIPMENT_STATUS_LABEL, mepApi } from "../../../../lib/modules/mep";
import { useMutation, useResource } from "../../../../lib/hooks";
import { useSession } from "../../../../lib/session";
import { ActionBar, Button, DataTable, DetailList, Empty, Feedback, Loading, PageHeader, Panel, StatusChip } from "../../../../components/ui";

const NEXT_STATUS: Record<string, { status: string; label: string } | undefined> = {
  SPECIFIED: { status: "SELECTED", label: "Marquer sélectionné" },
  SELECTED: { status: "INSTALLED", label: "Marquer installé" },
};

export default function EquipmentPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const session = useSession();
  const resource = useResource(() => mepApi.oneEquipment(id), [id]);
  const mutation = useMutation();
  const [override, setOverride] = useState<MepEquipmentView | null>(null);
  const equipment = override ?? resource.data;

  if (resource.loading && !equipment) return <Loading label="Chargement de l'équipement…" />;
  if (!equipment) return <Feedback error={resource.error || "Équipement introuvable."} />;
  const next = NEXT_STATUS[equipment.status];

  return (
    <>
      <PageHeader
        breadcrumb={`MEP / Équipements / ${equipment.tag}`}
        title={`${equipment.tag} — ${equipment.name}`}
        subtitle={`${DISCIPLINE_LABEL[equipment.discipline]} · système ${equipment.systemCode} · ${equipment.projectCode ?? ""}`}
        actions={<StatusChip status={EQUIPMENT_STATUS_CHIP[equipment.status] ?? "draft"} label={EQUIPMENT_STATUS_LABEL[equipment.status]} />}
      />
      <Feedback error={mutation.error} notice={mutation.notice} />
      <Panel title="Identification">
        <DetailList
          items={[
            { label: "Fabricant", value: equipment.manufacturer ?? "—" },
            { label: "Modèle", value: equipment.model ?? "—" },
            { label: "Localisation", value: equipment.location ?? "—" },
            { label: "Quantité", value: String(equipment.quantity) },
            { label: "Fiche technique", value: equipment.technicalDocumentId ? <Link href={`/documents/${equipment.technicalDocumentId}`}>{equipment.technicalDocumentCode}</Link> : "—" },
          ]}
        />
        {next && session.can("mep.system.manage") && (
          <ActionBar note="La mise en service (statut « Mis en service ») est prononcée uniquement par le commissioning.">
            <Button
              onClick={async () => {
                const updated = await mutation.run(() => mepApi.updateEquipment(equipment.id, { status: next.status }), "Statut mis à jour.");
                if (updated) setOverride(updated);
              }}
            >
              {next.label}
            </Button>
          </ActionBar>
        )}
      </Panel>
      <div className="module-grid cols-2">
        <Panel title="Caractéristiques">
          <DataTable
            rows={equipment.specs.map((spec, index) => ({ ...spec, id: String(index) }))}
            empty={<Empty title="Aucune caractéristique" />}
            columns={[
              { key: "name", header: "Caractéristique", render: (spec) => spec.name },
              { key: "value", header: "Valeur", align: "right", render: (spec) => <strong className="num">{spec.value}</strong> },
              { key: "unit", header: "Unité", render: (spec) => spec.unit || "—" },
            ]}
          />
        </Panel>
        <Panel title="Notes de calcul liées">
          <DataTable
            rows={equipment.calculations ?? []}
            onRowClick={(calculation) => router.push(`/mep/calculations/${calculation.id}`)}
            empty={<Empty title="Aucune note de calcul" />}
            columns={[
              {
                key: "title",
                header: "Note",
                render: (calculation) => (
                  <>
                    <strong>{calculation.title}</strong>
                    <small>{calculation.code}</small>
                  </>
                ),
              },
              { key: "result", header: "Résultat", render: (calculation) => calculation.current.outputs.map((output) => `${output.symbol} = ${output.value} ${output.unit}`).join(" · ") },
              { key: "status", header: "Statut", render: (calculation) => <StatusChip status={CALC_STATUS_CHIP[calculation.current.status] ?? "pending"} label={CALC_STATUS_LABEL[calculation.current.status]} /> },
            ]}
          />
        </Panel>
      </div>
    </>
  );
}
