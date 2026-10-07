"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Building2, CalendarClock, ExternalLink, Mail, MapPin, Phone, RefreshCw, UserRound } from "lucide-react";
import type { CrmActivityView, CrmOpportunityView } from "@axora24/contracts";
import { ApiError } from "../lib/api";
import {
  crmDirectoryApi,
  type CrmAccount360View,
  type CrmAssigneeView,
  type CrmNextActionView,
} from "../lib/modules/crm";
import { useSession } from "../lib/session";
import { CrmNextActions } from "./crm-next-actions";
import styles from "./crm-account-360.module.css";

function amount(value: string, currency: string): string {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? new Intl.NumberFormat("fr-FR", { style: "currency", currency }).format(parsed)
    : `${value} ${currency}`;
}

function date(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

function errorMessage(caught: unknown): string {
  return caught instanceof ApiError ? caught.message : "Le compte 360 est momentanément indisponible.";
}

export function CrmAccount360({ accountId }: { accountId: string }): React.ReactElement {
  const { can } = useSession();
  const canReadActions = can("crm.nextaction.read");
  const canManageActions = can("crm.nextaction.manage");
  const canReadTimeline = can("crm.activity.read");
  const [view, setView] = useState<CrmAccount360View | null>(null);
  const [timeline, setTimeline] = useState<CrmActivityView[]>([]);
  const [actions, setActions] = useState<CrmNextActionView[]>([]);
  const [assignees, setAssignees] = useState<CrmAssigneeView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let supplementalFailed = false;
      const optional = async <T,>(request: Promise<T>, fallback: T): Promise<T> => {
        try { return await request; }
        catch { supplementalFailed = true; return fallback; }
      };
      const [nextView, nextTimeline, nextActions, nextAssignees] = await Promise.all([
        crmDirectoryApi.account360(accountId),
        canReadTimeline ? optional(crmDirectoryApi.accountTimeline(accountId), null) : Promise.resolve(null),
        canReadActions ? optional(crmDirectoryApi.nextActions(accountId), null) : Promise.resolve(null),
        canManageActions ? optional(crmDirectoryApi.assignees(), []) : Promise.resolve([]),
      ]);
      setView(nextView);
      setTimeline(nextTimeline ?? nextView.timeline.items);
      setActions(nextActions ?? nextView.nextActions.items);
      setAssignees(nextAssignees);
      setError(supplementalFailed ? "Certaines données complémentaires sont indisponibles. Les informations consolidées du compte restent affichées." : "");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [accountId, canManageActions, canReadActions, canReadTimeline]);

  useEffect(() => { void load(); }, [load]);

  const currencies = useMemo(() => {
    const grouped = new Map<string, CrmOpportunityView[]>();
    for (const opportunity of view?.opportunities.items ?? []) {
      grouped.set(opportunity.currency, [...(grouped.get(opportunity.currency) ?? []), opportunity]);
    }
    return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [view?.opportunities.items]);

  if (loading && !view) return <main className={styles.state} role="status" aria-live="polite"><span className={styles.loader} aria-hidden="true" /><strong>Chargement du compte 360…</strong><span>Contacts, opportunités et engagements sont synchronisés.</span></main>;

  if (error && !view) return <main className={styles.state}><Building2 aria-hidden="true" /><h1>Compte indisponible</h1><div className={styles.error} role="alert">{error}</div><button type="button" className={styles.primaryButton} onClick={() => void load()}><RefreshCw size={17} aria-hidden="true" />Réessayer</button><Link href="/crm">Retour au CRM</Link></main>;

  if (!view) return <main className={styles.state}><h1>Compte introuvable</h1><Link href="/crm">Retour au CRM</Link></main>;

  const { account } = view;
  const contacts = view.contacts.items;
  const opportunities = view.opportunities.items;
  const openActions = actions.filter(item => item.status === "OPEN").length;
  const overdueActions = actions.filter(item => item.status === "OPEN" && new Date(item.dueAt).getTime() < Date.now()).length;
  return <main className={styles.page} aria-busy={loading}>
    <Link className={styles.backLink} href="/crm"><ArrowLeft size={16} aria-hidden="true" />Répertoire CRM</Link>
    <header className={styles.identity}>
      <div className={styles.monogram} aria-hidden="true">{account.name.slice(0, 2).toUpperCase()}</div>
      <div className={styles.identityMain}>
        <div className={styles.titleLine}><h1>{account.name}</h1>{account.archivedAt && <span className={styles.archived}>Archivé</span>}</div>
        <p>{account.industry || "Secteur non renseigné"}</p>
        <address>
          {(account.city || account.country) && <span><MapPin size={15} aria-hidden="true" />{[account.city, account.country].filter(Boolean).join(", ")}</span>}
          {account.email && <a href={`mailto:${account.email}`}><Mail size={15} aria-hidden="true" />{account.email}</a>}
          {account.phone && <a href={`tel:${account.phone}`}><Phone size={15} aria-hidden="true" />{account.phone}</a>}
          {account.website && <a href={account.website} target="_blank" rel="noreferrer"><ExternalLink size={15} aria-hidden="true" />Site web<span className={styles.srOnly}> (nouvel onglet)</span></a>}
        </address>
      </div>
      <dl className={styles.counters} aria-label="Repères du compte">
        <div><dt>Contacts</dt><dd>{contacts.length}</dd></div>
        <div><dt>Opportunités</dt><dd>{opportunities.length}</dd></div>
        <div><dt>Actions ouvertes</dt><dd>{openActions}</dd></div>
        <div className={overdueActions ? styles.alertCounter : ""}><dt>En retard</dt><dd>{overdueActions}</dd></div>
      </dl>
    </header>

    {error && <div className={styles.error} role="alert">{error}<button type="button" onClick={() => void load()}>Actualiser</button></div>}

    <div className={styles.mainGrid}>
      {view.nextActions.available ? <CrmNextActions accountId={accountId} actions={actions} assignees={assignees} canManage={canManageActions} onChanged={load} /> : <section className={styles.actions}><header className={styles.sectionHead}><div><h2>Prochaines actions</h2><p>Engagements classés par échéance.</p></div></header><p className={styles.emptyLine}>Vous n’avez pas la permission de consulter les prochaines actions.</p></section>}
      <aside className={styles.sideRail}>
        <section className={styles.section} aria-labelledby="contacts-title">
          <header className={styles.sectionHead}><div><h2 id="contacts-title">Contacts</h2><p>Interlocuteurs rattachés au compte.</p></div><UserRound aria-hidden="true" /></header>
          {!view.contacts.available ? <p className={styles.emptyLine}>Contacts non accessibles avec vos permissions.</p> : contacts.length === 0 ? <p className={styles.emptyLine}>Aucun contact rattaché</p> : <ul className={styles.contactList}>{contacts.map(contact => <li key={contact.id}><div><strong>{contact.fullName}</strong>{contact.isPrimary && <span>Principal</span>}</div><p>{contact.jobTitle || "Fonction non renseignée"}</p>{contact.email && <a href={`mailto:${contact.email}`}>{contact.email}</a>}</li>)}</ul>}
        </section>
      </aside>
    </div>

    <section className={styles.section} aria-labelledby="opportunities-title">
      <header className={styles.sectionHead}><div><h2 id="opportunities-title">Opportunités</h2><p>Les montants restent séparés par devise, sans agrégation implicite.</p></div></header>
      {!view.opportunities.available ? <p className={styles.emptyLine}>Opportunités non accessibles avec vos permissions.</p> : currencies.length === 0 ? <p className={styles.emptyLine}>Aucune opportunité pour ce compte</p> : <div className={styles.currencyGrid}>{currencies.map(([currency, items]) => <section key={currency} className={styles.currencyLane} aria-labelledby={`currency-${currency}`}>
        <header><h3 id={`currency-${currency}`}>{currency}</h3><span>{items.length} opportunité{items.length > 1 ? "s" : ""}</span></header>
        <ul>{items.map(opportunity => <li key={opportunity.id}><div><strong>{opportunity.name}</strong><span>{opportunity.stageName}</span></div><b>{amount(opportunity.amount, opportunity.currency)}</b><small>{opportunity.expectedCloseDate ? `Clôture visée ${new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(new Date(opportunity.expectedCloseDate))}` : "Échéance non renseignée"}</small></li>)}</ul>
      </section>)}</div>}
    </section>

    <section className={styles.timeline} aria-labelledby="timeline-title">
      <header className={styles.sectionHead}><div><h2 id="timeline-title">Chronologie</h2><p>Historique immuable des interactions liées au compte.</p></div><CalendarClock aria-hidden="true" /></header>
      {!view.timeline.available ? <p className={styles.emptyLine}>Chronologie non accessible avec vos permissions.</p> : timeline.length === 0 ? <p className={styles.emptyLine}>Aucune activité enregistrée</p> : <ol>{[...timeline].sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()).map(item => <li key={item.id}><time dateTime={item.occurredAt}>{date(item.occurredAt)}</time><div><strong>{item.subject}</strong><span>{item.type.replaceAll("_", " ")}</span>{item.body && <p>{item.body}</p>}</div></li>)}</ol>}
    </section>
  </main>;
}
