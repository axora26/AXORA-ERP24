"use client";
import React, { useState } from "react";
import type { DqeLineView, DqeView, EstimationRequirementView, EstimationStudyView, StudyRequirementCategory } from "@axora24/contracts";
import { api, ApiError } from "../lib/api";
import { Form, Modal, SelectField, TextAreaField, TextField } from "./ui";

type Selection = { kind: "requirement"; parent: EstimationStudyView; row: EstimationRequirementView } | { kind: "line"; parent: DqeView; row: DqeLineView };
export function EstimationDraftEditor({ selection, deleting, onClose, onSaved }: { selection: Selection; deleting: boolean; onClose: () => void; onSaved: (result: EstimationStudyView | DqeView) => Promise<void> }): React.ReactElement {
  const requirement = selection.kind === "requirement";
  const initial = selection.row;
  const [position, setPosition] = useState(String(initial.position));
  const [category, setCategory] = useState("category" in initial ? initial.category : "FACT");
  const [statement, setStatement] = useState("statement" in initial ? initial.statement : "");
  const [reference, setReference] = useState(("sourceReference" in initial ? initial.sourceReference : initial.reference) ?? "");
  const [designation, setDesignation] = useState("designation" in initial ? initial.designation : "");
  const [unitCode, setUnitCode] = useState("unitCode" in initial ? initial.unitCode : "");
  const [quantity, setQuantity] = useState("quantity" in initial ? initial.quantity : "");
  const [unitPrice, setUnitPrice] = useState("unitPrice" in initial ? initial.unitPrice : "");
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState("");
  async function submit(): Promise<void> {
    if (saving || conflict) return;
    const numericPosition = Number(position);
    if (!deleting && (!Number.isSafeInteger(numericPosition) || numericPosition < 1)) { setError("La position doit être un entier positif."); return; }
    if (!deleting && !requirement && (!/^\d{1,18}(\.\d{1,6})?$/.test(quantity.replace(",", ".")) || !/^\d{1,18}(\.\d{1,6})?$/.test(unitPrice.replace(",", ".")))) { setError("La quantité et le prix doivent être positifs ou nuls, avec au maximum six décimales."); return; }
    setSaving(true); setError("");
    const path = requirement ? `/estimation/studies/${selection.parent.id}/requirements/${selection.row.id}` : `/estimation/dqes/${selection.parent.id}/lines/${selection.row.id}`;
    try {
      const result = deleting ? await api.delete<EstimationStudyView | DqeView>(path, { expectedVersion: selection.parent.version }) : await api.patch<EstimationStudyView | DqeView>(path, { expectedVersion: selection.parent.version, position: numericPosition, ...(requirement ? { category, statement: statement.trim(), sourceReference: reference.trim() || null } : { reference: reference.trim() || null, designation: designation.trim(), unitCode: unitCode.trim(), quantity: quantity.trim().replace(",", "."), unitPrice: unitPrice.trim().replace(",", ".") }) });
      await onSaved(result);
    } catch (caught) {
      const stale = caught instanceof ApiError && caught.status === 409 && /changed|concurr|version|modifi/i.test(caught.message);
      setConflict(stale); setError(stale ? "Le brouillon a changé. Fermez cette fenêtre et rouvrez le document pour retrouver sa dernière version." : caught instanceof ApiError && /position already exists/i.test(caught.message) ? "Cette position est déjà utilisée. Choisissez une autre position." : caught instanceof ApiError ? caught.message : "Enregistrement impossible.");
    } finally { setSaving(false); }
  }
  return <Modal title={`${deleting ? "Supprimer" : "Modifier"} ${requirement ? "une exigence" : "une ligne du DQE"}`} onClose={() => !saving && onClose()} wide>
    {error && <div className="form-error" role="alert">{error}</div>}
    {deleting ? <><p>Confirmez la suppression de cet élément du brouillon. {requirement ? "Les autres exigences seront conservées." : "Le montant du DQE sera recalculé."}</p><p><strong>{requirement ? statement : designation}</strong></p><div className="module-form-actions"><button type="button" className="secondary-button" disabled={saving} onClick={onClose}>Annuler</button><button type="button" className="primary-inline-button" disabled={saving || conflict} onClick={() => void submit()}>{saving ? "Suppression…" : "Supprimer"}</button></div></> : <Form columns={2} onSubmit={() => void submit()} saving={saving || conflict} submitLabel="Enregistrer la correction">
      <TextField label="Position" type="number" value={position} onChange={setPosition} required />
      {requirement ? <><SelectField label="Catégorie" value={category} onChange={value => setCategory(value as StudyRequirementCategory)} required options={[{ value: "FACT", label: "Fait" }, { value: "ASSUMPTION", label: "Hypothèse" }, { value: "CONSTRAINT", label: "Contrainte" }, { value: "RISK", label: "Risque" }, { value: "NOTE", label: "Note" }]} /><TextAreaField label="Énoncé de l’exigence" value={statement} onChange={setStatement} required wide /></> : <><TextField label="Unité" value={unitCode} onChange={setUnitCode} required /><TextField label="Désignation" value={designation} onChange={setDesignation} required wide /><TextField label="Quantité" inputMode="decimal" value={quantity} onChange={setQuantity} required hint="Maximum six décimales" /><TextField label="Prix unitaire" inputMode="decimal" value={unitPrice} onChange={setUnitPrice} required hint="Maximum six décimales" /></>}
      <TextField label={requirement ? "Source" : "Référence"} value={reference} onChange={setReference} wide />
    </Form>}
  </Modal>;
}
export type EstimationDraftSelection = Selection;
