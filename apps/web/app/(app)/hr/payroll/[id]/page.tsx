"use client";

import React, { useState } from "react";
import { useParams } from "next/navigation";
import type { PayrollRunView } from "@axora24/contracts";
import { Lock, Plus } from "lucide-react";
import { hrApi } from "../../../../lib/modules/hr";
import { formatDateTime, formatMoney } from "../../../../lib/format";
import { useMutation, useResource } from "../../../../lib/hooks";
import { useSession } from "../../../../lib/session";
import { ActionBar, Button, DataTable, DecimalField, DetailList, Empty, Feedback, Form, Loading, Modal, PageHeader, Panel, SelectField, StatusChip, TextField } from "../../../../components/ui";

export default function PayrollRunPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const session = useSession();
  const resource = useResource(() => hrApi.payrollRun(id), [id]);
  const mutation = useMutation();
  const [override, setOverride] = useState<PayrollRunView | null>(null);
  const [dialog, setDialog] = useState<"adjust" | "close" | null>(null);
  const [values, setValues] = useState({ employeeId: "", amount: "", label: "" });
  const run = override ?? resource.data;

  if (resource.loading && !run) return <Loading label="Chargement de la paie…" />;
  if (!run) return <Feedback error={resource.error || "Paie introuvable."} />;
  const canManage = session.can("hr.payroll.manage") && run.status === "DRAFT";

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
        subtitle={`${run.lines.length} salarié(s) · brut total ${formatMoney(run.totalGross, run.currency)}`}
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
      <Feedback error={mutation.error} notice={mutation.notice} />
      <Panel title="Synthèse">
        <DetailList
          items={[
            { label: "Brut total", value: <strong>{formatMoney(run.totalGross, run.currency)}</strong> },
            { label: "Devise", value: run.currency },
            { label: "Retenues légales", value: <StatusChip status="not_tested" label="Non paramétrées — aucune règle présumée" /> },
            { label: "Clôture", value: run.closedAt ? formatDateTime(run.closedAt) : "—" },
          ]}
        />
        <p className="inline-note">
          Préparation de paie : salaire de base + éléments variables saisis explicitement, heures validées en regard. Les cotisations et impôts relèvent d&apos;un
          paramétrage pays qui n&apos;existe pas encore : aucun net à payer n&apos;est calculé.
        </p>
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
              { key: "base", header: "Salaire de base", align: "right", render: (line) => <span className="num">{formatMoney(line.baseSalary, run.currency)}</span> },
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
