"use client";

import React, { useState } from "react";
import { useParams } from "next/navigation";
import type { SiteDailyLogView } from "@axora24/contracts";
import { PenLine } from "lucide-react";
import { fieldApi } from "../../../../lib/modules/field";
import { formatDate, formatDateTime, formatQuantity } from "../../../../lib/format";
import { useMutation, useResource } from "../../../../lib/hooks";
import { useSession } from "../../../../lib/session";
import { EvidenceTimeline } from "../../../../components/field-evidence";
import { ActionBar, Button, DataTable, DetailList, Empty, Feedback, Loading, PageHeader, Panel, StatusChip } from "../../../../components/ui";

export default function SiteLogPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const session = useSession();
  const resource = useResource(() => fieldApi.log(id), [id]);
  const mutation = useMutation();
  const [override, setOverride] = useState<SiteDailyLogView | null>(null);
  const log = override ?? resource.data;

  if (resource.loading && !log) return <Loading label="Chargement du journal…" />;
  if (!log) return <Feedback error={resource.error || "Journal introuvable."} />;

  async function sign(): Promise<void> {
    if (!log) return;
    const updated = await mutation.run(() => fieldApi.signLog(log.id, log.version), "Journal signé : il est désormais figé.");
    if (updated) setOverride(updated);
  }

  return (
    <>
      <PageHeader
        breadcrumb={`Chantier / Journal / ${log.projectCode ?? ""}`}
        title={`Journal du ${formatDate(log.logDate)}`}
        subtitle={`${log.projectCode ?? ""} · rédigé par ${log.createdByName} · version ${log.version}`}
        actions={<StatusChip status={log.status === "SIGNED" ? "verified" : "draft"} label={log.status === "SIGNED" ? `Signé le ${formatDateTime(log.signedAt)}` : "Brouillon"} />}
      />
      <Feedback error={mutation.error} notice={mutation.notice} />
      <Panel title="Conditions et effectif">
        <DetailList
          items={[
            { label: "Météo", value: log.weather ?? "—" },
            { label: "Température", value: log.temperature ?? "—" },
            { label: "Effectif déclaré", value: <strong>{log.workforceCount}</strong> },
            {
              label: "Pointés sur ce chantier (RH)",
              value: log.clockedInCount === log.workforceCount ? String(log.clockedInCount) : <StatusChip status="warning" label={`${log.clockedInCount} — écart à expliquer`} />,
            },
          ]}
        />
        {log.status === "DRAFT" && (
          <ActionBar note="La signature fige le journal : il ne pourra plus être modifié ni complété.">
            {session.can("field.log.sign") && (
              <Button variant="primary" onClick={() => void sign()} disabled={mutation.saving}>
                <PenLine size={14} aria-hidden="true" /> Signer le journal
              </Button>
            )}
          </ActionBar>
        )}
        {log.status === "SIGNED" && <p className="inline-note">Signé par {log.signedByName} le {formatDateTime(log.signedAt)}.</p>}
      </Panel>
      <div className="module-grid cols-2">
        <Panel title="Travaux réalisés">
          <p className="prose">{log.summary}</p>
          {log.safetyNotes && (
            <>
              <h3 className="prose-title">Sécurité / événements</h3>
              <p className="prose">{log.safetyNotes}</p>
            </>
          )}
        </Panel>
        <Panel title="Matériaux sortis du stock ce jour" subtitle="Sorties imputées au projet, nettes des retours (module Stock)">
          <DataTable
            rows={log.stockIssues.map((line) => ({ ...line, id: line.itemCode }))}
            empty={<Empty title="Aucune sortie de stock ce jour" />}
            columns={[
              {
                key: "item",
                header: "Article",
                render: (line) => (
                  <>
                    <strong>{line.itemName}</strong>
                    <small>{line.itemCode}</small>
                  </>
                ),
              },
              { key: "qty", header: "Quantité", align: "right", render: (line) => `${formatQuantity(line.quantity, 3)} ${line.unitCode}` },
            ]}
          />
        </Panel>
      </div>
      <div className="stack">
        <Panel title="Photos et observations du jour">{log.evidence.length === 0 ? <Empty title="Aucune preuve rattachée" /> : <EvidenceTimeline items={log.evidence} />}</Panel>
      </div>
    </>
  );
}
