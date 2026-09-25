"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import type { CalculationTypeView } from "@axora24/contracts";
import { Calculator, Cpu, Layers, ShieldQuestion } from "lucide-react";
import { CALC_STATUS_CHIP, CALC_STATUS_LABEL, DISCIPLINE_LABEL, EQUIPMENT_STATUS_CHIP, EQUIPMENT_STATUS_LABEL, mepApi } from "../../lib/modules/mep";
import { useMutation, useResource } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import { ProjectPicker, useProjectChoice } from "../../components/project-picker";
import { Button, DataTable, Empty, Feedback, Form, Loading, Metric, Metrics, Modal, PageHeader, Panel, SelectField, StatusChip, Tabs, TextAreaField, TextField } from "../../components/ui";

type TabId = "equipment" | "systems" | "calculations" | "quantities" | "coverage";
type Dialog = "system" | "equipment" | "calculation";

export default function MepPage(): React.ReactElement {
  const session = useSession();
  const router = useRouter();
  const mutation = useMutation();
  const { projects, projectId, setProjectId } = useProjectChoice();
  const [tab, setTab] = useState<TabId>("equipment");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const catalog = useResource(() => mepApi.catalog());
  const data = useResource(
    () => (projectId ? Promise.all([mepApi.systems(projectId), mepApi.equipment(projectId), mepApi.calculations(projectId), mepApi.quantities(projectId)]) : Promise.resolve(null)),
    [projectId],
  );
  const [systems, equipment, calculations, quantities] = data.data ?? [[], [], [], []];

  async function done(action: () => Promise<unknown>, success: string, open?: (result: { id: string }) => string): Promise<void> {
    const result = await mutation.run(action, success);
    if (result !== undefined) {
      setDialog(null);
      if (open && result && typeof result === "object" && "id" in result) router.push(open(result as { id: string }));
      else await data.reload();
    }
  }

  return (
    <>
      <PageHeader
        breadcrumb="Ingénierie / MEP"
        title="Ingénierie MEP"
        subtitle="Systèmes CVC, électricité, courants faibles, plomberie et incendie ; notes de calcul dont chaque résultat est vérifiable (entrées, formule, substitution)."
        onRefresh={() => void data.reload()}
        actions={
          projectId && (
            <>
              {session.can("mep.system.manage") && (
                <>
                  <Button onClick={() => setDialog("system")}>
                    <Layers size={15} aria-hidden="true" /> Système
                  </Button>
                  <Button onClick={() => setDialog("equipment")} disabled={systems.length === 0}>
                    <Cpu size={15} aria-hidden="true" /> Équipement
                  </Button>
                </>
              )}
              {session.can("mep.calculation.manage") && (
                <Button variant="primary" onClick={() => setDialog("calculation")}>
                  <Calculator size={15} aria-hidden="true" /> Note de calcul
                </Button>
              )}
            </>
          )
        }
      />
      <Feedback error={projects.error || data.error || mutation.error} notice={mutation.notice} />
      <ProjectPicker projects={projects.data ?? []} value={projectId} onChange={setProjectId} />
      {data.loading && !data.data ? (
        <Loading label="Chargement de l'ingénierie…" />
      ) : (
        <>
          <Metrics label="Synthèse MEP">
            <Metric icon={<Layers size={20} />} tone="blue" label="Systèmes" value={String(systems.length)} detail={[...new Set(systems.map((system) => DISCIPLINE_LABEL[system.discipline]))].join(" · ") || "—"} />
            <Metric icon={<Cpu size={20} />} tone="violet" label="Équipements" value={String(equipment.length)} detail={`${equipment.filter((item) => item.status === "COMMISSIONED").length} mis en service`} />
            <Metric
              icon={<Calculator size={20} />}
              tone={calculations.some((calculation) => calculation.current.status === "DRAFT") ? "amber" : "green"}
              label="Notes de calcul"
              value={String(calculations.length)}
              detail={`${calculations.filter((calculation) => calculation.current.status === "DRAFT").length} à valider par un autre ingénieur`}
            />
          </Metrics>
          <Tabs<TabId>
            active={tab}
            onChange={setTab}
            tabs={[
              { id: "equipment", label: "Équipements", count: equipment.length },
              { id: "systems", label: "Systèmes", count: systems.length },
              { id: "calculations", label: "Notes de calcul", count: calculations.length },
              { id: "quantities", label: "Quantitatif" },
              { id: "coverage", label: "Couverture des calculs" },
            ]}
          />
          <div className="stack">
            {tab === "equipment" && (
              <Panel title="Équipements" subtitle="Identité de référence reprise par le BIM, le commissioning et la GMAO">
                <DataTable
                  rows={equipment}
                  onRowClick={(item) => router.push(`/mep/equipment/${item.id}`)}
                  empty={<Empty icon={<Cpu size={22} />} title="Aucun équipement" body="Créez un système puis ses équipements." />}
                  columns={[
                    {
                      key: "tag",
                      header: "Repère",
                      render: (item) => (
                        <>
                          <strong>{item.tag}</strong>
                          <small>{item.name}</small>
                        </>
                      ),
                    },
                    { key: "system", header: "Système", render: (item) => `${item.systemCode} · ${DISCIPLINE_LABEL[item.discipline]}` },
                    { key: "maker", header: "Fabricant / modèle", render: (item) => [item.manufacturer, item.model].filter(Boolean).join(" · ") || "—" },
                    { key: "location", header: "Localisation", render: (item) => item.location ?? "—" },
                    { key: "qty", header: "Qté", align: "right", render: (item) => String(item.quantity) },
                    { key: "status", header: "Statut", render: (item) => <StatusChip status={EQUIPMENT_STATUS_CHIP[item.status] ?? "draft"} label={EQUIPMENT_STATUS_LABEL[item.status]} /> },
                  ]}
                />
              </Panel>
            )}
            {tab === "systems" && (
              <Panel title="Systèmes par discipline">
                <DataTable
                  rows={systems}
                  empty={<Empty icon={<Layers size={22} />} title="Aucun système" />}
                  columns={[
                    {
                      key: "code",
                      header: "Système",
                      render: (system) => (
                        <>
                          <strong>{system.code}</strong>
                          <small>{system.name}</small>
                        </>
                      ),
                    },
                    { key: "discipline", header: "Discipline", render: (system) => DISCIPLINE_LABEL[system.discipline] },
                    { key: "count", header: "Équipements", align: "right", render: (system) => String(system.equipmentCount) },
                  ]}
                />
              </Panel>
            )}
            {tab === "calculations" && (
              <Panel title="Notes de calcul" subtitle="Toute hypothèse modifiée crée une révision ; validation par un ingénieur distinct de l'auteur">
                <DataTable
                  rows={calculations}
                  onRowClick={(calculation) => router.push(`/mep/calculations/${calculation.id}`)}
                  empty={<Empty icon={<Calculator size={22} />} title="Aucune note de calcul" />}
                  columns={[
                    {
                      key: "title",
                      header: "Note",
                      render: (calculation) => (
                        <>
                          <strong>{calculation.title}</strong>
                          <small>
                            {calculation.code} · {calculation.calcTitle}
                            {calculation.equipmentTag ? ` · ${calculation.equipmentTag}` : ""}
                          </small>
                        </>
                      ),
                    },
                    {
                      key: "result",
                      header: "Résultat (révision courante)",
                      render: (calculation) => calculation.current.outputs.map((output) => `${output.symbol} = ${output.value} ${output.unit}`).join(" · "),
                    },
                    { key: "rev", header: "Rév.", align: "right", render: (calculation) => `${calculation.currentRevision}${calculation.validatedRevision && calculation.validatedRevision !== calculation.currentRevision ? ` (appl. ${calculation.validatedRevision})` : ""}` },
                    { key: "status", header: "Statut", render: (calculation) => <StatusChip status={CALC_STATUS_CHIP[calculation.current.status] ?? "pending"} label={CALC_STATUS_LABEL[calculation.current.status]} /> },
                  ]}
                />
              </Panel>
            )}
            {tab === "quantities" && (
              <Panel title="Quantitatif des équipements" subtitle="Quantités déclarées par système et par statut">
                <DataTable
                  rows={quantities.map((row) => ({ ...row, id: `${row.systemId}-${row.status}` }))}
                  empty={<Empty title="Aucun équipement" />}
                  columns={[
                    { key: "system", header: "Système", render: (row) => `${row.systemCode} — ${row.systemName}` },
                    { key: "discipline", header: "Discipline", render: (row) => DISCIPLINE_LABEL[row.discipline] ?? row.discipline },
                    { key: "status", header: "Statut", render: (row) => EQUIPMENT_STATUS_LABEL[row.status] ?? row.status },
                    { key: "refs", header: "Références", align: "right", render: (row) => String(row.references) },
                    { key: "qty", header: "Quantité", align: "right", render: (row) => <strong>{row.quantity}</strong> },
                  ]}
                />
              </Panel>
            )}
            {tab === "coverage" && (
              <div className="module-grid cols-2">
                <Panel title="Calculs disponibles" subtitle={catalog.data ? `Noyau ${catalog.data.kernelVersion} — relations physiques élémentaires, entrées toutes explicites` : ""}>
                  <ul className="calc-catalog">
                    {(catalog.data?.types ?? []).map((type) => (
                      <li key={type.type}>
                        <strong>{type.title}</strong>
                        <code>{type.formula}</code>
                        <small>{type.disciplines.map((discipline) => DISCIPLINE_LABEL[discipline]).join(" · ")}</small>
                      </li>
                    ))}
                  </ul>
                </Panel>
                <Panel title="Non couvert (NOT_STARTED)" subtitle="Aucune norme n'est codée sans source vérifiée : ces calculs ne sont pas approximés">
                  <ul className="calc-catalog">
                    {(catalog.data?.notCovered ?? []).map((zone) => (
                      <li key={zone.domain}>
                        <strong>
                          <ShieldQuestion size={13} aria-hidden="true" /> {zone.domain}
                        </strong>
                        <small>{zone.reason}</small>
                      </li>
                    ))}
                  </ul>
                </Panel>
              </div>
            )}
          </div>
        </>
      )}
      {dialog && projectId && (
        <MepDialog
          dialog={dialog}
          projectId={projectId}
          systems={systems.map((system) => ({ value: system.id, label: `${system.code} — ${system.name}` }))}
          equipment={equipment.map((item) => ({ value: item.id, label: `${item.tag} — ${item.name}` }))}
          types={catalog.data?.types ?? []}
          saving={mutation.saving}
          error={mutation.error}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      )}
    </>
  );
}

