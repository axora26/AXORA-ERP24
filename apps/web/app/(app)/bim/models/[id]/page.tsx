"use client";

import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { BimClashView, BimElementView, BimModelView, BimVersionDiffView, BimVersionView } from "@axora24/contracts";
import { CheckCircle2, Fingerprint, GitCompare, Link2, MessageSquare, TriangleAlert, Upload } from "lucide-react";
import { BIM_DISCIPLINE_LABEL, CLASH_STATUS_LABEL, VERSION_STATUS_CHIP, VERSION_STATUS_LABEL, bimApi, sha256Hex } from "../../../../lib/modules/bim";
import { mepApi } from "../../../../lib/modules/mep";
import { assetUrl } from "../../../../lib/api";
import { formatDateTime } from "../../../../lib/format";
import { useMutation, useResource } from "../../../../lib/hooks";
import { useSession } from "../../../../lib/session";
import { ActionBar, Button, DataTable, DetailList, Empty, Feedback, Form, Loading, Modal, PageHeader, Panel, SelectField, StatusChip, Tabs, TextAreaField, TextField } from "../../../../components/ui";

type TabId = "elements" | "structure" | "versions" | "clashes";
type Dialog = { kind: "import" } | { kind: "decide"; version: BimVersionView; approve: boolean } | { kind: "bind"; element: BimElementView } | { kind: "clash" } | { kind: "clash-action"; clash: BimClashView; action: "comment" | "propose" | "resolve" | "refuse" };

