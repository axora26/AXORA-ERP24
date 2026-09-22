"use client";

import React from "react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import type {
  CrmOpportunityView,
  DqeSummaryView,
  DqeView,
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
  quantity: "",
  unitPrice: "",
};

/**
 * Espace Etudes & DQE (INC-03).
 * Les listes et compteurs proviennent exclusivement de l'API du tenant.
 */
export function EstimationWorkspace(): React.ReactElement {
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
        category: requirementForm.category,
        statement: requirementForm.statement,
        ...(requirementForm.sourceReference.trim()
          ? { sourceReference: requirementForm.sourceReference.trim() }
          : {}),
      });
      setRequirementForm({
        ...EMPTY_REQUIREMENT_FORM,
        position: String(selectedStudy.requirements.length + 2),
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
      setSelectedStudy(await estimationApi.markStudyReady(selectedStudy.id));
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
      setSelectedDqe(await estimationApi.dqe(dqeId));
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
        ...(lineForm.reference.trim() ? { reference: lineForm.reference.trim() } : {}),
        designation: lineForm.designation,
        unitCode: lineForm.unitCode,
        quantity: lineForm.quantity,
        unitPrice: lineForm.unitPrice,
      });
      setLineForm({ ...EMPTY_LINE_FORM, position: String(selectedDqe.lines.length + 2) });
      setSelectedDqe(await estimationApi.dqe(selectedDqe.id));
      setNotice("Ligne ajoutée au DQE.");
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Ajout de la ligne impossible.");
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
      setSelectedDqe(await estimationApi.finalizeDqe(selectedDqe.id));
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
                    <th>Position</th>
                    <th>Catégorie</th>
                    <th>Énoncé</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedStudy.requirements.map((requirement) => (
                    <tr key={requirement.id}>
                      <td>{requirement.position}</td>
                      <td>{requirement.category}</td>
                      <td>{requirement.statement}</td>
                      <td>{requirement.sourceReference ?? "—"}</td>
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
                  <th>Document</th>
                  <th>Statut</th>
                  <th>Lignes</th>
                  <th>Total</th>
                  <th>Action</th>
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
            </div>
          </div>

          {selectedDqe.lines.length === 0 ? (
            <EmptyState title="Aucune ligne" body="Ajoutez la première ligne du bordereau." />
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
                  {selectedDqe.lines.map((line) => (
                    <tr key={line.id}>
                      <td>{line.position}</td>
                      <td><strong>{line.reference ?? "—"}</strong></td>
                      <td>{line.designation}</td>
                      <td>{line.unitCode}</td>
                      <td className="numeric-cell">{line.quantity}</td>
                      <td className="numeric-cell">{line.unitPrice}</td>
                      <td className="numeric-cell">{line.lineTotal}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {selectedDqe.status === "DRAFT" && (
            <form className="line-form" onSubmit={addDqeLine}>
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
