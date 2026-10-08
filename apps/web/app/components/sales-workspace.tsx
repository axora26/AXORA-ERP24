"use client";

import React from "react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ESTIMATION_PERMISSIONS,
  SALES_PERMISSIONS,
  type ContractSummaryView,
  type ContractVariationParentView,
  type ContractVariationView,
  type DqeSummaryView,
  type QuoteSummaryView,
  type QuoteView,
} from "@axora24/contracts";
import {
  Ban,
  CheckCircle2,
  ChevronRight,
  FileDiff,
  FileSignature,
  Loader2,
  Plus,
  Receipt,
  RefreshCw,
  Send,
} from "lucide-react";
import { ApiError, estimationApi, salesApi } from "../lib/api";
import { formatMoney, formatQuantity } from "../lib/format";
import { useSession } from "../lib/session";
import { BusinessPrintLink } from "./business-print-link";

interface SalesData {
  finalizedDqes: DqeSummaryView[];
  quotes: QuoteSummaryView[];
  contracts: Array<ContractSummaryView | ContractVariationParentView>;
  access: {
    dqes: boolean;
    quotes: boolean;
    contracts: boolean;
    contractParents: boolean;
  };
}

async function readScopedList<T>(
  enabled: boolean,
  read: () => Promise<T[]>,
): Promise<{ items: T[]; available: boolean }> {
  if (!enabled) return { items: [], available: false };
  try {
    return { items: await read(), available: true };
  } catch (caught) {
    if (
      caught instanceof ApiError &&
      caught.status === 403 &&
      caught.code !== "MFA_STEP_UP_REQUIRED"
    )
      return { items: [], available: false };
    throw caught;
  }
}

type VariationContract = ContractSummaryView | ContractVariationParentView;

const EMPTY_QUOTE_FORM = { dqeId: "", code: "", title: "" };
const EMPTY_CONTRACT_FORM = { code: "", title: "" };
const EMPTY_VARIATION_FORM = {
  code: "",
  title: "",
  reason: "",
  designation: "",
  unitCode: "u",
  quantity: "1.000000",
  unitPrice: "0.000000",
};

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

const VARIATION_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Brouillon",
  SUBMITTED: "À approuver",
  APPROVED: "Approuvé",
  REJECTED: "Rejeté",
};

/**
 * Espace Devis, Contrats & Avenants (INC-04 + parité ERP3602).
 * Un devis n'existe que depuis un DQE FINALIZED ; un contrat n'existe que
 * depuis un devis ACCEPTED. Toutes les lignes affichées sont des copies
 * immuables figées au moment de la création côté serveur.
 */
export function SalesWorkspace(): React.ReactElement {
  const { activeCompanyId, user } = useSession();
  return (
    <CompanySalesWorkspace
      key={`${user?.organizationId ?? ""}:${user?.id ?? ""}:${activeCompanyId ?? ""}`}
    />
  );
}

