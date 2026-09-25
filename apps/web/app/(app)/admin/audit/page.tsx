"use client";

import React, { useState } from "react";
import type { AuditLogView } from "@axora24/contracts";
import { ScrollText } from "lucide-react";
import { adminApi } from "../../../lib/modules/admin";
import { describeAudit } from "../../../lib/audit-labels";
import { formatDateTime } from "../../../lib/format";
import { useResource } from "../../../lib/hooks";
import {
  Button,
  DataTable,
  DateField,
  Empty,
  Feedback,
  Loading,
  Modal,
  PageHeader,
  Panel,
  SelectField,
  TextField,
} from "../../../components/ui";

const ACTION_FILTERS = [
  { value: "auth.", label: "Authentification" },
  { value: "core.", label: "Administration" },
  { value: "crm.", label: "CRM" },
  { value: "estimation.", label: "Études & DQE" },
  { value: "sales.", label: "Devis & Contrats" },
  { value: "projects.", label: "Projets" },
  { value: "procurement.", label: "Achats" },
  { value: "inventory.", label: "Stock" },
  { value: "finance.", label: "Finance" },
];

export default function AuditPage(): React.ReactElement {
  const [filters, setFilters] = useState({ action: "", resourceType: "", from: "", to: "" });
  const [applied, setApplied] = useState(filters);
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<AuditLogView | null>(null);
  const logs = useResource(
    () => adminApi.audit({ ...applied, page: String(page), pageSize: "25" }),
    [applied, page],
  );
  const totalPages = logs.data ? Math.max(1, Math.ceil(logs.data.total / logs.data.pageSize)) : 1;

  return (
    <>
      <PageHeader
        breadcrumb="Administration / Journal d'audit"
        title="Journal d'audit"
        subtitle="Trace append-only de toutes les actions sensibles. Aucune entrée ne peut être modifiée ni supprimée."
        onRefresh={() => void logs.reload()}
      />
      <Feedback error={logs.error} />

      <Panel title="Filtres">
        <form
          className="module-form cols-4"
          onSubmit={(event) => {
            event.preventDefault();
            setPage(1);
            setApplied(filters);
          }}
        >
          <SelectField
            label="Domaine"
            value={filters.action}
            onChange={(action) => setFilters({ ...filters, action })}
            options={ACTION_FILTERS}
            emptyLabel="Tous les domaines"
          />
          <TextField
            label="Type de ressource"
            value={filters.resourceType}
            onChange={(resourceType) => setFilters({ ...filters, resourceType })}
            placeholder="Ex. Contract"
          />
          <DateField label="Du" value={filters.from} onChange={(from) => setFilters({ ...filters, from })} />
          <DateField label="Au" value={filters.to} onChange={(to) => setFilters({ ...filters, to })} />
          <div className="module-form-actions">
            <button className="primary-inline-button" type="submit">
              Appliquer
            </button>
            <Button
              variant="ghost"
              onClick={() => {
                const cleared = { action: "", resourceType: "", from: "", to: "" };
                setFilters(cleared);
                setApplied(cleared);
                setPage(1);
              }}
            >
              Réinitialiser
            </Button>
          </div>
        </form>
      </Panel>

      <div className="stack">
        <Panel title="Événements" subtitle={logs.data ? `${logs.data.total} événement(s)` : undefined}>
          {logs.loading && !logs.data ? (
            <Loading label="Chargement du journal…" />
          ) : (
            <>
              <DataTable
                rows={logs.data?.items ?? []}
                onRowClick={setDetail}
                empty={<Empty icon={<ScrollText size={22} />} title="Aucun événement pour ces filtres" />}
                columns={[
                  { key: "date", header: "Date", render: (log) => formatDateTime(log.createdAt), width: "170px" },
                  {
                    key: "action",
                    header: "Action",
                    render: (log) => (
                      <>
                        <strong>{describeAudit(log.action)}</strong>
                        <small>{log.action}</small>
                      </>
                    ),
                  },
                  {
                    key: "resource",
                    header: "Ressource",
                    render: (log) => (
                      <>
                        {log.resourceType}
                        <small>{log.resourceId.slice(0, 18)}…</small>
                      </>
                    ),
                  },
                  { key: "actor", header: "Auteur", render: (log) => log.actorName ?? "Système" },
                ]}
              />
              <div className="pagination">
                <span>
                  Page {logs.data?.page ?? 1} / {totalPages}
                </span>
                <div>
                  <Button disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
                    Précédent
                  </Button>
                  <Button disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>
                    Suivant
                  </Button>
                </div>
              </div>
            </>
          )}
        </Panel>
      </div>

      {detail && (
        <Modal title={describeAudit(detail.action)} onClose={() => setDetail(null)} wide>
          <dl className="detail-list">
            <div>
              <dt>Date</dt>
              <dd>{formatDateTime(detail.createdAt)}</dd>
            </div>
            <div>
              <dt>Auteur</dt>
              <dd>
                {detail.actorName ?? "Système"} {detail.actorEmail && <small className="muted">({detail.actorEmail})</small>}
              </dd>
            </div>
            <div>
              <dt>Ressource</dt>
              <dd>
                {detail.resourceType} · {detail.resourceId}
              </dd>
            </div>
            <div>
              <dt>Code d&apos;action</dt>
              <dd>{detail.action}</dd>
            </div>
          </dl>
          <div style={{ padding: "0 21px 20px" }}>
            <pre className="json-block">{JSON.stringify(detail.metadata ?? {}, null, 2)}</pre>
          </div>
        </Modal>
      )}
    </>
  );
}
