"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { ProjectBudgetFigure, ProjectDetailView, ProjectWbsNodeView } from "@axora24/contracts";
import { CheckCircle2, Lock, PauseCircle, Play, Plus, Trash2, XCircle } from "lucide-react";
import {
  CHANGE_ORDER_STATUS_LABEL,
  COST_CATEGORY_LABEL,
  PROJECT_STATUS_LABEL,
  RISK_STATUS_LABEL,
  TASK_STATUS_LABEL,
  WBS_KIND_LABEL,
  projectsApi,
} from "../../../lib/modules/projects";
import { formatDate, formatMoney, formatPercent } from "../../../lib/format";
import { useMutation, useResource } from "../../../lib/hooks";
import { useSession } from "../../../lib/session";
import {
  ActionBar,
  Button,
  DataTable,
  DateField,
  DecimalField,
  DetailList,
  Empty,
  Feedback,
  Form,
  Loading,
  Modal,
  PageHeader,
  Panel,
  ProgressBar,
  SelectField,
  StatusChip,
  Tabs,
  TextAreaField,
  TextField,
} from "../../../components/ui";

type TabId = "cockpit" | "wbs" | "planning" | "changes" | "follow";

type Dialog =
  | { kind: "status"; status: string; label: string }
  | { kind: "wbs"; parentId?: string }
  | { kind: "budget"; wbsItemId: string }
  | { kind: "change" }
  | { kind: "reject"; orderId: string }
  | { kind: "task" }
  | { kind: "milestone" }
  | { kind: "risk" };

