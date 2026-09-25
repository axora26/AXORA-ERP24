"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import type { DocumentFolderView } from "@axora24/contracts";
import { FileText, Folder, FolderOpen, FolderPlus, Search, Upload } from "lucide-react";
import { CATEGORY_LABEL, DOCUMENT_STATUS_CHIP, DOCUMENT_STATUS_LABEL, documentsApi } from "../../lib/modules/documents";
import { projectsApi } from "../../lib/modules/projects";
import { formatDateTime } from "../../lib/format";
import { useMutation, useResource } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import { Button, DataTable, Empty, Feedback, Form, Loading, Metric, Metrics, Modal, PageHeader, Panel, SelectField, StatusChip, TextField } from "../../components/ui";

export default function DocumentsPage(): React.ReactElement {
  const session = useSession();
  const router = useRouter();
  const mutation = useMutation();
  const [projectId, setProjectId] = useState("");
  const [folderId, setFolderId] = useState("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<"document" | "folder" | null>(null);
  const projects = useResource(() => (session.can("projects.project.read") ? projectsApi.list().catch(() => []) : Promise.resolve([])));
  const folders = useResource(() => documentsApi.folders(projectId || undefined), [projectId]);
  const documents = useResource(() => documentsApi.list({ q: search, projectId, folderId, status }), [search, projectId, folderId, status]);
  const all = useResource(() => documentsApi.list());
  const list = documents.data ?? [];
  const summary = all.data ?? [];

  return (
    <>
      <PageHeader
        breadcrumb="Projets & chantiers / GED"
        title="Documents"
        subtitle="Plans, fiches techniques, PV et rapports versionnés : chaque révision est conservée intacte, l'approbation revient à un tiers."
        onRefresh={() => {
          void documents.reload();
          void folders.reload();
          void all.reload();
        }}
        actions={
          session.can("documents.document.manage") && (
            <>
              <Button onClick={() => setDialog("folder")}>
                <FolderPlus size={15} aria-hidden="true" /> Dossier
              </Button>
              <Button variant="primary" onClick={() => setDialog("document")}>
                <Upload size={15} aria-hidden="true" /> Nouveau document
              </Button>
            </>
          )
        }
      />
      <Feedback error={documents.error || folders.error || mutation.error} notice={mutation.notice} />
      <Metrics label="Synthèse GED">
        <Metric icon={<FileText size={20} />} tone="blue" label="Documents" value={String(summary.filter((document) => document.status !== "ARCHIVED").length)} detail={`${summary.filter((document) => document.status === "ARCHIVED").length} archivé(s)`} />
        <Metric icon={<FileText size={20} />} tone="amber" label="En visa" value={String(summary.filter((document) => document.status === "SUBMITTED").length)} detail="Approbation par un tiers" />
        <Metric icon={<FileText size={20} />} tone="green" label="Approuvés" value={String(summary.filter((document) => document.status === "APPROVED").length)} detail="Révision applicable" />
        <Metric icon={<FileText size={20} />} tone="red" label="Refusés" value={String(summary.filter((document) => document.status === "REJECTED").length)} detail="Nouvelle révision attendue" />
      </Metrics>

      <form
        className="toolbar"
        onSubmit={(event) => {
          event.preventDefault();
          setSearch(q.trim());
        }}
      >
        <SelectField
          label="Projet"
          value={projectId}
          onChange={(value) => {
            setProjectId(value);
            setFolderId("");
          }}
          options={(projects.data ?? []).map((project) => ({ value: project.id, label: `${project.code} — ${project.name}` }))}
          emptyLabel="Tous les projets"
        />
        <SelectField label="Statut" value={status} onChange={setStatus} options={Object.entries(DOCUMENT_STATUS_LABEL).filter(([key]) => key !== "SUPERSEDED").map(([key, label]) => ({ value: key, label }))} emptyLabel="Tous" />
        <TextField label="Recherche" value={q} onChange={setQ} placeholder="Code, titre, mot-clé, nom de fichier" />
        <Button type="submit">
          <Search size={14} aria-hidden="true" /> Rechercher
        </Button>
      </form>

      <div className="ged-layout">
        <Panel title="Arborescence">
          <FolderTree folders={folders.data ?? []} selected={folderId} onSelect={setFolderId} />
        </Panel>
        <Panel title="Documents" subtitle={search ? `Résultats pour « ${search} »` : "Du plus récent au plus ancien"}>
          {documents.loading && !documents.data ? (
            <Loading label="Recherche…" />
          ) : (
            <DataTable
              rows={list}
              onRowClick={(document) => router.push(`/documents/${document.id}`)}
              empty={<Empty icon={<FileText size={22} />} title="Aucun document" body="Déposez un plan, une fiche technique ou un PV pour démarrer." />}
              columns={[
                {
                  key: "title",
                  header: "Document",
                  render: (document) => (
                    <>
                      <strong>{document.title}</strong>
                      <small>
                        {document.code} · {CATEGORY_LABEL[document.category]}
                        {document.projectCode ? ` · ${document.projectCode}` : ""}
                        {document.folderName ? ` · ${document.folderName}` : ""}
                      </small>
                    </>
                  ),
                },
                { key: "rev", header: "Indice", render: (document) => `${document.currentRevision}${document.approvedRevision && document.approvedRevision !== document.currentRevision ? ` (appl. ${document.approvedRevision})` : ""}` },
                { key: "updated", header: "Mis à jour", render: (document) => formatDateTime(document.updatedAt) },
                { key: "status", header: "Statut", render: (document) => <StatusChip status={DOCUMENT_STATUS_CHIP[document.status] ?? "draft"} label={DOCUMENT_STATUS_LABEL[document.status]} /> },
              ]}
            />
          )}
        </Panel>
      </div>

      {dialog === "folder" && (
        <Modal title="Nouveau dossier" onClose={() => setDialog(null)}>
          <Feedback error={mutation.error} />
          <FolderForm
            folders={folders.data ?? []}
            projects={(projects.data ?? []).map((project) => ({ value: project.id, label: `${project.code} — ${project.name}` }))}
            defaultProject={projectId}
            saving={mutation.saving}
            onSubmit={async (input) => {
              const result = await mutation.run(() => documentsApi.createFolder(input), "Dossier créé.");
              if (result) {
                setDialog(null);
                await folders.reload();
              }
            }}
          />
        </Modal>
      )}
      {dialog === "document" && (
        <Modal title="Nouveau document" onClose={() => setDialog(null)} wide>
          <Feedback error={mutation.error} />
          <DocumentForm
            folders={folders.data ?? []}
            projects={(projects.data ?? []).map((project) => ({ value: project.id, label: `${project.code} — ${project.name}` }))}
            defaultProject={projectId}
            defaultFolder={folderId}
            saving={mutation.saving}
            onSubmit={async (file, input) => {
              const created = await mutation.run(async () => {
                const stored = await documentsApi.upload(file);
                return documentsApi.create({ ...input, fileId: stored.id, fileName: file.name });
              }, "Document déposé en brouillon.");
              if (created) router.push(`/documents/${created.id}`);
            }}
          />
        </Modal>
      )}
    </>
  );
}

function FolderTree({ folders, selected, onSelect }: { folders: DocumentFolderView[]; selected: string; onSelect: (id: string) => void }): React.ReactElement {
  const children = (parentId: string | null): DocumentFolderView[] => folders.filter((folder) => folder.parentId === parentId);
  const render = (parentId: string | null, depth: number): React.ReactNode =>
    children(parentId).map((folder) => (
      <React.Fragment key={folder.id}>
        <li>
          <button type="button" className={selected === folder.id ? "active" : ""} style={{ paddingLeft: 12 + depth * 16 }} onClick={() => onSelect(folder.id)}>
            {selected === folder.id ? <FolderOpen size={14} aria-hidden="true" /> : <Folder size={14} aria-hidden="true" />}
            <span>{folder.name}</span>
            <small>{folder.documentCount}</small>
          </button>
        </li>
        {render(folder.id, depth + 1)}
      </React.Fragment>
    ));
  return (
    <ul className="folder-tree">
      <li>
        <button type="button" className={selected === "" ? "active" : ""} onClick={() => onSelect("")}>
          <FolderOpen size={14} aria-hidden="true" />
          <span>Tous les documents</span>
        </button>
      </li>
      {render(null, 0)}
      {folders.length === 0 && <li className="inline-note">Aucun dossier : créez l&apos;arborescence du projet.</li>}
    </ul>
  );
}

function folderOptions(folders: DocumentFolderView[], projectId: string): Array<{ value: string; label: string }> {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const path = (folder: DocumentFolderView): string => (folder.parentId && byId.get(folder.parentId) ? `${path(byId.get(folder.parentId)!)} / ${folder.name}` : folder.name);
  return folders.filter((folder) => !projectId || folder.projectId === projectId).map((folder) => ({ value: folder.id, label: path(folder) }));
}

function FolderForm({
  folders,
  projects,
  defaultProject,
  saving,
  onSubmit,
}: {
  folders: DocumentFolderView[];
  projects: Array<{ value: string; label: string }>;
  defaultProject: string;
  saving: boolean;
  onSubmit: (input: { name: string; projectId?: string; parentId?: string }) => Promise<void>;
}): React.ReactElement {
  const [name, setName] = useState("");
  const [projectId, setProjectId] = useState(defaultProject);
  const [parentId, setParentId] = useState("");
  return (
    <Form submitLabel="Créer" saving={saving} onSubmit={() => onSubmit({ name, projectId: projectId || undefined, parentId: parentId || undefined })}>
      <TextField label="Nom" value={name} onChange={setName} required placeholder="Plans d'exécution" />
      <SelectField label="Projet" value={projectId} onChange={setProjectId} options={projects} emptyLabel="Documents de l'entreprise" />
      <SelectField label="Dossier parent" value={parentId} onChange={setParentId} options={folderOptions(folders, projectId)} emptyLabel="Racine" wide />
    </Form>
  );
}

function DocumentForm({
  folders,
  projects,
  defaultProject,
  defaultFolder,
  saving,
  onSubmit,
}: {
  folders: DocumentFolderView[];
  projects: Array<{ value: string; label: string }>;
  defaultProject: string;
  defaultFolder: string;
  saving: boolean;
  onSubmit: (file: File, input: { title: string; category: string; projectId?: string; folderId?: string; keywords?: string }) => Promise<void>;
}): React.ReactElement {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("PLAN");
  const [projectId, setProjectId] = useState(defaultProject);
  const [folderId, setFolderId] = useState(defaultFolder);
  const [keywords, setKeywords] = useState("");
  return (
    <Form
      submitLabel="Déposer"
      saving={saving}
      onSubmit={() => (file ? onSubmit(file, { title, category, projectId: projectId || undefined, folderId: folderId || undefined, keywords: keywords || undefined }) : undefined)}
    >
      <div className="field wide">
        <label htmlFor="document-file">Fichier *</label>
        <input
          id="document-file"
          type="file"
          required
          accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx,.pptx,.zip,.ifc,.dwg"
          onChange={(event) => {
            const chosen = event.currentTarget.files?.[0] ?? null;
            setFile(chosen);
            if (chosen && !title) setTitle(chosen.name.replace(/\.[^.]+$/, ""));
          }}
        />
        <small className="field-note">PDF, images, Office, ZIP, IFC, DWG — 25 Mo max. Le type est vérifié sur le contenu du fichier.</small>
      </div>
      <TextField label="Titre" value={title} onChange={setTitle} required wide />
      <SelectField label="Catégorie" value={category} onChange={setCategory} required options={Object.entries(CATEGORY_LABEL).map(([key, label]) => ({ value: key, label }))} />
      <SelectField
        label="Projet"
        value={projectId}
        onChange={(value) => {
          setProjectId(value);
          setFolderId("");
        }}
        options={projects}
        emptyLabel="Documents de l'entreprise"
      />
      <SelectField label="Dossier" value={folderId} onChange={setFolderId} options={folderOptions(folders, projectId)} emptyLabel="Aucun" />
      <TextField label="Mots-clés" value={keywords} onChange={setKeywords} placeholder="rdc cvc gaines" />
    </Form>
  );
}
