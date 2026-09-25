"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { AUTOMATION_EVENTS, type AutomationEventType, type WorkflowApprovalView, type WorkflowCondition, type WorkflowDefinitionCreated } from "@axora24/contracts";
import { AlertOctagon, CheckCircle2, GitBranch, Play, Plus, Send, Stamp, Trash2, Webhook, XCircle } from "lucide-react";
import {
  ACTION_LABEL,
  APPROVAL_STATUS_CHIP,
  APPROVAL_STATUS_LABEL,
  DELIVERY_STATUS_CHIP,
  DELIVERY_STATUS_LABEL,
  EVENT_OPTIONS,
  FIELD_LABEL,
  OPERATOR_LABEL,
  RESOURCE_LABEL,
  definitionPayload,
  describeConditions,
  emptyAction,
  operatorsFor,
  workflowApi,
  type ActionDraft,
} from "../../lib/modules/workflow";
import { formatDateTime } from "../../lib/format";
import { useMutation, useResource } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import { Button, DataTable, Empty, Feedback, Form, Loading, Metric, Metrics, Modal, PageHeader, Panel, SelectField, StatusChip, Tabs, TextAreaField, TextField, Toggle } from "../../components/ui";

type TabId = "approvals" | "definitions" | "executions" | "deliveries";

