"use client";

import React, { useMemo, useState } from "react";
import { CalendarClock, Check, Plus, RotateCw, X } from "lucide-react";
import { crmError } from "../lib/crm-error";
import {
  crmDirectoryApi,
  type CrmAssigneeView,
  type CrmNextActionPriority,
  type CrmNextActionView,
} from "../lib/modules/crm";
import styles from "./crm-account-360.module.css";

const PRIORITIES: Array<{ value: CrmNextActionPriority; label: string }> = [
  { value: "LOW", label: "Basse" },
  { value: "MEDIUM", label: "Normale" },
  { value: "HIGH", label: "Haute" },
  { value: "URGENT", label: "Urgente" },
];

const STATUS_LABEL = { OPEN: "Ouverte", COMPLETED: "Terminée", CANCELLED: "Annulée" } as const;
const PRIORITY_LABEL = Object.fromEntries(PRIORITIES.map((item) => [item.value, item.label])) as Record<CrmNextActionPriority, string>;

function dateTimeLocal(iso?: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function readableDate(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

function isOverdue(action: CrmNextActionView): boolean {
  return action.status === "OPEN" && new Date(action.dueAt).getTime() < Date.now();
}

interface Props {
  accountId: string;
  actions: CrmNextActionView[];
  assignees: CrmAssigneeView[];
  canManage: boolean;
  onChanged: () => Promise<void> | void;
}

export function CrmNextActions({ accountId, actions, assignees, canManage, onChanged }: Props): React.ReactElement {
  const [creating, setCreating] = useState(false);
  const [rescheduling, setRescheduling] = useState<CrmNextActionView | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [priority, setPriority] = useState<CrmNextActionPriority>("MEDIUM");
  const [assigneeUserId, setAssigneeUserId] = useState("");
  const [rescheduleAt, setRescheduleAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const sorted = useMemo(() => [...actions].sort((a, b) => {
    if (a.status === "OPEN" && b.status !== "OPEN") return -1;
    if (a.status !== "OPEN" && b.status === "OPEN") return 1;
    return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
  }), [actions]);

  async function run(action: () => Promise<unknown>, fallback: string): Promise<boolean> {
    if (saving) return false;
    setSaving(true);
    setError("");
    try {
      await action();
      await onChanged();
      return true;
    } catch (caught) {
      setError(crmError(caught, fallback));
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function create(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!title.trim() || !dueAt) return;
    const created = await run(() => crmDirectoryApi.createNextAction({
      accountId,
      title: title.trim(),
      details: description.trim() || null,
      dueAt: new Date(dueAt).toISOString(),
      priority,
      assigneeUserId,
    }), "Création de l’action impossible.");
    if (created) {
      setCreating(false);
      setTitle(""); setDescription(""); setDueAt(""); setPriority("MEDIUM"); setAssigneeUserId("");
    }
  }

  async function reschedule(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!rescheduling || !rescheduleAt) return;
    const saved = await run(
      () => crmDirectoryApi.updateNextAction(rescheduling.id, { dueAt: new Date(rescheduleAt).toISOString(), expectedVersion: rescheduling.version }),
      "Replanification impossible.",
    );
    if (saved) setRescheduling(null);
  }

  return <section className={styles.actions} aria-labelledby="next-actions-title">
    <header className={styles.sectionHead}>
      <div><h2 id="next-actions-title">Prochaines actions</h2><p>Engagements classés par échéance, comme un tableau de départs.</p></div>
      {canManage ? <button type="button" className={styles.primaryButton} onClick={() => { setCreating(value => !value); setError(""); }}><Plus size={17} aria-hidden="true" />Nouvelle action</button> : <span className={styles.readOnly}>Lecture seule</span>}
    </header>

    {error && <div className={styles.error} role="alert">{error}</div>}

    {creating && <form className={styles.actionForm} aria-label="Créer une prochaine action" onSubmit={event => void create(event)}>
      <label>Intitulé<input value={title} onChange={event => setTitle(event.currentTarget.value)} required maxLength={200} autoFocus /></label>
      <label>Échéance<input type="datetime-local" value={dueAt} onChange={event => setDueAt(event.currentTarget.value)} required /></label>
      <label>Priorité<select value={priority} onChange={event => setPriority(event.currentTarget.value as CrmNextActionPriority)}>{PRIORITIES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      <label>Assignée à<select value={assigneeUserId} onChange={event => setAssigneeUserId(event.currentTarget.value)} required><option value="">Sélectionner une personne</option>{assignees.map(item => <option key={item.id} value={item.id}>{item.fullName}</option>)}</select></label>
      <label className={styles.wideField}>Notes<textarea value={description} onChange={event => setDescription(event.currentTarget.value)} rows={2} maxLength={1000} /></label>
      <div className={styles.formActions}><button type="button" className={styles.secondaryButton} onClick={() => setCreating(false)} disabled={saving}>Fermer</button><button type="submit" className={styles.primaryButton} disabled={saving || !title.trim() || !dueAt || !assigneeUserId}>{saving ? "Création…" : "Créer l’action"}</button></div>
    </form>}

    {sorted.length === 0 ? <div className={styles.empty}><CalendarClock aria-hidden="true" /><strong>Aucune prochaine action</strong><span>Ajoutez un engagement daté pour maintenir le suivi commercial.</span></div> : <ol className={styles.departures}>
      {sorted.map(action => <li key={action.id} className={`${styles.departure} ${isOverdue(action) ? styles.overdue : ""}`}>
        <time dateTime={action.dueAt}><span>{new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short" }).format(new Date(action.dueAt))}</span>{new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(new Date(action.dueAt))}</time>
        <div className={styles.actionBody}>
          <div className={styles.actionTitle}><strong>{action.title}</strong><span className={`${styles.status} ${styles[`priority${action.priority}`]}`}>{PRIORITY_LABEL[action.priority]}</span><span className={styles.status}>{STATUS_LABEL[action.status]}</span></div>
          {action.details && <p>{action.details}</p>}
          <small>{action.assigneeName} · Échéance {readableDate(action.dueAt)}{isOverdue(action) ? " · En retard" : ""}</small>
          {rescheduling?.id === action.id && <form className={styles.rescheduleForm} aria-label={`Replanifier ${action.title}`} onSubmit={event => void reschedule(event)}><label>Nouvelle échéance<input type="datetime-local" value={rescheduleAt} onChange={event => setRescheduleAt(event.currentTarget.value)} required autoFocus /></label><button type="submit" className={styles.primaryButton} disabled={saving}>Enregistrer l’échéance</button><button type="button" className={styles.secondaryButton} onClick={() => setRescheduling(null)}>Annuler</button></form>}
        </div>
        {canManage && action.status === "OPEN" && <div className={styles.rowActions}>
          <button type="button" aria-label={`Replanifier ${action.title}`} onClick={() => { setRescheduling(action); setRescheduleAt(dateTimeLocal(action.dueAt)); }}><RotateCw size={15} aria-hidden="true" />Replanifier</button>
          <button type="button" aria-label={`Terminer ${action.title}`} onClick={() => void run(() => crmDirectoryApi.completeNextAction(action.id, action.version), "Clôture impossible.")} disabled={saving}><Check size={15} aria-hidden="true" />Terminer</button>
          <button type="button" aria-label={`Annuler ${action.title}`} onClick={() => void run(() => crmDirectoryApi.cancelNextAction(action.id, action.version), "Annulation impossible.")} disabled={saving}><X size={15} aria-hidden="true" />Annuler</button>
        </div>}
      </li>)}
    </ol>}
  </section>;
}