export default function ProjectDetailPage(): React.ReactElement {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const session = useSession();
  const resource = useResource(() => projectsApi.detail(projectId), [projectId]);
  const mutation = useMutation();
  const [override, setOverride] = useState<ProjectDetailView | null>(null);
  const [tab, setTab] = useState<TabId>("cockpit");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const project = override ?? resource.data;

  async function apply(action: () => Promise<ProjectDetailView>, success: string): Promise<boolean> {
    const updated = await mutation.run(action, success);
    if (updated) {
      setOverride(updated);
      setDialog(null);
      return true;
    }
    return false;
  }

  if (resource.loading && !project) return <Loading label="Chargement du projet…" />;
  if (!project) return <Feedback error={resource.error || "Projet introuvable."} />;

  const canManage = session.can("projects.project.manage");
  const canBudget = session.can("projects.budget.manage");
  const canApprove = session.can("projects.changeorder.approve");
  const canTasks = session.can("projects.task.manage");
  const frozen = project.status === "COMPLETED" || project.status === "CANCELLED";
  const leaves = project.wbs.filter((node) => node.isLeaf);
  const leafOptions = leaves.map((node) => ({ value: node.id, label: `${node.code} — ${node.name}` }));
  const wbsName = (id: string) => {
    const node = project.wbs.find((item) => item.id === id);
    return node ? `${node.code} — ${node.name}` : "—";
  };

  const transitions: Array<{ status: string; label: string; icon: React.ReactNode; variant: "primary" | "secondary" | "danger" }> = [];
  if (project.status === "PLANNED") transitions.push({ status: "IN_PROGRESS", label: "Démarrer", icon: <Play size={14} />, variant: "primary" });
  if (project.status === "IN_PROGRESS") {
    transitions.push({ status: "ON_HOLD", label: "Suspendre", icon: <PauseCircle size={14} />, variant: "secondary" });
    transitions.push({ status: "COMPLETED", label: "Terminer", icon: <CheckCircle2 size={14} />, variant: "primary" });
  }
  if (project.status === "ON_HOLD") transitions.push({ status: "IN_PROGRESS", label: "Reprendre", icon: <Play size={14} />, variant: "primary" });
  if (!frozen) transitions.push({ status: "CANCELLED", label: "Annuler", icon: <XCircle size={14} />, variant: "danger" });

  return (
    <>
      <PageHeader
        breadcrumb={`Projets / ${project.code}`}
        title={project.name}
        subtitle={[project.clientName, project.location].filter(Boolean).join(" · ") || undefined}
        onRefresh={() => {
          setOverride(null);
          void resource.reload();
        }}
        actions={
          <>
            <StatusChip status={project.status} label={PROJECT_STATUS_LABEL[project.status]} />
            {canManage &&
              transitions.map((transition) => (
                <Button
                  key={transition.status}
                  variant={transition.variant}
                  disabled={mutation.saving}
                  onClick={() => {
                    if (transition.status === "ON_HOLD" || transition.status === "CANCELLED") {
                      setDialog({ kind: "status", status: transition.status, label: transition.label });
                    } else {
                      void apply(
                        () => projectsApi.setStatus(project.id, transition.status),
                        `Projet : ${PROJECT_STATUS_LABEL[transition.status]}.`,
                      );
                    }
                  }}
                >
                  {transition.icon} {transition.label}
                </Button>
              ))}
          </>
        }
      />
      <Feedback error={mutation.error} notice={mutation.notice} />
      {project.statusReason && (project.status === "ON_HOLD" || project.status === "CANCELLED") && (
        <p className="inline-warning" style={{ borderRadius: 10, border: "1px solid #fcd9a4" }}>
          Motif : {project.statusReason}
        </p>
      )}

      <Tabs<TabId>
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "cockpit", label: "Cockpit" },
          { id: "wbs", label: "WBS & budget", count: project.wbs.length },
          { id: "planning", label: "Planning & tâches", count: project.tasks.length },
          { id: "changes", label: "Avenants", count: project.changeOrders.length },
          { id: "follow", label: "Jalons & risques", count: project.milestones.length + project.risks.length },
        ]}
      />

      {tab === "cockpit" && <Cockpit project={project} />}

      {tab === "wbs" && (
        <div className="stack">
          <Panel
            title="Structure de découpage (WBS)"
            subtitle="Le budget est porté par les feuilles ; les lots parents affichent la somme dérivée de leurs feuilles."
            actions={
              canManage &&
              !frozen && (
                <Button onClick={() => setDialog({ kind: "wbs" })}>
                  <Plus size={14} aria-hidden="true" /> Élément racine
                </Button>
              )
            }
          >
            <WbsTable
              nodes={project.wbs}
              currency={project.currency}
              canAddChild={canManage && !frozen}
              canBudget={canBudget && !frozen && !project.budgetBaselinedAt}
              onAddChild={(parentId) => setDialog({ kind: "wbs", parentId })}
              onAddBudget={(wbsItemId) => setDialog({ kind: "budget", wbsItemId })}
              budgetLineCount={(id) => project.budgetLines.filter((line) => line.wbsItemId === id).length}
            />
          </Panel>
          <Panel
            title="Lignes budgétaires (déboursé)"
            subtitle={
              project.budgetBaselinedAt
                ? `Baseline figée le ${formatDate(project.budgetBaselinedAt)} : toute évolution passe par un avenant.`
                : "Budget initial en préparation : figez la baseline avant de démarrer le projet."
            }
          >
            <DataTable
              rows={project.budgetLines}
              empty={<Empty title="Aucune ligne budgétaire" body="Ajoutez des lignes sur les feuilles du WBS." />}
              columns={[
                { key: "wbs", header: "Élément WBS", render: (line) => wbsName(line.wbsItemId) },
                { key: "category", header: "Nature", render: (line) => COST_CATEGORY_LABEL[line.category] },
                { key: "description", header: "Description", render: (line) => line.description },
                {
                  key: "amount",
                  header: "Montant",
                  align: "right",
                  render: (line) => <span className="num">{formatMoney(line.amount, project.currency)}</span>,
                },
                {
                  key: "actions",
                  header: "",
                  align: "right",
                  render: (line) =>
                    canBudget && !project.budgetBaselinedAt && !frozen ? (
                      <Button
                        variant="ghost"
                        title="Supprimer la ligne"
                        onClick={() => void apply(() => projectsApi.removeBudgetLine(project.id, line.id), "Ligne supprimée.")}
                      >
                        <Trash2 size={14} aria-label="Supprimer" />
                      </Button>
                    ) : project.budgetBaselinedAt ? (
                      <Lock size={13} aria-label="Figée" className="muted" />
                    ) : null,
                },
              ]}
            />
            {canBudget && !project.budgetBaselinedAt && !frozen && (
              <ActionBar note={`Budget initial actuel : ${formatMoney(project.cockpit.initialBudget, project.currency)}. Une fois figée, la baseline ne peut plus être modifiée.`}>
                <Button
                  variant="primary"
                  disabled={mutation.saving || project.budgetLines.length === 0}
                  onClick={() => void apply(() => projectsApi.baseline(project.id), "Baseline budgétaire figée.")}
                >
                  <Lock size={14} aria-hidden="true" /> Figer la baseline
                </Button>
              </ActionBar>
            )}
          </Panel>
        </div>
      )}

      {tab === "planning" && (
        <div className="stack">
          <Panel
            title="Planning"
            subtitle="Diagramme de Gantt des tâches datées"
            actions={
              canTasks &&
              !frozen && (
                <Button onClick={() => setDialog({ kind: "task" })} disabled={leaves.length === 0}>
                  <Plus size={14} aria-hidden="true" /> Tâche
                </Button>
              )
            }
          >
            <Gantt project={project} />
          </Panel>
          <Panel title="Tâches" subtitle={`Avancement physique pondéré : ${formatPercent(project.physicalProgress)}`}>
            <DataTable
              rows={project.tasks}
              empty={<Empty title="Aucune tâche" body="Les tâches se créent sur les feuilles du WBS." />}
              columns={[
                {
                  key: "name",
                  header: "Tâche",
                  render: (task) => (
                    <>
                      <strong>{task.name}</strong>
                      <small>{wbsName(task.wbsItemId)}</small>
                    </>
                  ),
                },
                { key: "weight", header: "Poids", align: "right", render: (task) => task.weight },
                { key: "dates", header: "Dates prévues", render: (task) => `${formatDate(task.plannedStart)} → ${formatDate(task.plannedEnd)}` },
                {
                  key: "status",
                  header: "Statut",
                  render: (task) =>
                    canTasks && (project.status === "IN_PROGRESS" || project.status === "PLANNED") ? (
                      <select
                        className="inline-select"
                        aria-label={`Statut de ${task.name}`}
                        value={task.status}
                        onChange={(event) => {
                          const status = event.currentTarget.value;
                          void apply(() => projectsApi.setTaskStatus(project.id, task.id, status), "Statut de tâche mis à jour.");
                        }}
                      >
                        {Object.entries(TASK_STATUS_LABEL).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <StatusChip status={task.status === "DONE" ? "done" : task.status} label={TASK_STATUS_LABEL[task.status]} />
                    ),
                },
              ]}
            />
          </Panel>
        </div>
      )}

      {tab === "changes" && (
        <div className="stack">
          <Panel
            title="Avenants"
            subtitle="Seule voie de modification du budget après baseline ; approbation par une personne distincte du demandeur."
            actions={
              canBudget &&
              !frozen &&
              project.budgetBaselinedAt && (
                <Button onClick={() => setDialog({ kind: "change" })}>
                  <Plus size={14} aria-hidden="true" /> Demander un avenant
                </Button>
              )
            }
          >
            {!project.budgetBaselinedAt && (
              <p className="inline-note">Les avenants s&apos;appliquent après le gel de la baseline budgétaire.</p>
            )}
            <DataTable
              rows={project.changeOrders}
              empty={<Empty title="Aucun avenant" />}
              columns={[
                {
                  key: "title",
                  header: "Avenant",
                  render: (order) => (
                    <>
                      <strong>
                        {order.code} — {order.title}
                      </strong>
                      <small>{order.reason}</small>
                    </>
                  ),
                },
                { key: "wbs", header: "Élément WBS", render: (order) => wbsName(order.wbsItemId) },
                {
                  key: "amount",
                  header: "Variation",
                  align: "right",
                  render: (order) => (
                    <span className={`num ${order.amount.startsWith("-") ? "text-success" : ""}`}>
                      {order.amount.startsWith("-") ? "" : "+"}
                      {formatMoney(order.amount, project.currency)}
                    </span>
                  ),
                },
                {
                  key: "status",
                  header: "Statut",
                  render: (order) => (
                    <>
                      <StatusChip status={order.status} label={CHANGE_ORDER_STATUS_LABEL[order.status]} />
                      {order.decisionNote && <small>{order.decisionNote}</small>}
                    </>
                  ),
                },
                {
                  key: "actions",
                  header: "",
                  align: "right",
                  render: (order) =>
                    order.status === "PENDING" && canApprove && !frozen ? (
                      order.requestedByUserId === session.user.id ? (
                        <small className="muted">Validation par un tiers requise</small>
                      ) : (
                        <div className="chip-row">
                          <Button
                            variant="primary"
                            onClick={() => void apply(() => projectsApi.approveChangeOrder(project.id, order.id), `Avenant ${order.code} approuvé.`)}
                          >
                            Approuver
                          </Button>
                          <Button variant="danger" onClick={() => setDialog({ kind: "reject", orderId: order.id })}>
                            Rejeter
                          </Button>
                        </div>
                      )
                    ) : null,
                },
              ]}
            />
          </Panel>
        </div>
      )}

      {tab === "follow" && (
        <div className="module-grid cols-2">
          <Panel
            title="Jalons"
            actions={
              canManage &&
              !frozen && (
                <Button onClick={() => setDialog({ kind: "milestone" })}>
                  <Plus size={14} aria-hidden="true" /> Jalon
                </Button>
              )
            }
          >
            <DataTable
              rows={project.milestones}
              empty={<Empty title="Aucun jalon" />}
              columns={[
                { key: "name", header: "Jalon", render: (milestone) => <strong>{milestone.name}</strong> },
                { key: "due", header: "Échéance", render: (milestone) => formatDate(milestone.dueDate) },
                {
                  key: "status",
                  header: "État",
                  render: (milestone) =>
                    milestone.status === "ACHIEVED" ? (
                      <StatusChip status="done" label={`Atteint le ${formatDate(milestone.achievedAt)}`} />
                    ) : milestone.overdue ? (
                      <StatusChip status="overdue" label="En retard" />
                    ) : (
                      <StatusChip status="planned" label="Prévu" />
                    ),
                },
                {
                  key: "actions",
                  header: "",
                  align: "right",
                  render: (milestone) =>
                    milestone.status === "PLANNED" && canManage && !frozen ? (
                      <Button
                        variant="ghost"
                        onClick={() => void apply(() => projectsApi.achieveMilestone(project.id, milestone.id), "Jalon atteint.")}
                      >
                        Marquer atteint
                      </Button>
                    ) : null,
                },
              ]}
            />
          </Panel>
          <Panel
            title="Registre des risques"
            subtitle="Score = probabilité × impact (1 à 25)"
            actions={
              canManage &&
              !frozen && (
                <Button onClick={() => setDialog({ kind: "risk" })}>
                  <Plus size={14} aria-hidden="true" /> Risque
                </Button>
              )
            }
          >
            <DataTable
              rows={[...project.risks].sort((left, right) => right.score - left.score)}
              empty={<Empty title="Aucun risque identifié" />}
              columns={[
                {
                  key: "title",
                  header: "Risque",
                  render: (risk) => (
                    <>
                      <strong>{risk.title}</strong>
                      {risk.mitigation && <small>Parade : {risk.mitigation}</small>}
                    </>
                  ),
                },
                {
                  key: "score",
                  header: "Score",
                  align: "right",
                  render: (risk) => (
                    <StatusChip status={risk.score >= 15 ? "critical" : risk.score >= 8 ? "medium" : "low"} label={`${risk.score} (${risk.probability}×${risk.impact})`} />
                  ),
                },
                {
                  key: "status",
                  header: "Statut",
                  render: (risk) =>
                    canManage && !frozen ? (
                      <select
                        className="inline-select"
                        aria-label={`Statut du risque ${risk.title}`}
                        value={risk.status}
                        onChange={(event) => {
                          const status = event.currentTarget.value;
                          void apply(() => projectsApi.updateRisk(project.id, risk.id, { status }), "Risque mis à jour.");
                        }}
                      >
                        {Object.entries(RISK_STATUS_LABEL).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      RISK_STATUS_LABEL[risk.status]
                    ),
                },
              ]}
            />
          </Panel>
        </div>
      )}

      {dialog && (
        <ProjectDialog
          dialog={dialog}
          project={project}
          leafOptions={leafOptions}
          saving={mutation.saving}
          error={mutation.error}
          onClose={() => setDialog(null)}
          apply={apply}
        />
      )}
    </>
  );
}

