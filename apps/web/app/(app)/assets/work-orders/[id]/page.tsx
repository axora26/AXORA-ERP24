"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { WorkOrderView } from "@axora24/contracts";
import { CheckCircle2, Clock, Package, Play, XCircle } from "lucide-react";
import { PRIORITY_CHIP, PRIORITY_LABEL, WO_STATUS_LABEL, WO_TYPE_LABEL, assetsApi } from "../../../../lib/modules/assets";
import { hrApi } from "../../../../lib/modules/hr";
import { inventoryApi } from "../../../../lib/modules/inventory";
import { formatDate, formatDateTime, formatMoney, formatQuantity, todayIso } from "../../../../lib/format";
import { useMutation, useResource } from "../../../../lib/hooks";
import { useSession } from "../../../../lib/session";
import { ActionBar, Button, DataTable, DateField, DecimalField, DetailList, Empty, Feedback, Form, Grid, Loading, Modal, PageHeader, Panel, SelectField, StatusChip, TextAreaField, TextField } from "../../../../components/ui";

type Dialog = "start" | "labor" | "part" | "complete" | "cancel";

export default function WorkOrderPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const session = useSession();
  const resource = useResource(() => assetsApi.workOrder(id), [id]);
  const mutation = useMutation();
  const [override, setOverride] = useState<WorkOrderView | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const order = override ?? resource.data;
  const needsEmployees = dialog === "start" || dialog === "labor";
  const employees = useResource(() => (needsEmployees && session.can("hr.employee.read") ? hrApi.employees() : Promise.resolve([])), [needsEmployees]);
  const stock = useResource(
    () => (dialog === "part" && session.can("inventory.item.read") ? Promise.all([inventoryApi.items(), inventoryApi.warehouses(), inventoryApi.balances()]) : Promise.resolve(null)),
    [dialog],
  );

  if (resource.loading && !order) return <Loading label="Chargement de l'ordre de travail…" />;
  if (!order) return <Feedback error={resource.error || "Ordre de travail introuvable."} />;
  const canWork = session.can("assets.workorder.manage");
  const closed = order.status === "COMPLETED" || order.status === "CANCELLED";
  const employeeOptions = (employees.data ?? []).filter((employee) => employee.status === "ACTIVE").map((employee) => ({ value: employee.id, label: `${employee.firstName} ${employee.lastName} — ${employee.jobTitle}` }));
  const [items, warehouses, balances] = stock.data ?? [[], [], []];
  const available = balances.filter((balance) => Number(balance.quantity) > 0);

  async function apply(action: () => Promise<WorkOrderView>, success: string): Promise<void> {
    const updated = await mutation.run(action, success);
    if (updated) {
      setOverride(updated);
      setDialog(null);
    }
  }

  return (
    <>
      <PageHeader
        breadcrumb={`Actifs & GMAO / ${order.code}`}
        title={order.title}
        subtitle={`${order.code} · ${WO_TYPE_LABEL[order.type]} · ${order.assetCode} — ${order.assetName}`}
        onRefresh={() => {
          setOverride(null);
          void resource.reload();
        }}
        actions={
          <>
            <StatusChip status={order.status} label={WO_STATUS_LABEL[order.status]} />
            {order.overdue && <StatusChip status="overdue" label="En retard" />}
          </>
        }
      />
      <Feedback error={mutation.error} notice={mutation.notice} />
      {canWork && !closed && (
        <ActionBar note={order.status === "OPEN" ? "Démarrez l'OT pour saisir temps et pièces." : "Temps et pièces sont définitifs une fois saisis (append-only)."}>
          {order.status === "OPEN" && (
            <Button variant="primary" onClick={() => setDialog("start")}>
              <Play size={15} aria-hidden="true" /> Démarrer
            </Button>
          )}
          {order.status === "IN_PROGRESS" && (
            <>
              <Button onClick={() => setDialog("labor")}>
                <Clock size={15} aria-hidden="true" /> Saisir du temps
              </Button>
              <Button onClick={() => setDialog("part")}>
                <Package size={15} aria-hidden="true" /> Consommer une pièce
              </Button>
              <Button variant="primary" onClick={() => setDialog("complete")} disabled={(order.labor ?? []).length === 0} title={(order.labor ?? []).length === 0 ? "Saisissez le temps d'intervention avant de clôturer" : undefined}>
                <CheckCircle2 size={15} aria-hidden="true" /> Clôturer
              </Button>
            </>
          )}
          {(order.labor ?? []).length + (order.parts ?? []).length === 0 && (
            <Button variant="ghost" onClick={() => setDialog("cancel")}>
              <XCircle size={15} aria-hidden="true" /> Annuler
            </Button>
          )}
        </ActionBar>
      )}
      <div className="stack">
        <Grid>
          <Panel title="Ordre de travail">
            <DetailList
              items={[
                { label: "Actif", value: <Link href={`/assets/${order.assetId}`}>{`${order.assetCode} — ${order.assetName}`}</Link> },
                { label: "Origine", value: order.ticketCode ? `Ticket ${order.ticketCode}` : order.plannedFor ? `Plan préventif — échéance du ${formatDate(order.plannedFor)}` : "—" },
                { label: "Priorité", value: <StatusChip status={PRIORITY_CHIP[order.priority] ?? "planned"} label={PRIORITY_LABEL[order.priority]} /> },
                { label: "Échéance", value: formatDate(order.dueDate) },
                { label: "Technicien", value: order.assignedEmployeeName ?? "Non affecté" },
                { label: "Démarré", value: order.startedAt ? formatDateTime(order.startedAt) : "—" },
                ...(order.type === "CORRECTIVE"
                  ? [
                      { label: "Panne constatée", value: order.failureAt ? formatDateTime(order.failureAt) : "—" },
                      { label: "Remise en service", value: order.restoredAt ? formatDateTime(order.restoredAt) : "—" },
                    ]
                  : []),
                { label: "Clôturé", value: order.completedAt ? `${formatDateTime(order.completedAt)}${order.completedOnTime === false ? " (hors délai)" : ""}` : "—" },
              ]}
            />
          </Panel>
          <Panel title="Coûts" subtitle="Main-d'œuvre au coût horaire RH figé, pièces au coût moyen pondéré du stock.">
            <DetailList
              items={[
                { label: "Main-d'œuvre", value: formatMoney(order.laborCost, order.currency) },
                { label: "Pièces", value: formatMoney(order.partsCost, order.currency) },
                { label: "Total", value: <strong>{formatMoney(order.totalCost, order.currency)}</strong> },
              ]}
            />
          </Panel>
        </Grid>
        <Panel title="Consignes">
          <p className="prose-block">{order.instructions}</p>
          {order.completionReport && (
            <>
              <h3 className="subhead">Compte-rendu</h3>
              <p className="prose-block">{order.completionReport}</p>
            </>
          )}
        </Panel>
        <Panel title="Temps d'intervention">
          <DataTable
            rows={order.labor ?? []}
            empty={<Empty icon={<Clock size={22} />} title="Aucun temps saisi" body="Un OT ne peut pas être clôturé sans temps d'intervention." />}
            columns={[
              { key: "employee", header: "Technicien", render: (line) => line.employeeName },
              { key: "date", header: "Date", render: (line) => formatDate(line.workDate) },
              { key: "hours", header: "Heures", align: "right", render: (line) => formatQuantity(line.hours) },
              { key: "rate", header: "Coût horaire", align: "right", render: (line) => formatMoney(line.hourlyCost, order.currency) },
              { key: "cost", header: "Coût", align: "right", render: (line) => formatMoney(line.cost, order.currency) },
            ]}
          />
        </Panel>
        <Panel title="Pièces consommées">
          <DataTable
            rows={order.parts ?? []}
            empty={<Empty icon={<Package size={22} />} title="Aucune pièce" body="Chaque pièce est une sortie du grand livre de stock (mouvement « Sortie maintenance »)." />}
            columns={[
              {
                key: "item",
                header: "Article",
                render: (part) => (
                  <>
                    <strong>{part.itemName}</strong>
                    <small>
                      {part.itemCode} · magasin {part.warehouseCode}
                    </small>
                  </>
                ),
              },
              { key: "qty", header: "Quantité", align: "right", render: (part) => `${formatQuantity(part.quantity, 3)} ${part.unitCode}` },
              { key: "cost", header: "Coût", align: "right", render: (part) => formatMoney(part.cost, order.currency) },
            ]}
          />
        </Panel>
      </div>

      {dialog === "start" && (
        <Modal title={`Démarrer ${order.code}`} onClose={() => setDialog(null)}>
          <Feedback error={mutation.error} />
          <StartForm employees={employeeOptions} current={order.assignedEmployeeId ?? ""} saving={mutation.saving} onSubmit={(employeeId) => apply(() => assetsApi.start(id, employeeId), "OT démarré.")} />
        </Modal>
      )}
      {dialog === "labor" && (
        <Modal title="Saisir du temps" onClose={() => setDialog(null)}>
          <Feedback error={mutation.error || employees.error} />
          <LaborForm employees={employeeOptions} current={order.assignedEmployeeId ?? ""} saving={mutation.saving} onSubmit={(input) => apply(() => assetsApi.labor(id, input), "Temps enregistré.")} />
        </Modal>
      )}
      {dialog === "part" && (
        <Modal title="Consommer une pièce" onClose={() => setDialog(null)}>
          <Feedback error={mutation.error || stock.error} />
          <PartForm
            options={available.map((balance) => {
              const item = items.find((candidate) => candidate.id === balance.itemId);
              const warehouse = warehouses.find((candidate) => candidate.id === balance.warehouseId);
              return { value: `${balance.itemId}|${balance.warehouseId}`, label: `${item?.code ?? "?"} — ${item?.name ?? ""} · ${warehouse?.code ?? "?"} (dispo ${formatQuantity(balance.quantity, 3)} ${item?.unitCode ?? ""})` };
            })}
            saving={mutation.saving}
            onSubmit={(input) => apply(() => assetsApi.part(id, input), "Pièce sortie du stock.")}
          />
        </Modal>
      )}
      {dialog === "complete" && (
        <Modal title={`Clôturer ${order.code}`} onClose={() => setDialog(null)}>
          <Feedback error={mutation.error} />
          <CompleteForm corrective={order.type === "CORRECTIVE"} saving={mutation.saving} onSubmit={(input) => apply(() => assetsApi.complete(id, input), "OT clôturé.")} />
        </Modal>
      )}
      {dialog === "cancel" && (
        <Modal title={`Annuler ${order.code}`} onClose={() => setDialog(null)}>
          <Feedback error={mutation.error} />
          <ReasonForm saving={mutation.saving} onSubmit={(reason) => apply(() => assetsApi.cancel(id, reason), "OT annulé.")} />
        </Modal>
      )}
    </>
  );
}

