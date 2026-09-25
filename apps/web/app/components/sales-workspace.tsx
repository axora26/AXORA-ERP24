"use client";

import React from "react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { ContractSummaryView, DqeSummaryView, QuoteSummaryView, QuoteView } from "@axora24/contracts";
import {
  Ban,
  CheckCircle2,
  ChevronRight,
  FileSignature,
  Loader2,
  Plus,
  Receipt,
  RefreshCw,
  Send,
} from "lucide-react";
import { ApiError, estimationApi, salesApi } from "../lib/api";
import { formatMoney, formatQuantity } from "../lib/format";

interface SalesData {
  finalizedDqes: DqeSummaryView[];
  quotes: QuoteSummaryView[];
  contracts: ContractSummaryView[];
}

const EMPTY_QUOTE_FORM = { dqeId: "", code: "", title: "" };
const EMPTY_CONTRACT_FORM = { code: "", title: "" };

const QUOTE_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Brouillon",
  SUBMITTED: "Soumis",
  ACCEPTED: "Accepté",
  REJECTED: "Rejeté",
};

const CONTRACT_STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Actif",
  ARCHIVED: "Archivé",
};

/**
 * Espace Devis & Contrats (INC-04).
 * Un devis n'existe que depuis un DQE FINALIZED ; un contrat n'existe que
 * depuis un devis ACCEPTED. Toutes les lignes affichées sont des copies
 * immuables figées au moment de la création côté serveur.
 */