export default function BimModelPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const session = useSession();
  const resource = useResource(() => bimApi.model(id), [id]);
  const mutation = useMutation();
  const [override, setOverride] = useState<BimModelView | null>(null);
  const [tab, setTab] = useState<TabId>("elements");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [filter, setFilter] = useState({ ifcType: "", q: "" });
  const [verification, setVerification] = useState<Record<string, string>>({});
  const [diff, setDiff] = useState<BimVersionDiffView | null>(null);
  const model = override ?? resource.data;
  const latest = model?.latestVersion ?? null;
  const elements = useResource(() => (latest ? bimApi.elements(latest.id, filter) : Promise.resolve([])), [latest?.id, filter.ifcType, filter.q]);
  const clashes = useResource(() => bimApi.clashes(id), [id]);

  useEffect(() => {
    const versions = model?.versions ?? [];
    if (versions.length >= 2) void bimApi.diff(versions[0]!.id, versions[1]!.id).then(setDiff).catch(() => setDiff(null));
  }, [model?.versions]);

  if (resource.loading && !model) return <Loading label="Chargement de la maquette…" />;
  if (!model) return <Feedback error={resource.error || "Maquette introuvable."} />;

  async function applyModel(action: () => Promise<BimModelView>, success: string): Promise<void> {
    const updated = await mutation.run(action, success);
    if (updated) {
      setOverride(updated);
      setDialog(null);
    }
  }

  async function verify(version: BimVersionView): Promise<void> {
    const result = await mutation.run(() => bimApi.verify(version.id));
    if (result) setVerification((current) => ({ ...current, [version.id]: result.verified ? `Empreinte vérifiée le ${formatDateTime(result.checkedAt)}` : "ÉCHEC : le fichier ne correspond plus à son empreinte" }));
  }

  const types = Object.keys(latest?.summary.elementTypes ?? {}).sort();

  return (
    <>
      <PageHeader
        breadcrumb={`BIM / ${model.code}`}
        title={model.name}
        subtitle={`${model.code} · ${BIM_DISCIPLINE_LABEL[model.discipline]} · ${model.projectCode ?? ""}${latest ? ` · v${latest.versionNumber} ${latest.schema}` : ""}`}
        actions={
          <>
            {latest && <StatusChip status={VERSION_STATUS_CHIP[latest.status] ?? "pending"} label={VERSION_STATUS_LABEL[latest.status]} />}
            {session.can("bim.model.manage") && (
              <Button variant="primary" onClick={() => setDialog({ kind: "import" })}>
                <Upload size={14} aria-hidden="true" /> Importer un IFC
              </Button>
            )}
          </>
        }
      />
      <Feedback error={mutation.error} notice={mutation.notice} />
      {latest ? (
        <Panel title={`Version ${latest.versionNumber}`} subtitle={`${latest.fileName} · importée par ${latest.importedByName} le ${formatDateTime(latest.importedAt)}`}>
          <DetailList
            items={[
              { label: "Schéma", value: latest.schema },
              { label: "Application", value: latest.application ?? "—" },
              { label: "Entités / éléments", value: `${latest.entityCount} / ${latest.elementCount}` },
              {
                label: "Empreinte SHA-256",
                value: (
                  <span className="hash" title={latest.sha256}>
                    {latest.sha256.slice(0, 16)}…
                  </span>
                ),
              },
            ]}
          />
          {verification[latest.id] && <p className="inline-note">{verification[latest.id]}</p>}
          {latest.summary.warnings.length > 0 && <p className="inline-warning">{latest.summary.warnings.join(" · ")}</p>}
          <ActionBar note={latest.status === "IMPORTED" ? (latest.importedByUserId === session.user.id ? "Vous avez importé cette version : son visa revient à une autre personne." : "Version en attente de visa.") : `Version approuvée applicable : ${model.approvedVersionNumber ?? "aucune"}`}>
            <Button variant="ghost" onClick={() => void verify(latest)}>
              <Fingerprint size={14} aria-hidden="true" /> Revérifier l&apos;empreinte
            </Button>
            <a className="btn btn-secondary" href={assetUrl(latest.fileUrl)} target="_blank" rel="noreferrer">
              Télécharger l&apos;IFC
            </a>
            {latest.status === "IMPORTED" && session.can("bim.model.approve") && latest.importedByUserId !== session.user.id && (
              <>
                <Button variant="danger" onClick={() => setDialog({ kind: "decide", version: latest, approve: false })}>
                  Refuser
                </Button>
                <Button variant="primary" onClick={() => setDialog({ kind: "decide", version: latest, approve: true })}>
                  <CheckCircle2 size={14} aria-hidden="true" /> Approuver
                </Button>
              </>
            )}
          </ActionBar>
        </Panel>
      ) : (
        <Empty icon={<Upload size={22} />} title="Aucune version importée" body="Importez un fichier IFC (IFC2X3, IFC4) : son empreinte est vérifiée à l'import." />
      )}

      <Tabs<TabId>
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "elements", label: "Éléments", count: latest?.elementCount ?? 0 },
          { id: "structure", label: "Structure & systèmes" },
          { id: "versions", label: "Versions", count: model.versionCount },
          { id: "clashes", label: "Conflits", count: (clashes.data ?? []).length },
        ]}
      />
      <div className="stack">
        {tab === "elements" && latest && (
          <Panel title="Éléments de la version courante" subtitle="Classe IFC, niveau, type et système ; liaison à l'équipement MEP de référence">
            <div className="toolbar inner">
              <SelectField label="Classe IFC" value={filter.ifcType} onChange={(ifcType) => setFilter((current) => ({ ...current, ifcType }))} options={types.map((type) => ({ value: type, label: `${type} (${latest.summary.elementTypes[type]})` }))} emptyLabel="Toutes" />
              <TextField label="Recherche" value={filter.q} onChange={(q) => setFilter((current) => ({ ...current, q }))} placeholder="Nom, GlobalId, repère" />
            </div>
            <DataTable
              rows={elements.data ?? []}
              empty={<Empty title="Aucun élément" />}
              columns={[
                {
                  key: "name",
                  header: "Élément",
                  render: (element) => (
                    <>
                      <strong>{element.name ?? "(sans nom)"}</strong>
                      <small className="hash">{element.globalId}</small>
                    </>
                  ),
                },
                { key: "type", header: "Classe IFC", render: (element) => element.ifcType },
                { key: "storey", header: "Niveau", render: (element) => element.storeyName ?? "—" },
                { key: "system", header: "Système", render: (element) => element.systems.join(", ") || "—" },
                { key: "props", header: "Propriétés", align: "right", render: (element) => String(Object.keys(element.properties).length + Object.keys(element.quantities).length) },
                {
                  key: "equipment",
                  header: "Équipement MEP",
                  render: (element) =>
                    element.equipment ? (
                      <StatusChip status="verified" label={element.equipment.tag} />
                    ) : session.can("bim.model.manage") ? (
                      <Button variant="ghost" onClick={() => setDialog({ kind: "bind", element })}>
                        <Link2 size={13} aria-hidden="true" /> Lier
                      </Button>
                    ) : (
                      "—"
                    ),
                },
              ]}
            />
          </Panel>
        )}
        {tab === "structure" && latest && (
          <div className="module-grid cols-2">
            <Panel title="Structure spatiale">
              <ul className="spatial-tree">
                {latest.summary.spatial.map((node) => {
                  const depth = (() => {
                    let level = 0;
                    let parent = node.parentGlobalId;
                    while (parent && level < 10) {
                      level += 1;
                      parent = latest.summary.spatial.find((candidate) => candidate.globalId === parent)?.parentGlobalId ?? null;
                    }
                    return level;
                  })();
                  return (
                    <li key={node.globalId} style={{ paddingLeft: 12 + depth * 18 }}>
                      <strong>{node.name ?? "(sans nom)"}</strong> <small>{node.ifcType.replace("IFC", "")}</small>
                    </li>
                  );
                })}
              </ul>
            </Panel>
            <Panel title="Systèmes et répartition">
              <DataTable
                rows={latest.summary.systems.map((system) => ({ ...system, id: system.globalId }))}
                empty={<Empty title="Aucun système" />}
                columns={[
                  { key: "name", header: "Système", render: (system) => system.name ?? system.globalId },
                  { key: "type", header: "Classe", render: (system) => system.ifcType },
                  { key: "members", header: "Membres", align: "right", render: (system) => String(system.memberCount) },
                ]}
              />
              <ul className="type-counts">
                {Object.entries(latest.summary.elementTypes).map(([type, count]) => (
                  <li key={type}>
                    <span>{type}</span>
                    <strong>{count}</strong>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        )}
        {tab === "versions" && (
          <>
            <Panel title="Historique des versions" subtitle="Contenu importé immuable ; chaque version référence son fichier par empreinte">
              <DataTable
                rows={model.versions ?? []}
                empty={<Empty title="Aucune version" />}
                columns={[
                  { key: "v", header: "Version", render: (version) => <strong>v{version.versionNumber}</strong> },
                  {
                    key: "file",
                    header: "Fichier",
                    render: (version) => (
                      <>
                        {version.fileName}
                        <small className="hash">{version.sha256}</small>
                      </>
                    ),
                  },
                  { key: "schema", header: "Schéma", render: (version) => version.schema },
                  { key: "count", header: "Éléments", align: "right", render: (version) => String(version.elementCount) },
                  {
                    key: "status",
                    header: "Statut",
                    render: (version) => (
                      <>
                        <StatusChip status={VERSION_STATUS_CHIP[version.status] ?? "pending"} label={VERSION_STATUS_LABEL[version.status]} />
                        {verification[version.id] && <small>{verification[version.id]}</small>}
                      </>
                    ),
                  },
                  {
                    key: "verify",
                    header: "",
                    align: "right",
                    render: (version) => (
                      <Button variant="ghost" onClick={() => void verify(version)}>
                        <Fingerprint size={13} aria-hidden="true" /> Vérifier
                      </Button>
                    ),
                  },
                ]}
              />
            </Panel>
            {diff && (
              <Panel title={`Comparaison v${diff.fromVersion} → v${diff.toVersion}`} subtitle="Par identifiant GlobalId, indépendant du logiciel d'export">
                <DetailList
                  items={[
                    { label: "Ajoutés", value: String(diff.added.length) },
                    { label: "Supprimés", value: String(diff.removed.length) },
                    { label: "Modifiés", value: String(diff.changed.length) },
                    { label: "Inchangés", value: String(diff.unchanged) },
                  ]}
                />
                <ul className="diff-list">
                  {diff.added.map((element) => (
                    <li key={`a-${element.globalId}`} className="added">
                      + {element.name ?? element.globalId} <small>{element.ifcType}</small>
                    </li>
                  ))}
                  {diff.removed.map((element) => (
                    <li key={`r-${element.globalId}`} className="removed">
                      − {element.name ?? element.globalId} <small>{element.ifcType}</small>
                    </li>
                  ))}
                  {diff.changed.map((element) => (
                    <li key={`c-${element.globalId}`} className="changed">
                      <GitCompare size={12} aria-hidden="true" /> {element.name ?? element.globalId} <small>{element.fields.join(", ")}</small>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
          </>
        )}
        {tab === "clashes" && (
          <Panel
            title="Conflits de synthèse"
            subtitle="Deux éléments réels de la maquette ; résolution approuvée par une autre personne que le proposant"
            actions={
              session.can("bim.clash.manage") &&
              latest && (
                <Button onClick={() => setDialog({ kind: "clash" })}>
                  <TriangleAlert size={14} aria-hidden="true" /> Conflit
                </Button>
              )
            }
          >
            {(clashes.data ?? []).length === 0 ? (
              <Empty title="Aucun conflit" />
            ) : (
              <ol className="clash-list">
                {(clashes.data ?? []).map((clash) => (
                  <li key={clash.id} className={clash.status.toLowerCase()}>
                    <header>
                      <strong>{clash.code}</strong>
                      <StatusChip status={clash.status === "RESOLVED" ? "closed" : clash.status === "OPEN" ? "critical" : "pending"} label={CLASH_STATUS_LABEL[clash.status]} />
                      <small>
                        v{clash.versionNumber} · {clash.createdByName} · {formatDateTime(clash.createdAt)}
                      </small>
                    </header>
                    <p>{clash.description}</p>
                    <p className="clash-elements">
                      {clash.elementA.name ?? clash.elementA.globalId} <small>({clash.elementA.ifcType})</small> ✕ {clash.elementB.name ?? clash.elementB.globalId} <small>({clash.elementB.ifcType})</small>
                    </p>
                    {clash.proposal && (
                      <p className="inline-note">
                        Proposition de {clash.proposedByName} : {clash.proposal}
                      </p>
                    )}
                    {clash.resolvedAt && (
                      <p className="inline-note">
                        Résolu par {clash.resolvedByName} le {formatDateTime(clash.resolvedAt)} {clash.resolutionNote ? `— ${clash.resolutionNote}` : ""}
                      </p>
                    )}
                    {clash.comments.map((comment) => (
                      <p key={comment.id} className="clash-comment">
                        <MessageSquare size={12} aria-hidden="true" /> <strong>{comment.authorName}</strong> {comment.body} <small>{formatDateTime(comment.createdAt)}</small>
                      </p>
                    ))}
                    <div className="chip-row">
                      {session.can("bim.clash.manage") && clash.status !== "RESOLVED" && (
                        <Button variant="ghost" onClick={() => setDialog({ kind: "clash-action", clash, action: "comment" })}>
                          Commenter
                        </Button>
                      )}
                      {session.can("bim.clash.manage") && clash.status === "OPEN" && <Button onClick={() => setDialog({ kind: "clash-action", clash, action: "propose" })}>Proposer une résolution</Button>}
                      {session.can("bim.model.approve") && clash.status === "RESOLUTION_PROPOSED" && clash.proposedByUserId !== session.user.id && (
                        <>
                          <Button variant="danger" onClick={() => setDialog({ kind: "clash-action", clash, action: "refuse" })}>
                            Refuser
                          </Button>
                          <Button variant="primary" onClick={() => setDialog({ kind: "clash-action", clash, action: "resolve" })}>
                            Approuver la résolution
                          </Button>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        )}
      </div>

      {dialog?.kind === "import" && (
        <Modal title="Importer une version IFC" onClose={() => setDialog(null)}>
          <Feedback error={mutation.error} />
          <ImportForm
            saving={mutation.saving}
            onSubmit={async (file) => {
              const expected = await sha256Hex(file);
              const result = await mutation.run(async () => {
                const stored = await bimApi.upload(file);
                return bimApi.importVersion(model.id, { fileId: stored.id, ...(expected ? { expectedSha256: expected } : {}) });
              }, expected ? "Version importée : empreinte calculée dans le navigateur et vérifiée par le serveur." : "Version importée (empreinte vérifiée par le serveur).");
              if (result) {
                setOverride(result.model);
                setDialog(null);
                void clashes.reload();
              }
            }}
          />
        </Modal>
      )}
      {dialog?.kind === "decide" && (
        <Modal title={dialog.approve ? `Approuver la version ${dialog.version.versionNumber}` : `Refuser la version ${dialog.version.versionNumber}`} onClose={() => setDialog(null)}>
          <Feedback error={mutation.error} />
          <NoteForm required={!dialog.approve} label={dialog.approve ? "Approuver" : "Refuser"} saving={mutation.saving} onSubmit={(note) => applyModel(() => (dialog.approve ? bimApi.approve(dialog.version.id, note || undefined) : bimApi.reject(dialog.version.id, note)), dialog.approve ? "Version approuvée." : "Version refusée.")} />
        </Modal>
      )}
      {dialog?.kind === "bind" && (
        <Modal title={`Lier ${dialog.element.name ?? dialog.element.globalId} à un équipement`} onClose={() => setDialog(null)}>
          <Feedback error={mutation.error} />
          <BindForm
            projectId={model.projectId}
            saving={mutation.saving}
            onSubmit={async (equipmentId) => {
              const result = await mutation.run(() => bimApi.bind(model.id, { equipmentId, globalId: dialog.element.globalId }), "Élément lié à l'équipement de référence.");
              if (result) {
                setDialog(null);
                void elements.reload();
              }
            }}
          />
        </Modal>
      )}
      {dialog?.kind === "clash" && (
        <Modal title="Nouveau conflit de synthèse" onClose={() => setDialog(null)}>
          <Feedback error={mutation.error} />
          <ClashForm
            elements={(elements.data ?? []).map((element) => ({ value: element.globalId, label: `${element.name ?? element.globalId} (${element.ifcType})` }))}
            saving={mutation.saving}
            onSubmit={async (input) => {
              const result = await mutation.run(() => bimApi.createClash(model.id, input), "Conflit enregistré.");
              if (result) {
                setDialog(null);
                void clashes.reload();
              }
            }}
          />
        </Modal>
      )}
      {dialog?.kind === "clash-action" && (
        <Modal title={{ comment: "Commenter", propose: "Proposer une résolution", resolve: "Approuver la résolution", refuse: "Refuser la résolution" }[dialog.action]} onClose={() => setDialog(null)}>
          <Feedback error={mutation.error} />
          <NoteForm
            required={dialog.action !== "resolve"}
            label={{ comment: "Publier", propose: "Proposer", resolve: "Approuver", refuse: "Refuser" }[dialog.action]}
            saving={mutation.saving}
            onSubmit={async (note) => {
              const clash = dialog.clash;
              const result = await mutation.run(
                () =>
                  dialog.action === "comment"
                    ? bimApi.comment(clash.id, note)
                    : dialog.action === "propose"
                      ? bimApi.propose(clash.id, note)
                      : dialog.action === "resolve"
                        ? bimApi.resolve(clash.id, note || undefined)
                        : bimApi.refuse(clash.id, note),
                "Conflit mis à jour.",
              );
              if (result) {
                setDialog(null);
                void clashes.reload();
              }
            }}
          />
        </Modal>
      )}
    </>
  );
}

function ImportForm({ saving, onSubmit }: { saving: boolean; onSubmit: (file: File) => Promise<void> }): React.ReactElement {
  const [file, setFile] = useState<File | null>(null);
  return (
    <Form columns={1} submitLabel="Importer" saving={saving} onSubmit={() => (file ? onSubmit(file) : undefined)}>
      <div className="field wide">
        <label htmlFor="ifc-file">Fichier IFC (IFC2X3, IFC4) *</label>
        <input id="ifc-file" type="file" accept=".ifc" required onChange={(event) => setFile(event.currentTarget.files?.[0] ?? null)} />
        <small className="field-note">L&apos;empreinte SHA-256 est calculée dans le navigateur puis revérifiée par le serveur : un fichier altéré en transit est refusé.</small>
      </div>
    </Form>
  );
}

function NoteForm({ required, label, saving, onSubmit }: { required: boolean; label: string; saving: boolean; onSubmit: (note: string) => Promise<void> }): React.ReactElement {
  const [note, setNote] = useState("");
  return (
    <Form columns={1} submitLabel={label} saving={saving} onSubmit={() => onSubmit(note)}>
      <TextAreaField label={required ? "Texte (obligatoire)" : "Commentaire"} value={note} onChange={setNote} required={required} />
    </Form>
  );
}

function BindForm({ projectId, saving, onSubmit }: { projectId: string; saving: boolean; onSubmit: (equipmentId: string) => Promise<void> }): React.ReactElement {
  const equipment = useResource(() => mepApi.equipment(projectId).catch(() => []), [projectId]);
  const [equipmentId, setEquipmentId] = useState("");
  return (
    <Form columns={1} submitLabel="Lier" saving={saving} onSubmit={() => onSubmit(equipmentId)}>
      <SelectField label="Équipement MEP" value={equipmentId} onChange={setEquipmentId} required options={(equipment.data ?? []).map((item) => ({ value: item.id, label: `${item.tag} — ${item.name}` }))} />
    </Form>
  );
}

function ClashForm({ elements, saving, onSubmit }: { elements: Array<{ value: string; label: string }>; saving: boolean; onSubmit: (input: { elementAGlobalId: string; elementBGlobalId: string; description: string }) => Promise<void> }): React.ReactElement {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [description, setDescription] = useState("");
  return (
    <Form columns={1} submitLabel="Enregistrer" saving={saving} onSubmit={() => onSubmit({ elementAGlobalId: a, elementBGlobalId: b, description })}>
      <SelectField label="Élément A" value={a} onChange={setA} required options={elements} />
      <SelectField label="Élément B" value={b} onChange={setB} required options={elements.filter((element) => element.value !== a)} />
      <TextAreaField label="Description du conflit" value={description} onChange={setDescription} required />
    </Form>
  );
}