function CompanySalesWorkspace(): React.ReactElement {
  const { can } = useSession();
  const hasDqeRead = can(ESTIMATION_PERMISSIONS.DQE_READ);
  const hasQuoteRead = can(SALES_PERMISSIONS.QUOTE_READ);
  const canManageQuotes = can(SALES_PERMISSIONS.QUOTE_MANAGE);
  const hasContractRead = can(SALES_PERMISSIONS.CONTRACT_READ);
  const canManageContracts = can(SALES_PERMISSIONS.CONTRACT_MANAGE);
  const canManageVariations = can(SALES_PERMISSIONS.VARIATION_MANAGE);
  const canApproveVariations = can(SALES_PERMISSIONS.VARIATION_APPROVE);
  const canReadVariations =
    can(SALES_PERMISSIONS.VARIATION_READ) ||
    canManageVariations ||
    canApproveVariations;
  const [data, setData] = useState<SalesData | null>(null);
  const canReadDqes = hasDqeRead && Boolean(data?.access.dqes);
  const canReadQuotes = hasQuoteRead && Boolean(data?.access.quotes);
  const canReadContracts = hasContractRead && Boolean(data?.access.contracts);
  const canDiscoverContracts = Boolean(data?.access.contractParents);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [quoteForm, setQuoteForm] = useState(EMPTY_QUOTE_FORM);
  const [selectedQuote, setSelectedQuote] = useState<QuoteView | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [contractForm, setContractForm] = useState(EMPTY_CONTRACT_FORM);
  const [selectedContract, setSelectedContract] =
    useState<VariationContract | null>(null);
  const [variations, setVariations] = useState<ContractVariationView[]>([]);
  const [variationsLoading, setVariationsLoading] = useState(false);
  const [variationsError, setVariationsError] = useState("");
  const [variationForm, setVariationForm] = useState(EMPTY_VARIATION_FORM);
  const [variationDecisionNotes, setVariationDecisionNotes] = useState<
    Record<string, string>
  >({});
  const [variationCreating, setVariationCreating] = useState(false);
  const [variationSavingIds, setVariationSavingIds] = useState<
    Record<string, boolean>
  >({});
  const mountedRef = useRef(true);
  const workspaceLoadRequestRef = useRef(0);
  const quoteSelectionRef = useRef(0);
  const variationSelectionRef = useRef(0);
  const variationListRequestRef = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    if (!mountedRef.current) return;
    const requestId = ++workspaceLoadRequestRef.current;
    setLoading(true);
    setError("");
    try {
      const [dqeRead, quoteRead, contractRead] = await Promise.all([
        readScopedList(hasDqeRead, () => estimationApi.dqes()),
        readScopedList(hasQuoteRead, () => salesApi.quotes()),
        (async () => {
          const full = await readScopedList<VariationContract>(
            hasContractRead,
            () => salesApi.contracts(),
          );
          if (full.available) return { ...full, fullAccess: true };
          if (
            !mountedRef.current ||
            requestId !== workspaceLoadRequestRef.current
          )
            return { ...full, fullAccess: false };
          const parents = await readScopedList<VariationContract>(
            canReadVariations,
            () => salesApi.variationContracts(),
          );
          return { ...parents, fullAccess: false };
        })(),
      ]);
      if (requestId !== workspaceLoadRequestRef.current) return;
      const quotes = quoteRead.items;
      setData({
        finalizedDqes: dqeRead.items.filter(
          (dqe) => dqe.status === "FINALIZED",
        ),
        quotes,
        contracts: contractRead.items,
        access: {
          dqes: dqeRead.available,
          quotes: quoteRead.available,
          contracts: contractRead.fullAccess,
          contractParents: contractRead.available,
        },
      });
      quoteSelectionRef.current += 1;
      setSelectedQuote((current) =>
        current
          ? (quotes.find((quote) => quote.id === current.id) ?? null)
          : null,
      );
      setRejectReason("");
      setContractForm(EMPTY_CONTRACT_FORM);
      variationSelectionRef.current += 1;
      variationListRequestRef.current += 1;
      setSelectedContract(null);
      setVariations([]);
      setVariationsLoading(false);
      setVariationsError("");
      setVariationDecisionNotes({});
      setError("");
    } catch (caught) {
      if (requestId !== workspaceLoadRequestRef.current) return;
      setData(null);
      setError(
        caught instanceof ApiError ? caught.message : "Chargement impossible.",
      );
    } finally {
      if (requestId === workspaceLoadRequestRef.current) setLoading(false);
    }
  }, [hasContractRead, hasDqeRead, hasQuoteRead, canReadVariations]);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    return () => {
      mountedRef.current = false;
      workspaceLoadRequestRef.current += 1;
      quoteSelectionRef.current += 1;
      variationSelectionRef.current += 1;
      variationListRequestRef.current += 1;
    };
  }, [load]);

  async function createQuote(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const selectionId = ++quoteSelectionRef.current;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const created = await salesApi.createQuote(quoteForm);
      if (selectionId === quoteSelectionRef.current) {
        setSelectedQuote(created);
        setQuoteForm(EMPTY_QUOTE_FORM);
        setNotice("Devis créé depuis le DQE finalisé.");
      }
      await load();
    } catch (caught) {
      if (selectionId !== quoteSelectionRef.current) return;
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Création du devis impossible.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function openQuote(quoteId: string): Promise<void> {
    const selectionId = ++quoteSelectionRef.current;
    setSelectedQuote(null);
    setRejectReason("");
    setContractForm(EMPTY_CONTRACT_FORM);
    setError("");
    setNotice("");
    try {
      const quote = await salesApi.quote(quoteId);
      if (selectionId !== quoteSelectionRef.current) return;
      setSelectedQuote(quote);
      setRejectReason("");
    } catch (caught) {
      if (selectionId !== quoteSelectionRef.current) return;
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Ouverture du devis impossible.",
      );
    }
  }

  async function submitQuote(): Promise<void> {
    if (!selectedQuote) return;
    const selectionId = quoteSelectionRef.current;
    const quoteId = selectedQuote.id;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const quote = await salesApi.submitQuote(quoteId);
      if (selectionId === quoteSelectionRef.current) {
        setSelectedQuote(quote);
        setNotice("Devis soumis au client.");
      }
      await load();
    } catch (caught) {
      if (selectionId !== quoteSelectionRef.current) return;
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Soumission du devis impossible.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function acceptQuote(): Promise<void> {
    if (!selectedQuote) return;
    const selectionId = quoteSelectionRef.current;
    const quoteId = selectedQuote.id;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const quote = await salesApi.acceptQuote(quoteId);
      if (selectionId === quoteSelectionRef.current) {
        setSelectedQuote(quote);
        setNotice("Devis accepté. Un contrat peut désormais être créé.");
      }
      await load();
    } catch (caught) {
      if (selectionId !== quoteSelectionRef.current) return;
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Acceptation du devis impossible.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function rejectQuote(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedQuote) return;
    const selectionId = quoteSelectionRef.current;
    const quoteId = selectedQuote.id;
    const reason = rejectReason;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const quote = await salesApi.rejectQuote(quoteId, reason);
      if (selectionId === quoteSelectionRef.current) {
        setSelectedQuote(quote);
        setRejectReason("");
        setNotice("Devis rejeté et motif consigné.");
      }
      await load();
    } catch (caught) {
      if (selectionId !== quoteSelectionRef.current) return;
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Rejet du devis impossible.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function createContract(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (!selectedQuote) return;
    const selectionId = quoteSelectionRef.current;
    const quoteId = selectedQuote.id;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await salesApi.createContract({
        quoteId,
        ...contractForm,
      });
      if (selectionId === quoteSelectionRef.current) {
        setContractForm(EMPTY_CONTRACT_FORM);
        setNotice("Contrat créé depuis le devis accepté.");
      }
      await load();
    } catch (caught) {
      if (selectionId !== quoteSelectionRef.current) return;
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Création du contrat impossible.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function openContractVariations(
    contract: VariationContract,
    changeSelection = true,
  ): Promise<boolean> {
    const changesContract =
      changeSelection && selectedContract?.id !== contract.id;
    const selectionId = changesContract
      ? ++variationSelectionRef.current
      : variationSelectionRef.current;
    const requestId = ++variationListRequestRef.current;
    if (changesContract) {
      setSelectedContract(contract);
      setVariationForm(EMPTY_VARIATION_FORM);
    }
    setVariationsLoading(true);
    setVariationsError("");
    if (changeSelection) setVariationDecisionNotes({});
    try {
      const loadedVariations = await salesApi.contractVariations(contract.id);
      if (
        selectionId !== variationSelectionRef.current ||
        requestId !== variationListRequestRef.current
      )
        return false;
      setVariations((current) =>
        loadedVariations.map((incoming) => {
          const existing = changesContract
            ? undefined
            : current.find((item) => item.id === incoming.id);
          return existing && existing.version > incoming.version
            ? existing
            : incoming;
        }),
      );
      return true;
    } catch (caught) {
      if (
        selectionId !== variationSelectionRef.current ||
        requestId !== variationListRequestRef.current
      )
        return false;
      setVariations([]);
      setVariationsError(
        caught instanceof ApiError
          ? caught.message
          : "Chargement des avenants impossible.",
      );
      return false;
    } finally {
      if (
        selectionId === variationSelectionRef.current &&
        requestId === variationListRequestRef.current
      )
        setVariationsLoading(false);
    }
  }

  async function createContractVariation(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (
      !selectedContract ||
      !canManageVariations ||
      variationsLoading ||
      variationsError
    )
      return;
    const contract = selectedContract;
    const selectionId = variationSelectionRef.current;
    setVariationCreating(true);
    setError("");
    setNotice("");
    try {
      const created = await salesApi.createContractVariation(contract.id, {
        code: variationForm.code,
        title: variationForm.title,
        reason: variationForm.reason,
        lines: [
          {
            position: 1,
            designation: variationForm.designation,
            unitCode: variationForm.unitCode,
            quantity: variationForm.quantity,
            unitPrice: variationForm.unitPrice,
          },
        ],
      });
      if (selectionId !== variationSelectionRef.current) return;
      variationListRequestRef.current += 1;
      setVariationsLoading(false);
      setVariations((current) => {
        const existing = current.find((item) => item.id === created.id);
        if (!existing) return [created, ...current];
        return current.map((item) =>
          item.id === created.id && item.version < created.version
            ? created
            : item,
        );
      });
      setVariationForm(EMPTY_VARIATION_FORM);
      setNotice("Avenant créé en brouillon avec sa ligne financière immuable.");
      await openContractVariations(contract, false);
    } catch (caught) {
      if (selectionId !== variationSelectionRef.current) return;
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Création de l'avenant impossible.",
      );
    } finally {
      setVariationCreating(false);
    }
  }

  async function transitionVariation(
    variation: ContractVariationView,
    action: "submit" | "approve" | "reject",
  ): Promise<void> {
    if (!selectedContract) return;
    const contract = selectedContract;
    const selectionId = variationSelectionRef.current;
    const decisionNote = variationDecisionNotes[variation.id] ?? "";
    setVariationSavingIds((current) => ({ ...current, [variation.id]: true }));
    setError("");
    setNotice("");
    try {
      const updated =
        action === "submit"
          ? await salesApi.submitContractVariation(
              contract.id,
              variation.id,
              variation.version,
            )
          : action === "approve"
            ? await salesApi.approveContractVariation(
                contract.id,
                variation.id,
                variation.version,
                decisionNote || undefined,
              )
            : await salesApi.rejectContractVariation(
                contract.id,
                variation.id,
                variation.version,
                decisionNote,
              );
      if (selectionId !== variationSelectionRef.current) return;
      variationListRequestRef.current += 1;
      setVariationsLoading(false);
      setVariations((current) =>
        current.map((item) =>
          item.id === updated.id && item.version <= updated.version
            ? updated
            : item,
        ),
      );
      setVariationDecisionNotes((current) => ({
        ...current,
        [variation.id]: "",
      }));
      setNotice(
        action === "submit"
          ? "Avenant soumis pour décision."
          : action === "approve"
            ? "Avenant approuvé."
            : "Avenant rejeté.",
      );
      await openContractVariations(contract, false);
    } catch (caught) {
      if (selectionId !== variationSelectionRef.current) return;
      if (caught instanceof ApiError && caught.status === 409) {
        const reloaded = await openContractVariations(contract, false);
        if (reloaded)
          setNotice("Des données plus récentes ont remplacé la vue obsolète.");
      } else {
        setError(
          caught instanceof ApiError
            ? caught.message
            : "Mise à jour de l'avenant impossible.",
        );
      }
    } finally {
      setVariationSavingIds((current) => {
        const next = { ...current };
        delete next[variation.id];
        return next;
      });
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
      <div className="empty-state" role="alert">
        <strong>{error || "Données indisponibles."}</strong>
        <button
          className="secondary-button"
          type="button"
          onClick={() => void load()}
        >
          <RefreshCw size={15} aria-hidden="true" />
          <span>Réessayer</span>
        </button>
      </div>
    );
  }

  const hasContractForQuote = (quoteId: string) =>
    data.contracts.some(
      (contract) => "source" in contract && contract.source.quoteId === quoteId,
    );

  return (
    <>
      <section className="welcome-row">
        <div>
          <p className="breadcrumb">
            Command Center / Devis, contrats &amp; avenants
          </p>
          <h1>Devis, contrats &amp; avenants</h1>
          <p>
            Transformez un DQE en engagement contractuel, puis pilotez les
            plus-values et moins-values avec un workflow approuvé.
          </p>
        </div>
        <button
          className="secondary-button"
          type="button"
          onClick={() => void load()}
        >
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
        {canReadQuotes && (
          <Metric
            icon={<Receipt size={20} aria-hidden="true" />}
            tone="blue"
            label="Devis"
            value={String(data.quotes.length)}
            detail={`${data.quotes.filter((quote) => quote.status === "ACCEPTED").length} accepté(s)`}
          />
        )}
        {canDiscoverContracts && (
          <Metric
            icon={<FileSignature size={20} aria-hidden="true" />}
            tone="green"
            label="Contrats"
            value={String(data.contracts.length)}
            detail={`${data.contracts.filter((contract) => contract.status === "ACTIVE").length} actif(s)`}
          />
        )}
        {canReadDqes && canManageQuotes && (
          <Metric
            icon={<CheckCircle2 size={20} aria-hidden="true" />}
            tone="violet"
            label="DQE finalisés disponibles"
            value={String(data.finalizedDqes.length)}
            detail="Sources éligibles à un devis"
          />
        )}
      </section>

      {(canReadQuotes || (canReadDqes && canManageQuotes)) && (
        <section className="estimation-grid">
          {canReadDqes && canManageQuotes && (
            <article className="panel">
              <div className="panel-head">
                <div>
                  <h2>Nouveau devis</h2>
                  <p>
                    Uniquement depuis un DQE finalisé (lignes figées à la
                    création)
                  </p>
                </div>
              </div>
              <form className="estimation-form" onSubmit={createQuote}>
                <label htmlFor="quote-dqe">DQE finalisé</label>
                <select
                  id="quote-dqe"
                  value={quoteForm.dqeId}
                  onChange={(event) =>
                    setQuoteForm({
                      ...quoteForm,
                      dqeId: event.currentTarget.value,
                    })
                  }
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
                  <p className="field-hint">
                    Aucun DQE finalisé n'est disponible pour l'instant.
                  </p>
                )}

                <div className="form-row">
                  <div>
                    <label htmlFor="quote-code">Code du devis</label>
                    <input
                      id="quote-code"
                      value={quoteForm.code}
                      onChange={(event) =>
                        setQuoteForm({
                          ...quoteForm,
                          code: event.currentTarget.value,
                        })
                      }
                      placeholder="DEV-2026-001"
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="quote-title">Titre du devis</label>
                    <input
                      id="quote-title"
                      value={quoteForm.title}
                      onChange={(event) =>
                        setQuoteForm({
                          ...quoteForm,
                          title: event.currentTarget.value,
                        })
                      }
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
          )}

          {canReadQuotes && (
            <article className="panel">
              <div className="panel-head">
                <div>
                  <h2>Devis émis</h2>
                  <p>Cycle de vie brouillon → soumis → accepté/rejeté</p>
                </div>
              </div>
              {data.quotes.length === 0 ? (
                <EmptyState
                  title="Aucun devis"
                  body="Créez un devis depuis un DQE finalisé."
                />
              ) : (
                <ul className="estimation-list">
                  {data.quotes.map((quote) => (
                    <li key={quote.id}>
                      <div>
                        <span className="record-code">{quote.code}</span>
                        <strong>{quote.title}</strong>
                        <small>
                          {formatMoney(quote.subtotal, quote.currency)}
                        </small>
                      </div>
                      <div>
                        <span
                          className={`status-chip status-${quote.status.toLowerCase()}`}
                        >
                          {QUOTE_STATUS_LABEL[quote.status] ?? quote.status}
                        </span>
                        <small>
                          {canReadContracts
                            ? hasContractForQuote(quote.id)
                              ? "Contrat créé"
                              : "Sans contrat"
                            : "Statut contrat non disponible"}
                        </small>
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
          )}
        </section>
      )}

      {canReadQuotes && selectedQuote && (
        <section className="panel study-detail-panel">
          <div className="panel-head">
            <div>
              <span className="record-code">{selectedQuote.code}</span>
              <h2>{selectedQuote.title}</h2>
              <p>
                Source DQE{" "}
                {selectedQuote.source.dqeCode || selectedQuote.source.dqeId} ·{" "}
                {formatMoney(selectedQuote.subtotal, selectedQuote.currency)}
              </p>
            </div>
            <BusinessPrintLink
              kind="quotes"
              id={selectedQuote.id}
              companyId={selectedQuote.companyId}
            >
              Imprimer le devis
            </BusinessPrintLink>
            <span
              className={`status-chip status-${selectedQuote.status.toLowerCase()}`}
            >
              {QUOTE_STATUS_LABEL[selectedQuote.status] ?? selectedQuote.status}
            </span>
          </div>

          {selectedQuote.lines.length === 0 ? (
            <EmptyState
              title="Aucune ligne"
              body="Ce devis ne contient aucune ligne."
            />
          ) : (
            <div className="table-wrap dqe-lines-table">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Pos.</th>
                    <th scope="col">Référence</th>
                    <th scope="col">Désignation</th>
                    <th scope="col">Unité</th>
                    <th scope="col">Quantité</th>
                    <th scope="col">Prix unitaire</th>
                    <th scope="col">Total ligne</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedQuote.lines.map((line) => (
                    <tr key={line.id}>
                      <td>{line.position}</td>
                      <td>
                        <strong>{line.reference ?? "—"}</strong>
                      </td>
                      <td>{line.designation}</td>
                      <td>{line.unitCode}</td>
                      <td className="numeric-cell">
                        {formatQuantity(line.quantity, 3)}
                      </td>
                      <td className="numeric-cell">
                        {formatMoney(line.unitPrice)}
                      </td>
                      <td className="numeric-cell">
                        {formatMoney(line.lineTotal)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {canManageQuotes && selectedQuote.status === "DRAFT" && (
            <div className="study-actions">
              <p>La soumission transmet le devis pour décision.</p>
              <button
                className="secondary-button"
                type="button"
                disabled={saving}
                onClick={() => void submitQuote()}
              >
                <Send size={15} aria-hidden="true" />
                Soumettre le devis
              </button>
            </div>
          )}

          {canManageQuotes && selectedQuote.status === "SUBMITTED" && (
            <div className="study-actions dqe-finalize-actions">
              <button
                className="secondary-button"
                type="button"
                disabled={saving}
                onClick={() => void acceptQuote()}
              >
                <CheckCircle2 size={15} aria-hidden="true" />
                Accepter le devis
              </button>
              <form className="requirement-form" onSubmit={rejectQuote}>
                <div className="requirement-statement">
                  <label htmlFor="reject-reason">Motif de rejet</label>
                  <input
                    id="reject-reason"
                    value={rejectReason}
                    onChange={(event) =>
                      setRejectReason(event.currentTarget.value)
                    }
                    placeholder="Budget client insuffisant"
                    required
                  />
                </div>
                <button
                  className="primary-inline-button"
                  type="submit"
                  disabled={saving}
                >
                  <Ban size={15} aria-hidden="true" />
                  Rejeter le devis
                </button>
              </form>
            </div>
          )}

          {canReadContracts &&
            canManageContracts &&
            selectedQuote.status === "ACCEPTED" &&
            !hasContractForQuote(selectedQuote.id) && (
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
                    onChange={(event) =>
                      setContractForm({
                        ...contractForm,
                        code: event.currentTarget.value,
                      })
                    }
                    placeholder="CTR-2026-001"
                    required
                  />
                </div>
                <div className="dqe-title-field">
                  <label htmlFor="contract-title">Titre du contrat</label>
                  <input
                    id="contract-title"
                    value={contractForm.title}
                    onChange={(event) =>
                      setContractForm({
                        ...contractForm,
                        title: event.currentTarget.value,
                      })
                    }
                    placeholder="Contrat — Campus solaire"
                    required
                  />
                </div>
                <button
                  className="primary-inline-button"
                  type="submit"
                  disabled={saving}
                >
                  <Plus size={15} aria-hidden="true" />
                  {saving ? "Création…" : "Créer le contrat"}
                </button>
              </form>
            )}

          {selectedQuote.status === "ACCEPTED" &&
            hasContractForQuote(selectedQuote.id) && (
              <p className="inline-confirmation" role="status">
                Un contrat existe déjà pour ce devis.
              </p>
            )}

          {selectedQuote.status === "REJECTED" &&
            selectedQuote.rejectionReason && (
              <p className="field-hint">
                Motif du rejet : {selectedQuote.rejectionReason}
              </p>
            )}
        </section>
      )}

      {canDiscoverContracts && (
        <section className="panel dqe-panel">
          <div className="panel-head">
            <div>
              <h2>Contrats</h2>
              <p>
                Enregistrements contractuels neutres issus de devis acceptés
              </p>
            </div>
          </div>
          {data.contracts.length === 0 ? (
            <EmptyState
              title="Aucun contrat"
              body="Acceptez un devis puis créez son contrat."
            />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Contrat</th>
                    <th scope="col">Statut</th>
                    {canReadContracts && <th scope="col">Lignes</th>}
                    <th scope="col">Total</th>
                    {canReadContracts && <th scope="col">Devis source</th>}
                    {canReadContracts && <th scope="col">Document</th>}
                    {canReadVariations && <th scope="col">Avenants</th>}
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
                        <span
                          className={`status-chip status-${contract.status.toLowerCase()}`}
                        >
                          {CONTRACT_STATUS_LABEL[contract.status] ??
                            contract.status}
                        </span>
                      </td>
                      {canReadContracts && (
                        <td>
                          {"lines" in contract ? contract.lines.length : "—"}
                        </td>
                      )}
                      <td className="numeric-cell">
                        {formatMoney(contract.subtotal, contract.currency)}
                      </td>
                      {canReadContracts && (
                        <td>
                          {"source" in contract
                            ? contract.source.quoteCode ||
                              contract.source.quoteId
                            : "—"}
                        </td>
                      )}
                      {canReadContracts && (
                        <td>
                          <BusinessPrintLink
                            kind="contracts"
                            id={contract.id}
                            companyId={contract.companyId}
                          >
                            Imprimer le contrat
                          </BusinessPrintLink>
                        </td>
                      )}
                      {canReadVariations && (
                        <td>
                          <button
                            className="secondary-button"
                            type="button"
                            aria-label={`Gérer les avenants ${contract.code}`}
                            onClick={() =>
                              void openContractVariations(contract)
                            }
                          >
                            <FileDiff size={15} aria-hidden="true" />
                            Avenants
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {canReadVariations && selectedContract && (
        <section className="panel study-detail-panel contract-variations-panel">
          <div className="panel-head">
            <div>
              <span className="record-code">{selectedContract.title}</span>
              <h2>Avenants du contrat {selectedContract.code}</h2>
              <p>
                Plus-values et moins-values tracées séparément du contrat
                initial immuable.
              </p>
            </div>
            <span className="status-chip status-active">
              {formatMoney(
                selectedContract.subtotal,
                selectedContract.currency,
              )}{" "}
              initial
            </span>
          </div>

          {variationsLoading ? (
            <div className="crm-loading" role="status">
              <Loader2 size={20} className="spin" aria-hidden="true" />
              <span>Chargement des avenants…</span>
            </div>
          ) : (
            <>
              {canManageVariations &&
                !variationsLoading &&
                !variationsError && (
                  <form
                    className="estimation-form contract-variation-form"
                    onSubmit={createContractVariation}
                  >
                    <div className="form-row">
                      <div>
                        <label htmlFor="variation-code">
                          Code de l'avenant
                        </label>
                        <input
                          id="variation-code"
                          value={variationForm.code}
                          onChange={(event) =>
                            setVariationForm({
                              ...variationForm,
                              code: event.currentTarget.value,
                            })
                          }
                          placeholder="AV-2026-001"
                          required
                        />
                      </div>
                      <div>
                        <label htmlFor="variation-title">
                          Titre de l'avenant
                        </label>
                        <input
                          id="variation-title"
                          value={variationForm.title}
                          onChange={(event) =>
                            setVariationForm({
                              ...variationForm,
                              title: event.currentTarget.value,
                            })
                          }
                          placeholder="Extension du lot électricité"
                          required
                        />
                      </div>
                    </div>
                    <label htmlFor="variation-reason">Motif de l'avenant</label>
                    <textarea
                      id="variation-reason"
                      value={variationForm.reason}
                      onChange={(event) =>
                        setVariationForm({
                          ...variationForm,
                          reason: event.currentTarget.value,
                        })
                      }
                      placeholder="Décrivez la demande, son origine et son périmètre."
                      required
                    />
                    <div className="form-row">
                      <div>
                        <label htmlFor="variation-designation">
                          Désignation de la ligne
                        </label>
                        <input
                          id="variation-designation"
                          value={variationForm.designation}
                          onChange={(event) =>
                            setVariationForm({
                              ...variationForm,
                              designation: event.currentTarget.value,
                            })
                          }
                          placeholder="Tableau divisionnaire complémentaire"
                          required
                        />
                      </div>
                      <div>
                        <label htmlFor="variation-unit">
                          Unité de la ligne
                        </label>
                        <input
                          id="variation-unit"
                          value={variationForm.unitCode}
                          onChange={(event) =>
                            setVariationForm({
                              ...variationForm,
                              unitCode: event.currentTarget.value,
                            })
                          }
                          required
                        />
                      </div>
                    </div>
                    <div className="form-row">
                      <div>
                        <label htmlFor="variation-quantity">
                          Quantité de la ligne
                        </label>
                        <input
                          id="variation-quantity"
                          inputMode="decimal"
                          value={variationForm.quantity}
                          onChange={(event) =>
                            setVariationForm({
                              ...variationForm,
                              quantity: event.currentTarget.value,
                            })
                          }
                          required
                        />
                        <small className="field-hint">
                          Utilisez une quantité négative pour une moins-value.
                        </small>
                      </div>
                      <div>
                        <label htmlFor="variation-unit-price">
                          Prix unitaire de la ligne
                        </label>
                        <input
                          id="variation-unit-price"
                          inputMode="decimal"
                          value={variationForm.unitPrice}
                          onChange={(event) =>
                            setVariationForm({
                              ...variationForm,
                              unitPrice: event.currentTarget.value,
                            })
                          }
                          required
                        />
                      </div>
                    </div>
                    <button
                      className="primary-inline-button"
                      type="submit"
                      disabled={variationCreating}
                    >
                      <Plus size={15} aria-hidden="true" />
                      {variationCreating ? "Création…" : "Créer l'avenant"}
                    </button>
                  </form>
                )}

              {variationsError ? (
                <div className="form-error" role="alert">
                  {variationsError}
                </div>
              ) : variations.length === 0 ? (
                <EmptyState
                  title="Aucun avenant"
                  body="Le contrat conserve pour l'instant son montant initial."
                />
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Avenant</th>
                        <th scope="col">Statut</th>
                        <th scope="col">Écart</th>
                        <th scope="col">Montant projeté</th>
                        <th scope="col">Motif</th>
                        <th scope="col">Décision</th>
                      </tr>
                    </thead>
                    <tbody>
                      {variations.map((variation) => (
                        <tr key={variation.id}>
                          <td>
                            <strong>{variation.title}</strong>
                            <small>
                              {variation.code} · révision{" "}
                              {variation.revisionNumber}
                            </small>
                          </td>
                          <td>
                            <span
                              className={`status-chip status-${variation.status.toLowerCase()}`}
                            >
                              {VARIATION_STATUS_LABEL[variation.status] ??
                                variation.status}
                            </span>
                          </td>
                          <td className="numeric-cell">
                            {formatMoney(
                              variation.amountDelta,
                              variation.currency,
                            )}
                          </td>
                          <td className="numeric-cell">
                            {formatMoney(
                              variation.revisedContractAmount,
                              variation.currency,
                            )}
                          </td>
                          <td>{variation.reason}</td>
                          <td>
                            {canManageVariations &&
                              variation.status === "DRAFT" && (
                                <button
                                  className="secondary-button"
                                  type="button"
                                  aria-label={`Soumettre l'avenant ${variation.code}`}
                                  disabled={variationSavingIds[variation.id]}
                                  onClick={() =>
                                    void transitionVariation(
                                      variation,
                                      "submit",
                                    )
                                  }
                                >
                                  <Send size={14} aria-hidden="true" />
                                  Soumettre
                                </button>
                              )}
                            {canApproveVariations &&
                              variation.status === "SUBMITTED" && (
                                <div className="stack">
                                  <label
                                    htmlFor={`variation-note-${variation.id}`}
                                  >
                                    Note de décision — {variation.code}
                                  </label>
                                  <input
                                    id={`variation-note-${variation.id}`}
                                    value={
                                      variationDecisionNotes[variation.id] ?? ""
                                    }
                                    onChange={(event) =>
                                      setVariationDecisionNotes((current) => ({
                                        ...current,
                                        [variation.id]: event.target.value,
                                      }))
                                    }
                                    placeholder="Décision motivée"
                                  />
                                  <div className="study-actions">
                                    <button
                                      className="secondary-button"
                                      type="button"
                                      aria-label={`Approuver l'avenant ${variation.code}`}
                                      disabled={
                                        variationSavingIds[variation.id]
                                      }
                                      onClick={() =>
                                        void transitionVariation(
                                          variation,
                                          "approve",
                                        )
                                      }
                                    >
                                      <CheckCircle2
                                        size={14}
                                        aria-hidden="true"
                                      />
                                      Approuver
                                    </button>
                                    <button
                                      className="secondary-button"
                                      type="button"
                                      aria-label={`Rejeter l'avenant ${variation.code}`}
                                      disabled={
                                        variationSavingIds[variation.id] ||
                                        !(
                                          variationDecisionNotes[
                                            variation.id
                                          ] ?? ""
                                        ).trim()
                                      }
                                      onClick={() =>
                                        void transitionVariation(
                                          variation,
                                          "reject",
                                        )
                                      }
                                    >
                                      <Ban size={14} aria-hidden="true" />
                                      Rejeter
                                    </button>
                                  </div>
                                </div>
                              )}
                            {!(
                              (canManageVariations &&
                                variation.status === "DRAFT") ||
                              (canApproveVariations &&
                                variation.status === "SUBMITTED")
                            ) &&
                              (variation.decisionNote || "—")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </section>
      )}
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

function EmptyState({
  title,
  body,
}: {
  title: string;
  body: string;
}): React.ReactElement {
  return (
    <div className="empty-state">
      <Receipt size={22} aria-hidden="true" />
      <strong>{title}</strong>
      <small>{body}</small>
    </div>
  );
}
