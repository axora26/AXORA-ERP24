"use client";

import React from "react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import type {
  CrmOpportunityView,
  DqeSummaryView,
  DqeView,
  DqeVariantView,
  EstimationStudySummaryView,
  EstimationStudyView,
} from "@axora24/contracts";
import {
  BookOpenCheck,
  Calculator,
  CheckCircle2,
  ChevronRight,
  FileSpreadsheet,
  Loader2,
  Plus,
  RefreshCw,
} from "lucide-react";
import { ApiError, crmApi, estimationApi } from "../lib/api";
import { useSession } from "../lib/session";
import { EstimationDraftEditor, type EstimationDraftSelection } from "./estimation-draft-editor";
import { FileDownloadButton } from "./file-download-button";

interface EstimationData {
  opportunities: CrmOpportunityView[];
  studies: EstimationStudySummaryView[];
  dqes: DqeSummaryView[];
}

const EMPTY_FORM = {
  opportunityId: "",
  code: "",
  title: "",
  objective: "",
  sourceReference: "",
};

const EMPTY_REQUIREMENT_FORM = {
  position: "1",
  category: "FACT",
  statement: "",
  sourceReference: "",
};

const EMPTY_DQE_FORM = {
  code: "",
  title: "",
  currency: "USD",
};

const EMPTY_LINE_FORM = {
  position: "1",
  reference: "",
  designation: "",
  unitCode: "",
  costCategory: "MATERIAL",
  quantity: "",
  unitPrice: "",
};

const EMPTY_PRICING_FORM = { overheadRate: "0", marginRate: "0", taxRate: "0" };
const EMPTY_VARIANT_FORM = { code: "", title: "" };

/**
 * Espace Etudes & DQE (INC-03).
 * Les listes et compteurs proviennent exclusivement de l'API du tenant.
 */