export function SalesWorkspace(): React.ReactElement {
  const [data, setData] = useState<SalesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [quoteForm, setQuoteForm] = useState(EMPTY_QUOTE_FORM);
  const [selectedQuote, setSelectedQuote] = useState<QuoteView | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [contractForm, setContractForm] = useState(EMPTY_CONTRACT_FORM);

  const load = useCallback(async (): Promise<void> => {
    try {
      const [dqes, quotes, contracts] = await Promise.all([
        estimationApi.dqes(),
        salesApi.quotes(),
        salesApi.contracts(),
      ]);
      setData({
        finalizedDqes: dqes.filter((dqe) => dqe.status === "FINALIZED"),
        quotes,
        contracts,
      });
      setError("");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createQuote(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const created = await salesApi.createQuote(quoteForm);
      setSelectedQuote(created);
      setQuoteForm(EMPTY_QUOTE_FORM);
      setNotice("Devis créé depuis le DQE finalisé.");
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Création du devis impossible.");
    } finally {
      setSaving(false);
    }
  }

  async function openQuote(quoteId: string): Promise<void> {
    setError("");
    try {
      setSelectedQuote(await salesApi.quote(quoteId));
      setRejectReason("");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Ouverture du devis impossible.");
    }
  }

  async function submitQuote(): Promise<void> {
    if (!selectedQuote) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      setSelectedQuote(await salesApi.submitQuote(selectedQuote.id));
      setNotice("Devis soumis au client.");
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Soumission du devis impossible.");
    } finally {
      setSaving(false);
    }
  }

  async function acceptQuote(): Promise<void> {
    if (!selectedQuote) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      setSelectedQuote(await salesApi.acceptQuote(selectedQuote.id));
      setNotice("Devis accepté. Un contrat peut désormais être créé.");
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Acceptation du devis impossible.");
    } finally {
      setSaving(false);
    }
  }

  async function rejectQuote(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedQuote) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      setSelectedQuote(await salesApi.rejectQuote(selectedQuote.id, rejectReason));
      setRejectReason("");
      setNotice("Devis rejeté et motif consigné.");
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Rejet du devis impossible.");
    } finally {
      setSaving(false);
    }
  }

  async function createContract(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedQuote) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await salesApi.createContract({ quoteId: selectedQuote.id, ...contractForm });
      setContractForm(EMPTY_CONTRACT_FORM);
      setNotice("Contrat créé depuis le devis accepté.");
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Création du contrat impossible.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="crm-loading" role="status">
        <Loader2 size={20} className="spin" aria-hidden="true" />
        <span>Chargement des devis et contrats…</span>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="form-error" role="alert">
        {error || "Données indisponibles."}
      </div>
    );
  }

  const hasContractForQuote = (quoteId: string) =>
    data.contracts.some((contract) => contract.source.quoteId === quoteId);

  return (
    <>
      <section className="welcome-row">
        <div>
          <p className="breadcrumb">Command Center / Devis &amp; Contrats</p>
          <h1>Devis &amp; Contrats</h1>
          <p>Transformez un DQE finalisé en devis, puis un devis accepté en contrat.</p>
        </div>
        <button className="secondary-button" type="button" onClick={() => void load()}>
          <RefreshCw size={15} aria-hidden="true" />
          <span>Actualiser</span>
        </button>
      </section>

      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="form-success" role="status">
          {notice}
        </div>
      )}

      <section className="metrics-grid" aria-label="Indicateurs commerciaux">
        <Metric
          icon={<Receipt size={20} aria-hidden="true" />}
          tone="blue"
          label="Devis"
          value={String(data.quotes.length)}
          detail={`${data.quotes.filter((quote) => quote.status === "ACCEPTED").length} accepté(s)`}
        />
        <Metric
          icon={<FileSignature size={20} aria-hidden="true" />}
          tone="green"
          label="Contrats"
          value={String(data.contracts.length)}
          detail={`${data.contracts.filter((contract) => contract.status === "ACTIVE").length} actif(s)`}
        />
        <Metric
          icon={<CheckCircle2 size={20} aria-hidden="true" />}
          tone="violet"
          label="DQE finalisés disponibles"
          value={String(data.finalizedDqes.length)}
          detail="Sources éligibles à un devis"
        />
      </section>

      <section className="estimation-grid">
        <article className="panel">
          <div className="panel-head">
            <div>
              <h2>Nouveau devis</h2>
              <p>Uniquement depuis un DQE finalisé (lignes figées à la création)</p>
            </div>
          </div>
          <form className="estimation-form" onSubmit={createQuote}>
            <label htmlFor="quote-dqe">DQE finalisé</label>
            <select
              id="quote-dqe"
              value={quoteForm.dqeId}
              onChange={(event) => setQuoteForm({ ...quoteForm, dqeId: event.currentTarget.value })}
              required
            >
              <option value="">Sélectionner un DQE finalisé</option>
              {data.finalizedDqes.map((dqe) => (
                <option value={dqe.id} key={dqe.id}>
                  {dqe.code} — {dqe.title}
                </option>
              ))}
            </select>
            {data.finalizedDqes.length === 0 && (
              <p className="field-hint">Aucun DQE finalisé n'est disponible pour l'instant.</p>
            )}

            <div className="form-row">
              <div>
                <label htmlFor="quote-code">Code du devis</label>
                <input
                  id="quote-code"
                  value={quoteForm.code}
                  onChange={(event) => setQuoteForm({ ...quoteForm, code: event.currentTarget.value })}
                  placeholder="DEV-2026-001"
                  required
                />
              </div>
              <div>
                <label htmlFor="quote-title">Titre du devis</label>
                <input
                  id="quote-title"
                  value={quoteForm.title}
                  onChange={(event) => setQuoteForm({ ...quoteForm, title: event.currentTarget.value })}
                  placeholder="Devis — Campus solaire"
                  required
                />
              </div>
            </div>

            <button
              className="primary-inline-button"
              type="submit"
              disabled={saving || data.finalizedDqes.length === 0}
            >
              <Plus size={15} aria-hidden="true" />
              {saving ? "Création…" : "Créer le devis"}
            </button>
          </form>
        </article>

        <article className="panel">
          <div className="panel-head">
            <div>
              <h2>Devis émis</h2>
              <p>Cycle de vie brouillon → soumis → accepté/rejeté</p>
            </div>
          </div>
          {data.quotes.length === 0 ? (
            <EmptyState title="Aucun devis" body="Créez un devis depuis un DQE finalisé." />
          ) : (
            <ul className="estimation-list">
              {data.quotes.map((quote) => (
                <li key={quote.id}>
                  <div>
                    <span className="record-code">{quote.code}</span>
                    <strong>{quote.title}</strong>
                    <small>{formatMoney(quote.subtotal, quote.currency)}</small>
                  </div>
                  <div>
                    <span className={`status-chip status-${quote.status.toLowerCase()}`}>
                      {QUOTE_STATUS_LABEL[quote.status] ?? quote.status}
                    </span>
                    <small>{hasContractForQuote(quote.id) ? "Contrat créé" : "Sans contrat"}</small>
                    <button
                      className="link-button"
                      type="button"
                      aria-label={`Ouvrir ${quote.code}`}
                      onClick={() => void openQuote(quote.id)}
                    >
                      Ouvrir <ChevronRight size={13} aria-hidden="true" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </article>
      </section>

      {selectedQuote && (
        <section className="panel study-detail-panel">
          <div className="panel-head">
            <div>
              <span className="record-code">{selectedQuote.code}</span>
              <h2>{selectedQuote.title}</h2>
              <p>
                Source DQE {selectedQuote.source.dqeCode || selectedQuote.source.dqeId} · {formatMoney(selectedQuote.subtotal, selectedQuote.currency)}
              </p>
            </div>
            <span className={`status-chip status-${selectedQuote.status.toLowerCase()}`}>
              {QUOTE_STATUS_LABEL[selectedQuote.status] ?? selectedQuote.status}
            </span>
          </div>

          {selectedQuote.lines.length === 0 ? (
            <EmptyState title="Aucune ligne" body="Ce devis ne contient aucune ligne." />
          ) : (
            <div className="table-wrap dqe-lines-table">
              <table>
                <thead>
                  <tr>
                    <th>Pos.</th>
                    <th>Référence</th>
                    <th>Désignation</th>
                    <th>Unité</th>
                    <th>Quantité</th>
                    <th>Prix unitaire</th>
                    <th>Total ligne</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedQuote.lines.map((line) => (
                    <tr key={line.id}>
                      <td>{line.position}</td>
                      <td><strong>{line.reference ?? "—"}</strong></td>
                      <td>{line.designation}</td>
                      <td>{line.unitCode}</td>
                      <td className="numeric-cell">{formatQuantity(line.quantity, 3)}</td>
                      <td className="numeric-cell">{formatMoney(line.unitPrice)}</td>
                      <td className="numeric-cell">{formatMoney(line.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {selectedQuote.status === "DRAFT" && (
            <div className="study-actions">
              <p>La soumission transmet le devis pour décision.</p>
              <button className="secondary-button" type="button" disabled={saving} onClick={() => void submitQuote()}>
                <Send size={15} aria-hidden="true" />
                Soumettre le devis
              </button>
            </div>
          )}

          {selectedQuote.status === "SUBMITTED" && (
            <div className="study-actions dqe-finalize-actions">
              <button className="secondary-button" type="button" disabled={saving} onClick={() => void acceptQuote()}>
                <CheckCircle2 size={15} aria-hidden="true" />
                Accepter le devis
              </button>
              <form className="requirement-form" onSubmit={rejectQuote}>
                <div className="requirement-statement">
                  <label htmlFor="reject-reason">Motif de rejet</label>
                  <input
                    id="reject-reason"
                    value={rejectReason}
                    onChange={(event) => setRejectReason(event.currentTarget.value)}
                    placeholder="Budget client insuffisant"
                    required
                  />
                </div>
                <button className="primary-inline-button" type="submit" disabled={saving}>
                  <Ban size={15} aria-hidden="true" />
                  Rejeter le devis
                </button>
              </form>
            </div>
          )}

          {selectedQuote.status === "ACCEPTED" && !hasContractForQuote(selectedQuote.id) && (
            <form className="dqe-create-form" onSubmit={createContract}>
              <div className="dqe-create-copy">
                <h3>Créer le contrat</h3>
                <p>Copie immuable des lignes du devis accepté.</p>
              </div>
              <div>
                <label htmlFor="contract-code">Code du contrat</label>
                <input
                  id="contract-code"
                  value={contractForm.code}
                  onChange={(event) => setContractForm({ ...contractForm, code: event.currentTarget.value })}
                  placeholder="CTR-2026-001"
                  required
                />
              </div>
              <div className="dqe-title-field">
                <label htmlFor="contract-title">Titre du contrat</label>
                <input
                  id="contract-title"
                  value={contractForm.title}
                  onChange={(event) => setContractForm({ ...contractForm, title: event.currentTarget.value })}
                  placeholder="Contrat — Campus solaire"
                  required
                />
              </div>
              <button className="primary-inline-button" type="submit" disabled={saving}>
                <Plus size={15} aria-hidden="true" />
                {saving ? "Création…" : "Créer le contrat"}
              </button>
            </form>
          )}

          {selectedQuote.status === "ACCEPTED" && hasContractForQuote(selectedQuote.id) && (
            <p className="inline-confirmation" role="status">
              Un contrat existe déjà pour ce devis.
            </p>
          )}

          {selectedQuote.status === "REJECTED" && selectedQuote.rejectionReason && (
            <p className="field-hint">Motif du rejet : {selectedQuote.rejectionReason}</p>
          )}
        </section>
      )}

      <section className="panel dqe-panel">
        <div className="panel-head">
          <div>
            <h2>Contrats</h2>
            <p>Enregistrements contractuels neutres issus de devis acceptés</p>
          </div>
        </div>
        {data.contracts.length === 0 ? (
          <EmptyState title="Aucun contrat" body="Acceptez un devis puis créez son contrat." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Contrat</th>
                  <th>Statut</th>
                  <th>Lignes</th>
                  <th>Total</th>
                  <th>Devis source</th>
                </tr>
              </thead>
              <tbody>
                {data.contracts.map((contract) => (
                  <tr key={contract.id}>
                    <td>
                      <strong>{contract.title}</strong>
                      <small>{contract.code}</small>
                    </td>
                    <td>
                      <span className={`status-chip status-${contract.status.toLowerCase()}`}>
                        {CONTRACT_STATUS_LABEL[contract.status] ?? contract.status}
                      </span>
                    </td>
                    <td>{contract.lines.length}</td>
                    <td className="numeric-cell">
                      {formatMoney(contract.subtotal, contract.currency)}
                    </td>
                    <td>{contract.source.quoteCode || contract.source.quoteId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function Metric({
  icon,
  tone,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode;
  tone: "blue" | "green" | "violet";
  label: string;
  value: string;
  detail: string;
}): React.ReactElement {
  return (
    <article className="metric-card">
      <div className={`metric-icon ${tone}`}>{icon}</div>
      <div className="metric-label">{label}</div>
      <strong>{value}</strong>
      <small className={tone}>{detail}</small>
    </article>
  );
}

function EmptyState({ title, body }: { title: string; body: string }): React.ReactElement {
  return (
    <div className="empty-state">
      <Receipt size={22} aria-hidden="true" />
      <strong>{title}</strong>
      <small>{body}</small>
    </div>
  );
}
