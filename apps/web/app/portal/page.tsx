"use client";

import React, { FormEvent, Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { PortalHomeView, PortalOrderView } from "@axora24/contracts";
import { CalendarCheck, FileText, FolderKanban, LogOut, Package, Receipt } from "lucide-react";
import { PortalError, portalClient } from "../lib/portal-client";
import { formatDate, formatDateTime, formatMoney, formatPercent, formatQuantity } from "../lib/format";

const PROJECT_STATUS: Record<string, string> = { PLANNED: "Planifié", IN_PROGRESS: "En cours", ON_HOLD: "Suspendu", COMPLETED: "Terminé", CLOSED: "Clos" };
const INVOICE_STATUS: Record<string, string> = { ISSUED: "À régler", PARTIALLY_PAID: "Partiellement réglée", PAID: "Réglée", RECORDED: "Reçue", APPROVED: "Approuvée" };
const ORDER_STATUS: Record<string, string> = { ISSUED: "Émise", PARTIALLY_RECEIVED: "Partiellement livrée", RECEIVED: "Livrée" };

function PortalHome(): React.ReactElement {
  const router = useRouter();
  const params = useSearchParams();
  const companyId = params.get("c") ?? "";
  const [home, setHome] = useState<PortalHomeView | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setHome(await portalClient.home());
    } catch (caught) {
      if (caught instanceof PortalError && caught.status === 401) router.replace(`/portal/login?c=${encodeURIComponent(companyId)}`);
      else setError("Service momentanément indisponible.");
    }
  }, [companyId, router]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!home) return <main className="portal-main">{error ? <div className="form-error">{error}</div> : <span className="loader" />}</main>;
  const nothing = home.projects.length + home.customerInvoices.length + home.documents.length + home.orders.length + home.supplierInvoices.length === 0;

  return (
    <main className="portal-main">
      <header className="portal-header">
        <div>
          <span className="eyebrow">Portail {home.me.kind === "CLIENT" ? "client" : "fournisseur"} · {home.me.companyName}</span>
          <h1>{home.me.rootName}</h1>
          <p>
            Connecté en tant que {home.me.fullName} ({home.me.email})
          </p>
        </div>
        <button
          className="portal-logout"
          type="button"
          onClick={async () => {
            await portalClient.logout().catch(() => undefined);
            router.replace(`/portal/login?c=${encodeURIComponent(companyId)}`);
          }}
        >
          <LogOut size={16} aria-hidden="true" /> Se déconnecter
        </button>
      </header>
      {nothing && <p className="portal-note">Aucun élément ne vous est encore partagé. Votre interlocuteur publiera ici projets, documents, commandes ou factures.</p>}

      {home.projects.map((project) => (
        <section key={project.id} className="portal-section">
          <h2>
            <FolderKanban size={18} aria-hidden="true" /> {project.name}
          </h2>
          <p className="portal-meta">
            {project.code} · {PROJECT_STATUS[project.status] ?? project.status} · {project.plannedStart ? formatDate(project.plannedStart) : "—"} → {project.plannedEnd ? formatDate(project.plannedEnd) : "—"}
          </p>
          <div className="portal-progress" role="img" aria-label={`Avancement ${project.progressPercent} %`}>
            <i style={{ width: `${Math.min(100, Number(project.progressPercent))}%` }} />
          </div>
          <p className="portal-meta">Avancement physique : {formatPercent(project.progressPercent)}</p>
          {project.milestones.length > 0 && (
            <ul className="portal-list">
              {project.milestones.map((milestone) => (
                <li key={milestone.name}>
                  <span>{milestone.name}</span>
                  <span>{milestone.achievedAt ? `Atteint le ${formatDate(milestone.achievedAt)}` : `Prévu le ${formatDate(milestone.dueDate)}`}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}

      {home.documents.length > 0 && (
        <section className="portal-section">
          <h2>
            <FileText size={18} aria-hidden="true" /> Documents
          </h2>
          <ul className="portal-list">
            {home.documents.map((document) => (
              <li key={document.id}>
                <span>
                  {document.code} — {document.title} (rév. {document.revision})
                </span>
                <a href={document.contentUrl}>Télécharger</a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {home.customerInvoices.length > 0 && (
        <section className="portal-section">
          <h2>
            <Receipt size={18} aria-hidden="true" /> Factures
          </h2>
          <ul className="portal-list">
            {home.customerInvoices.map((invoice) => (
              <li key={invoice.id}>
                <span>
                  {invoice.code} · émise le {invoice.issueDate ? formatDate(invoice.issueDate) : "—"} · échéance {invoice.dueDate ? formatDate(invoice.dueDate) : "—"}
                </span>
                <span>
                  {formatMoney(invoice.total, invoice.currency)} · reste {formatMoney(invoice.balance, invoice.currency)} · {INVOICE_STATUS[invoice.status] ?? invoice.status}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {home.orders.map((order) => (
        <OrderSection key={order.id} order={order} onAcknowledged={setHome} />
      ))}

      {home.supplierInvoices.length > 0 && (
        <section className="portal-section">
          <h2>
            <Receipt size={18} aria-hidden="true" /> Vos factures
          </h2>
          <ul className="portal-list">
            {home.supplierInvoices.map((invoice) => (
              <li key={invoice.id}>
                <span>
                  Réf. {invoice.supplierReference} · du {formatDate(invoice.invoiceDate)} · échéance {formatDate(invoice.dueDate)}
                </span>
                <span>
                  {formatMoney(invoice.total, invoice.currency)} · réglé {formatMoney(invoice.paidAmount, invoice.currency)} · {INVOICE_STATUS[invoice.status] ?? invoice.status}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="portal-footer">Espace externe AXORA — distinct de l&apos;application interne. Seuls les éléments explicitement partagés avec vous sont visibles.</p>
    </main>
  );
}

function OrderSection({ order, onAcknowledged }: { order: PortalOrderView; onAcknowledged: (home: PortalHomeView) => void }): React.ReactElement {
  const [date, setDate] = useState(order.expectedDate ?? "");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      onAcknowledged(await portalClient.acknowledge(order.id, date, note || undefined));
    } catch (caught) {
      setError(caught instanceof PortalError ? caught.message : "Envoi impossible.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="portal-section">
      <h2>
        <Package size={18} aria-hidden="true" /> Commande {order.code}
      </h2>
      <p className="portal-meta">
        {ORDER_STATUS[order.status] ?? order.status} · émise le {order.issuedAt ? formatDateTime(order.issuedAt) : "—"} · {formatMoney(order.total, order.currency)}
      </p>
      <ul className="portal-list">
        {order.lines.map((line) => (
          <li key={line.description}>
            <span>{line.description}</span>
            <span>
              {formatQuantity(line.quantity, 3)} {line.unitCode} × {formatMoney(line.unitPrice, order.currency)} · livré {formatQuantity(line.receivedQuantity, 3)}
            </span>
          </li>
        ))}
      </ul>
      {order.acknowledgement ? (
        <p className="portal-ack">
          <CalendarCheck size={16} aria-hidden="true" /> Livraison confirmée pour le {formatDate(order.acknowledgement.confirmedDate)} (accusé du {formatDateTime(order.acknowledgement.at)})
          {order.acknowledgement.note ? ` — ${order.acknowledgement.note}` : ""}
        </p>
      ) : order.status !== "RECEIVED" ? (
        <form className="portal-inline-form" onSubmit={submit}>
          <label>
            Date de livraison confirmée
            <input type="date" value={date} onChange={(event) => setDate(event.currentTarget.value)} required />
          </label>
          <label>
            Remarque
            <input type="text" value={note} onChange={(event) => setNote(event.currentTarget.value)} maxLength={500} />
          </label>
          <button className="primary-button" type="submit" disabled={saving}>
            Accuser réception
          </button>
          {error && <span className="form-error">{error}</span>}
        </form>
      ) : null}
    </section>
  );
}

export default function PortalPage(): React.ReactElement {
  return (
    <Suspense fallback={<span className="loader" />}>
      <PortalHome />
    </Suspense>
  );
}
