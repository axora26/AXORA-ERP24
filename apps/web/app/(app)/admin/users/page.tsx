"use client";

import React, { useState } from "react";
import type { AdminUserView } from "@axora24/contracts";
import { ShieldCheck, UserCheck, UserPlus, UsersRound } from "lucide-react";
import { adminApi } from "../../../lib/modules/admin";
import { formatDateTime } from "../../../lib/format";
import { useMutation, useResource } from "../../../lib/hooks";
import { useSession } from "../../../lib/session";
import { DataUnavailable,
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
  SelectField,
  StatusChip,
  TextField,
  Toggle,
} from "../../../components/ui";

export default function UsersPage(): React.ReactElement {
  const session = useSession();
  const data = useResource(() => Promise.all([adminApi.users(), adminApi.roles(), adminApi.companies(), adminApi.projects()]));
  const mutation = useMutation();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AdminUserView | null>(null);

  const [users, roles, companies, projects] = data.data ?? [[], [], [], []];
  const roleOptions = roles.map((role) => ({
    value: role.id,
    label: role.name,
    hint: role.isSystem ? "Rôle système — toutes les permissions" : `${role.permissions.length} permission(s)`,
  }));
  const companyOptions = companies.map((company) => ({ value: company.id, label: company.name }));

  if (data.error && !data.data && !data.loading) return <DataUnavailable title="Utilisateurs" error={data.error} onRetry={() => void data.reload()}/>;

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
          projects={projects}
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
          projects={projects}
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
type ProjectOption = { id: string; code: string; name: string; companyId: string; companyName: string; status: string };
type AssignmentDraft = { roleId: string; companyId: string; projectId: string };

function RoleAssignmentsEditor({ roleOptions, companyOptions, projects, globalRoleIds, onGlobalRolesChange, assignments, onAssignmentsChange }: {
  roleOptions: Option[];
  companyOptions: Option[];
  projects: ProjectOption[];
  globalRoleIds: string[];
  onGlobalRolesChange: (value: string[]) => void;
  assignments: AssignmentDraft[];
  onAssignmentsChange: (value: AssignmentDraft[]) => void;
}): React.ReactElement {
  const add = () => onAssignmentsChange([...assignments, { roleId: roleOptions[0]?.value ?? "", companyId: companyOptions[0]?.value ?? "", projectId: "" }]);
  return <div className="stack">
    <CheckboxGroup label="Rôles globaux" options={roleOptions} selected={globalRoleIds} onChange={onGlobalRolesChange} />
    <div className="field"><span className="field-note">Rôles portés par un chantier</span><small className="field-note">Ces droits restent limités à l’entreprise et au projet sélectionnés.</small></div>
    {assignments.map((assignment, index) => {
      const projectOptions = projects.filter((project) => project.companyId === assignment.companyId).map((project) => ({ value: project.id, label: `${project.code} — ${project.name}` }));
      return <div className="admin-scope-row" key={`${index}-${assignment.roleId}-${assignment.companyId}-${assignment.projectId}`}>
        <SelectField label={`Rôle projet ${index + 1}`} value={assignment.roleId} onChange={(value) => onAssignmentsChange(assignments.map((item, current) => current === index ? { ...item, roleId: value } : item))} options={roleOptions} required />
        <SelectField label="Entreprise" value={assignment.companyId} onChange={(value) => onAssignmentsChange(assignments.map((item, current) => current === index ? { ...item, companyId: value, projectId: "" } : item))} options={companyOptions} required />
        <SelectField label="Projet" value={assignment.projectId} onChange={(value) => onAssignmentsChange(assignments.map((item, current) => current === index ? { ...item, projectId: value } : item))} options={projectOptions} emptyLabel="Tous les projets de l’entreprise" />
        <button className="icon-button" type="button" onClick={() => onAssignmentsChange(assignments.filter((_, current) => current !== index))} aria-label={`Supprimer le rôle projet ${index + 1}`}>×</button>
      </div>;
    })}
    <Button type="button" variant="secondary" onClick={add} disabled={roleOptions.length === 0 || companyOptions.length === 0}>Ajouter une portée</Button>
  </div>;
}

function CreateUserModal({
  roleOptions,
  companyOptions,
  projects,
  onClose,
  onSubmit,
  saving,
  error,
}: {
  roleOptions: Option[];
  companyOptions: Option[];
  projects: ProjectOption[];
  onClose: () => void;
  onSubmit: (input: { email: string; fullName: string; password: string; roleIds: string[]; companyIds: string[]; roleAssignments: Array<{ roleId: string; companyId?: string | null; projectId?: string | null }> }) => Promise<void>;
  saving: boolean;
  error: string;
}): React.ReactElement {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [companyIds, setCompanyIds] = useState<string[]>(companyOptions.length === 1 ? [companyOptions[0]!.value] : []);
  const [assignments, setAssignments] = useState<AssignmentDraft[]>([]);
  return (
    <Modal title="Nouvel utilisateur" onClose={onClose} wide>
      <Feedback error={error} />
      <Form onSubmit={() => onSubmit({ email, fullName, password, roleIds, companyIds, roleAssignments: [...roleIds.map((roleId) => ({ roleId })), ...assignments.map((assignment) => ({ roleId: assignment.roleId, companyId: assignment.companyId || null, projectId: assignment.projectId || null }))] })} submitLabel="Créer le compte" saving={saving}>
        <TextField label="Nom complet" value={fullName} onChange={setFullName} required />
        <TextField label="E-mail" type="email" value={email} onChange={setEmail} required />
        <TextField
          label="Mot de passe initial"
          type="password"
          value={password}
          onChange={setPassword}
          required
          minLength={12}
          autoComplete="new-password"
          hint="12 caractères minimum. Transmettez-le par un canal sûr ; l'utilisateur pourra le changer dans « Mon compte »."
        />
        <RoleAssignmentsEditor roleOptions={roleOptions} companyOptions={companyOptions} projects={projects} globalRoleIds={roleIds} onGlobalRolesChange={setRoleIds} assignments={assignments} onAssignmentsChange={setAssignments} />
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
  projects,
  onClose,
  onSubmit,
  saving,
  error,
}: {
  user: AdminUserView;
  isSelf: boolean;
  roleOptions: Option[];
  companyOptions: Option[];
  projects: ProjectOption[];
  onClose: () => void;
  onSubmit: (input: { fullName: string; isActive: boolean; roleIds: string[]; companyIds: string[]; roleAssignments: Array<{ roleId: string; companyId?: string | null; projectId?: string | null }> }) => Promise<void>;
  saving: boolean;
  error: string;
}): React.ReactElement {
  const [fullName, setFullName] = useState(user.fullName);
  const [isActive, setIsActive] = useState(user.isActive);
  const [roleIds, setRoleIds] = useState(user.roleAssignments.filter((assignment) => assignment.companyId === null && assignment.projectId === null).map((assignment) => assignment.roleId));
  const [companyIds, setCompanyIds] = useState(user.companies.map((company) => company.id));
  const [assignments, setAssignments] = useState<AssignmentDraft[]>(user.roleAssignments.filter((assignment) => assignment.companyId !== null || assignment.projectId !== null).map((assignment) => ({ roleId: assignment.roleId, companyId: assignment.companyId ?? "", projectId: assignment.projectId ?? "" })));
  return (
    <Modal title={`Modifier ${user.email}`} onClose={onClose} wide>
      <Feedback error={error} />
      <Form onSubmit={() => onSubmit({ fullName, isActive, roleIds, companyIds, roleAssignments: [...roleIds.map((roleId) => ({ roleId })), ...assignments.map((assignment) => ({ roleId: assignment.roleId, companyId: assignment.companyId || null, projectId: assignment.projectId || null }))] })} submitLabel="Enregistrer" saving={saving}>
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
        <RoleAssignmentsEditor roleOptions={roleOptions} companyOptions={companyOptions} projects={projects} globalRoleIds={roleIds} onGlobalRolesChange={setRoleIds} assignments={assignments} onAssignmentsChange={setAssignments} />
        <CheckboxGroup label="Entreprises accessibles" options={companyOptions} selected={companyIds} onChange={setCompanyIds} />
      </Form>
    </Modal>
  );
}
