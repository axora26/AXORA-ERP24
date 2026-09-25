"use client";

import React, { useState } from "react";
import type { AdminUserView } from "@axora24/contracts";
import { ShieldCheck, UserCheck, UserPlus, UsersRound } from "lucide-react";
import { adminApi } from "../../../lib/modules/admin";
import { formatDateTime } from "../../../lib/format";
import { useMutation, useResource } from "../../../lib/hooks";
import { useSession } from "../../../lib/session";
import {
  Button,
  CheckboxGroup,
  DataTable,
  Empty,
  Feedback,
  Form,
  Loading,
  Metric,
  Metrics,
  Modal,
  PageHeader,
  Panel,
  StatusChip,
  TextField,
  Toggle,
} from "../../../components/ui";

export default function UsersPage(): React.ReactElement {
  const session = useSession();
  const data = useResource(() => Promise.all([adminApi.users(), adminApi.roles(), adminApi.companies()]));
  const mutation = useMutation();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AdminUserView | null>(null);

  const [users, roles, companies] = data.data ?? [[], [], []];
  const roleOptions = roles.map((role) => ({
    value: role.id,
    label: role.name,
    hint: role.isSystem ? "Rôle système — toutes les permissions" : `${role.permissions.length} permission(s)`,
  }));
  const companyOptions = companies.map((company) => ({ value: company.id, label: company.name }));

  return (
    <>
      <PageHeader
        breadcrumb="Administration / Utilisateurs"
        title="Utilisateurs"
        subtitle="Comptes de votre organisation, rôles attribués et entreprises accessibles."
        onRefresh={() => void data.reload()}
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <UserPlus size={15} aria-hidden="true" /> Nouvel utilisateur
          </Button>
        }
      />
      <Feedback error={data.error || mutation.error} notice={mutation.notice} />

      {data.loading && !data.data ? (
        <Loading label="Chargement des utilisateurs…" />
      ) : (
        <>
          <Metrics label="Synthèse des comptes">
            <Metric icon={<UsersRound size={20} />} tone="blue" label="Comptes" value={String(users.length)} />
            <Metric
              icon={<UserCheck size={20} />}
              tone="green"
              label="Actifs"
              value={String(users.filter((user) => user.isActive).length)}
              detail={`${users.filter((user) => !user.isActive).length} désactivé(s)`}
            />
            <Metric
              icon={<ShieldCheck size={20} />}
              tone="violet"
              label="MFA activée"
              value={String(users.filter((user) => user.mfaEnabled).length)}
              detail="Double authentification TOTP"
            />
          </Metrics>

          <div className="stack">
            <Panel title="Comptes" subtitle="Cliquez sur une ligne pour modifier les rôles, entreprises ou l'état du compte">
              <DataTable
                rows={users}
                onRowClick={(user) => setEditing(user)}
                empty={<Empty title="Aucun utilisateur" />}
                columns={[
                  {
                    key: "name",
                    header: "Utilisateur",
                    render: (user) => (
                      <>
                        <strong>{user.fullName}</strong>
                        <small>{user.email}</small>
                      </>
                    ),
                  },
                  {
                    key: "roles",
                    header: "Rôles",
                    render: (user) =>
                      user.roles.length === 0 ? (
                        <span className="muted">Aucun (aucun accès)</span>
                      ) : (
                        <div className="chip-row">
                          {user.roles.map((role) => (
                            <StatusChip key={role.id} status="submitted" label={role.name} />
                          ))}
                        </div>
                      ),
                  },
                  { key: "companies", header: "Entreprises", render: (user) => user.companies.map((c) => c.name).join(", ") },
                  {
                    key: "status",
                    header: "État",
                    render: (user) => (
                      <div className="chip-row">
                        <StatusChip status={user.isActive ? "active" : "archived"} label={user.isActive ? "Actif" : "Désactivé"} />
                        {user.mfaEnabled && <StatusChip status="verified" label="MFA" />}
                      </div>
                    ),
                  },
                  { key: "login", header: "Dernière connexion", render: (user) => formatDateTime(user.lastLoginAt) },
                ]}
              />
            </Panel>
          </div>
        </>
      )}

      {creating && (
        <CreateUserModal
          roleOptions={roleOptions}
          companyOptions={companyOptions}
          onClose={() => setCreating(false)}
          onSubmit={async (input) => {
            const created = await mutation.run(() => adminApi.createUser(input), `Compte ${input.email} créé.`);
            if (created) {
              setCreating(false);
              await data.reload();
            }
          }}
          saving={mutation.saving}
          error={mutation.error}
        />
      )}

      {editing && (
        <EditUserModal
          user={editing}
          isSelf={editing.id === session.user.id}
          roleOptions={roleOptions}
          companyOptions={companyOptions}
          onClose={() => setEditing(null)}
          saving={mutation.saving}
          error={mutation.error}
          onSubmit={async (input) => {
            const updated = await mutation.run(() => adminApi.updateUser(editing.id, input), "Compte mis à jour.");
            if (updated) {
              setEditing(null);
              await data.reload();
            }
          }}
        />
      )}
    </>
  );
}

