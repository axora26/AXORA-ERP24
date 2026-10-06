"use client";

import React, { useMemo, useState } from "react";
import { ChartNoAxesCombined } from "lucide-react";
import { projectsApi, COST_CATEGORY_LABEL } from "../../../lib/modules/projects";
import { formatMoney, formatDate } from "../../../lib/format";
import { useMutation, useResource } from "../../../lib/hooks";
import { useSession } from "../../../lib/session";
import { Button, DataTable, Empty, Feedback, PageHeader, Panel, SelectField, StatusChip, TextAreaField, TextField } from "../../../components/ui";

const categories = ["MATERIAL", "LABOR", "EQUIPMENT", "SUBCONTRACT", "OVERHEAD", "OTHER"] as const;

export default function ForecastsPage(): React.ReactElement {
  const session = useSession();
  const projects = useResource(() => projectsApi.list());
  const [projectId, setProjectId] = useState("");
  const forecasts = useResource(() => projectId ? projectsApi.forecasts(projectId) : Promise.resolve([]));
  const mutation = useMutation();
  const [justification, setJustification] = useState("");
  const [revisedBudget, setRevisedBudget] = useState("");
  const [lines, setLines] = useState(() => categories.map((category) => ({ category, description: "", remainingAmount: "0.00" })));
  const project = (projects.data ?? []).find((item) => item.id === projectId);
  const canManage = session.can("projects.forecast.manage");
  const canApprove = session.can("projects.forecast.approve");
  const latest = forecasts.data?.[0];
  const remaining = useMemo(() => lines.reduce((sum, line) => sum + (Number(line.remainingAmount) || 0), 0), [lines]);

  return (
    <>
      <PageHeader breadcrumb="Projets / Prévisions" title="Prévisions EAC" subtitle="Figez le consommé réellement visible, explicitez le reste à faire et sécurisez la validation par un tiers." onRefresh={() => void forecasts.reload()} />
      <Feedback error={projects.error || forecasts.error || mutation.error} notice={mutation.notice} />
      <div className="stack">
        <Panel title="Projet" subtitle="Les sources restent filtrées par l’entreprise active">
          <SelectField label="Projet à analyser" value={projectId} onChange={setProjectId} options={(projects.data ?? []).map((item) => ({ value: item.id, label: `${item.code} · ${item.name}` }))} />
        </Panel>
        {projectId && project && (
          <>
            <Panel title="Nouvelle révision" subtitle="Six catégories obligatoires · le consommé est calculé par les modules autorisés">
              {canManage ? (
                <form className="stack" onSubmit={(event) => { event.preventDefault(); void mutation.run(async () => { const result = await projectsApi.createForecast(projectId, { justification, revisedBudget, lines }); setJustification(""); setRevisedBudget(""); setLines(categories.map((category) => ({ category, description: "", remainingAmount: "0.00" }))); await forecasts.reload(); return result; }, "Révision EAC créée."); }}>
                  <div className="form-grid form-grid-2">
                    <TextField label={`Budget révisé (${project.currency})`} value={revisedBudget} onChange={setRevisedBudget} inputMode="decimal" required />
                    <div className="metric-inline"><strong>Reste explicite</strong><span>{formatMoney(remaining.toFixed(2), project.currency)}</span></div>
                  </div>
                  <TextAreaField label="Justification" value={justification} onChange={setJustification} required />
                  <div className="table-wrap"><table className="data-table"><thead><tr><th>Catégorie</th><th>Description</th><th className="align-right">Reste à faire</th></tr></thead><tbody>{lines.map((line, index) => <tr key={line.category}><td><strong>{COST_CATEGORY_LABEL[line.category]}</strong></td><td><input className="field-input" value={line.description} onChange={(event) => setLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.currentTarget.value } : item))} placeholder="Hypothèse documentée" required /></td><td><input className="field-input align-right" value={line.remainingAmount} onChange={(event) => setLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, remainingAmount: event.currentTarget.value } : item))} inputMode="decimal" required /></td></tr>)}</tbody></table></div>
                  <div className="actions"><Button type="submit" variant="primary" disabled={mutation.saving}>Créer la révision</Button></div>
                </form>
              ) : <Empty icon={<ChartNoAxesCombined size={22} />} title="Préparation réservée" body="Votre profil peut consulter les révisions mais ne peut pas en créer." />}
            </Panel>
            <Panel title="Historique des révisions" subtitle={latest ? `Dernière révision : R${latest.revisionNumber}` : "Aucune révision enregistrée"}>
              <DataTable rows={forecasts.data ?? []} empty={<Empty icon={<ChartNoAxesCombined size={22} />} title="Aucune prévision" body="Créez la première révision EAC du projet." />} columns={[
                { key: "revision", header: "Révision", render: (row) => <><strong>R{row.revisionNumber}</strong><small>{formatDate(row.asOf)}</small></> },
                { key: "status", header: "Statut", render: (row) => <StatusChip status={row.status} label={row.status === "APPROVED" ? "Approuvée" : row.status === "REJECTED" ? "Rejetée" : "En attente"} /> },
                { key: "eac", header: "EAC", align: "right", render: (row) => <span className="num">{formatMoney(row.eacAmount, row.currency)}</span> },
                { key: "margin", header: "Marge", align: "right", render: (row) => <span className="num">{formatMoney(row.marginAmount, row.currency)}</span> },
                { key: "decision", header: "Décision", render: (row) => row.status === "PENDING" && canApprove ? <div className="actions"><Button variant="secondary" onClick={() => void mutation.run(async () => { const result = await projectsApi.approveForecast(projectId, row.id); await forecasts.reload(); return result; }, "Révision approuvée.")}>Approuver</Button><Button variant="ghost" onClick={() => void mutation.run(async () => { const result = await projectsApi.rejectForecast(projectId, row.id, "Révision à revoir"); await forecasts.reload(); return result; }, "Révision rejetée.")}>Rejeter</Button></div> : row.decisionNote ?? "—" },
              ]} />
            </Panel>
          </>
        )}
      </div>
    </>
  );
}
