"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CircleDollarSign, FolderKanban, HardHat, Plus } from "lucide-react";
import { projectsApi, PROJECT_STATUS_LABEL } from "../../lib/modules/projects";
import { salesApi } from "../../lib/api";
import { formatCompactMoney, formatDate, formatMoney, sumMoney } from "../../lib/format";
import { useMutation, useResource } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import {
  Button,
  DataTable,
  DateField,
  Empty,
  Feedback,
  Form,
  Loading,
  Metric,
  Metrics,
  Modal,
  PageHeader,
  Panel,
  ProgressBar,
  SelectField,
  StatusChip,
  TextAreaField,
  TextField,
  Toggle,
} from "../../components/ui";

export default function ProjectsPage(): React.ReactElement {
  const session = useSession();
  const router = useRouter();
  const projects = useResource(() => projectsApi.list());
  const mutation = useMutation();
  const [creating, setCreating] = useState(false);
  const rows = projects.data ?? [];
  const active = rows.filter((project) => ["PLANNED", "IN_PROGRESS", "ON_HOLD"].includes(project.status));
  const canManage = session.can("projects.project.manage");

  return (
    <>
      <PageHeader
        breadcrumb="Projets / Portefeuille"
        title="Portefeuille de projets"
        subtitle="Affaires issues des contrats : WBS, budget de coûts, avenants, planning et avancement réel."
        onRefresh={() => void projects.reload()}
        actions={
          canManage && (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus size={15} aria-hidden="true" /> Nouveau projet
            </Button>
          )
        }
      />
      <Feedback error={projects.error || mutation.error} notice={mutation.notice} />

      {projects.loading && !projects.data ? (
        <Loading label="Chargement du portefeuille…" />
      ) : (
        <>
          <Metrics label="Synthèse du portefeuille">
            <Metric
              icon={<FolderKanban size={20} />}
              tone="violet"
              label="Projets actifs"
              value={String(active.length)}
              detail={`${rows.filter((project) => project.status === "IN_PROGRESS").length} en cours d'exécution`}
            />
            <Metric
              icon={<HardHat size={20} />}
              tone="green"
              label="Terminés"
              value={String(rows.filter((project) => project.status === "COMPLETED").length)}
              detail={`${rows.filter((project) => project.status === "CANCELLED").length} annulé(s)`}
            />
            <Metric
              icon={<CircleDollarSign size={20} />}
              tone="blue"
              label="Budget révisé (actifs)"
              value={summarize(active.map((project) => ({ amount: project.revisedBudget, currency: project.currency })))}
              detail="Budget initial + avenants approuvés"
            />
          </Metrics>

          <div className="stack">
            <Panel title="Projets" subtitle="Cliquez sur un projet pour ouvrir son cockpit">
              <DataTable
                rows={rows}
                onRowClick={(project) => router.push(`/projects/${project.id}`)}
                empty={
                  <Empty
                    icon={<FolderKanban size={22} />}
                    title="Aucun projet"
                    body="Créez un projet depuis un contrat actif pour en hériter le montant et les lots."
                  />
                }
                columns={[
                  {
                    key: "name",
                    header: "Projet",
                    render: (project) => (
                      <>
                        <strong>
                          <Link href={`/projects/${project.id}`} onClick={(event) => event.stopPropagation()}>
                            {project.name}
                          </Link>
                        </strong>
                        <small>
                          {project.code}
                          {project.contractCode ? ` · contrat ${project.contractCode}` : ""}
                        </small>
                      </>
                    ),
                  },
                  { key: "client", header: "Client", render: (project) => project.clientName ?? "—" },
                  {
                    key: "status",
                    header: "Statut",
                    render: (project) => <StatusChip status={project.status} label={PROJECT_STATUS_LABEL[project.status]} />,
                  },
                  {
                    key: "progress",
                    header: "Avancement",
                    render: (project) => <ProgressBar value={Number(project.physicalProgress)} />,
                  },
                  {
                    key: "budget",
                    header: "Budget révisé",
                    align: "right",
                    render: (project) => <span className="num">{formatMoney(project.revisedBudget, project.currency)}</span>,
                  },
                  {
                    key: "dates",
                    header: "Planning",
                    render: (project) => `${formatDate(project.plannedStart)} → ${formatDate(project.plannedEnd)}`,
                  },
                ]}
              />
            </Panel>
          </div>
        </>
      )}

      {creating && (
        <CreateProjectModal
          usedContractIds={rows.map((project) => project.contractId).filter((id): id is string => Boolean(id))}
          saving={mutation.saving}
          error={mutation.error}
          onClose={() => setCreating(false)}
          onSubmit={async (input) => {
            const created = await mutation.run(() => projectsApi.create(input), "Projet créé.");
            if (created) router.push(`/projects/${created.id}`);
          }}
        />
      )}
    </>
  );
}

