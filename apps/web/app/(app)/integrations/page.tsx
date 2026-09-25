"use client";

import React, { useState } from "react";
import type { ApiKeyView, InboundEndpointView } from "@axora24/contracts";
import { Ban, BookOpen, Cable, KeyRound, ListChecks, Webhook } from "lucide-react";
import { CONNECTOR_STATUS_CHIP, CONNECTOR_STATUS_LABEL, KEY_STATUS_CHIP, KEY_STATUS_LABEL, PERMISSION_LABEL, integrationsApi, parseIps, truthCell } from "../../lib/modules/integrations";
import { formatDateTime } from "../../lib/format";
import { useMutation, useResource } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import { Button, CheckboxGroup, DataTable, DateField, Empty, Feedback, Form, Loading, Modal, PageHeader, Panel, StatusChip, Tabs, TextAreaField, TextField, Toggle } from "../../components/ui";

type TabId = "keys" | "inbound" | "connectors" | "docs";

export default function IntegrationsPage(): React.ReactElement {
  const session = useSession();
  const mutation = useMutation();
  const [tab, setTab] = useState<TabId>("keys");
  const [dialog, setDialog] = useState<"key" | "endpoint" | null>(null);
  const [revealed, setRevealed] = useState<{ title: string; secret: string; note: string } | null>(null);
  const [revoking, setRevoking] = useState<ApiKeyView | null>(null);
  const [logOf, setLogOf] = useState<ApiKeyView | null>(null);
  const [eventsOf, setEventsOf] = useState<InboundEndpointView | null>(null);
  const canManage = session.can("integrations.apikey.manage");
  const canInbound = session.can("integrations.inbound.manage");

  const data = useResource(() => Promise.all([integrationsApi.keys(), integrationsApi.endpoints(), integrationsApi.connectors()]));
  const delegable = useResource(() => (dialog === "key" ? integrationsApi.delegable() : Promise.resolve([])), [dialog]);
  const docs = useResource(() => (tab === "docs" ? integrationsApi.openapi() : Promise.resolve(null)), [tab]);
  const log = useResource(() => (logOf ? integrationsApi.requests(logOf.id) : Promise.resolve([])), [logOf?.id]);
  const events = useResource(() => (eventsOf ? integrationsApi.events(eventsOf.id) : Promise.resolve([])), [eventsOf?.id]);
  const [keys, endpoints, connectors] = data.data ?? [[], [], []];

  async function done<T>(action: () => Promise<T>, success: string): Promise<T | undefined> {
    const result = await mutation.run(action, success);
    if (result !== undefined) await data.reload();
    return result;
  }

  return (
    <>
      <PageHeader
        breadcrumb="Administration / API & intégrations"
        title="API & intégrations"
        subtitle="Clés d'API à permissions explicites (jamais plus que vos propres droits), limitation de débit, quotas et liste d'adresses IP ; webhooks entrants signés et idempotents ; état réel de chaque connecteur."
        onRefresh={() => void data.reload()}
        actions={
          <>
            {canInbound && (
              <Button onClick={() => setDialog("endpoint")}>
                <Webhook size={15} aria-hidden="true" /> Webhook entrant
              </Button>
            )}
            {canManage && (
              <Button variant="primary" onClick={() => setDialog("key")}>
                <KeyRound size={15} aria-hidden="true" /> Émettre une clé
              </Button>
            )}
          </>
        }
      />
      <Feedback error={data.error || mutation.error} notice={mutation.notice} />
      <Tabs
        tabs={[
          { id: "keys", label: "Clés d'API", count: keys.filter((key) => key.status === "ACTIVE").length },
          { id: "inbound", label: "Webhooks entrants", count: endpoints.length },
          { id: "connectors", label: "Connecteurs", count: connectors.length },
          { id: "docs", label: "Documentation API" },
        ]}
        active={tab}
        onChange={setTab}
      />

      {data.loading && !data.data ? (
        <Loading label="Chargement des intégrations…" />
      ) : (
        <div className="stack">
          {tab === "keys" && (
            <Panel title="Clés d'API" subtitle="Seule l'empreinte du secret est conservée. Une clé perd immédiatement les droits retirés à son créateur ; une révocation est définitive.">
              <DataTable
                rows={keys}
                empty={<Empty icon={<KeyRound size={22} />} title="Aucune clé" body="Émettez une clé pour qu'un système externe lise vos données ou crée des prospects." />}
                columns={[
                  {
                    key: "name",
                    header: "Clé",
                    render: (row) => (
                      <>
                        <strong>{row.name}</strong>
                        <small>
                          <code>{row.prefix}…</code> · émise par {row.createdByName} le {formatDateTime(row.createdAt)}
                        </small>
                      </>
                    ),
                  },
                  { key: "permissions", header: "Permissions", render: (row) => <small className="wrap-cell">{row.permissions.map((permission) => PERMISSION_LABEL[permission] ?? permission).join(", ")}</small> },
                  {
                    key: "limits",
                    header: "Limites",
                    render: (row) => (
                      <small className="wrap-cell">
                        {row.rateLimitPerMinute}/min · {row.usageToday}/{row.dailyQuota} aujourd&apos;hui
                        {row.allowedIps.length ? ` · IP : ${row.allowedIps.join(", ")}` : ""}
                        {row.expiresAt ? ` · expire le ${row.expiresAt.slice(0, 10)}` : ""}
                      </small>
                    ),
                  },
                  { key: "used", header: "Dernier usage", render: (row) => (row.lastUsedAt ? formatDateTime(row.lastUsedAt) : "Jamais") },
                  { key: "status", header: "État", render: (row) => <StatusChip status={KEY_STATUS_CHIP[row.status] ?? "pending"} label={row.status === "REVOKED" && row.revokeReason ? `Révoquée — ${row.revokeReason}` : KEY_STATUS_LABEL[row.status]} /> },
                  {
                    key: "actions",
                    header: "",
                    render: (row) => (
                      <span className="row-actions">
                        <Button variant="ghost" onClick={() => setLogOf(row)}>
                          <ListChecks size={14} aria-hidden="true" /> Journal
                        </Button>
                        {canManage && row.status === "ACTIVE" && (
                          <Button variant="danger" onClick={() => setRevoking(row)}>
                            <Ban size={14} aria-hidden="true" /> Révoquer
                          </Button>
                        )}
                      </span>
                    ),
                  },
                ]}
              />
            </Panel>
          )}

          {tab === "inbound" && (
            <Panel title="Webhooks entrants" subtitle="Chaque requête est vérifiée (HMAC-SHA256 sur le corps brut, horodatage de moins de 5 minutes) avant tout traitement ; un même identifiant d'événement n'est traité qu'une fois.">
              <DataTable
                rows={endpoints}
                empty={<Empty icon={<Webhook size={22} />} title="Aucun point d'entrée" body="Créez un point d'entrée pour recevoir les prospects d'un formulaire web." />}
                columns={[
                  {
                    key: "name",
                    header: "Point d'entrée",
                    render: (row) => (
                      <>
                        <strong>{row.name}</strong>
                        <small>
                          <code>POST {row.path}</code>
                        </small>
                      </>
                    ),
                  },
                  { key: "kind", header: "Effet", render: () => "Crée un prospect CRM" },
                  { key: "counts", header: "Reçus", align: "right", render: (row) => `${row.accepted} accepté(s) · ${row.rejected} refusé(s)` },
                  { key: "last", header: "Dernière réception", render: (row) => (row.lastReceivedAt ? formatDateTime(row.lastReceivedAt) : "Jamais") },
                  {
                    key: "active",
                    header: "Actif",
                    render: (row) =>
                      canInbound ? (
                        <Toggle label={row.active ? "Actif" : "Inactif"} checked={row.active} onChange={(active) => void done(() => integrationsApi.setEndpointActive(row.id, active), active ? "Point d'entrée activé." : "Point d'entrée désactivé.")} />
                      ) : (
                        <StatusChip status={row.active ? "active" : "archived"} label={row.active ? "Actif" : "Inactif"} />
                      ),
                  },
                  {
                    key: "events",
                    header: "",
                    render: (row) => (
                      <Button variant="ghost" onClick={() => setEventsOf(row)}>
                        <ListChecks size={14} aria-hidden="true" /> Événements
                      </Button>
                    ),
                  },
                ]}
              />
            </Panel>
          )}

          {tab === "connectors" && (
            <Panel title="Registre des connecteurs" subtitle="Grille de vérité : un connecteur n'est « vérifié en local » que si aucun système externe n'est en jeu ou s'il a réellement été atteint (et jamais « testé » tant qu'aucun run CI n'a abouti). Tout le reste est NOT_TESTED ou non développé — jamais présenté comme fonctionnel.">
              <DataTable
                rows={connectors.map((connector) => ({ ...connector, id: connector.key }))}
                empty={<Empty icon={<Cable size={22} />} title="Registre vide" body="Aucun connecteur déclaré." />}
                columns={[
                  {
                    key: "name",
                    header: "Connecteur",
                    render: (row) => (
                      <>
                        <strong>{row.name}</strong>
                        <small>{row.category}</small>
                      </>
                    ),
                  },
                  { key: "grid", header: "Supporté · implémenté · externe atteint · lecture · écriture", render: (row) => <small className="wrap-cell">{[row.supported, row.implemented, row.externalReached, row.readTested, row.writeTested].map(truthCell).join(" · ")}</small> },
                  { key: "status", header: "Statut", render: (row) => <StatusChip status={CONNECTOR_STATUS_CHIP[row.status] ?? "pending"} label={CONNECTOR_STATUS_LABEL[row.status]} /> },
                  { key: "evidence", header: "Preuve / limite", render: (row) => <small className="wrap-cell">{row.evidence}</small> },
                ]}
              />
            </Panel>
          )}

          {tab === "docs" && (
            <Panel
              title="API publique v1"
              subtitle="Authentification : en-tête Authorization: Bearer axk_… ; périmètre : l'entreprise de la clé ; pagination par curseur (limit ≤ 100, cursor) ; réponses 401/403/429 documentées."
              actions={
                <a className="btn btn-ghost" href="/api/v1/public/openapi.json" target="_blank" rel="noreferrer">
                  <BookOpen size={14} aria-hidden="true" /> openapi.json
                </a>
              }
            >
              {docs.loading && !docs.data ? (
                <Loading label="Chargement de la spécification…" />
              ) : (
                <DataTable
                  rows={Object.entries(docs.data?.paths ?? {}).flatMap(([path, methods]) => Object.entries(methods).map(([method, operation]) => ({ id: `${method} ${path}`, method, path, summary: operation.summary ?? "", permission: operation["x-axora-permission"] ?? null })))}
                  empty={<Empty icon={<BookOpen size={22} />} title="Spécification indisponible" body="La spécification OpenAPI n'a pas pu être chargée." />}
                  columns={[
                    { key: "route", header: "Route", render: (row) => <code>{`${row.method.toUpperCase()} /api/v1${row.path}`}</code> },
                    { key: "summary", header: "Description", render: (row) => row.summary },
                    { key: "permission", header: "Permission de la clé", render: (row) => (row.permission ? <code>{row.permission}</code> : row.path.includes("inbound") ? "Signature HMAC (sans clé)" : "Clé valide") },
                  ]}
                />
              )}
            </Panel>
          )}
        </div>
      )}

      {dialog === "key" && (
        <Modal title="Émettre une clé d'API" onClose={() => setDialog(null)} wide>
          <Feedback error={mutation.error || delegable.error} />
          <KeyForm
            options={(delegable.data ?? []).map((entry) => ({ value: entry.permission, label: PERMISSION_LABEL[entry.permission] ?? entry.permission, hint: entry.granted ? entry.permission : `${entry.permission} — vous ne la détenez pas` }))}
            allowed={(delegable.data ?? []).filter((entry) => entry.granted).map((entry) => entry.permission)}
            saving={mutation.saving}
            onSubmit={async (input) => {
              const result = await done(() => integrationsApi.issue(input), "Clé émise.");
              if (result) {
                setDialog(null);
                setRevealed({ title: `Clé « ${result.key.name} »`, secret: result.secret, note: "Copiez cette clé maintenant : elle ne sera plus jamais affichée (seule son empreinte est conservée). Utilisation : en-tête Authorization: Bearer <clé>." });
              }
            }}
          />
        </Modal>
      )}

      {dialog === "endpoint" && (
        <Modal title="Nouveau webhook entrant" onClose={() => setDialog(null)}>
          <Feedback error={mutation.error} />
          <EndpointForm
            saving={mutation.saving}
            onSubmit={async (name) => {
              const result = await done(() => integrationsApi.createEndpoint(name), "Point d'entrée créé.");
              if (result) {
                setDialog(null);
                setTab("inbound");
                setRevealed({
                  title: `Secret de signature — ${result.endpoint.name}`,
                  secret: result.secret,
                  note: `Transmettez ce secret à l'émetteur maintenant : il ne sera plus affiché. L'émetteur envoie POST ${result.endpoint.path} avec X-Axora-Timestamp (secondes Unix) et X-Axora-Signature = v1= + HMAC-SHA256(secret, horodatage + "." + corps), corps { id, type: "crm.lead", data: { contactName, companyName, email?, phone?, message? } }.`,
                });
              }
            }}
          />
        </Modal>
      )}

      {revealed && (
        <Modal title={revealed.title} onClose={() => setRevealed(null)}>
          <div className="token-box">
            <p>{revealed.note}</p>
            <code>{revealed.secret}</code>
            <div>
              <Button variant="primary" onClick={() => void navigator.clipboard?.writeText(revealed.secret)}>
                Copier
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {revoking && (
        <Modal title={`Révoquer « ${revoking.name} »`} onClose={() => setRevoking(null)}>
          <Feedback error={mutation.error} />
          <RevokeForm
            saving={mutation.saving}
            onSubmit={async (reason) => {
              if (await done(() => integrationsApi.revoke(revoking.id, reason), "Clé révoquée définitivement.")) setRevoking(null);
            }}
          />
        </Modal>
      )}

      {logOf && (
        <Modal title={`Journal — ${logOf.name}`} onClose={() => setLogOf(null)} wide>
          {log.loading && !log.data ? (
            <Loading label="Chargement du journal…" />
          ) : (
            <DataTable
              rows={log.data ?? []}
              empty={<Empty icon={<Cable size={22} />} title="Aucune requête" body="Les 100 dernières requêtes authentifiées par cette clé apparaîtront ici (refus compris)." />}
              columns={[
                { key: "at", header: "Date", render: (row) => formatDateTime(row.at) },
                { key: "route", header: "Requête", render: (row) => <code>{`${row.method} ${row.path}`}</code> },
                { key: "status", header: "Statut", render: (row) => <StatusChip status={row.status < 400 ? "done" : row.status === 429 ? "pending" : "blocked"} label={String(row.status)} /> },
                { key: "ip", header: "IP", render: (row) => row.ip ?? "—" },
                { key: "ms", header: "Durée", align: "right", render: (row) => `${row.durationMs} ms` },
              ]}
            />
          )}
        </Modal>
      )}

      {eventsOf && (
        <Modal title={`Événements — ${eventsOf.name}`} onClose={() => setEventsOf(null)} wide>
          {events.loading && !events.data ? (
            <Loading label="Chargement des événements…" />
          ) : (
            <DataTable
              rows={events.data ?? []}
              empty={<Empty icon={<Webhook size={22} />} title="Aucun événement" body="Seuls les événements à signature valide sont enregistrés." />}
              columns={[
                { key: "at", header: "Reçu", render: (row) => formatDateTime(row.receivedAt) },
                { key: "id", header: "Identifiant", render: (row) => <code>{row.externalId}</code> },
                { key: "status", header: "Résultat", render: (row) => <StatusChip status={row.status === "ACCEPTED" ? "done" : "blocked"} label={row.status === "ACCEPTED" ? "Accepté" : `Refusé — ${row.error}`} /> },
              ]}
            />
          )}
        </Modal>
      )}
    </>
  );
}

function KeyForm({ options, allowed, saving, onSubmit }: { options: Array<{ value: string; label: string; hint?: string }>; allowed: string[]; saving: boolean; onSubmit: (input: Record<string, unknown>) => Promise<void> }): React.ReactElement {
  const [name, setName] = useState("");
  const [permissions, setPermissions] = useState<string[]>([]);
  const [rate, setRate] = useState("60");
  const [quota, setQuota] = useState("10000");
  const [ips, setIps] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  return (
    <Form
      submitLabel="Émettre"
      saving={saving}
      onSubmit={() => onSubmit({ name, permissions: permissions.filter((permission) => allowed.includes(permission)), rateLimitPerMinute: Number(rate), dailyQuota: Number(quota), allowedIps: parseIps(ips), expiresAt: expiresAt || undefined })}
    >
      <TextField label="Nom" value={name} onChange={setName} required wide />
      <CheckboxGroup label="Permissions explicites (seules celles que vous détenez sont acceptées)" options={options} selected={permissions} onChange={setPermissions} />
      <TextField label="Requêtes par minute" value={rate} onChange={setRate} inputMode="numeric" required hint="1 à 600" />
      <TextField label="Quota journalier" value={quota} onChange={setQuota} inputMode="numeric" required hint="1 à 1 000 000" />
      <TextAreaField label="Adresses IP autorisées" value={ips} onChange={setIps} hint="Vide = toutes. Séparez par des virgules ou des retours à la ligne." />
      <DateField label="Expiration" value={expiresAt} onChange={setExpiresAt} hint="Facultative, 2 ans au plus." />
    </Form>
  );
}

function EndpointForm({ saving, onSubmit }: { saving: boolean; onSubmit: (name: string) => Promise<void> }): React.ReactElement {
  const [name, setName] = useState("");
  return (
    <Form columns={1} submitLabel="Créer" saving={saving} onSubmit={() => onSubmit(name)}>
      <TextField label="Nom" value={name} onChange={setName} required hint="Ex. : Formulaire de contact du site web. Les prospects reçus vous seront attribués." />
    </Form>
  );
}

function RevokeForm({ saving, onSubmit }: { saving: boolean; onSubmit: (reason: string) => Promise<void> }): React.ReactElement {
  const [reason, setReason] = useState("");
  return (
    <Form columns={1} submitLabel="Révoquer définitivement" saving={saving} onSubmit={() => onSubmit(reason)}>
      <TextAreaField label="Motif" value={reason} onChange={setReason} required />
    </Form>
  );
}
