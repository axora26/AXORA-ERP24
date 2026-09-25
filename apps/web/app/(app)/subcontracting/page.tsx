"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import type { SubcontractStatementView } from "@axora24/contracts";
import { BadgeCheck, FileSignature, HardHat, Landmark, Plus, Scale } from "lucide-react";
import {
  PACKAGE_STATUS_LABEL,
  STATEMENT_STATUS_CHIP,
  STATEMENT_STATUS_LABEL,
  SUBCONTRACTOR_STATUS_CHIP,
  SUBCONTRACTOR_STATUS_LABEL,
  SUB_DOCUMENT_LABEL,
  subcontractingApi,
} from "../../lib/modules/subcontracting";
import { procurementApi } from "../../lib/modules/procurement";
import { projectsApi } from "../../lib/modules/projects";
import { formatDate, formatMoney, formatPercent } from "../../lib/format";
import { useMutation, useResource } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import { Button, DataTable, DecimalField, Empty, Feedback, Form, Loading, Metric, Metrics, Modal, PageHeader, Panel, SelectField, StatusChip, Tabs, TextAreaField, TextField } from "../../components/ui";

type TabId = "subcontractors" | "packages" | "statements" | "retentions";
type Dialog = "subcontractor" | "package";

export default function SubcontractingPage(): React.ReactElement {
  const session = useSession();
  const router = useRouter();
  const mutation = useMutation();
  const [tab, setTab] = useState<TabId>("packages");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [deciding, setDeciding] = useState<SubcontractStatementView | null>(null);
  const data = useResource(() => Promise.all([subcontractingApi.summary(), subcontractingApi.subcontractors(), subcontractingApi.packages(), subcontractingApi.statements(), subcontractingApi.retentions()]));
  const [summary, subcontractors, packages, statements, retentions] = data.data ?? [null, [], [], [], []];
  const suppliers = useResource(() => (dialog === "subcontractor" && session.can("procurement.request.read") ? procurementApi.suppliers() : Promise.resolve([])), [dialog]);
  const orders = useResource(() => (dialog === "package" && session.can("procurement.request.read") ? procurementApi.orders() : Promise.resolve([])), [dialog]);
  const currency = summary?.currency;

  async function done(action: () => Promise<unknown>, success: string, open?: (result: { id: string }) => string): Promise<void> {
    const result = await mutation.run(action, success);
    if (result !== undefined) {
      setDialog(null);
      setDeciding(null);
      if (open && result && typeof result === "object" && "id" in result) router.push(open(result as { id: string }));
      else await data.reload();
    }
  }

  return (
    <>
      <PageHeader
        breadcrumb="Projets & chantiers / Sous-traitance"
        title="Sous-traitance"
        subtitle="Sous-traitants qualifiés (obligation de vigilance), lots adossés aux commandes, situations dérivées de l'avancement réel des tâches, retenues de garantie tracées."
        onRefresh={() => void data.reload()}
        actions={
          session.can("subcontracting.package.manage") && (
            <>
              <Button onClick={() => setDialog("subcontractor")}>
                <HardHat size={15} aria-hidden="true" /> Sous-traitant
              </Button>
              <Button variant="primary" onClick={() => setDialog("package")}>
                <Plus size={15} aria-hidden="true" /> Lot confié
              </Button>
            </>
          )
        }
      />
      <Feedback error={data.error || mutation.error} notice={mutation.notice} />
      {data.loading && !data.data ? (
        <Loading label="Chargement de la sous-traitance…" />
      ) : (
        <>
          {summary && (
            <Metrics label="Indicateurs de sous-traitance">
              <Metric icon={<BadgeCheck size={20} />} tone={summary.nonCompliant > 0 ? "amber" : "green"} label="Sous-traitants qualifiés" value={`${summary.qualified} / ${summary.subcontractors}`} detail={`${summary.nonCompliant} non en règle (pièces échues ou absentes)`} />
              <Metric icon={<FileSignature size={20} />} tone="blue" label="Lots en cours" value={String(summary.activePackages)} detail={`Contracté ${formatMoney(summary.contracted, currency)}`} />
              <Metric icon={<Scale size={20} />} tone={summary.pendingStatements > 0 ? "amber" : "green"} label="Situations certifiées" value={formatMoney(summary.certified, currency)} detail={`${summary.pendingStatements} situation(s) à approuver`} />
              <Metric icon={<Landmark size={20} />} tone="violet" label="Retenues détenues" value={formatMoney(summary.retentionHeld, currency)} detail={`${summary.retentionDue} libérable(s) à échéance`} />
            </Metrics>
          )}
          <Tabs
            tabs={[
              { id: "packages", label: "Lots confiés", count: packages.length },
              { id: "statements", label: "Situations", count: statements.filter((statement) => statement.status === "DRAFT").length },
              { id: "retentions", label: "Retenues de garantie", count: retentions.filter((retention) => retention.status === "HELD").length },
              { id: "subcontractors", label: "Sous-traitants", count: subcontractors.length },
            ]}
            active={tab}
            onChange={setTab}
          />
          <div className="stack">
            {tab === "packages" && (
              <Panel title="Lots confiés" subtitle="Avancement en direct = tâches terminées du lot WBS ; seul l'avancement certifié par situation est facturé.">
                <DataTable
                  rows={packages}
                  onRowClick={(row) => router.push(`/subcontracting/packages/${row.id}`)}
                  empty={<Empty icon={<FileSignature size={22} />} title="Aucun lot confié" body="Un lot s'adosse à une commande émise d'un sous-traitant qualifié." />}
                  columns={[
                    {
                      key: "package",
                      header: "Lot",
                      render: (row) => (
                        <>
                          <strong>{row.title}</strong>
                          <small>
                            {row.code} · {row.supplierName} · {row.projectCode} / {row.wbsCode} · {row.purchaseOrderCode}
                          </small>
                        </>
                      ),
                    },
                    { key: "amount", header: "Montant HT", align: "right", render: (row) => formatMoney(row.amount, row.currency) },
                    { key: "live", header: "Avancement réel", align: "right", render: (row) => `${formatPercent(row.livePercent)} (${row.liveDoneTasks}/${row.liveTotalTasks})` },
                    { key: "certified", header: "Certifié", align: "right", render: (row) => `${formatPercent(row.certifiedPercent)} · ${formatMoney(row.certifiedGross, row.currency)}` },
                    { key: "retention", header: "Retenue détenue", align: "right", render: (row) => formatMoney(row.retentionHeld, row.currency) },
                    { key: "status", header: "État", render: (row) => <StatusChip status={row.status === "ACTIVE" ? "in_progress" : row.status === "COMPLETED" ? "done" : "cancelled"} label={PACKAGE_STATUS_LABEL[row.status]} /> },
                  ]}
                />
              </Panel>
            )}
            {tab === "statements" && (
              <Panel title="Situations de travaux" subtitle="Montants figés à la préparation ; approbation par une autre personne, sous-traitant en règle.">
                <DataTable
                  rows={statements}
                  onRowClick={(statement) => router.push(`/subcontracting/packages/${statement.packageId}`)}
                  empty={<Empty icon={<Scale size={22} />} title="Aucune situation" body="Préparez une situation depuis un lot dont des tâches sont terminées." />}
                  columns={[
                    {
                      key: "statement",
                      header: "Situation",
                      render: (statement) => (
                        <>
                          <strong>
                            N°{statement.number} — {statement.supplierName}
                          </strong>
                          <small>
                            {statement.code} · {statement.packageCode} · au {formatDate(statement.periodEnd)} · préparée par {statement.preparedByName}
                          </small>
                        </>
                      ),
                    },
                    { key: "percent", header: "Cumul", align: "right", render: (statement) => `${formatPercent(statement.previousPercent)} → ${formatPercent(statement.cumulativePercent)}` },
                    { key: "gross", header: "Brut", align: "right", render: (statement) => formatMoney(statement.grossAmount, currency) },
                    { key: "retention", header: "Retenue", align: "right", render: (statement) => formatMoney(statement.retentionAmount, currency) },
                    { key: "net", header: "Net", align: "right", render: (statement) => <strong>{formatMoney(statement.netAmount, currency)}</strong> },
                    { key: "status", header: "État", render: (statement) => <StatusChip status={STATEMENT_STATUS_CHIP[statement.status] ?? "pending"} label={statement.supplierInvoiceCode ? `Facturée ${statement.supplierInvoiceCode}` : STATEMENT_STATUS_LABEL[statement.status]} /> },
                    {
                      key: "decide",
                      header: "",
                      render: (statement) =>
                        statement.status === "DRAFT" && session.can("subcontracting.statement.approve") && statement.preparedByUserId !== session.user.id ? (
                          <Button onClick={() => setDeciding(statement)}>Décider</Button>
                        ) : null,
                    },
                  ]}
                />
              </Panel>
            )}
            {tab === "retentions" && (
              <Panel title="Retenues de garantie" subtitle="Objet à part entière : libération à échéance, ou anticipée contre caution bancaire référencée.">
                <DataTable
                  rows={retentions}
                  onRowClick={(retention) => router.push(`/subcontracting/packages/${retention.packageId}`)}
                  empty={<Empty icon={<Landmark size={22} />} title="Aucune retenue" body="Chaque situation approuvée constitue sa retenue." />}
                  columns={[
                    {
                      key: "retention",
                      header: "Retenue",
                      render: (retention) => (
                        <>
                          <strong>{retention.supplierName}</strong>
                          <small>
                            {retention.packageCode} · {retention.statementCode}
                          </small>
                        </>
                      ),
                    },
                    { key: "amount", header: "Montant", align: "right", render: (retention) => formatMoney(retention.amount, currency) },
                    { key: "due", header: "Échéance", render: (retention) => (retention.due && retention.status === "HELD" ? <StatusChip status="pending" label={`Libérable depuis le ${formatDate(retention.releaseDueDate)}`} /> : formatDate(retention.releaseDueDate)) },
                    { key: "status", header: "État", render: (retention) => (retention.status === "HELD" ? <StatusChip status="warning" label="Détenue" /> : <StatusChip status="done" label={`Libérée${retention.guaranteeReference ? " (caution)" : ""} · ${retention.releaseInvoiceCode ?? ""}`} />) },
                  ]}
                />
              </Panel>
            )}
            {tab === "subcontractors" && (
              <Panel title="Sous-traitants" subtitle="Fournisseurs des Achats enregistrés comme sous-traitants ; pièces de vigilance exigées pour qualifier, confier un lot et approuver une situation.">
                <DataTable
                  rows={subcontractors}
                  onRowClick={(row) => router.push(`/subcontracting/subcontractors/${row.id}`)}
                  empty={<Empty icon={<HardHat size={22} />} title="Aucun sous-traitant" body="Enregistrez un fournisseur existant comme sous-traitant." />}
                  columns={[
                    {
                      key: "name",
                      header: "Sous-traitant",
                      render: (row) => (
                        <>
                          <strong>{row.supplierName}</strong>
                          <small>
                            {row.supplierCode} · {row.trades}
                            {row.workforce ? ` · ${row.workforce} pers.` : ""}
                          </small>
                        </>
                      ),
                    },
                    { key: "status", header: "Qualification", render: (row) => <StatusChip status={SUBCONTRACTOR_STATUS_CHIP[row.status] ?? "pending"} label={SUBCONTRACTOR_STATUS_LABEL[row.status]} /> },
                    {
                      key: "compliance",
                      header: "Vigilance",
                      render: (row) => {
                        const issue = row.compliance.find((item) => item.required && item.state !== "VALID");
                        return issue ? <StatusChip status={issue.state === "EXPIRING" ? "warning" : "failed"} label={`${SUB_DOCUMENT_LABEL[issue.kind]} : ${issue.state === "EXPIRING" ? "échéance proche" : issue.state === "EXPIRED" ? "échue" : "absente"}`} /> : <StatusChip status="passed" label="En règle" />;
                      },
                    },
                    { key: "packages", header: "Lots", align: "right", render: (row) => String(row.packages) },
                    { key: "amount", header: "Contracté", align: "right", render: (row) => formatMoney(row.contractedAmount, row.currency) },
                    { key: "retention", header: "Retenues détenues", align: "right", render: (row) => formatMoney(row.retentionHeld, row.currency) },
                  ]}
                />
              </Panel>
            )}
          </div>
        </>
      )}

      {dialog === "subcontractor" && (
        <Modal title="Enregistrer un sous-traitant" onClose={() => setDialog(null)}>
          <Feedback error={mutation.error || suppliers.error} />
          <SubcontractorForm
            suppliers={(suppliers.data ?? []).filter((supplier) => !subcontractors.some((row) => row.supplierId === supplier.id)).map((supplier) => ({ value: supplier.id, label: `${supplier.code} — ${supplier.name}` }))}
            saving={mutation.saving}
            onSubmit={(input) => done(() => subcontractingApi.createSubcontractor(input), "Sous-traitant enregistré (à qualifier).", (created) => `/subcontracting/subcontractors/${created.id}`)}
          />
        </Modal>
      )}
      {dialog === "package" && (
        <Modal title="Nouveau lot confié" onClose={() => setDialog(null)}>
          <Feedback error={mutation.error || orders.error} />
          <PackageForm
            orders={(orders.data ?? [])
              .filter((order) => (order.status === "ISSUED" || order.status === "PARTIALLY_RECEIVED") && order.projectId && subcontractors.some((row) => row.supplierId === order.supplierId && row.status === "QUALIFIED") && !packages.some((row) => row.purchaseOrderId === order.id))
              .map((order) => ({ value: order.id, label: `${order.code} — ${order.supplierName} · ${order.projectCode} · ${formatMoney(order.total, order.currency)}`, projectId: order.projectId! }))}
            saving={mutation.saving}
            onSubmit={(input) => done(() => subcontractingApi.createPackage(input), "Lot confié créé.", (created) => `/subcontracting/packages/${created.id}`)}
          />
        </Modal>
      )}
      {deciding && (
        <Modal title={`Situation ${deciding.code}`} onClose={() => setDeciding(null)}>
          <Feedback error={mutation.error} />
          <DecisionForm saving={mutation.saving} onSubmit={(decision, note) => done(() => subcontractingApi.decideStatement(deciding.id, decision, note || undefined), decision === "APPROVED" ? "Situation approuvée." : "Situation rejetée.")} />
        </Modal>
      )}
    </>
  );
}