function FigureCard({ label, figure, currency }: { label: string; figure: ProjectBudgetFigure; currency: string }): React.ReactElement {
  return (
    <div className={`figure ${figure.available ? "" : "pending"}`}>
      <span>{label}</span>
      <strong>{figure.available ? formatMoney(figure.amount, currency) : "Non alimenté"}</strong>
      <small>{figure.available ? figure.source : `Source à venir : ${figure.source}`}</small>
    </div>
  );
}

function Cockpit({ project }: { project: ProjectDetailView }): React.ReactElement {
  const cockpit = project.cockpit;
  const margin = cockpit.forecastMargin;
  const lots = project.wbs.filter((node) => node.depth === 0);
  return (
    <div className="stack">
      <Panel title="Chaîne budgétaire" subtitle="Chaque montant provient d'un événement source traçable (lignes, avenants, commandes, factures, paiements).">
        <div className="figures">
          <div className="figure">
            <span>Montant contractuel (vente)</span>
            <strong>{formatMoney(cockpit.contractAmount, project.currency)}</strong>
            <small>{project.contractCode ? `Figé depuis le contrat ${project.contractCode}` : "Projet sans contrat"}</small>
          </div>
          <div className="figure">
            <span>Budget initial (baseline)</span>
            <strong>{formatMoney(cockpit.initialBudget, project.currency)}</strong>
            <small>{project.budgetBaselinedAt ? `Figé le ${formatDate(project.budgetBaselinedAt)}` : "Non figé"}</small>
          </div>
          <div className="figure">
            <span>Avenants approuvés</span>
            <strong>{formatMoney(cockpit.approvedChangeOrders, project.currency)}</strong>
            <small>{project.changeOrders.filter((order) => order.status === "APPROVED").length} avenant(s)</small>
          </div>
          <div className="figure highlight">
            <span>Budget révisé</span>
            <strong>{formatMoney(cockpit.revisedBudget, project.currency)}</strong>
            <small>Initial + avenants approuvés</small>
          </div>
          <div className={`figure ${margin.startsWith("-") ? "negative" : "positive"}`}>
            <span>Marge prévisionnelle</span>
            <strong>{formatMoney(margin, project.currency)}</strong>
            <small>Contrat − budget révisé</small>
          </div>
          <FigureCard label="Engagé" figure={cockpit.committed} currency={project.currency} />
          <FigureCard label="Consommé" figure={cockpit.consumed} currency={project.currency} />
          <FigureCard label="Facturé" figure={cockpit.invoiced} currency={project.currency} />
          <FigureCard label="Payé" figure={cockpit.paid} currency={project.currency} />
        </div>
      </Panel>
      <div className="module-grid cols-2">
        <Panel title="Avancement physique" subtitle="Dérivé des tâches terminées, pondérées">
          <div style={{ padding: "18px 21px" }}>
            <ProgressBar value={Number(cockpit.physicalProgress)} />
          </div>
          <DetailList
            items={[
              { label: "À faire", value: cockpit.taskCounts.TODO },
              { label: "En cours", value: cockpit.taskCounts.IN_PROGRESS },
              { label: "Bloquées", value: cockpit.taskCounts.BLOCKED },
              { label: "Terminées", value: cockpit.taskCounts.DONE },
            ]}
          />
        </Panel>
        <Panel title="Lots" subtitle="Budget révisé et avancement par lot racine">
          <DataTable
            rows={lots}
            empty={<Empty title="WBS vide" />}
            columns={[
              { key: "lot", header: "Lot", render: (node) => `${node.code} — ${node.name}` },
              { key: "budget", header: "Budget révisé", align: "right", render: (node) => <span className="num">{formatMoney(node.revisedBudget, project.currency)}</span> },
              { key: "progress", header: "Avancement", render: (node) => <ProgressBar value={Number(node.physicalProgress)} /> },
            ]}
          />
        </Panel>
      </div>
      <Panel title="Identification">
        <DetailList
          items={[
            { label: "Code", value: project.code },
            {
              label: "Contrat",
              value: project.contractCode ? <Link href="/sales">{project.contractCode}</Link> : "—",
            },
            { label: "Client", value: project.clientName ?? "—" },
            { label: "Devise", value: project.currency },
            { label: "Début prévu", value: formatDate(project.plannedStart) },
            { label: "Fin prévue", value: formatDate(project.plannedEnd) },
          ]}
        />
        {project.description && <p className="inline-note">{project.description}</p>}
      </Panel>
    </div>
  );
}