function MepDialog({
  dialog,
  projectId,
  systems,
  equipment,
  types,
  saving,
  error,
  onClose,
  onDone,
}: {
  dialog: Dialog;
  projectId: string;
  systems: Array<{ value: string; label: string }>;
  equipment: Array<{ value: string; label: string }>;
  types: CalculationTypeView[];
  saving: boolean;
  error: string;
  onClose: () => void;
  onDone: (action: () => Promise<unknown>, success: string, open?: (result: { id: string }) => string) => Promise<void>;
}): React.ReactElement {
  const [values, setValues] = useState<Record<string, string>>({ discipline: "HVAC", calcType: types[0]?.type ?? "" });
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [specs, setSpecs] = useState("");
  const set = (field: string) => (value: string) => setValues((current) => ({ ...current, [field]: value }));
  const value = (field: string) => values[field] ?? "";
  const type = types.find((candidate) => candidate.type === value("calcType"));

  let title: string;
  let body: React.ReactNode;
  if (dialog === "system") {
    title = "Nouveau système";
    body = (
      <Form submitLabel="Créer" saving={saving} onSubmit={() => onDone(() => mepApi.createSystem({ projectId, code: value("code"), name: value("name"), discipline: value("discipline"), description: value("description") || undefined }), "Système créé.")}>
        <TextField label="Code" value={value("code")} onChange={set("code")} required placeholder="CVC-01" />
        <TextField label="Nom" value={value("name")} onChange={set("name")} required />
        <SelectField label="Discipline" value={value("discipline")} onChange={set("discipline")} required options={Object.entries(DISCIPLINE_LABEL).map(([key, label]) => ({ value: key, label }))} />
        <TextField label="Description" value={value("description")} onChange={set("description")} />
      </Form>
    );
  } else if (dialog === "equipment") {
    title = "Nouvel équipement";
    body = (
      <Form
        submitLabel="Créer"
        saving={saving}
        onSubmit={() =>
          onDone(
            () =>
              mepApi.createEquipment({
                systemId: value("systemId"),
                tag: value("tag"),
                name: value("name"),
                manufacturer: value("manufacturer") || undefined,
                model: value("model") || undefined,
                location: value("location") || undefined,
                specs: specs
                  .split("\n")
                  .map((line) => line.split(";").map((part) => part.trim()))
                  .filter((parts) => parts[0] && parts[1])
                  .map(([name, val, unit]) => ({ name, value: val, unit: unit ?? "" })),
              }),
            "Équipement créé.",
            (result) => `/mep/equipment/${result.id}`,
          )
        }
      >
        <SelectField label="Système" value={value("systemId")} onChange={set("systemId")} required options={systems} />
        <TextField label="Repère" value={value("tag")} onChange={set("tag")} required placeholder="CTA-01" />
        <TextField label="Désignation" value={value("name")} onChange={set("name")} required wide />
        <TextField label="Fabricant" value={value("manufacturer")} onChange={set("manufacturer")} />
        <TextField label="Modèle" value={value("model")} onChange={set("model")} />
        <TextField label="Localisation" value={value("location")} onChange={set("location")} />
        <TextAreaField label="Caractéristiques (une par ligne : nom ; valeur ; unité)" value={specs} onChange={setSpecs} rows={4} />
      </Form>
    );
  } else {
    title = "Nouvelle note de calcul";
    body = (
      <Form
        submitLabel="Calculer et enregistrer"
        saving={saving}
        onSubmit={() =>
          onDone(
            () =>
              mepApi.createCalculation({
                projectId,
                calcType: value("calcType"),
                title: value("title"),
                equipmentId: value("equipmentId") || undefined,
                systemId: value("systemId") || undefined,
                inputs: Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, input.replace(",", ".").trim()])),
                sources: value("sources") || undefined,
                notes: value("notes") || undefined,
              }),
            "Note de calcul enregistrée : à valider par un autre ingénieur.",
            (result) => `/mep/calculations/${result.id}`,
          )
        }
      >
        <SelectField
          label="Calcul"
          value={value("calcType")}
          onChange={(next) => {
            set("calcType")(next);
            setInputs({});
          }}
          required
          options={types.map((candidate) => ({ value: candidate.type, label: candidate.title }))}
          wide
        />
        {type && <p className="formula-box wide">{type.formula}</p>}
        <TextField label="Intitulé" value={value("title")} onChange={set("title")} required wide />
        <SelectField label="Équipement" value={value("equipmentId")} onChange={set("equipmentId")} options={equipment} emptyLabel="Aucun" />
        <SelectField label="Système" value={value("systemId")} onChange={set("systemId")} options={systems} emptyLabel="Aucun" />
        {type?.inputs.map((input) => (
          <TextField
            key={input.name}
            label={`${input.symbol} — ${input.label} (${input.unit})`}
            value={inputs[input.name] ?? ""}
            onChange={(next) => setInputs((current) => ({ ...current, [input.name]: next }))}
            required
            hint={input.hint}
          />
        ))}
        <TextAreaField label="Sources des valeurs d'entrée (exigées pour la validation)" value={value("sources")} onChange={set("sources")} />
        <TextAreaField label="Notes" value={value("notes")} onChange={set("notes")} />
      </Form>
    );
  }
  return (
    <Modal title={title} onClose={onClose} wide={dialog !== "system"}>
      <Feedback error={error} />
      {body}
    </Modal>
  );
}