export default function WorkflowPage(): React.ReactElement {
  const session = useSession();
  const mutation = useMutation();
  const canRead = session.can("workflow.definition.read");
  const canManage = session.can("workflow.definition.manage");
  const [tab, setTab] = useState<TabId>(canRead ? "definitions" : "approvals");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<WorkflowDefinitionCreated | null>(null);
  const [deciding, setDeciding] = useState<{ approval: WorkflowApprovalView; decision: "APPROVED" | "REJECTED" } | null>(null);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("tab");
    if (requested === "approvals" || (canRead && (requested === "definitions" || requested === "executions" || requested === "deliveries"))) setTab(requested);
  }, [canRead]);

  const data = useResource(() =>
    Promise.all([
      workflowApi.summary(),
      workflowApi.approvals(),
      canRead ? workflowApi.definitions() : Promise.resolve([]),
      canRead ? workflowApi.executions() : Promise.resolve([]),
      canRead ? workflowApi.deliveries() : Promise.resolve([]),
    ]),
  );
  const roles = useResource(() => (creating && canManage ? workflowApi.roles() : Promise.resolve([])), [creating]);
  const [summary, approvals, definitions, executions, deliveries] = data.data ?? [null, [], [], [], []];

  async function act(action: () => Promise<unknown>, success: string): Promise<void> {
    const result = await mutation.run(action, success);
    if (result !== undefined) {
      setDeciding(null);
      await data.reload();
    }
  }

  return (
    <>
      <PageHeader
        breadcrumb="Pilotage / Workflows"
        title="Workflows & approbations"
        subtitle="Événement → condition → action : notifications, approbations à quatre yeux avec escalade, webhooks signés. Chaque exécution est journalisée, succès comme échec."
        onRefresh={() => void data.reload()}
        actions={
          canManage && (
            <>
              <Button onClick={() => void act(() => workflowApi.run(), "Événements en attente traités.")}>
                <Play size={15} aria-hidden="true" /> Traiter maintenant
              </Button>
              <Button variant="primary" onClick={() => setCreating(true)}>
                <Plus size={15} aria-hidden="true" /> Nouveau workflow
              </Button>
            </>
          )
        }
      />
      <Feedback error={data.error || mutation.error} notice={mutation.notice} />
      {data.loading && !data.data ? (
        <Loading label="Chargement des workflows…" />
      ) : (
        <>
          {summary && (
            <Metrics label="Indicateurs d'automatisation">
              <Metric icon={<GitBranch size={20} />} tone="blue" label="Workflows actifs" value={String(summary.activeDefinitions)} detail={`${summary.pendingEvents} événement(s) en file`} />
              <Metric icon={<Stamp size={20} />} tone={summary.overdueApprovals > 0 ? "red" : summary.pendingApprovals > 0 ? "amber" : "green"} label="Approbations en attente" value={String(summary.pendingApprovals)} detail={`${summary.overdueApprovals} hors délai`} />
              <Metric icon={<AlertOctagon size={20} />} tone={summary.failedExecutions > 0 ? "red" : "green"} label="Exécutions en échec" value={String(summary.failedExecutions)} detail="Journal consultable ci-dessous" />
              <Metric icon={<Webhook size={20} />} tone={summary.failedDeliveries > 0 ? "red" : "green"} label="Webhooks en échec" value={String(summary.failedDeliveries)} detail="Après 5 tentatives (1 min → 2 h)" />
            </Metrics>
          )}
          <Tabs
            tabs={[
              ...(canRead ? [{ id: "definitions" as const, label: "Workflows", count: definitions.filter((definition) => definition.active).length }] : []),
              { id: "approvals" as const, label: "Approbations", count: approvals.filter((approval) => approval.status === "PENDING").length },
              ...(canRead
                ? [
                    { id: "executions" as const, label: "Journal d'exécution", count: executions.length },
                    { id: "deliveries" as const, label: "Webhooks", count: deliveries.length },
                  ]
                : []),
            ]}
            active={tab}
            onChange={setTab}
          />
          <div className="stack">
            {tab === "definitions" && (
              <Panel title="Workflows configurés" subtitle="Une modification crée une nouvelle version ; une seule version active par code. Les définitions ne s'appliquent qu'aux événements postérieurs à leur création.">
                <DataTable
                  rows={definitions}
                  empty={<Empty icon={<GitBranch size={22} />} title="Aucun workflow" body="Exemple : demande d'achat soumise, montant > 10 000 → approbation DAF sous 24 h, escalade DG." />}
                  columns={[
                    {
                      key: "name",
                      header: "Workflow",
                      render: (row) => (
                        <>
                          <strong>{row.name}</strong>
                          <small>
                            {row.code} · v{row.version} · par {row.createdByName}
                          </small>
                        </>
                      ),
                    },
                    {
                      key: "rule",
                      header: "Règle",
                      render: (row) => (
                        <>
                          <strong>{row.eventLabel}</strong>
                          <small>Si {describeConditions(row.conditions)}</small>
                        </>
                      ),
                    },
                    {
                      key: "actions",
                      header: "Actions",
                      render: (row) => (
                        <small className="workflow-actions">
                          {row.actions
                            .map((action) =>
                              action.type === "NOTIFY"
                                ? `Notifier ${action.roleName}`
                                : action.type === "REQUIRE_APPROVAL"
                                  ? `Approbation ${action.approverRoleName} sous ${action.slaHours} h${action.escalationRoleName ? `, escalade ${action.escalationRoleName}` : ""}`
                                  : `Webhook ${hostOf(action.url)}`,
                            )
                            .join(" · ")}
                        </small>
                      ),
                    },
                    { key: "runs", header: "Exécutions", align: "right", render: (row) => (row.failures > 0 ? `${row.executions} (${row.failures} en échec)` : String(row.executions)) },
                    {
                      key: "active",
                      header: "Actif",
                      render: (row) =>
                        canManage ? (
                          <Toggle label={row.active ? "Actif" : "Inactif"} checked={row.active} onChange={(active) => void act(() => workflowApi.setActive(row.id, active), active ? "Version activée (les autres versions sont désactivées)." : "Workflow désactivé.")} />
                        ) : (
                          <StatusChip status={row.active ? "active" : "archived"} label={row.active ? "Actif" : "Inactif"} />
                        ),
                    },
                  ]}
                />
              </Panel>
            )}

            {tab === "approvals" && (
              <Panel title="Approbations de workflow" subtitle="Décision par un titulaire du rôle approbateur, distinct du demandeur. Tant qu'elle est en attente ou refusée, l'approbation métier de la pièce est bloquée.">
                <DataTable
                  rows={approvals}
                  empty={<Empty icon={<Stamp size={22} />} title="Aucune approbation" body="Les approbations naissent des workflows comportant l'action « Exiger une approbation »." />}
                  columns={[
                    {
                      key: "title",
                      header: "Demande",
                      render: (row) => (
                        <>
                          <strong>{row.title}</strong>
                          <small>
                            {row.code} · {RESOURCE_LABEL[row.resourceType] ?? row.resourceType}
                            {row.link && (
                              <>
                                {" · "}
                                <Link href={row.link}>ouvrir la pièce</Link>
                              </>
                            )}
                          </small>
                        </>
                      ),
                    },
                    { key: "requester", header: "Demandeur", render: (row) => row.requesterName ?? "Système" },
                    { key: "role", header: "Rôle approbateur", render: (row) => row.approverRoleName },
                    {
                      key: "due",
                      header: "Échéance",
                      render: (row) => (
                        <>
                          <strong className={row.overdue ? "text-danger" : undefined}>{formatDateTime(row.dueAt)}</strong>
                          {row.escalatedAt && <small>Escaladée le {formatDateTime(row.escalatedAt)}</small>}
                        </>
                      ),
                    },
                    {
                      key: "status",
                      header: "État",
                      render: (row) => (
                        <>
                          <StatusChip status={row.overdue ? "blocked" : (APPROVAL_STATUS_CHIP[row.status] ?? "pending")} label={row.overdue ? "Hors délai" : APPROVAL_STATUS_LABEL[row.status]} />
                          {row.decidedByName && (
                            <small>
                              {row.decidedByName} · {formatDateTime(row.decidedAt)}
                              {row.decisionNote ? ` — ${row.decisionNote}` : ""}
                            </small>
                          )}
                        </>
                      ),
                    },
                    {
                      key: "decide",
                      header: "",
                      render: (row) =>
                        row.canDecide ? (
                          <span className="row-actions">
                            <Button variant="primary" onClick={() => setDeciding({ approval: row, decision: "APPROVED" })}>
                              <CheckCircle2 size={14} aria-hidden="true" /> Approuver
                            </Button>
                            <Button variant="ghost" onClick={() => setDeciding({ approval: row, decision: "REJECTED" })}>
                              <XCircle size={14} aria-hidden="true" /> Refuser
                            </Button>
                          </span>
                        ) : null,
                    },
                  ]}
                />
              </Panel>
            )}

            {tab === "executions" && (
              <Panel title="Journal d'exécution" subtitle="Append-only : une exécution par (workflow, événement), jamais rejouée ni modifiée.">
                <DataTable
                  rows={executions}
                  empty={<Empty icon={<Send size={22} />} title="Aucune exécution" body="Les exécutions apparaissent dès qu'un événement satisfait les conditions d'un workflow actif." />}
                  columns={[
                    { key: "at", header: "Date", render: (row) => formatDateTime(row.finishedAt) },
                    {
                      key: "workflow",
                      header: "Workflow",
                      render: (row) => (
                        <>
                          <strong>{row.definitionName}</strong>
                          <small>
                            {row.definitionCode} · {row.eventLabel}
                          </small>
                        </>
                      ),
                    },
                    {
                      key: "log",
                      header: "Actions",
                      render: (row) => (
                        <ul className="workflow-log">
                          {row.log.map((entry, index) => (
                            <li key={index} className={entry.ok ? "ok" : "ko"}>
                              {ACTION_LABEL[entry.action] ?? entry.action} — {entry.detail}
                            </li>
                          ))}
                          {row.log.length === 0 && row.error && <li className="ko">{row.error}</li>}
                        </ul>
                      ),
                    },
                    { key: "status", header: "Résultat", render: (row) => <StatusChip status={row.status === "SUCCEEDED" ? "done" : "blocked"} label={row.status === "SUCCEEDED" ? "Réussie" : "Échec"} /> },
                  ]}
                />
              </Panel>
            )}

            {tab === "deliveries" && (
              <Panel title="Webhooks sortants" subtitle="Signature HMAC-SHA256 de « horodatage.corps » (en-têtes X-Axora-Timestamp / X-Axora-Signature), re-signée à chaque tentative ; redirections non suivies.">
                <DataTable
                  rows={deliveries}
                  empty={<Empty icon={<Webhook size={22} />} title="Aucune livraison" body="Ajoutez une action « Webhook signé » à un workflow pour notifier un système externe." />}
                  columns={[
                    { key: "at", header: "Créée", render: (row) => formatDateTime(row.createdAt) },
                    {
                      key: "target",
                      header: "Cible",
                      render: (row) => (
                        <>
                          <strong>{hostOf(row.url)}</strong>
                          <small>{row.definitionCode}</small>
                        </>
                      ),
                    },
                    {
                      key: "status",
                      header: "État",
                      render: (row) => (
                        <>
                          <StatusChip status={DELIVERY_STATUS_CHIP[row.status] ?? "pending"} label={DELIVERY_STATUS_LABEL[row.status]} />
                          <small>
                            {row.attempts} tentative(s){row.lastStatusCode !== null ? ` · HTTP ${row.lastStatusCode}` : ""}
                            {row.lastError ? ` · ${row.lastError}` : ""}
                          </small>
                        </>
                      ),
                    },
                    { key: "next", header: "Prochaine tentative", render: (row) => (row.status === "PENDING" && row.nextAttemptAt ? formatDateTime(row.nextAttemptAt) : row.deliveredAt ? `Livrée ${formatDateTime(row.deliveredAt)}` : "—") },
                    {
                      key: "retry",
                      header: "",
                      render: (row) =>
                        row.status === "FAILED" && canManage ? (
                          <Button onClick={() => void act(() => workflowApi.retry(row.id), "Nouvelle tentative effectuée.")}>
                            <Send size={14} aria-hidden="true" /> Relancer
                          </Button>
                        ) : null,
                    },
                  ]}
                />
              </Panel>
            )}
          </div>
        </>
      )}

      {creating && (
        <Modal title="Nouveau workflow" onClose={() => setCreating(false)} wide>
          <Feedback error={mutation.error || roles.error} />
          <DefinitionForm
            roles={(roles.data ?? []).map((role) => ({ value: role.id, label: role.name }))}
            saving={mutation.saving}
            onSubmit={async (input) => {
              const result = await mutation.run(() => workflowApi.create(input), "Workflow créé.");
              if (result) {
                setCreating(false);
                if (result.webhookSecrets.length > 0) setCreated(result);
                await data.reload();
              }
            }}
          />
        </Modal>
      )}

      {deciding && (
        <Modal title={`${deciding.decision === "APPROVED" ? "Approuver" : "Refuser"} ${deciding.approval.code}`} onClose={() => setDeciding(null)}>
          <Feedback error={mutation.error} />
          <DecisionForm
            decision={deciding.decision}
            saving={mutation.saving}
            onSubmit={(note) => act(() => workflowApi.decide(deciding.approval.id, deciding.decision, note || undefined), deciding.decision === "APPROVED" ? "Approbation accordée." : "Approbation refusée.")}
          />
        </Modal>
      )}

      {created && <SecretReveal created={created} onClose={() => setCreated(null)} />}
    </>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function DecisionForm({ decision, saving, onSubmit }: { decision: "APPROVED" | "REJECTED"; saving: boolean; onSubmit: (note: string) => Promise<void> }): React.ReactElement {
  const [note, setNote] = useState("");
  return (
    <Form columns={1} submitLabel={decision === "APPROVED" ? "Approuver" : "Refuser"} saving={saving} onSubmit={() => onSubmit(note)}>
      <TextAreaField label={decision === "APPROVED" ? "Commentaire (facultatif)" : "Motif du refus"} value={note} onChange={setNote} required={decision === "REJECTED"} />
    </Form>
  );
}

function DefinitionForm({ roles, saving, onSubmit }: { roles: Array<{ value: string; label: string }>; saving: boolean; onSubmit: (input: Record<string, unknown>) => Promise<void> }): React.ReactElement {
  const [eventType, setEventType] = useState<AutomationEventType>("procurement.request.submitted");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [conditions, setConditions] = useState<WorkflowCondition[]>([]);
  const [actions, setActions] = useState<ActionDraft[]>([emptyAction("NOTIFY")]);
  const fields = Object.keys(AUTOMATION_EVENTS[eventType].fields);
  const gated = (["PurchaseRequest", "SupplierInvoice", "SubcontractStatement"] as string[]).includes(AUTOMATION_EVENTS[eventType].resourceType);

  const updateAction = (index: number, patch: Partial<Record<string, string>>) => setActions((current) => current.map((action, position) => (position === index ? ({ ...action, ...patch } as ActionDraft) : action)));

  return (
    <Form submitLabel="Créer le workflow" saving={saving} onSubmit={() => onSubmit(definitionPayload({ code, name, description, eventType, conditions, actions }))}>
      <TextField label="Code" value={code} onChange={setCode} required hint="Majuscules, chiffres, - ou _. Même code = nouvelle version." />
      <TextField label="Nom" value={name} onChange={setName} required />
      <SelectField
        label="Événement déclencheur"
        value={eventType}
        onChange={(value) => {
          setEventType(value as AutomationEventType);
          setConditions([]);
        }}
        options={EVENT_OPTIONS}
        required
        wide
      />
      <div className="field wide">
        <span className="field-note">Conditions (toutes requises)</span>
        <div className="line-editor">
          {conditions.map((condition, index) => (
            <div className="line-editor-row workflow-condition-row" key={index}>
              <select aria-label={`Champ condition ${index + 1}`} value={condition.field} onChange={(event) => setConditions((current) => current.map((item, position) => (position === index ? { field: event.currentTarget.value, operator: operatorsFor(eventType, event.currentTarget.value)[0]!, value: "" } : item)))}>
                {fields.map((field) => (
                  <option key={field} value={field}>
                    {FIELD_LABEL[field] ?? field}
                  </option>
                ))}
              </select>
              <select aria-label={`Opérateur condition ${index + 1}`} value={condition.operator} onChange={(event) => setConditions((current) => current.map((item, position) => (position === index ? { ...item, operator: event.currentTarget.value as WorkflowCondition["operator"] } : item)))}>
                {operatorsFor(eventType, condition.field).map((operator) => (
                  <option key={operator} value={operator}>
                    {OPERATOR_LABEL[operator]}
                  </option>
                ))}
              </select>
              <input aria-label={`Valeur condition ${index + 1}`} placeholder="Valeur" value={condition.value} onChange={(event) => setConditions((current) => current.map((item, position) => (position === index ? { ...item, value: event.currentTarget.value } : item)))} required />
              <button type="button" className="icon-button" aria-label={`Retirer la condition ${index + 1}`} onClick={() => setConditions((current) => current.filter((_, position) => position !== index))}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <Button variant="ghost" onClick={() => setConditions((current) => [...current, { field: fields[0]!, operator: operatorsFor(eventType, fields[0]!)[0]!, value: "" }])}>
            <Plus size={14} aria-hidden="true" /> Ajouter une condition
          </Button>
        </div>
      </div>
      <div className="field wide">
        <span className="field-note">
          Actions, exécutées dans l&apos;ordre. Gabarits disponibles : {fields.map((field) => `{{${field}}}`).join(" ")}
        </span>
        <div className="workflow-action-list">
          {actions.map((action, index) => (
            <fieldset className="workflow-action" key={index}>
              <legend>
                Action {index + 1}
                <button type="button" className="icon-button" aria-label={`Retirer l'action ${index + 1}`} disabled={actions.length === 1} onClick={() => setActions((current) => current.filter((_, position) => position !== index))}>
                  <Trash2 size={14} />
                </button>
              </legend>
              <SelectField
                label="Type"
                value={action.type}
                onChange={(value) => setActions((current) => current.map((item, position) => (position === index ? emptyAction(value as ActionDraft["type"]) : item)))}
                options={[
                  { value: "NOTIFY", label: "Notifier un rôle" },
                  ...(gated ? [{ value: "REQUIRE_APPROVAL", label: "Exiger une approbation" }] : []),
                  { value: "WEBHOOK", label: "Webhook signé" },
                ]}
                required
              />
              {action.type === "NOTIFY" && (
                <>
                  <SelectField label="Rôle destinataire" value={action.roleId} onChange={(value) => updateAction(index, { roleId: value })} options={roles} required />
                  <TextField label="Titre" value={action.title} onChange={(value) => updateAction(index, { title: value })} required />
                  <TextField label="Message" value={action.body} onChange={(value) => updateAction(index, { body: value })} required />
                </>
              )}
              {action.type === "REQUIRE_APPROVAL" && (
                <>
                  <SelectField label="Rôle approbateur" value={action.approverRoleId} onChange={(value) => updateAction(index, { approverRoleId: value })} options={roles} required />
                  <SelectField label="Rôle d'escalade" value={action.escalationRoleId} onChange={(value) => updateAction(index, { escalationRoleId: value })} options={roles.filter((role) => role.value !== action.approverRoleId)} emptyLabel="Aucun (relance des approbateurs)" />
                  <TextField label="Délai (heures)" value={action.slaHours} onChange={(value) => updateAction(index, { slaHours: value })} required />
                  <TextField label="Intitulé" value={action.title} onChange={(value) => updateAction(index, { title: value })} required />
                </>
              )}
              {action.type === "WEBHOOK" && <TextField label="URL HTTPS" value={action.url} onChange={(value) => updateAction(index, { url: value })} required hint="Le secret de signature sera affiché une seule fois." />}
            </fieldset>
          ))}
          <Button variant="ghost" onClick={() => setActions((current) => (current.length < 6 ? [...current, emptyAction("NOTIFY")] : current))}>
            <Plus size={14} aria-hidden="true" /> Ajouter une action
          </Button>
        </div>
      </div>
      <TextAreaField label="Description" value={description} onChange={setDescription} />
    </Form>
  );
}

/** Secrets de signature montres une seule fois (seule leur forme chiffree est conservee). */
function SecretReveal({ created, onClose }: { created: WorkflowDefinitionCreated; onClose: () => void }): React.ReactElement {
  return (
    <Modal title={`Secrets de signature — ${created.definition.code} v${created.definition.version}`} onClose={onClose}>
      <div className="token-box">
        <p>Transmettez ces secrets au(x) destinataire(s) maintenant : ils ne seront plus jamais affichés. Vérification : HMAC-SHA256(secret, horodatage + « . » + corps) = X-Axora-Signature (préfixe v1=), horodatage de moins de 5 minutes.</p>
        {created.webhookSecrets.map((entry) => (
          <div key={entry.url}>
            <small>{entry.url}</small>
            <code>{entry.secret}</code>
          </div>
        ))}
      </div>
    </Modal>
  );
}
