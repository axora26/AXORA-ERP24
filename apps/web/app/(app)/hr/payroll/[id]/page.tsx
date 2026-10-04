"use client";

import React, { useState } from "react";
import { useParams } from "next/navigation";
import type { PayrollRunView } from "@axora24/contracts";
import { Lock, Plus } from "lucide-react";
import { hrApi } from "../../../../lib/modules/hr";
import { formatDateTime, formatMoney, formatQuantity } from "../../../../lib/format";
import { useMutation, useResource } from "../../../../lib/hooks";
import { useSession } from "../../../../lib/session";
import { FileDownloadButton } from "../../../../components/file-download-button";
import { ActionBar, Button, DataTable, DecimalField, DetailList, Empty, Feedback, Form, Loading, Modal, PageHeader, Panel, SelectField, StatusChip, TextField } from "../../../../components/ui";

export default function PayrollRunPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const session = useSession();
  const resource = useResource(() => hrApi.payrollRun(id), [id]);
  const mutation = useMutation();
  const [override, setOverride] = useState<PayrollRunView | null>(null);
  const [dialog, setDialog] = useState<"adjust" | "close" | null>(null);
  const [values, setValues] = useState({ employeeId: "", amount: "", label: "" });
  const [downloadError, setDownloadError] = useState("");
  const run = override ?? resource.data;

  if (resource.loading && !run) return <Loading label="Chargement de la paie…" />;
  if (!run) return <Feedback error={resource.error || "Paie introuvable."} />;
  const canManage = session.can("hr.payroll.manage") && run.status === "DRAFT";
  const hourly = run.policy?.mode === "VALIDATED_HOURS";

  async function apply(action: () => Promise<PayrollRunView>, success: string): Promise<void> {
    const updated = await mutation.run(action, success);
    if (updated) {
      setOverride(updated);
      setDialog(null);
      setValues({ employeeId: "", amount: "", label: "" });
    }
  }

  return (
    <>
      <PageHeader
        breadcrumb={`RH / Paie / ${run.period}`}
        title={`Paie ${run.period}`}
        subtitle={`${run.lines.length} salarié(s) · brut ${formatMoney(run.totalGross, run.currency)} · net ${run.netAmount === null ? "à paramétrer" : formatMoney(run.netAmount, run.currency)}`}
        actions={
          <>
            <StatusChip status={run.status === "DRAFT" ? "draft" : "closed"} label={run.status === "DRAFT" ? "En préparation" : "Clôturée"} />
            {canManage && (
              <Button onClick={() => setDialog("adjust")}>
                <Plus size={14} aria-hidden="true" /> Élément variable
              </Button>
            )}
          </>
        }
      />
      <Feedback error={mutation.error || downloadError || resource.error} notice={mutation.notice} />
      <Panel title="Synthèse">
        <DetailList
          items={[
            { label: "Brut total", value: <strong>{formatMoney(run.totalGross, run.currency)}</strong> },
            { label: "Retenues légales", value: run.statutoryDeductions === "CONFIGURED" ? formatMoney(run.totalDeductions, run.currency) : <StatusChip status="not_tested" label="À paramétrer" /> },
            { label: "Net à payer", value: run.netAmount === null ? "Non calculé" : <strong className="text-success">{formatMoney(run.netAmount, run.currency)}</strong> },
            { label: "Devise", value: run.currency },
            { label: "Calcul enregistré", value: hourly ? "Heures validées" : "Salaire de base mensuel" },
            ...(hourly ? [
              { label: "Heures mensuelles de référence", value: `${run.policy?.standardMonthlyHours} h` },
              { label: "Coefficient heures supplémentaires", value: run.policy?.overtimeCoefficient ?? "—" },
            ] : []),
            { label: "Clôture", value: run.closedAt ? formatDateTime(run.closedAt) : "—" },
          ]}
        />
        <p className="inline-note">
          {hourly ? "Le montant automatique provient des heures validées et des règles enregistrées à la préparation." : "Le montant automatique reprend le salaire de base mensuel."} Les éléments variables sont ajoutés explicitement. Les règles et les heures de cette préparation sont conservées.
        </p>
        <p className="inline-note">{run.statutoryDeductions === "CONFIGURED" ? "Les cotisations et l'impôt sont calculés selon la photographie de politique enregistrée à la préparation." : "Les retenues légales ne sont pas paramétrées : aucun net à payer n'est calculé. Configurez-les dans les règles RH avant une nouvelle préparation."}</p>
        {!!run.warnings?.length && <div className="payroll-warnings"><h3>Points à vérifier</h3><ul>{run.warnings.map((warning, index) => <li key={`${warning.employeeId}-${warning.code}-${index}`}><strong>{run.lines.find(line => line.employeeId === warning.employeeId)?.employeeName ?? "Salarié"}</strong> : {warning.message}</li>)}</ul></div>}
        {canManage && (
          <ActionBar note="La clôture fige définitivement la paie de la période.">
            <Button variant="primary" onClick={() => setDialog("close")}>
              <Lock size={14} aria-hidden="true" /> Clôturer
            </Button>
          </ActionBar>
        )}
      </Panel>
      <div className="stack">
        <Panel title="Lignes de paie">
          <DataTable
            rows={run.lines.map((line) => ({ ...line, id: line.employeeId }))}
            empty={<Empty title="Aucun salarié sur la période" />}
            columns={[
              { key: "who", header: "Salarié", render: (line) => <strong>{line.employeeName}</strong> },
              { key: "hours", header: "Heures validées", align: "right", render: (line) => <span className="num">{line.validatedHours} h</span> },
              { key: "attendance", header: "Heures pointées", align: "right", render: (line) => <span className="num">{line.attendanceHours === undefined ? "Non disponible (historique)" : `${line.attendanceHours} h`}</span> },
              { key: "base", header: "Salaire de base", align: "right", render: (line) => <span className="num">{formatMoney(line.baseSalary, run.currency)}</span> },
              ...(hourly ? [
                { key: "regular", header: "Heures ordinaires", align: "right" as const, render: (line: PayrollRunView["lines"][number]) => <span className="num">{line.regularHours ?? "—"} h</span> },
                { key: "overtime", header: "Heures supplémentaires", align: "right" as const, render: (line: PayrollRunView["lines"][number]) => <span className="num">{line.overtimeHours ?? "—"} h</span> },
                { key: "rate", header: "Taux horaire", align: "right" as const, render: (line: PayrollRunView["lines"][number]) => <span className="num">{line.hourlyRate === undefined ? "—" : `${formatQuantity(line.hourlyRate, 6)} ${run.currency}/h`}</span> },
              ] : []),
              { key: "automatic", header: "Montant automatique", align: "right", render: (line) => <span className="num">{formatMoney(line.automaticAmount ?? line.baseSalary, run.currency)}</span> },
              {
                key: "adj",
                header: "Éléments variables",
                align: "right",
                render: (line) => (
                  <>
                    <span className="num">{formatMoney(line.adjustments, run.currency)}</span>
                    {line.adjustmentNotes && <small>{line.adjustmentNotes}</small>}
                  </>
                ),
              },
              { key: "gross", header: "Brut", align: "right", render: (line) => <strong className="num">{formatMoney(line.grossAmount, run.currency)}</strong> },
              ...(run.statutoryDeductions === "CONFIGURED" ? [
                { key: "deductions", header: "Retenues", align: "right" as const, render: (line: PayrollRunView["lines"][number]) => <span className="num">{formatMoney(line.totalDeductions ?? "0.00", run.currency)}</span> },
                { key: "net", header: "Net à payer", align: "right" as const, render: (line: PayrollRunView["lines"][number]) => <strong className="num text-success">{formatMoney(line.netAmount ?? line.grossAmount, run.currency)}</strong> },
              ] : []),
              { key: "pdf", header: "Document", render: (line) => <FileDownloadButton path={`/hr/payroll/${run.id}/employees/${line.employeeId}/export.pdf`} filename={`paie-${run.period}-${line.employeeId}.pdf`} onError={setDownloadError}>{run.status === "CLOSED" ? "Bulletin / PDF" : "Fiche de préparation / PDF"}</FileDownloadButton> },
            ]}
          />
        </Panel>
      </div>

      {dialog === "adjust" && (
        <Modal title="Élément variable de paie" onClose={() => setDialog(null)}>
          <Feedback error={mutation.error} />
          <Form
            submitLabel="Ajouter"
            saving={mutation.saving}
            onSubmit={() => apply(() => hrApi.adjustPayroll(run.id, { ...values, amount: values.amount.replace(",", ".").trim() }), "Élément variable enregistré.")}
          >
            <SelectField
              label="Salarié"
              value={values.employeeId}
              onChange={(employeeId) => setValues((current) => ({ ...current, employeeId }))}
              required
              options={run.lines.map((line) => ({ value: line.employeeId, label: line.employeeName }))}
            />
            <DecimalField label="Montant (négatif pour une retenue)" value={values.amount} onChange={(amount) => setValues((current) => ({ ...current, amount }))} required placeholder="150.00" />
            <TextField label="Libellé" value={values.label} onChange={(label) => setValues((current) => ({ ...current, label }))} required placeholder="Prime de chantier" wide />
          </Form>
        </Modal>
      )}
      {dialog === "close" && (
        <Modal title={`Clôturer la paie ${run.period}`} onClose={() => setDialog(null)}>
          <Feedback error={mutation.error} />
          <Form columns={1} submitLabel="Clôturer définitivement" saving={mutation.saving} onSubmit={() => apply(() => hrApi.closePayroll(run.id), "Paie clôturée.")}>
            <p className="inline-note">Brut total : {formatMoney(run.totalGross, run.currency)}. Aucune modification ne sera plus possible.</p>
          </Form>
        </Modal>
      )}
    </>
  );
}