function WbsTable({
  nodes,
  currency,
  canAddChild,
  canBudget,
  onAddChild,
  onAddBudget,
  budgetLineCount,
}: {
  nodes: ProjectWbsNodeView[];
  currency: string;
  canAddChild: boolean;
  canBudget: boolean;
  onAddChild: (parentId: string) => void;
  onAddBudget: (wbsItemId: string) => void;
  budgetLineCount: (id: string) => number;
}): React.ReactElement {
  return (
    <DataTable
      rows={nodes}
      empty={<Empty title="WBS vide" body="Créez un premier élément racine (lot ou phase)." />}
      columns={[
        {
          key: "name",
          header: "Élément",
          render: (node) => (
            <div style={{ paddingLeft: node.depth * 18 }}>
              <strong>
                {node.code} — {node.name}
              </strong>
              <small>
                {WBS_KIND_LABEL[node.kind]}
                {node.isLeaf ? " · feuille" : " · budget dérivé"}
              </small>
            </div>
          ),
        },
        { key: "initial", header: "Budget initial", align: "right", render: (node) => <span className="num">{formatMoney(node.initialBudget, currency)}</span> },
        { key: "revised", header: "Budget révisé", align: "right", render: (node) => <span className="num">{formatMoney(node.revisedBudget, currency)}</span> },
        { key: "progress", header: "Avancement", render: (node) => <ProgressBar value={Number(node.physicalProgress)} /> },
        {
          key: "actions",
          header: "",
          align: "right",
          render: (node) => (
            <div className="chip-row" style={{ justifyContent: "flex-end" }}>
              {canBudget && node.isLeaf && (
                <Button variant="ghost" onClick={() => onAddBudget(node.id)}>
                  + Budget
                </Button>
              )}
              {canAddChild && budgetLineCount(node.id) === 0 && (
                <Button variant="ghost" onClick={() => onAddChild(node.id)}>
                  + Sous-élément
                </Button>
              )}
            </div>
          ),
        },
      ]}
    />
  );
}