function StartForm({ employees, current, saving, onSubmit }: { employees: Array<{ value: string; label: string }>; current: string; saving: boolean; onSubmit: (employeeId: string) => Promise<void> }): React.ReactElement {
  const [employeeId, setEmployee] = useState(current);
  return (
    <Form columns={1} submitLabel="Démarrer" saving={saving} onSubmit={() => onSubmit(employeeId)}>
      <SelectField label="Technicien" value={employeeId} onChange={setEmployee} options={employees} emptyLabel="— Conserver l'affectation —" />
    </Form>
  );
}

function LaborForm({ employees, current, saving, onSubmit }: { employees: Array<{ value: string; label: string }>; current: string; saving: boolean; onSubmit: (input: { employeeId: string; workDate: string; hours: string }) => Promise<void> }): React.ReactElement {
  const [employeeId, setEmployee] = useState(current);
  const [workDate, setWorkDate] = useState(todayIso());
  const [hours, setHours] = useState("");
  return (
    <Form submitLabel="Enregistrer" saving={saving} onSubmit={() => onSubmit({ employeeId, workDate, hours })}>
      <SelectField label="Technicien" value={employeeId} onChange={setEmployee} options={employees} required wide />
      <DateField label="Date" value={workDate} onChange={setWorkDate} required />
      <DecimalField label="Heures" value={hours} onChange={setHours} required hint="Au plus 24 h par saisie." />
    </Form>
  );
}