type Option = { value: string; label: string; hint?: string };

function CreateUserModal({
  roleOptions,
  companyOptions,
  onClose,
  onSubmit,
  saving,
  error,
}: {
  roleOptions: Option[];
  companyOptions: Option[];
  onClose: () => void;
  onSubmit: (input: { email: string; fullName: string; password: string; roleIds: string[]; companyIds: string[] }) => Promise<void>;
  saving: boolean;
  error: string;
}): React.ReactElement {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [companyIds, setCompanyIds] = useState<string[]>(companyOptions.length === 1 ? [companyOptions[0]!.value] : []);
  return (
    <Modal title="Nouvel utilisateur" onClose={onClose} wide>
      <Feedback error={error} />
      <Form onSubmit={() => onSubmit({ email, fullName, password, roleIds, companyIds })} submitLabel="Créer le compte" saving={saving}>
        <TextField label="Nom complet" value={fullName} onChange={setFullName} required />
        <TextField label="E-mail" type="email" value={email} onChange={setEmail} required />
        <TextField
          label="Mot de passe initial"
          type="password"
          value={password}
          onChange={setPassword}
          required
          hint="8 caractères minimum. Transmettez-le par un canal sûr ; l'utilisateur pourra le changer dans « Mon compte »."
        />
        <CheckboxGroup label="Rôles" options={roleOptions} selected={roleIds} onChange={setRoleIds} />
        <CheckboxGroup label="Entreprises accessibles" options={companyOptions} selected={companyIds} onChange={setCompanyIds} />
      </Form>
    </Modal>
  );
}

function EditUserModal({
  user,
  isSelf,
  roleOptions,
  companyOptions,
  onClose,
  onSubmit,
  saving,
  error,
}: {
  user: AdminUserView;
  isSelf: boolean;
  roleOptions: Option[];
  companyOptions: Option[];
  onClose: () => void;
  onSubmit: (input: { fullName: string; isActive: boolean; roleIds: string[]; companyIds: string[] }) => Promise<void>;
  saving: boolean;
  error: string;
}): React.ReactElement {
  const [fullName, setFullName] = useState(user.fullName);
  const [isActive, setIsActive] = useState(user.isActive);
  const [roleIds, setRoleIds] = useState(user.roles.map((role) => role.id));
  const [companyIds, setCompanyIds] = useState(user.companies.map((company) => company.id));
  return (
    <Modal title={`Modifier ${user.email}`} onClose={onClose} wide>
      <Feedback error={error} />
      <Form onSubmit={() => onSubmit({ fullName, isActive, roleIds, companyIds })} submitLabel="Enregistrer" saving={saving}>
        <TextField label="Nom complet" value={fullName} onChange={setFullName} required />
        <div className="field">
          <span className="field-note">État du compte</span>
          <Toggle
            label={isActive ? "Compte actif" : "Compte désactivé (sessions révoquées)"}
            checked={isActive}
            onChange={setIsActive}
            disabled={isSelf}
          />
          {isSelf && <small className="field-note">Vous ne pouvez pas désactiver votre propre compte.</small>}
        </div>
        <CheckboxGroup label="Rôles" options={roleOptions} selected={roleIds} onChange={setRoleIds} />
        <CheckboxGroup label="Entreprises accessibles" options={companyOptions} selected={companyIds} onChange={setCompanyIds} />
      </Form>
    </Modal>
  );
}