function SubcontractorForm({ suppliers, saving, onSubmit }: { suppliers: Array<{ value: string; label: string }>; saving: boolean; onSubmit: (input: Record<string, unknown>) => Promise<void> }): React.ReactElement {
  const [supplierId, setSupplier] = useState("");
  const [trades, setTrades] = useState("");
  const [workforce, setWorkforce] = useState("");
  return (
    <Form submitLabel="Enregistrer" saving={saving} onSubmit={() => onSubmit({ supplierId, trades, workforce: workforce ? Number(workforce) : undefined })}>
      <SelectField label="Fournisseur (Achats)" value={supplierId} onChange={setSupplier} options={suppliers} required wide />
      <TextField label="Corps d'état" value={trades} onChange={setTrades} required />
      <TextField label="Effectif" inputMode="numeric" value={workforce} onChange={setWorkforce} />
    </Form>
  );
}

function PackageForm({ orders, saving, onSubmit }: { orders: Array<{ value: string; label: string; projectId: string }>; saving: boolean; onSubmit: (input: Record<string, unknown>) => Promise<void> }): React.ReactElement {
  const [form, setForm] = useState({ purchaseOrderId: "", wbsItemId: "", title: "", scope: "", retentionRate: "5", retentionReleaseDays: "365" });
  const set = (key: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));
  const projectId = orders.find((order) => order.value === form.purchaseOrderId)?.projectId;
  const project = useResource(() => (projectId ? projectsApi.detail(projectId) : Promise.resolve(null)), [projectId]);
  return (
    <Form submitLabel="Créer le lot" saving={saving} onSubmit={() => onSubmit({ ...form, retentionReleaseDays: Number(form.retentionReleaseDays) })}>
      <SelectField label="Commande émise (sous-traitant qualifié)" value={form.purchaseOrderId} onChange={set("purchaseOrderId")} options={orders} required wide hint={orders.length === 0 ? "Aucune commande émise d'un sous-traitant qualifié, rattachée à un projet et libre." : undefined} />
      <SelectField label="Lot WBS (source de l'avancement)" value={form.wbsItemId} onChange={set("wbsItemId")} options={(project.data?.wbs ?? []).map((node) => ({ value: node.id, label: `${node.code} — ${node.name}` }))} required wide />
      <TextField label="Intitulé" value={form.title} onChange={set("title")} required wide />
      <DecimalField label="Retenue de garantie (%)" value={form.retentionRate} onChange={set("retentionRate")} required />
      <TextField label="Libération après (jours)" inputMode="numeric" value={form.retentionReleaseDays} onChange={set("retentionReleaseDays")} required />
      <TextAreaField label="Périmètre" value={form.scope} onChange={set("scope")} required wide />
    </Form>
  );
}

function DecisionForm({ saving, onSubmit }: { saving: boolean; onSubmit: (decision: string, note: string) => Promise<void> }): React.ReactElement {
  const [decision, setDecision] = useState("APPROVED");
  const [note, setNote] = useState("");
  return (
    <Form columns={1} submitLabel="Valider la décision" saving={saving} onSubmit={() => onSubmit(decision, note)}>
      <SelectField label="Décision" value={decision} onChange={setDecision} options={[{ value: "APPROVED", label: "Approuver (constat d'avancement conforme)" }, { value: "REJECTED", label: "Rejeter" }]} required />
      <TextAreaField label="Note (obligatoire en cas de rejet)" value={note} onChange={setNote} />
    </Form>
  );
}
