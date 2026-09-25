"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { AdminRoleView } from "@axora24/contracts";
import { Lock, Plus, Trash2 } from "lucide-react";
import { adminApi } from "../../../lib/modules/admin";
import { useMutation, useResource } from "../../../lib/hooks";
import { ActionBar, Button, Empty, Feedback, Form, Loading, Modal, PageHeader, Panel, TextField } from "../../../components/ui";

export default function RolesPage(): React.ReactElement {
  const data = useResource(() => Promise.all([adminApi.roles(), adminApi.permissions()]));
  const mutation = useMutation();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  const [roles, catalog] = data.data ?? [[], []];
  const selected: AdminRoleView | undefined = roles.find((role) => role.id === selectedId) ?? roles[0];

  useEffect(() => {
    if (selected) setDraft(selected.permissions);
  }, [selected?.id, selected?.permissions.join(",")]);

  const dirty = useMemo(() => {
    if (!selected) return false;
    return [...draft].sort().join(",") !== [...selected.permissions].sort().join(",");
  }, [draft, selected]);

  function toggle(key: string): void {
    setDraft((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]));
  }

  function toggleModule(keys: string[]): void {
    const allOn = keys.every((key) => draft.includes(key));
    setDraft((current) => (allOn ? current.filter((key) => !keys.includes(key)) : [...new Set([...current, ...keys])]));
  }

  return (
    <>
      <PageHeader
        breadcrumb="Administration / Rôles & permissions"
        title="Rôles & permissions"
        subtitle="Matrice d'autorisation : tout ce qui n'est pas explicitement accordé est refusé par le serveur."
        onRefresh={() => void data.reload()}
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus size={15} aria-hidden="true" /> Nouveau rôle
          </Button>
        }
      />
      <Feedback error={data.error || mutation.error} notice={mutation.notice} />

      {data.loading && !data.data ? (
        <Loading label="Chargement des rôles…" />
      ) : (
        <div className="split">
          <Panel title="Rôles" subtitle={`${roles.length} rôle(s)`}>
            <ul className="role-list">
              {roles.map((role) => (
                <li key={role.id}>
                  <button
                    type="button"
                    className={role.id === selected?.id ? "active" : ""}
                    onClick={() => setSelectedId(role.id)}
                  >
                    <span>
                      {role.isSystem && <Lock size={12} aria-label="Rôle système" />} {role.name}
                    </span>
                    <small>{role.memberCount} membre(s)</small>
                  </button>
                </li>
              ))}
            </ul>
          </Panel>

          {selected ? (
            <Panel
              title={selected.name}
              subtitle={
                selected.isSystem
                  ? "Rôle système : reçoit automatiquement toutes les permissions, non modifiable."
                  : `${draft.length} permission(s) accordée(s)`
              }
            >
              <div className="matrix">
                {catalog.map((group) => {
                  const keys = group.permissions.map((permission) => permission.key);
                  return (
                    <section key={group.module}>
                      <header>
                        <strong>{group.label}</strong>
                        {!selected.isSystem && (
                          <button type="button" onClick={() => toggleModule(keys)}>
                            {keys.every((key) => draft.includes(key)) ? "Tout retirer" : "Tout accorder"}
                          </button>
                        )}
                      </header>
                      <ul>
                        {group.permissions.map((permission) => (
                          <li key={permission.key}>
                            <label>
                              <input
                                type="checkbox"
                                checked={draft.includes(permission.key)}
                                disabled={selected.isSystem}
                                onChange={() => toggle(permission.key)}
                              />
                              <span>
                                {permission.label}
                                <code>{permission.key}</code>
                              </span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    </section>
                  );
                })}
              </div>
              {!selected.isSystem && (
                <ActionBar note="Les modifications s'appliquent dès l'enregistrement à tous les membres du rôle et sont inscrites au journal d'audit.">
                  <Button
                    variant="danger"
                    disabled={mutation.saving}
                    onClick={async () => {
                      const done = await mutation.run(() => adminApi.deleteRole(selected.id), `Rôle « ${selected.name} » supprimé.`);
                      if (done) {
                        setSelectedId(null);
                        await data.reload();
                      }
                    }}
                  >
                    <Trash2 size={14} aria-hidden="true" /> Supprimer
                  </Button>
                  <Button variant="secondary" disabled={!dirty} onClick={() => setDraft(selected.permissions)}>
                    Annuler
                  </Button>
                  <Button
                    variant="primary"
                    disabled={!dirty || mutation.saving}
                    onClick={async () => {
                      const saved = await mutation.run(
                        () => adminApi.setRolePermissions(selected.id, draft),
                        "Permissions enregistrées.",
                      );
                      if (saved) await data.reload();
                    }}
                  >
                    Enregistrer
                  </Button>
                </ActionBar>
              )}
            </Panel>
          ) : (
            <Panel>
              <Empty title="Aucun rôle" />
            </Panel>
          )}
        </div>
      )}

      {creating && (
        <CreateRoleModal
          saving={mutation.saving}
          error={mutation.error}
          onClose={() => setCreating(false)}
          onSubmit={async (name) => {
            const created = await mutation.run(
              () => adminApi.createRole({ name, permissions: [] }),
              `Rôle « ${name} » créé : accordez-lui maintenant ses permissions.`,
            );
            if (created) {
              setCreating(false);
              setSelectedId(created.id);
              await data.reload();
            }
          }}
        />
      )}
    </>
  );
}

function CreateRoleModal({
  onClose,
  onSubmit,
  saving,
  error,
}: {
  onClose: () => void;
  onSubmit: (name: string) => Promise<void>;
  saving: boolean;
  error: string;
}): React.ReactElement {
  const [name, setName] = useState("");
  return (
    <Modal title="Nouveau rôle" onClose={onClose}>
      <Feedback error={error} />
      <Form onSubmit={() => onSubmit(name)} submitLabel="Créer le rôle" saving={saving} columns={1}>
        <TextField
          label="Nom du rôle"
          value={name}
          onChange={setName}
          required
          placeholder="Ex. Conducteur de travaux"
          hint="Le rôle est créé sans aucune permission (deny-by-default)."
        />
      </Form>
    </Modal>
  );
}
