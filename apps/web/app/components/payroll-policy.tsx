"use client";
import React, { useState } from "react";
import type { PayrollCalculationMode, PayrollPolicyView } from "@axora24/contracts";
import { ApiError } from "../lib/api";
import { hrApi } from "../lib/modules/hr";
import { useResource } from "../lib/hooks";
import { useSession } from "../lib/session";
import { Button, DecimalField, DetailList, Feedback, Form, Loading, Modal, Panel, SelectField, TextField } from "./ui";

export function PayrollPolicy(): React.ReactElement {
  const { can } = useSession();
  const resource = useResource(() => hrApi.payrollPolicy());
  const [editing, setEditing] = useState<PayrollPolicyView | null>(null);
  const [mode, setMode] = useState<PayrollCalculationMode>("MONTHLY_BASE");
  const [hours, setHours] = useState("");
  const [coefficient, setCoefficient] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [socialRate, setSocialRate] = useState("");
  const [healthRate, setHealthRate] = useState("");
  const [incomeTaxRate, setIncomeTaxRate] = useState("");
  const [taxFreeAllowance, setTaxFreeAllowance] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const policy = resource.data;
  async function save(): Promise<void> {
    if (!editing || saving) return;
    const standardMonthlyHours = hours.trim().replace(",", ".");
    const overtimeCoefficient = coefficient.trim().replace(",", ".");
    if (mode === "VALIDATED_HOURS" && (!/^\d{1,3}(\.\d{1,2})?$/.test(standardMonthlyHours) || Number(standardMonthlyHours) <= 0 || Number(standardMonthlyHours) > 744 || !/^\d{1,3}(\.\d{1,2})?$/.test(overtimeCoefficient) || Number(overtimeCoefficient) < 1 || Number(overtimeCoefficient) > 100)) { setError("Saisissez des heures mensuelles entre 0,01 et 744 et un coefficient entre 1 et 100, avec deux décimales au maximum."); return; }
    const statutory = [countryCode.trim(), socialRate.trim(), healthRate.trim(), incomeTaxRate.trim(), taxFreeAllowance.trim()];
    if (statutory.some(Boolean) && statutory.some((value) => !value)) { setError("Renseignez le pays, les trois taux et l'abattement pour activer les retenues légales."); return; }
    if (statutory.some(Boolean) && (!/^[A-Za-z]{2}$/.test(countryCode.trim()) || [socialRate, healthRate, incomeTaxRate].some((value) => !/^\d{1,3}(\.\d{1,2})?$/.test(value.trim()) || Number(value) < 0 || Number(value) > 100) || !/^\d{1,12}(\.\d{1,2})?$/.test(taxFreeAllowance.trim()) || Number(taxFreeAllowance) < 0)) { setError("Les taux doivent être compris entre 0 et 100 ; l'abattement doit être positif ou nul."); return; }
    setSaving(true); setError(""); setNotice("");
    try {
      await hrApi.updatePayrollPolicy({ expectedVersion: editing.version, mode, ...(mode === "VALIDATED_HOURS" ? { standardMonthlyHours, overtimeCoefficient } : {}), ...(statutory.some(Boolean) ? { countryCode: countryCode.trim().toUpperCase(), employeeSocialRate: socialRate.trim().replace(",", "."), employeeHealthRate: healthRate.trim().replace(",", "."), incomeTaxRate: incomeTaxRate.trim().replace(",", "."), taxFreeAllowance: taxFreeAllowance.trim().replace(",", ".") } : {}) });
      setEditing(null); await resource.reload(); setNotice("Les règles de préparation de paie ont été enregistrées.");
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) { setEditing(null); await resource.reload(); setError("Les règles ont changé ailleurs. Vérifiez leur nouvelle version avant de les modifier."); }
      else setError(caught instanceof ApiError ? caught.message : "L’enregistrement a échoué.");
    } finally { setSaving(false); }
  }
  return <Panel title="Règles de préparation automatique" subtitle="Salaire mensuel ou calcul à partir des feuilles de temps validées" actions={can("hr.payrollpolicy.manage") && policy && <Button disabled={!!resource.error} onClick={() => { setEditing(policy); setMode(policy.mode); setHours(policy.standardMonthlyHours ?? ""); setCoefficient(policy.overtimeCoefficient ?? ""); setCountryCode(policy.countryCode ?? ""); setSocialRate(policy.employeeSocialRate ?? ""); setHealthRate(policy.employeeHealthRate ?? ""); setIncomeTaxRate(policy.incomeTaxRate ?? ""); setTaxFreeAllowance(policy.taxFreeAllowance ?? ""); setError(""); }}>Configurer le calcul</Button>}>
    <Feedback error={resource.error || error} notice={notice} />
    {!policy ? <>{resource.loading ? <Loading label="Chargement des règles…" /> : <button type="button" className="secondary-button" onClick={() => void resource.reload()}>Réessayer</button>}</> : <><DetailList items={[{ label: "Mode", value: policy.mode === "MONTHLY_BASE" ? "Salaire de base mensuel" : "Heures validées" }, { label: "Heures mensuelles de référence", value: policy.standardMonthlyHours ?? "Non utilisées" }, { label: "Coefficient heures supplémentaires", value: policy.overtimeCoefficient ?? "Non utilisé" }, { label: "Retenues légales", value: policy.statutoryConfigured ? `${policy.countryCode} · cotisations et impôt paramétrés` : "À paramétrer" }]} /><p className="inline-note">{policy.mode === "VALIDATED_HOURS" ? "Le brut est calculé à partir des heures validées, du salaire de base et des règles configurées. Les pointages importés dans une feuille doivent être validés avant de compter dans la paie." : "Le salaire de base mensuel est repris automatiquement. Les éléments variables restent explicites."}</p><p className="inline-note">{policy.statutoryConfigured ? "Les prochaines paies calculeront le net à payer à partir des taux enregistrés et de l'abattement." : "Aucune retenue légale n'est présumée tant que le pays, les taux salariés et l'abattement ne sont pas renseignés."}</p></>}
    {editing && <Modal title="Configurer la préparation de paie" onClose={() => !saving && setEditing(null)}><Feedback error={error} /><Form columns={1} onSubmit={() => void save()} saving={saving} submitLabel="Enregistrer les règles"><SelectField label="Mode de calcul" value={mode} onChange={value => setMode(value as PayrollCalculationMode)} required options={[{ value: "MONTHLY_BASE", label: "Salaire de base mensuel" }, { value: "VALIDATED_HOURS", label: "Heures validées" }]} />{mode === "VALIDATED_HOURS" && <><DecimalField label="Heures mensuelles de référence" value={hours} onChange={setHours} required hint="Indiquez la durée mensuelle applicable à votre entreprise." /><DecimalField label="Coefficient des heures supplémentaires" value={coefficient} onChange={setCoefficient} required hint="1 signifie aucune majoration. Utilisez le coefficient réellement applicable." /></>}<div className="payroll-statutory-form"><h3>Retenues légales</h3><p className="inline-note">Paramétrez les taux applicables à votre pays avec votre conseil comptable. AXORA ne déduit aucune règle automatiquement.</p><TextField label="Code pays (ISO 2)" value={countryCode} onChange={setCountryCode} placeholder="CD" /><DecimalField label="Cotisation sociale salarié (%)" value={socialRate} onChange={setSocialRate} placeholder="0.00" /><DecimalField label="Assurance santé salarié (%)" value={healthRate} onChange={setHealthRate} placeholder="0.00" /><DecimalField label="Impôt sur le revenu (%)" value={incomeTaxRate} onChange={setIncomeTaxRate} placeholder="0.00" /><DecimalField label="Abattement fiscal (devise de paie)" value={taxFreeAllowance} onChange={setTaxFreeAllowance} placeholder="0.00" /></div><p className="inline-note">Les préparations déjà créées conservent leur calcul enregistré. Ces règles s’appliquent aux prochaines préparations.</p></Form></Modal>}
  </Panel>;
}
