"use client";

import React, { useState } from "react";
import { useParams } from "next/navigation";
import type { StockCountView } from "@axora24/contracts";
import { Lock } from "lucide-react";
import { inventoryApi } from "../../../../lib/modules/inventory";
import { formatDateTime, formatQuantity } from "../../../../lib/format";
import { useMutation, useResource } from "../../../../lib/hooks";
import { useSession } from "../../../../lib/session";
import { ActionBar, Button, DataTable, Empty, Feedback, Loading, PageHeader, Panel, StatusChip } from "../../../../components/ui";

export default function StockCountPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const session = useSession();
  const resource = useResource(() => inventoryApi.count(id), [id]);
  const mutation = useMutation();
  const [override, setOverride] = useState<StockCountView | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const count = override ?? resource.data;

  if (resource.loading && !count) return <Loading label="Chargement de l'inventaire…" />;
  if (!count) return <Feedback error={resource.error || "Inventaire introuvable."} />;

  const canManage = session.can("inventory.count.manage") && count.status === "OPEN";
  const counted = count.lines.filter((line) => line.countedQuantity !== null).length;

  async function record(itemId: string): Promise<void> {
    const value = (drafts[itemId] ?? "").replace(",", ".").trim();
    if (!value) return;
    const updated = await mutation.run(() => inventoryApi.recordCount(id, itemId, value));
    if (updated) setOverride(updated);
  }

  return (
    <>
      <PageHeader
        breadcrumb={`Stock / Inventaires / ${count.code}`}
        title={`Inventaire ${count.code}`}
        subtitle={`Magasin ${count.warehouseCode} · ouvert le ${formatDateTime(count.createdAt)}`}
        actions={<StatusChip status={count.status === "OPEN" ? "pending" : "closed"} label={count.status === "OPEN" ? "En cours" : `Clôturé le ${formatDateTime(count.closedAt)}`} />}
      />
      <Feedback error={mutation.error} notice={mutation.notice} />
      <Panel title="Comptage" subtitle={`${counted} / ${count.lines.length} ligne(s) comptée(s) — quantités théoriques figées à l'ouverture`}>
        <DataTable
          rows={count.lines.map((line) => ({ ...line, id: line.itemId }))}
          empty={<Empty title="Magasin vide à l'ouverture" />}
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
            { key: "system", header: "Théorique", align: "right", render: (line) => `${formatQuantity(line.systemQuantity, 3)} ${line.unitCode}` },
            {
              key: "counted",
              header: "Compté",
              align: "right",
              render: (line) =>
                canManage ? (
                  <input
                    className="inline-select"
                    aria-label={`Quantité comptée ${line.itemName}`}
                    inputMode="decimal"
                    placeholder={line.countedQuantity ?? "…"}
                    value={drafts[line.itemId] ?? ""}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setDrafts((current) => ({ ...current, [line.itemId]: value }));
                    }}
                    onBlur={() => void record(line.itemId)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void record(line.itemId);
                    }}
                  />
                ) : line.countedQuantity !== null ? (
                  formatQuantity(line.countedQuantity, 3)
                ) : (
                  "—"
                ),
            },
            {
              key: "diff",
              header: "Écart",
              align: "right",
              render: (line) =>
                line.difference === null ? (
                  <span className="muted">à compter</span>
                ) : Number(line.difference) === 0 ? (
                  <StatusChip status="done" label="Conforme" />
                ) : (
                  <span className={`num ${line.difference.startsWith("-") ? "text-danger" : "text-success"}`}>
                    {line.difference.startsWith("-") ? "" : "+"}
                    {formatQuantity(line.difference, 3)}
                  </span>
                ),
            },
          ]}
        />
        {canManage && (
          <ActionBar note="À la clôture, chaque écart génère un ajustement tracé dans le grand livre et le magasin est dégelé.">
            <Button
              variant="primary"
              disabled={mutation.saving || counted < count.lines.length}
              onClick={async () => {
                const closed = await mutation.run(() => inventoryApi.closeCount(id), "Inventaire clôturé, écarts ajustés.");
                if (closed) setOverride(closed);
              }}
            >
              <Lock size={14} aria-hidden="true" /> Clôturer l&apos;inventaire
            </Button>
          </ActionBar>
        )}
      </Panel>
    </>
  );
}