function summarize(amounts: Array<{ amount: string; currency: string }>): string {
  if (amounts.length === 0) return "0";
  const currencies = new Set(amounts.map((entry) => entry.currency));
  if (currencies.size > 1) return `${currencies.size} devises`;
  return formatCompactMoney(sumMoney(amounts.map((entry) => entry.amount)), [...currencies][0] ?? null);
}

function CreateProjectModal({
  usedContractIds,
  saving,
  error,
  onClose,
  onSubmit,
}: {
  usedContractIds: string[];
  saving: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (input: Parameters<typeof projectsApi.create>[0]) => Promise<void>;
}): React.ReactElement {
  const contracts = useResource(() => salesApi.contracts().catch(() => []));
  const [contractId, setContractId] = useState("");
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [plannedStart, setPlannedStart] = useState("");
  const [plannedEnd, setPlannedEnd] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [clientName, setClientName] = useState("");
  const [importLines, setImportLines] = useState(true);
  const available = (contracts.data ?? []).filter(
    (contract) => contract.status === "ACTIVE" && !usedContractIds.includes(contract.id),
  );

  return (
    <Modal title="Nouveau projet" onClose={onClose} wide>
      <Feedback error={error} />
      <Form
        submitLabel="Créer le projet"
        saving={saving}
        onSubmit={() =>
          onSubmit({
            name,
            contractId: contractId || undefined,
            importContractLines: contractId ? importLines : undefined,
            currency: contractId ? undefined : currency,
            clientName: clientName || undefined,
            location: location || undefined,
            description: description || undefined,
            plannedStart: plannedStart || undefined,
            plannedEnd: plannedEnd || undefined,
          })
        }
      >
        <SelectField
          label="Contrat source"
          value={contractId}
          onChange={(value) => {
            setContractId(value);
            const contract = available.find((candidate) => candidate.id === value);
            if (contract && !name) setName(contract.title.replace(/^Contrat\s*[—-]\s*/i, ""));
          }}
          options={available.map((contract) => ({
            value: contract.id,
            label: `${contract.code} — ${contract.title} (${formatMoney(contract.subtotal, contract.currency)})`,
          }))}
          emptyLabel={contracts.loading ? "Chargement…" : "Aucun (projet interne)"}
          hint="Un contrat actif engendre au plus un projet ; son montant et sa devise sont repris à l'identique."
          wide
        />
        <TextField label="Nom du projet" value={name} onChange={setName} required />
        {contractId ? (
          <div className="field">
            <span className="field-note">Structure</span>
            <Toggle label="Créer un lot WBS par ligne du contrat" checked={importLines} onChange={setImportLines} />
          </div>
        ) : (
          <>
            <TextField label="Devise (ISO 4217)" value={currency} onChange={(value) => setCurrency(value.toUpperCase())} required />
            <TextField label="Client" value={clientName} onChange={setClientName} />
          </>
        )}
        <TextField label="Localisation" value={location} onChange={setLocation} />
        <DateField label="Début prévu" value={plannedStart} onChange={setPlannedStart} />
        <DateField label="Fin prévue" value={plannedEnd} onChange={setPlannedEnd} />
        <TextAreaField label="Description" value={description} onChange={setDescription} />
      </Form>
    </Modal>
  );
}
