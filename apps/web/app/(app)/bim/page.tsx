"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Box, Plus, Unplug } from "lucide-react";
import { BIM_DISCIPLINE_LABEL, CONNECTOR_STATE_LABEL, CONNECTOR_STEPS, VERSION_STATUS_CHIP, VERSION_STATUS_LABEL, bimApi } from "../../lib/modules/bim";
import { formatDateTime } from "../../lib/format";
import { useMutation, useResource } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import { ProjectPicker, useProjectChoice } from "../../components/project-picker";
import { Button, DataTable, Empty, Feedback, Form, Loading, Modal, PageHeader, Panel, SelectField, StatusChip, TextField } from "../../components/ui";

export default function BimPage(): React.ReactElement {
  const session = useSession();
  const router = useRouter();
  const mutation = useMutation();
  const { projects, projectId, setProjectId } = useProjectChoice();
  const [creating, setCreating] = useState(false);
  const models = useResource(() => (projectId ? bimApi.models(projectId) : Promise.resolve([])), [projectId]);
  const revit = useResource(() => bimApi.revit());

  return (
    <>
      <PageHeader
        breadcrumb="Ingénierie / BIM"
        title="Maquettes BIM"
        subtitle="Import IFC vérifié par empreinte, versions visées, éléments liés aux équipements MEP et conflits de synthèse."
        onRefresh={() => void models.reload()}
        actions={
          session.can("bim.model.manage") &&
          projectId && (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus size={15} aria-hidden="true" /> Maquette
            </Button>
          )
        }
      />
      <Feedback error={projects.error || models.error || mutation.error} notice={mutation.notice} />
      <ProjectPicker projects={projects.data ?? []} value={projectId} onChange={setProjectId} />
      <div className="module-grid cols-2">
        <Panel title="Maquettes du projet">
          {models.loading && !models.data ? (
            <Loading label="Chargement des maquettes…" />
          ) : (
            <DataTable
              rows={models.data ?? []}
              onRowClick={(model) => router.push(`/bim/models/${model.id}`)}
              empty={<Empty icon={<Box size={22} />} title="Aucune maquette" body="Créez une maquette puis importez un fichier IFC." />}
              columns={[
                {
                  key: "name",
                  header: "Maquette",
                  render: (model) => (
                    <>
                      <strong>{model.name}</strong>
                      <small>
                        {model.code} · {BIM_DISCIPLINE_LABEL[model.discipline]}
                      </small>
                    </>
                  ),
                },
                {
                  key: "version",
                  header: "Dernière version",
                  render: (model) =>
                    model.latestVersion ? (
                      <>
                        v{model.latestVersion.versionNumber} · {model.latestVersion.schema}
                        <small>
                          {model.latestVersion.elementCount} éléments · {formatDateTime(model.latestVersion.importedAt)}
                        </small>
                      </>
                    ) : (
                      "—"
                    ),
                },
                { key: "status", header: "Statut", render: (model) => (model.latestVersion ? <StatusChip status={VERSION_STATUS_CHIP[model.latestVersion.status] ?? "pending"} label={VERSION_STATUS_LABEL[model.latestVersion.status]} /> : "—") },
                { key: "clashes", header: "Conflits ouverts", align: "right", render: (model) => String(model.openClashes) },
              ]}
            />
          )}
        </Panel>
        <Panel title="Connecteur Revit natif" subtitle="Six états distincts, chacun avec sa preuve : aucun n'est simulé">
          {revit.data ? (
            <ul className="connector-states">
              {CONNECTOR_STEPS.map((step) => (
                <li key={step.key}>
                  <span>
                    <Unplug size={13} aria-hidden="true" /> {step.label}
                  </span>
                  <StatusChip status={revit.data![step.key].state === "IMPLEMENTED_NOT_VERIFIED" ? "passed" : revit.data![step.key].state === "NOT_AVAILABLE" ? "blocked" : "not_tested"} label={CONNECTOR_STATE_LABEL[revit.data![step.key].state]} />
                  <small>{revit.data![step.key].evidence}</small>
                </li>
              ))}
              <li className="interop">
                <span>Interopérabilité {revit.data.interoperability.format}</span>
                <StatusChip status="passed" label={CONNECTOR_STATE_LABEL[revit.data.interoperability.state]} />
                <small>
                  {revit.data.interoperability.schemas.join(", ")} — {revit.data.interoperability.evidence}
                </small>
              </li>
            </ul>
          ) : (
            <Loading label="Lecture de l'état du connecteur…" />
          )}
        </Panel>
      </div>
      {creating && (
        <Modal title="Nouvelle maquette" onClose={() => setCreating(false)}>
          <Feedback error={mutation.error} />
          <CreateForm
            saving={mutation.saving}
            onSubmit={async (name, discipline) => {
              const created = await mutation.run(() => bimApi.createModel({ projectId, name, discipline }), "Maquette créée : importez un fichier IFC.");
              if (created) router.push(`/bim/models/${created.id}`);
            }}
          />
        </Modal>
      )}
    </>
  );
}

function CreateForm({ saving, onSubmit }: { saving: boolean; onSubmit: (name: string, discipline: string) => Promise<void> }): React.ReactElement {
  const [name, setName] = useState("");
  const [discipline, setDiscipline] = useState("COORDINATION");
  return (
    <Form submitLabel="Créer" saving={saving} onSubmit={() => onSubmit(name, discipline)}>
      <TextField label="Nom" value={name} onChange={setName} required placeholder="Maquette de synthèse" />
      <SelectField label="Discipline" value={discipline} onChange={setDiscipline} required options={Object.entries(BIM_DISCIPLINE_LABEL).map(([value, label]) => ({ value, label }))} />
    </Form>
  );
}
