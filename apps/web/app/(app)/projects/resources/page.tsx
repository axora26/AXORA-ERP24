"use client";

import React, { useMemo, useState } from "react";
import { CalendarRange } from "lucide-react";
import { projectsApi } from "../../../lib/modules/projects";
import { hrApi } from "../../../lib/modules/hr";
import { fleetApi } from "../../../lib/modules/fleet";
import { assetsApi } from "../../../lib/modules/assets";
import { inventoryApi } from "../../../lib/modules/inventory";
import { formatDate, formatMoney } from "../../../lib/format";
import { useMutation, useResource } from "../../../lib/hooks";
import { useSession } from "../../../lib/session";
import { Button, DataTable, Empty, Feedback, PageHeader, Panel, SelectField, StatusChip, TextAreaField, TextField } from "../../../components/ui";

const kinds = ["EMPLOYEE", "VEHICLE", "ASSET", "MATERIAL"] as const;
const kindLabel: Record<string, string> = { EMPLOYEE: "Équipe / employé", VEHICLE: "Véhicule / engin", ASSET: "Actif / équipement", MATERIAL: "Matériau / article" };

export default function ProjectResourcesPage(): React.ReactElement {
  const session = useSession();
  const projects = useResource(() => projectsApi.list());
  const employees = useResource(() => hrApi.employees().catch(() => []));
  const vehicles = useResource(() => fleetApi.vehicles().catch(() => []));
  const assets = useResource(() => assetsApi.list().catch(() => []));
  const materials = useResource(() => inventoryApi.items().catch(() => []));
  const [projectId, setProjectId] = useState("");
  const resources = useResource(() => projectId ? projectsApi.resources(projectId) : Promise.resolve([]));
  const mutation = useMutation();
  const [kind, setKind] = useState<string>("EMPLOYEE");
  const [resourceId, setResourceId] = useState("");
  const [plannedQuantity, setPlannedQuantity] = useState("1");
  const [plannedRate, setPlannedRate] = useState("");
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [notes, setNotes] = useState("");
  const project = (projects.data ?? []).find((item) => item.id === projectId);
  const canManage = session.can("projects.resource.manage");
  const options = useMemo(() => {
    if (kind === "EMPLOYEE") return (employees.data ?? []).filter((item) => item.status === "ACTIVE").map((item) => ({ value: item.id, label: `${item.code} · ${item.fullName}` }));
    if (kind === "VEHICLE") return (vehicles.data ?? []).filter((item) => item.status === "ACTIVE").map((item) => ({ value: item.id, label: `${item.code} · ${item.make} ${item.model}` }));
    if (kind === "ASSET") return (assets.data ?? []).filter((item) => item.status === "IN_SERVICE").map((item) => ({ value: item.id, label: `${item.code} · ${item.name}` }));
    return (materials.data ?? []).filter((item) => item.isActive).map((item) => ({ value: item.id, label: `${item.code} · ${item.name} (${item.unitCode})` }));
  }, [assets.data, employees.data, kind, materials.data, vehicles.data]);

  return (
    <>
      <PageHeader breadcrumb="Projets / Ressources" title="Ressources projet" subtitle="Planifiez les équipes, engins, équipements et matériaux sans double réservation sur une même période." onRefresh={() => void resources.reload()} />
      <Feedback error={projects.error || resources.error || mutation.error} notice={mutation.notice} />
      <div className="stack">
        <Panel title="Projet" subtitle="Les plans restent isolés par entreprise">
          <SelectField label="Projet à planifier" value={projectId} onChange={(value) => { setProjectId(value); setResourceId(""); }} options={(projects.data ?? []).map((item) => ({ value: item.id, label: `${item.code} · ${item.name}` }))} />
        </Panel>
        {projectId && project && (
          <>
            {canManage && <Panel title="Nouvelle affectation prévisionnelle" subtitle="Une ressource humaine ou matérielle ne peut pas être planifiée deux fois sur une période active qui se chevauche.">
              <form className="stack" onSubmit={(event) => { event.preventDefault(); void mutation.run(async () => { const result = await projectsApi.createResource(projectId, { kind, resourceId, plannedQuantity, ...(plannedRate ? { plannedRate } : {}), startAt, ...(endAt ? { endAt } : {}), ...(notes ? { notes } : {}) }); setResourceId(""); setNotes(""); await resources.reload(); return result; }, "Ressource planifiée."); }}>
                <div className="form-grid form-grid-2">
                  <SelectField label="Type de ressource" value={kind} onChange={(value) => { setKind(value); setResourceId(""); }} options={kinds.map((item) => ({ value: item, label: kindLabel[item] ?? item }))} />
                  <SelectField label="Ressource" value={resourceId} onChange={setResourceId} options={options} required />
                  <TextField label="Quantité planifiée" value={plannedQuantity} onChange={setPlannedQuantity} inputMode="decimal" required />
                  <TextField label={`Taux indicatif (${project.currency})`} value={plannedRate} onChange={setPlannedRate} inputMode="decimal" placeholder="Optionnel" />
                  <TextField label="Début" type="date" value={startAt} onChange={setStartAt} required />
                  <TextField label="Fin" type="date" value={endAt} onChange={setEndAt} placeholder="Optionnel" />
                </div>
                <TextAreaField label="Notes de planification" value={notes} onChange={setNotes} placeholder="Lot, rotation, contrainte ou hypothèse" />
                <div className="actions"><Button type="submit" variant="primary" disabled={mutation.saving || !resourceId}>Planifier la ressource</Button></div>
              </form>
            </Panel>}
            <Panel title="Planning des ressources" subtitle={`${resources.data?.length ?? 0} affectation(s) enregistrée(s)`}>
              <DataTable rows={resources.data ?? []} empty={<Empty icon={<CalendarRange size={22} />} title="Aucune ressource planifiée" body="Ajoutez une équipe, un engin, un équipement ou un matériau à ce projet." />} columns={[
                { key: "resource", header: "Ressource", render: (row) => <><strong>{row.resourceName}</strong><small>{row.resourceCode} · {kindLabel[row.kind] ?? row.kind}</small></> },
                { key: "period", header: "Période", render: (row) => `${formatDate(row.startAt)}${row.endAt ? ` → ${formatDate(row.endAt)}` : " → ouvert"}` },
                { key: "quantity", header: "Quantité", align: "right", render: (row) => <span className="num">{row.plannedQuantity} {row.unitCode}</span> },
                { key: "rate", header: "Taux", align: "right", render: (row) => row.plannedRate ? formatMoney(row.plannedRate, project.currency) : "—" },
                { key: "status", header: "Statut", render: (row) => <StatusChip status={row.status} label={row.status === "RELEASED" ? "Libérée" : row.status === "RESERVED" ? "Réservée" : "Planifiée"} /> },
                { key: "action", header: "Action", render: (row) => row.status !== "RELEASED" && canManage ? <Button variant="ghost" onClick={() => void mutation.run(async () => { const result = await projectsApi.releaseResource(projectId, row.id); await resources.reload(); return result; }, "Affectation libérée.")}>Libérer</Button> : row.notes ?? "—" },
              ]} />
            </Panel>
          </>
        )}
      </div>
    </>
  );
}