/** Gantt : barres positionnees a l'echelle entre la premiere et la derniere date. */
function Gantt({ project }: { project: ProjectDetailView }): React.ReactElement {
  const dated = project.tasks.filter((task) => task.plannedStart && task.plannedEnd);
  const range = useMemo(() => {
    const times = dated.flatMap((task) => [Date.parse(task.plannedStart!), Date.parse(task.plannedEnd!)]);
    if (project.plannedStart) times.push(Date.parse(project.plannedStart));
    if (project.plannedEnd) times.push(Date.parse(project.plannedEnd));
    if (times.length === 0) return null;
    const start = Math.min(...times);
    const end = Math.max(...times) + 86_400_000;
    return { start, end, span: Math.max(end - start, 86_400_000) };
  }, [dated, project.plannedStart, project.plannedEnd]);

  if (!range || dated.length === 0) {
    return <Empty title="Aucune tâche datée" body="Renseignez les dates prévues des tâches pour afficher le Gantt." />;
  }
  const months: Array<{ label: string; left: number }> = [];
  const cursor = new Date(range.start);
  cursor.setUTCDate(1);
  while (cursor.getTime() < range.end) {
    const left = ((cursor.getTime() - range.start) / range.span) * 100;
    if (left >= 0) months.push({ label: cursor.toLocaleDateString("fr-FR", { month: "short", year: "2-digit" }), left });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  const today = ((Date.now() - range.start) / range.span) * 100;

  return (
    <div className="gantt" role="img" aria-label="Diagramme de Gantt des tâches">
      <div className="gantt-row gantt-head">
        <span />
        <div className="gantt-track">
          {months.map((month) => (
            <em key={`${month.label}-${month.left}`} style={{ left: `${month.left}%` }}>
              {month.label}
            </em>
          ))}
        </div>
      </div>
      {dated.map((task) => {
        const left = ((Date.parse(task.plannedStart!) - range.start) / range.span) * 100;
        const width = Math.max(((Date.parse(task.plannedEnd!) + 86_400_000 - Date.parse(task.plannedStart!)) / range.span) * 100, 0.8);
        return (
          <div className="gantt-row" key={task.id}>
            <span title={task.name}>{task.name}</span>
            <div className="gantt-track">
              {today >= 0 && today <= 100 && <i className="gantt-today" style={{ left: `${today}%` }} />}
              <b className={`gantt-bar status-${task.status.toLowerCase()}`} style={{ left: `${left}%`, width: `${width}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ProjectDialog({
  dialog,
  project,
  leafOptions,
  saving,
  error,
  onClose,
  apply,
}: {
  dialog: Dialog;
  project: ProjectDetailView;
  leafOptions: Array<{ value: string; label: string }>;
  saving: boolean;
  error: string;
  onClose: () => void;
  apply: (action: () => Promise<ProjectDetailView>, success: string) => Promise<boolean>;
}): React.ReactElement {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> =
      dialog.kind === "budget"
        ? { wbsItemId: dialog.wbsItemId, category: "MATERIAL" }
        : { kind: "WORK_PACKAGE", probability: "3", impact: "3" };
    return initial;
  });
  const set = (field: string) => (value: string) => setValues((current) => ({ ...current, [field]: value }));
  const value = (field: string) => values[field] ?? "";

  const titles: Record<Dialog["kind"], string> = {
    status: dialog.kind === "status" ? `${dialog.label} le projet` : "",
    wbs: "Nouvel élément WBS",
    budget: "Ligne budgétaire",
    change: "Demande d'avenant",
    reject: "Rejeter l'avenant",
    task: "Nouvelle tâche",
    milestone: "Nouveau jalon",
    risk: "Nouveau risque",
  };

  let form: React.ReactNode = null;
  switch (dialog.kind) {
    case "status":
      form = (
        <Form columns={1} submitLabel={dialog.label} saving={saving} onSubmit={() => apply(() => projectsApi.setStatus(project.id, dialog.status, value("reason")), `Projet : ${PROJECT_STATUS_LABEL[dialog.status]}.`)}>
          <TextAreaField label="Motif (obligatoire, tracé dans l'audit)" value={value("reason")} onChange={set("reason")} required />
        </Form>
      );
      break;
    case "wbs":
      form = (
        <Form
          submitLabel="Ajouter"
          saving={saving}
          onSubmit={() =>
            apply(
              () => projectsApi.addWbs(project.id, { code: value("code"), name: value("name"), kind: value("kind"), parentId: dialog.parentId }),
              "Élément WBS ajouté.",
            )
          }
        >
          {dialog.parentId && (
            <p className="field-note wide">
              Parent : {project.wbs.find((node) => node.id === dialog.parentId)?.code} — le parent devient un nœud à budget dérivé.
            </p>
          )}
          <TextField label="Code" value={value("code")} onChange={set("code")} required placeholder="Ex. ELEC-2" />
          <SelectField
            label="Nature"
            value={value("kind")}
            onChange={set("kind")}
            options={Object.entries(WBS_KIND_LABEL).map(([key, label]) => ({ value: key, label }))}
            required
          />
          <TextField label="Libellé" value={value("name")} onChange={set("name")} required wide />
        </Form>
      );
      break;
    case "budget":
      form = (
        <Form
          submitLabel="Ajouter la ligne"
          saving={saving}
          onSubmit={() =>
            apply(
              () =>
                projectsApi.addBudgetLine(project.id, {
                  wbsItemId: value("wbsItemId"),
                  category: value("category"),
                  description: value("description"),
                  amount: value("amount").replace(",", "."),
                }),
              "Ligne budgétaire ajoutée.",
            )
          }
        >
          <SelectField label="Élément WBS (feuille)" value={value("wbsItemId")} onChange={set("wbsItemId")} options={leafOptions} required wide />
          <SelectField
            label="Nature de coût"
            value={value("category")}
            onChange={set("category")}
            options={Object.entries(COST_CATEGORY_LABEL).map(([key, label]) => ({ value: key, label }))}
            required
          />
          <DecimalField label={`Montant (${project.currency})`} value={value("amount")} onChange={set("amount")} required />
          <TextField label="Description" value={value("description")} onChange={set("description")} required wide />
        </Form>
      );
      break;
    case "change":
      form = (
        <Form
          submitLabel="Soumettre l'avenant"
          saving={saving}
          onSubmit={() =>
            apply(
              () =>
                projectsApi.requestChangeOrder(project.id, {
                  wbsItemId: value("wbsItemId"),
                  title: value("title"),
                  reason: value("reason"),
                  amount: value("amount").replace(",", "."),
                }),
              "Avenant soumis : il doit être approuvé par une autre personne.",
            )
          }
        >
          <SelectField label="Élément WBS (feuille)" value={value("wbsItemId")} onChange={set("wbsItemId")} options={leafOptions} required wide />
          <TextField label="Objet" value={value("title")} onChange={set("title")} required />
          <DecimalField
            label={`Variation (${project.currency})`}
            value={value("amount")}
            onChange={set("amount")}
            required
            hint="Négative pour une économie (ex. -1500.00)."
          />
          <TextAreaField label="Justification" value={value("reason")} onChange={set("reason")} required />
        </Form>
      );
      break;
    case "reject":
      form = (
        <Form columns={1} submitLabel="Rejeter" saving={saving} onSubmit={() => apply(() => projectsApi.rejectChangeOrder(project.id, dialog.orderId, value("note")), "Avenant rejeté.")}>
          <TextAreaField label="Motif du rejet" value={value("note")} onChange={set("note")} required />
        </Form>
      );
      break;
    case "task":
      form = (
        <Form
          submitLabel="Créer la tâche"
          saving={saving}
          onSubmit={() =>
            apply(
              () =>
                projectsApi.addTask(project.id, {
                  wbsItemId: value("wbsItemId"),
                  name: value("name"),
                  weight: value("weight") ? value("weight").replace(",", ".") : undefined,
                  plannedStart: value("plannedStart") || undefined,
                  plannedEnd: value("plannedEnd") || undefined,
                }),
              "Tâche créée.",
            )
          }
        >
          <SelectField label="Élément WBS (feuille)" value={value("wbsItemId")} onChange={set("wbsItemId")} options={leafOptions} required wide />
          <TextField label="Tâche" value={value("name")} onChange={set("name")} required />
          <DecimalField label="Poids dans l'avancement" value={value("weight")} onChange={set("weight")} placeholder="1" hint="Par défaut 1." />
          <DateField label="Début prévu" value={value("plannedStart")} onChange={set("plannedStart")} />
          <DateField label="Fin prévue" value={value("plannedEnd")} onChange={set("plannedEnd")} />
        </Form>
      );
      break;
    case "milestone":
      form = (
        <Form submitLabel="Ajouter" saving={saving} onSubmit={() => apply(() => projectsApi.addMilestone(project.id, { name: value("name"), dueDate: value("dueDate") }), "Jalon ajouté.")}>
          <TextField label="Jalon" value={value("name")} onChange={set("name")} required />
          <DateField label="Échéance" value={value("dueDate")} onChange={set("dueDate")} required />
        </Form>
      );
      break;
    case "risk":
      form = (
        <Form
          submitLabel="Ajouter"
          saving={saving}
          onSubmit={() =>
            apply(
              () =>
                projectsApi.addRisk(project.id, {
                  title: value("title"),
                  probability: Number(value("probability")),
                  impact: Number(value("impact")),
                  mitigation: value("mitigation") || undefined,
                }),
              "Risque enregistré.",
            )
          }
        >
          <TextField label="Risque" value={value("title")} onChange={set("title")} required wide />
          <SelectField label="Probabilité" value={value("probability")} onChange={set("probability")} options={SCALE} required />
          <SelectField label="Impact" value={value("impact")} onChange={set("impact")} options={SCALE} required />
          <TextAreaField label="Parade envisagée" value={value("mitigation")} onChange={set("mitigation")} />
        </Form>
      );
      break;
  }

  return (
    <Modal title={titles[dialog.kind]} onClose={onClose} wide={dialog.kind !== "status" && dialog.kind !== "reject"}>
      <Feedback error={error} />
      {form}
    </Modal>
  );
}

const SCALE = [
  { value: "1", label: "1 — Très faible" },
  { value: "2", label: "2 — Faible" },
  { value: "3", label: "3 — Moyen" },
  { value: "4", label: "4 — Élevé" },
  { value: "5", label: "5 — Critique" },
];