function PartForm({ options, saving, onSubmit }: { options: Array<{ value: string; label: string }>; saving: boolean; onSubmit: (input: { itemId: string; warehouseId: string; quantity: string }) => Promise<void> }): React.ReactElement {
  const [key, setKey] = useState("");
  const [quantity, setQuantity] = useState("");
  const [itemId, warehouseId] = key.split("|");
  return (
    <Form columns={1} submitLabel="Sortir du stock" saving={saving} onSubmit={() => onSubmit({ itemId: itemId ?? "", warehouseId: warehouseId ?? "", quantity })}>
      <SelectField label="Article en stock" value={key} onChange={setKey} options={options} required hint={options.length === 0 ? "Aucun stock disponible." : undefined} />
      <DecimalField label="Quantité" value={quantity} onChange={setQuantity} required placeholder="0.000" />
    </Form>
  );
}

function CompleteForm({ corrective, saving, onSubmit }: { corrective: boolean; saving: boolean; onSubmit: (input: { report: string; restoredAt?: string }) => Promise<void> }): React.ReactElement {
  const [report, setReport] = useState("");
  const [restoredAt, setRestoredAt] = useState("");
  return (
    <Form columns={1} submitLabel="Clôturer" saving={saving} onSubmit={() => onSubmit({ report, ...(corrective && restoredAt ? { restoredAt: new Date(restoredAt).toISOString() } : {}) })}>
      <TextAreaField label="Compte-rendu d'intervention" value={report} onChange={setReport} required rows={5} />
      {corrective && <TextField type="datetime-local" label="Remise en service le" value={restoredAt} onChange={setRestoredAt} required hint="Doit être postérieure à la panne : elle alimente MTTR, MTBF et disponibilité." />}
    </Form>
  );
}

function ReasonForm({ saving, onSubmit }: { saving: boolean; onSubmit: (reason: string) => Promise<void> }): React.ReactElement {
  const [reason, setReason] = useState("");
  return (
    <Form columns={1} submitLabel="Annuler l'OT" saving={saving} onSubmit={() => onSubmit(reason)}>
      <TextAreaField label="Motif" value={reason} onChange={setReason} required />
    </Form>
  );
}
