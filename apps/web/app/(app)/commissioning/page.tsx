"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardCheck, Plus } from "lucide-react";
import { STAGE_CHIP, STAGE_LABEL, commissioningApi } from "../../lib/modules/commissioning";
import { mepApi } from "../../lib/modules/mep";
import { formatDateTime } from "../../lib/format";
import { useMutation, useResource } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import { ProjectPicker, useProjectChoice } from "../../components/project-picker";
import { Button, DataTable, Empty, Feedback, Form, Loading, Metric, Metrics, Modal, PageHeader, Panel, SelectField, StatusChip, TextAreaField } from "../../components/ui";

export default function CommissioningPage(): React.ReactElement {
  const session = useSession();
  const router = useRouter();
  const mutation = useMutation();
  const { projects, projectId, setProjectId } = useProjectChoice();
  const [creating, setCreating] = useState(false);
  const data = useResource(
    () => (projectId ? Promise.all([commissioningApi.list(projectId), session.can("mep.system.read") ? mepApi.equipment(projectId) : Promise.resolve([])]) : Promise.resolve(null)),
    [projectId],
  );
  const [activities, equipment] = data.data ?? [[], []];
  const candidates = equipment.filter((item) => item.status === "INSTALLED" && !activities.some((activity) => activity.equipmentId === item.id));

  return (
    <>
      <PageHeader
        breadcrumb="Ingénierie / Mise en service"
        title="Mise en service"
        subtitle="Précommissioning, essais, anomalies, corrections et retests jusqu'à la réception : aucune étape ne peut être sautée (garanti par la base)."
        onRefresh={() => void data.reload()}
        actions={
          session.can("commissioning.activity.manage") && (
            <Button variant="primary" onClick={() => setCreating(true)} disabled={candidates.length === 0}>
              <Plus size={15} aria-hidden="true" /> Mise en service
            </Button>
          )
        }
      />
      <Feedback error={projects.error || data.error || mutation.error} notice={mutation.notice} />
      <ProjectPicker projects={projects.data ?? []} value={projectId} onChange={setProjectId} />
      {data.loading && !data.data ? (
        <Loading label="Chargement des mises en service…" />
      ) : (
        <>
          <Metrics label="Synthèse mise en service">
            <Metric icon={<ClipboardCheck size={20} />} tone="blue" label="Équipements suivis" value={String(activities.length)} detail={`${candidates.length} installé(s) sans mise en service`} />
            <Metric icon={<ClipboardCheck size={20} />} tone={activities.some((activity) => activity.openPunchItems > 0) ? "red" : "green"} label="Anomalies non soldées" value={String(activities.reduce((sum, activity) => sum + activity.openPunchItems, 0))} detail="Retest obligatoire après correction" />
            <Metric icon={<ClipboardCheck size={20} />} tone="green" label="Réceptionnés" value={String(activities.filter((activity) => activity.status === "ACCEPTED" || activity.status === "HANDED_OVER").length)} detail={`${activities.filter((activity) => activity.status === "HANDED_OVER").length} remis au client`} />
          </Metrics>
          <div className="stack">
            <Panel title="Équipements en mise en service">
              <DataTable
                rows={activities}
                onRowClick={(activity) => router.push(`/commissioning/${activity.id}`)}
                empty={<Empty icon={<ClipboardCheck size={22} />} title="Aucune mise en service" body="Un équipement MEP installé peut entrer en mise en service." />}
                columns={[
                  {
                    key: "equipment",
                    header: "Équipement",
                    render: (activity) => (
                      <>
                        <strong>
                          {activity.equipmentTag} — {activity.equipmentName}
                        </strong>
                        <small>
                          {activity.code} · système {activity.systemCode}
                        </small>
                      </>
                    ),
                  },
                  { key: "stage", header: "Étape", render: (activity) => <StatusChip status={STAGE_CHIP[activity.stage] ?? "planned"} label={STAGE_LABEL[activity.stage]} /> },
                  { key: "punch", header: "Anomalies ouvertes", align: "right", render: (activity) => String(activity.openPunchItems) },
                  { key: "blockers", header: "Avant réception", render: (activity) => (activity.blockers.length ? <span className="clamp">{activity.blockers.join(" · ")}</span> : activity.acceptedAt ? `Réceptionné le ${formatDateTime(activity.acceptedAt)}` : "Prêt") },
                ]}
              />
            </Panel>
          </div>
        </>
      )}
      {creating && (
        <Modal title="Nouvelle mise en service" onClose={() => setCreating(false)}>
          <Feedback error={mutation.error} />
          <CreateForm
            equipment={candidates.map((item) => ({ value: item.id, label: `${item.tag} — ${item.name}` }))}
            saving={mutation.saving}
            onSubmit={async (equipmentId, procedure) => {
              const created = await mutation.run(() => commissioningApi.create({ equipmentId, procedure }), "Mise en service ouverte.");
              if (created) router.push(`/commissioning/${created.id}`);
            }}
          />
        </Modal>
      )}
    </>
  );
}

function CreateForm({ equipment, saving, onSubmit }: { equipment: Array<{ value: string; label: string }>; saving: boolean; onSubmit: (equipmentId: string, procedure: string) => Promise<void> }): React.ReactElement {
  const [equipmentId, setEquipmentId] = useState("");
  const [procedure, setProcedure] = useState("");
  return (
    <Form columns={1} submitLabel="Ouvrir" saving={saving} onSubmit={() => onSubmit(equipmentId, procedure)}>
      <SelectField label="Équipement installé" value={equipmentId} onChange={setEquipmentId} required options={equipment} />
      <TextAreaField label="Procédure d'essais" value={procedure} onChange={setProcedure} required rows={6} />
    </Form>
  );
}