export function EstimationWorkspace(): React.ReactElement {
  const { can } = useSession();
  const [draftEditor, setDraftEditor] = useState<{ selection: EstimationDraftSelection; deleting: boolean } | null>(null);
  const [data, setData] = useState<EstimationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [selectedStudy, setSelectedStudy] = useState<EstimationStudyView | null>(null);
  const [requirementForm, setRequirementForm] = useState(EMPTY_REQUIREMENT_FORM);
  const [selectedDqe, setSelectedDqe] = useState<DqeView | null>(null);
  const [dqeForm, setDqeForm] = useState(EMPTY_DQE_FORM);
  const [lineForm, setLineForm] = useState(EMPTY_LINE_FORM);
  const [pricingForm, setPricingForm] = useState(EMPTY_PRICING_FORM);
  const [variants, setVariants] = useState<DqeVariantView[]>([]);
  const [libraryItems, setLibraryItems] = useState<import("@axora24/contracts").DqeLibraryItemView[]>([]);
  const [variantForm, setVariantForm] = useState(EMPTY_VARIANT_FORM);

  const load = useCallback(async (): Promise<void> => {
    try {
      const [opportunities, studies, dqes] = await Promise.all([
        crmApi.opportunities(),
        estimationApi.studies(),
        estimationApi.dqes(),
      ]);
      setData({
        opportunities: opportunities.filter((opportunity) => opportunity.status === "OPEN"),
        studies,
        dqes,
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

  async function createStudy(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await estimationApi.createStudy({
        opportunityId: form.opportunityId,
        code: form.code,
        title: form.title,
        objective: form.objective,
        ...(form.sourceReference.trim() ? { sourceReference: form.sourceReference.trim() } : {}),
      });
      setForm(EMPTY_FORM);
      setNotice("Étude créée avec succès.");
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Création impossible.");
    } finally {
      setSaving(false);
    }
  }

  async function openStudy(studyId: string): Promise<void> {
    setError("");
    try {
      setSelectedStudy(await estimationApi.study(studyId));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Ouverture de l'étude impossible.");
    }
  }

  async function addRequirement(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedStudy) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await estimationApi.addRequirement(selectedStudy.id, {
        position: Number(requirementForm.position),
        expectedVersion: selectedStudy.version,
        category: requirementForm.category,
        statement: requirementForm.statement,
        ...(requirementForm.sourceReference.trim()
          ? { sourceReference: requirementForm.sourceReference.trim() }
          : {}),
      });
      setRequirementForm({
        ...EMPTY_REQUIREMENT_FORM,
        position: String(Math.max(0, ...selectedStudy.requirements.map(row => row.position), Number(requirementForm.position)) + 1),
      });
      setSelectedStudy(await estimationApi.study(selectedStudy.id));
      setNotice("Exigence ajoutée à l'étude.");
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Ajout de l'exigence impossible.");
    } finally {
      setSaving(false);
    }
  }

  async function markStudyReady(): Promise<void> {
    if (!selectedStudy) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      setSelectedStudy(await estimationApi.markStudyReady(selectedStudy.id, selectedStudy.version));
      setNotice("Étude validée. Ses exigences sont désormais figées.");
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Validation de l'étude impossible.");
    } finally {
      setSaving(false);
    }
  }

  async function createDqe(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedStudy) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const created = await estimationApi.createDqe({
        studyId: selectedStudy.id,
        ...dqeForm,
      });
      setSelectedDqe(created);
      setVariants([]);
      setLibraryItems([]);
      setVariantForm(EMPTY_VARIANT_FORM);
      setDqeForm(EMPTY_DQE_FORM);
      setNotice("DQE créé avec sa source d'étude figée.");
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Création du DQE impossible.");
    } finally {
      setSaving(false);
    }
  }

  async function openDqe(dqeId: string): Promise<void> {
    setError("");
    try {
      const dqe = await estimationApi.dqe(dqeId);
      setSelectedDqe(dqe);
      setPricingForm({ overheadRate: dqe.overheadRate ?? "0", marginRate: dqe.marginRate ?? "0", taxRate: dqe.taxRate ?? "0" });
      setVariants((await estimationApi.dqeVariants(dqeId)) ?? []);
      if (can("estimation.library.read")) {
        try { setLibraryItems((await estimationApi.dqeLibrary()) ?? []); } catch { setLibraryItems([]); }
      }
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Ouverture du DQE impossible.");
    }
  }

  async function addDqeLine(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedDqe) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await estimationApi.addDqeLine(selectedDqe.id, {
        position: Number(lineForm.position),
        expectedVersion: selectedDqe.version,
        ...(lineForm.reference.trim() ? { reference: lineForm.reference.trim() } : {}),
        designation: lineForm.designation,
        unitCode: lineForm.unitCode,
        ...(lineForm.costCategory !== "MATERIAL" ? { costCategory: lineForm.costCategory } : {}),
        quantity: lineForm.quantity,
        unitPrice: lineForm.unitPrice,
      });
      setLineForm({ ...EMPTY_LINE_FORM, position: String(Math.max(0, ...selectedDqe.lines.map(row => row.position), Number(lineForm.position)) + 1) });
      setSelectedDqe(await estimationApi.dqe(selectedDqe.id));
      setNotice("Ligne ajoutée au DQE.");
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Ajout de la ligne impossible.");
    } finally {
      setSaving(false);
    }
  }

  async function updateDqePricing(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedDqe || selectedDqe.status !== "DRAFT") return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const updated = await estimationApi.updateDqePricing(selectedDqe.id, { expectedVersion: selectedDqe.version, ...pricingForm });
      setSelectedDqe(updated);
      setPricingForm({ overheadRate: updated.overheadRate ?? "0", marginRate: updated.marginRate ?? "0", taxRate: updated.taxRate ?? "0" });
      setVariants((await estimationApi.dqeVariants(updated.id)) ?? []);
      setNotice("Coefficients du DQE enregistrés.");
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Enregistrement des coefficients impossible.");
    } finally {
      setSaving(false);
    }
  }

  function applyLibraryItem(code: string): void {
    const item = libraryItems.find((candidate) => candidate.code === code);
    if (!item) return;
    setLineForm({ ...lineForm, reference: item.code, designation: item.designation, unitCode: item.unitCode, costCategory: item.costCategory, unitPrice: item.unitPrice });
  }

  async function createDqeVariant(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedDqe || !variantForm.code.trim() || !variantForm.title.trim()) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await estimationApi.createDqeVariant(selectedDqe.id, { code: variantForm.code.trim(), title: variantForm.title.trim() });
      setVariantForm(EMPTY_VARIANT_FORM);
      setVariants((await estimationApi.dqeVariants(selectedDqe.id)) ?? []);
      setNotice("Variante enregistrée pour comparaison.");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Création de la variante impossible.");
    } finally {
      setSaving(false);
    }
  }

  async function finalizeDqe(): Promise<void> {
    if (!selectedDqe) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      setSelectedDqe(await estimationApi.finalizeDqe(selectedDqe.id, selectedDqe.version));
      setNotice("DQE finalisé. Les lignes et montants sont désormais figés.");
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Finalisation du DQE impossible.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="crm-loading" role="status">
        <Loader2 size={20} className="spin" aria-hidden="true" />
        <span>Chargement des études et DQE…</span>
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

  const readyStudies = data.studies.filter((study) => study.status === "READY_FOR_DQE").length;
  const finalDqes = data.dqes.filter((dqe) => dqe.status === "FINALIZED").length;

  return (
    <>
      <section className="welcome-row">
        <div>
          <p className="breadcrumb">Command Center / Études &amp; chiffrage</p>
          <h1>Estimation &amp; DQE</h1>
          <p>Transformez les besoins commerciaux en quantitatifs traçables.</p>
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

      <section className="metrics-grid" aria-label="Indicateurs d'estimation">
        <Metric
          icon={<BookOpenCheck size={20} aria-hidden="true" />}
          tone="blue"
          label="Études"
          value={String(data.studies.length)}
          detail={`${readyStudies} prête(s) pour chiffrage`}
        />
        <Metric
          icon={<Calculator size={20} aria-hidden="true" />}
          tone="violet"
          label="DQE"
          value={String(data.dqes.length)}
          detail={`${finalDqes} finalisé(s)`}
        />
        <Metric
          icon={<FileSpreadsheet size={20} aria-hidden="true" />}
          tone="green"
          label="Opportunités ouvertes"
          value={String(data.opportunities.length)}
          detail="Sources disponibles pour une étude"
        />
      </section>

      <section className="estimation-grid">
        <article className="panel">
          <div className="panel-head">
            <div>
              <h2>Nouvelle étude</h2>
              <p>Relier obligatoirement l'étude à une opportunité ouverte</p>
            </div>
          </div>
          <form className="estimation-form" onSubmit={createStudy}>
            <label htmlFor="study-opportunity">Opportunité</label>
            <select
              id="study-opportunity"
              value={form.opportunityId}
              onChange={(event) => setForm({ ...form, opportunityId: event.currentTarget.value })}
              required
            >
              <option value="">Sélectionner une opportunité</option>
              {data.opportunities.map((opportunity) => (
                <option value={opportunity.id} key={opportunity.id}>
                  {opportunity.name}
                </option>
              ))}
            </select>
            {data.opportunities.length === 0 && (
              <p className="field-hint">Aucune opportunité ouverte n'est disponible.</p>
            )}

            <div className="form-row">
              <div>
                <label htmlFor="study-code">Code de l'étude</label>
                <input
                  id="study-code"
                  value={form.code}
                  onChange={(event) => setForm({ ...form, code: event.currentTarget.value })}
                  placeholder="ETU-2026-001"
                  required
                />
              </div>
              <div>
                <label htmlFor="study-title">Titre de l'étude</label>
                <input
                  id="study-title"
                  value={form.title}
                  onChange={(event) => setForm({ ...form, title: event.currentTarget.value })}
                  placeholder="Centre médical — lot principal"
                  required
                />
              </div>
            </div>

            <label htmlFor="study-objective">Objectif</label>
            <textarea
              id="study-objective"
              value={form.objective}
              onChange={(event) => setForm({ ...form, objective: event.currentTarget.value })}
              placeholder="Décrire le périmètre et le résultat attendu"
              rows={3}
              required
            />

            <label htmlFor="study-source">Référence source (optionnelle)</label>
            <input
              id="study-source"
              value={form.sourceReference}
              onChange={(event) => setForm({ ...form, sourceReference: event.currentTarget.value })}
              placeholder="DAO-01 / CCTP §2.4"
            />

            <button
              className="primary-inline-button"
              type="submit"
              disabled={saving || data.opportunities.length === 0}
            >
              <Plus size={15} aria-hidden="true" />
              {saving ? "Création…" : "Créer l'étude"}
            </button>
          </form>
        </article>

        <article className="panel">
          <div className="panel-head">
            <div>
              <h2>Études de prix</h2>
              <p>Exigences et maturité du dossier</p>
            </div>
          </div>
          {data.studies.length === 0 ? (
            <EmptyState title="Aucune étude" body="Créez une étude depuis une opportunité ouverte." />
          ) : (
            <ul className="estimation-list">
              {data.studies.map((study) => (
                <li key={study.id}>
                  <div>
                    <span className="record-code">{study.code}</span>
                    <strong>{study.title}</strong>
                    <small>
                      {data.opportunities.find((opportunity) => opportunity.id === study.opportunityId)
                        ?.name ?? study.opportunityId}
                    </small>
                  </div>
                  <div>
                    <span className={`status-chip status-${study.status.toLowerCase()}`}>
                      {study.status === "READY_FOR_DQE" ? "Prête" : "Brouillon"}
                    </span>
                    <small>{study.requirements.length} exigence(s)</small>
                    <button
                      className="link-button"
                      type="button"
                      aria-label={`Ouvrir ${study.code}`}
                      onClick={() => void openStudy(study.id)}
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

      {selectedStudy && (
        <section className="panel study-detail-panel">
          <div className="panel-head">
            <div>
              <span className="record-code">{selectedStudy.code}</span>
              <h2>Exigences de l'étude</h2>
              <p>
                {selectedStudy.title} · Source {selectedStudy.sourceReference ?? "non renseignée"}
              </p>
            </div>
            <span className={`status-chip status-${selectedStudy.status.toLowerCase()}`}>
              {selectedStudy.status === "READY_FOR_DQE" ? "Prête" : "Brouillon"}
            </span>
          </div>

          {selectedStudy.requirements.length === 0 ? (
            <EmptyState
              title="Aucune exigence"
              body="Ajoutez au moins une exigence sourcée avant de valider l'étude."
            />
          ) : (
            <div className="table-wrap requirement-table">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Position</th>
                    <th scope="col">Catégorie</th>
                    <th scope="col">Énoncé</th>
                    <th scope="col">Source</th>
                    {selectedStudy.status === "DRAFT" && can("estimation.study.manage") && <th scope="col">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {selectedStudy.requirements.map((requirement) => (
                    <tr key={requirement.id}>
                      <td>{requirement.position}</td>
                      <td>{requirement.category}</td>
                      <td>{requirement.statement}</td>
                      <td>{requirement.sourceReference ?? "—"}</td>
                      {selectedStudy.status === "DRAFT" && can("estimation.study.manage") && <td><div className="crm-row-actions"><button type="button" className="link-button" aria-label={`Modifier l’exigence ${requirement.position}`} onClick={() => setDraftEditor({ selection: { kind: "requirement", parent: selectedStudy, row: requirement }, deleting: false })}>Modifier</button><button type="button" className="link-button" aria-label={`Supprimer l’exigence ${requirement.position}`} onClick={() => setDraftEditor({ selection: { kind: "requirement", parent: selectedStudy, row: requirement }, deleting: true })}>Supprimer</button></div></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {selectedStudy.status === "DRAFT" && (
            <form className="requirement-form" onSubmit={addRequirement}>
              <div>
                <label htmlFor="requirement-position">Position</label>
                <input
                  id="requirement-position"
                  type="number"
                  min="1"
                  step="1"
                  value={requirementForm.position}
                  onChange={(event) =>
                    setRequirementForm({ ...requirementForm, position: event.currentTarget.value })
                  }
                  required
                />
              </div>
              <div>
                <label htmlFor="requirement-category">Catégorie</label>
                <select
                  id="requirement-category"
                  value={requirementForm.category}
                  onChange={(event) =>
                    setRequirementForm({ ...requirementForm, category: event.currentTarget.value })
                  }
                >
                  <option value="FACT">Fait</option>
                  <option value="ASSUMPTION">Hypothèse</option>
                  <option value="CONSTRAINT">Contrainte</option>
                  <option value="RISK">Risque</option>
                  <option value="NOTE">Note</option>
                </select>
              </div>
              <div className="requirement-statement">
                <label htmlFor="requirement-statement">Énoncé de l'exigence</label>
                <input
                  id="requirement-statement"
                  value={requirementForm.statement}
                  onChange={(event) =>
                    setRequirementForm({ ...requirementForm, statement: event.currentTarget.value })
                  }
                  placeholder="Décrire l'exigence vérifiable"
                  required
                />
              </div>
              <div>
                <label htmlFor="requirement-source">Source de l'exigence (optionnelle)</label>
                <input
                  id="requirement-source"
                  value={requirementForm.sourceReference}
                  onChange={(event) =>
                    setRequirementForm({ ...requirementForm, sourceReference: event.currentTarget.value })
                  }
                  placeholder="CCTP §3.1"
                />
              </div>
              <button className="primary-inline-button" type="submit" disabled={saving}>
                <Plus size={15} aria-hidden="true" />
                {saving ? "Ajout…" : "Ajouter l'exigence"}
              </button>
            </form>
          )}
          {selectedStudy.status === "DRAFT" && (
            <div className="study-actions">
              <p>La validation fige les exigences et autorise la création du DQE.</p>
              <button
                className="secondary-button"
                type="button"
                disabled={saving || selectedStudy.requirements.length === 0}
                onClick={() => void markStudyReady()}
              >
                <CheckCircle2 size={15} aria-hidden="true" />
                Valider et figer l'étude
              </button>
            </div>
          )}
          {selectedStudy.status === "READY_FOR_DQE" && (
            <form className="dqe-create-form" onSubmit={createDqe}>
              <div className="dqe-create-copy">
                <h3>Créer le DQE</h3>
                <p>Le lien vers l'étude prête et ses exigences sera figé.</p>
              </div>
              <div>
                <label htmlFor="dqe-code">Code du DQE</label>
                <input
                  id="dqe-code"
                  value={dqeForm.code}
                  onChange={(event) => setDqeForm({ ...dqeForm, code: event.currentTarget.value })}
                  placeholder="DQE-2026-001"
                  required
                />
              </div>
              <div className="dqe-title-field">
                <label htmlFor="dqe-title">Titre du DQE</label>
                <input
                  id="dqe-title"
                  value={dqeForm.title}
                  onChange={(event) => setDqeForm({ ...dqeForm, title: event.currentTarget.value })}
                  placeholder="DQE — Lot principal"
                  required
                />
              </div>
              <div>
                <label htmlFor="dqe-currency">Devise</label>
                <select
                  id="dqe-currency"
                  value={dqeForm.currency}
                  onChange={(event) =>
                    setDqeForm({ ...dqeForm, currency: event.currentTarget.value })
                  }
                >
                  <option value="USD">USD</option>
                  <option value="CDF">CDF</option>
                  <option value="EUR">EUR</option>
                </select>
              </div>
              <button className="primary-inline-button" type="submit" disabled={saving}>
                <Plus size={15} aria-hidden="true" />
                {saving ? "Création…" : "Créer le DQE"}
              </button>
            </form>
          )}
          {selectedDqe && selectedDqe.source?.studyId === selectedStudy.id && (
            <p className="inline-confirmation" role="status">
              {selectedDqe.code} est prêt pour la saisie des lignes.
            </p>
          )}
        </section>
      )}

      <section className="panel dqe-panel">
        <div className="panel-head">
          <div>
            <h2>Documents DQE</h2>
            <p>Documents quantitatifs issus d'études validées</p>
          </div>
        </div>
        {data.dqes.length === 0 ? (
          <EmptyState title="Aucun DQE" body="Validez une étude avant de créer son DQE." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Document</th>
                  <th scope="col">Statut</th>
                  <th scope="col">Lignes</th>
                  <th scope="col">Total</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {data.dqes.map((dqe) => (
                  <tr key={dqe.id}>
                    <td>
                      <strong>{dqe.title}</strong>
                      <small>{dqe.code}</small>
                    </td>
                    <td>
                      <span className={`status-chip status-${dqe.status.toLowerCase()}`}>
                        {dqe.status === "FINALIZED" ? "Finalisé" : "Brouillon"}
                      </span>
                    </td>
                    <td>{dqe.lines.length}</td>
                    <td className="numeric-cell">
                      {dqe.subtotal} {dqe.currency}
                    </td>
                    <td>
                      <button
                        className="link-button"
                        type="button"
                        aria-label={`Ouvrir ${dqe.code}`}
                        onClick={() => void openDqe(dqe.id)}
                      >
                        Ouvrir <ChevronRight size={13} aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selectedDqe && (
        <section className="panel dqe-detail-panel">
          <div className="panel-head">
            <div>
              <span className="record-code">{selectedDqe.code}</span>
              <h2>Lignes du DQE</h2>
              <p>
                {selectedDqe.title} · Révision {selectedDqe.revision}
              </p>
            </div>
            <div className="dqe-total">
              <span className={`status-chip status-${selectedDqe.status.toLowerCase()}`}>
                {selectedDqe.status === "FINALIZED" ? "Finalisé" : "Brouillon"}
              </span>
              <strong>{selectedDqe.subtotal} {selectedDqe.currency}</strong>
              {can("estimation.dqe.read") && <div className="crm-row-actions"><FileDownloadButton path={`/estimation/dqes/${selectedDqe.id}/export.xlsx`} filename={`${selectedDqe.code}.xlsx`} onError={setError}>Exporter Excel</FileDownloadButton><FileDownloadButton path={`/estimation/dqes/${selectedDqe.id}/export.pdf`} filename={`${selectedDqe.code}.pdf`} onError={setError}>Exporter PDF</FileDownloadButton></div>}
            </div>
          </div>

          <div className="dqe-financial-summary" aria-label="Synthèse financière du DQE">
            <div><span>Total direct</span><strong>{selectedDqe.subtotal} {selectedDqe.currency}</strong></div>
            <div><span>Frais généraux</span><strong>{selectedDqe.overheadAmount} {selectedDqe.currency}</strong></div>
            <div><span>Marge</span><strong>{selectedDqe.marginAmount} {selectedDqe.currency}</strong></div>
            <div><span>Taxes</span><strong>{selectedDqe.taxAmount} {selectedDqe.currency}</strong></div>
            <div className="dqe-financial-total"><span>Total TTC</span><strong>{selectedDqe.total} {selectedDqe.currency}</strong></div>
          </div>

          {selectedDqe.status === "DRAFT" && can("estimation.pricing.manage") && (
            <form className="dqe-pricing-form" onSubmit={updateDqePricing}>
              <div className="dqe-pricing-copy"><strong>Coefficients de chiffrage</strong><small>Les taux sont enregistrés avec la version du brouillon.</small></div>
              <label htmlFor="dqe-overhead">Frais généraux (%)<input id="dqe-overhead" inputMode="decimal" value={pricingForm.overheadRate} onChange={(event) => setPricingForm({ ...pricingForm, overheadRate: event.currentTarget.value })} /></label>
              <label htmlFor="dqe-margin">Marge (%)<input id="dqe-margin" inputMode="decimal" value={pricingForm.marginRate} onChange={(event) => setPricingForm({ ...pricingForm, marginRate: event.currentTarget.value })} /></label>
              <label htmlFor="dqe-tax">Taxe (%)<input id="dqe-tax" inputMode="decimal" value={pricingForm.taxRate} onChange={(event) => setPricingForm({ ...pricingForm, taxRate: event.currentTarget.value })} /></label>
              <button className="secondary-button" type="submit" disabled={saving}>Enregistrer les taux</button>
            </form>
          )}

          <section className="dqe-variants" aria-labelledby="dqe-variants-title">
            <div className="dqe-variants-head">
              <div><h3 id="dqe-variants-title">Variantes comparées</h3><p>Capturez un instantané immuable avant de modifier le scénario de chiffrage.</p></div>
              {selectedDqe.status !== "ARCHIVED" && can("estimation.dqe.manage") && (
                <form className="dqe-variant-form" onSubmit={createDqeVariant}>
                  <label htmlFor="variant-code">Code<input id="variant-code" value={variantForm.code} onChange={(event) => setVariantForm({ ...variantForm, code: event.currentTarget.value })} placeholder="OPT-A" required /></label>
                  <label htmlFor="variant-title">Intitulé<input id="variant-title" value={variantForm.title} onChange={(event) => setVariantForm({ ...variantForm, title: event.currentTarget.value })} placeholder="Solution optimisée" required /></label>
                  <button className="secondary-button" type="submit" disabled={saving}>Capturer</button>
                </form>
              )}
            </div>
            {variants.length > 0 && <div className="table-wrap"><table><thead><tr><th>Variante</th><th>Révision</th><th>Total capturé</th><th>Écart actuel</th><th>Créée le</th></tr></thead><tbody>{variants.map((variant) => <tr key={variant.id}><td><strong>{variant.title}</strong><small>{variant.code}</small></td><td>R{variant.revision}</td><td className="numeric-cell">{variant.total} {variant.currency}</td><td className="numeric-cell">{variant.deltaTotal} {variant.currency}</td><td>{new Date(variant.createdAt).toLocaleDateString("fr-FR")}</td></tr>)}</tbody></table></div>}
            {variants.length === 0 && <p className="dqe-variants-empty">Aucune variante capturée pour ce DQE.</p>}
          </section>

          {selectedDqe.lines.length === 0 ? (
            <EmptyState title="Aucune ligne" body="Ajoutez la première ligne du bordereau." />
          ) : (
            <div className="table-wrap dqe-lines-table">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Pos.</th>
                    <th scope="col">Référence</th>
                    <th scope="col">Désignation</th>
                    <th scope="col">Famille</th>
                    <th scope="col">Unité</th>
                    <th scope="col">Quantité</th>
                    <th scope="col">Prix unitaire</th>
                    <th scope="col">Total ligne</th>
                    {selectedDqe.status === "DRAFT" && can("estimation.dqe.manage") && <th scope="col">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {selectedDqe.lines.map((line) => (
                    <tr key={line.id}>
                      <td>{line.position}</td>
                      <td><strong>{line.reference ?? "—"}</strong></td>
                      <td>{line.designation}</td>
                      <td>{line.costCategory === "MATERIAL" ? "Matériaux" : line.costCategory === "LABOR" ? "Main-d’œuvre" : line.costCategory === "EQUIPMENT" ? "Matériel" : line.costCategory === "SUBCONTRACTING" ? "Sous-traitance" : "Autres"}</td>
                      <td>{line.unitCode}</td>
                      <td className="numeric-cell">{line.quantity}</td>
                      <td className="numeric-cell">{line.unitPrice}</td>
                      <td className="numeric-cell">{line.lineTotal}</td>
                      {selectedDqe.status === "DRAFT" && can("estimation.dqe.manage") && <td><div className="crm-row-actions"><button type="button" className="link-button" aria-label={`Modifier la ligne ${line.position}`} onClick={() => setDraftEditor({ selection: { kind: "line", parent: selectedDqe, row: line }, deleting: false })}>Modifier</button><button type="button" className="link-button" aria-label={`Supprimer la ligne ${line.position}`} onClick={() => setDraftEditor({ selection: { kind: "line", parent: selectedDqe, row: line }, deleting: true })}>Supprimer</button></div></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {selectedDqe.status === "DRAFT" && (
            <form className="line-form" onSubmit={addDqeLine}>
              {libraryItems.length > 0 && <div className="line-library-field"><label htmlFor="line-library">Depuis la bibliothèque</label><select id="line-library" defaultValue="" onChange={(event) => applyLibraryItem(event.currentTarget.value)}><option value="">Choisir un ouvrage…</option>{libraryItems.filter((item) => item.isActive).map((item) => <option key={item.id} value={item.code}>{item.code} — {item.designation}</option>)}</select></div>}
              <div>
                <label htmlFor="line-position">Position de ligne</label>
                <input
                  id="line-position"
                  type="number"
                  min="1"
                  step="1"
                  value={lineForm.position}
                  onChange={(event) => setLineForm({ ...lineForm, position: event.currentTarget.value })}
                  required
                />
              </div>
              <div>
                <label htmlFor="line-reference">Référence (optionnelle)</label>
                <input
                  id="line-reference"
                  value={lineForm.reference}
                  onChange={(event) => setLineForm({ ...lineForm, reference: event.currentTarget.value })}
                  placeholder="BPU-001"
                />
              </div>
              <div className="line-designation">
                <label htmlFor="line-designation">Désignation</label>
                <input
                  id="line-designation"
                  value={lineForm.designation}
                  onChange={(event) => setLineForm({ ...lineForm, designation: event.currentTarget.value })}
                  placeholder="Ouvrage ou prestation"
                  required
                />
              </div>
              <div>
                <label htmlFor="line-unit">Unité</label>
                <input
                  id="line-unit"
                  value={lineForm.unitCode}
                  onChange={(event) => setLineForm({ ...lineForm, unitCode: event.currentTarget.value })}
                  placeholder="m3"
                  required
                />
              </div>
              <div>
                <label htmlFor="line-category">Famille de coût</label>
                <select
                  id="line-category"
                  value={lineForm.costCategory}
                  onChange={(event) => setLineForm({ ...lineForm, costCategory: event.currentTarget.value })}
                >
                  <option value="MATERIAL">Matériaux</option>
                  <option value="LABOR">Main-d’œuvre</option>
                  <option value="EQUIPMENT">Matériel</option>
                  <option value="SUBCONTRACTING">Sous-traitance</option>
                  <option value="OTHER">Autres</option>
                </select>
              </div>
              <div>
                <label htmlFor="line-quantity">Quantité</label>
                <input
                  id="line-quantity"
                  inputMode="decimal"
                  value={lineForm.quantity}
                  onChange={(event) => setLineForm({ ...lineForm, quantity: event.currentTarget.value })}
                  placeholder="0.000000"
                  required
                />
              </div>
              <div>
                <label htmlFor="line-unit-price">Prix unitaire</label>
                <input
                  id="line-unit-price"
                  inputMode="decimal"
                  value={lineForm.unitPrice}
                  onChange={(event) => setLineForm({ ...lineForm, unitPrice: event.currentTarget.value })}
                  placeholder="0.000000"
                  required
                />
              </div>
              <button className="primary-inline-button" type="submit" disabled={saving}>
                <Plus size={15} aria-hidden="true" />
                {saving ? "Ajout…" : "Ajouter la ligne"}
              </button>
            </form>
          )}
          {selectedDqe.status === "DRAFT" && (
            <div className="study-actions dqe-finalize-actions">
              <p>La finalisation bloque définitivement toute modification des lignes.</p>
              <button
                className="secondary-button"
                type="button"
                disabled={saving || selectedDqe.lines.length === 0}
                onClick={() => void finalizeDqe()}
              >
                <CheckCircle2 size={15} aria-hidden="true" />
                Finaliser et figer le DQE
              </button>
            </div>
          )}
        </section>
      )}
      {draftEditor && <EstimationDraftEditor selection={draftEditor.selection} deleting={draftEditor.deleting} onClose={() => setDraftEditor(null)} onSaved={async result => { if ("requirements" in result) setSelectedStudy(result); else setSelectedDqe(result); setDraftEditor(null); setNotice("Brouillon actualisé."); await load(); }} />}
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
      <FileSpreadsheet size={22} aria-hidden="true" />
      <strong>{title}</strong>
      <small>{body}</small>
    </div>
  );
}
