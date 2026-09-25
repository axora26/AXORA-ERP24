"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import type { PortalInvitationIssued } from "@axora24/contracts";
import { Globe2, UserPlus } from "lucide-react";
import { PRINCIPAL_STATUS_CHIP, PRINCIPAL_STATUS_LABEL, portalAdminApi } from "../../lib/modules/portal-admin";
import { procurementApi } from "../../lib/modules/procurement";
import { api } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import { useMutation, useResource } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import { Button, DataTable, Empty, Feedback, Form, Loading, Modal, PageHeader, Panel, SelectField, StatusChip, TextField } from "../../components/ui";
import { InvitationReveal } from "../../components/invitation-reveal";

export default function PortalAdminPage(): React.ReactElement {
  const session = useSession();
  const router = useRouter();
  const mutation = useMutation();
  const [creating, setCreating] = useState(false);
  const [issued, setIssued] = useState<PortalInvitationIssued | null>(null);
  const data = useResource(() => portalAdminApi.principals());
  const roots = useResource(
    () =>
      creating
        ? Promise.all([session.can("crm.account.read") ? api.get<Array<{ id: string; name: string }>>("/crm/accounts").catch(() => []) : Promise.resolve([]), session.can("procurement.request.read") ? procurementApi.suppliers() : Promise.resolve([])])
        : Promise.resolve(null),
    [creating],
  );

  return (
    <>
      <PageHeader
        breadcrumb="Administration / Portails externes"
        title="Portails client & fournisseur"
        subtitle="Identités externes séparées des comptes internes : invitation à usage unique, aucune permission interne héritée, chaque ressource exposée explicitement."
        onRefresh={() => void data.reload()}
        actions={
          session.can("portal.principal.manage") && (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <UserPlus size={15} aria-hidden="true" /> Inviter
            </Button>
          )
        }
      />
      <Feedback error={data.error || mutation.error} notice={mutation.notice} />
      {data.loading && !data.data ? (
        <Loading label="Chargement des accès portail…" />
      ) : (
        <Panel title="Accès externes">
          <DataTable
            rows={data.data ?? []}
            onRowClick={(principal) => router.push(`/portal-admin/${principal.id}`)}
            empty={<Empty icon={<Globe2 size={22} />} title="Aucun accès externe" body="Invitez un client (compte CRM) ou un fournisseur (Achats)." />}
            columns={[
              {
                key: "principal",
                header: "Personne",
                render: (principal) => (
                  <>
                    <strong>{principal.fullName}</strong>
                    <small>{principal.email}</small>
                  </>
                ),
              },
              { key: "kind", header: "Portail", render: (principal) => `${principal.kind === "CLIENT" ? "Client" : "Fournisseur"} · ${principal.rootName}` },
              { key: "status", header: "État", render: (principal) => <StatusChip status={PRINCIPAL_STATUS_CHIP[principal.status] ?? "pending"} label={principal.pendingInvitation && principal.status === "INVITED" ? "Invitation en attente" : PRINCIPAL_STATUS_LABEL[principal.status]} /> },
              { key: "grants", header: "Ressources exposées", align: "right", render: (principal) => String(principal.activeGrants) },
              { key: "login", header: "Dernière connexion", render: (principal) => (principal.lastLoginAt ? formatDateTime(principal.lastLoginAt) : "Jamais") },
            ]}
          />
        </Panel>
      )}
      {creating && (
        <Modal title="Inviter un accès externe" onClose={() => setCreating(false)}>
          <Feedback error={mutation.error || roots.error} />
          <InviteForm
            accounts={(roots.data?.[0] ?? []).map((account) => ({ value: account.id, label: account.name }))}
            suppliers={(roots.data?.[1] ?? []).map((supplier) => ({ value: supplier.id, label: `${supplier.code} — ${supplier.name}` }))}
            saving={mutation.saving}
            onSubmit={async (input) => {
              const result = await mutation.run(() => portalAdminApi.create(input), "Invitation émise.");
              if (result) {
                setCreating(false);
                setIssued(result);
                await data.reload();
              }
            }}
          />
        </Modal>
      )}
      {issued && <InvitationReveal issued={issued} onClose={() => setIssued(null)} />}
    </>
  );
}

function InviteForm({
  accounts,
  suppliers,
  saving,
  onSubmit,
}: {
  accounts: Array<{ value: string; label: string }>;
  suppliers: Array<{ value: string; label: string }>;
  saving: boolean;
  onSubmit: (input: Record<string, unknown>) => Promise<void>;
}): React.ReactElement {
  const [kind, setKind] = useState("CLIENT");
  const [rootId, setRootId] = useState("");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  return (
    <Form submitLabel="Émettre l'invitation" saving={saving} onSubmit={() => onSubmit({ kind, email, fullName, ...(kind === "CLIENT" ? { crmAccountId: rootId } : { supplierId: rootId }) })}>
      <SelectField
        label="Portail"
        value={kind}
        onChange={(value) => {
          setKind(value);
          setRootId("");
        }}
        options={[
          { value: "CLIENT", label: "Client (compte CRM)" },
          { value: "SUPPLIER", label: "Fournisseur (Achats)" },
        ]}
        required
      />
      <SelectField label={kind === "CLIENT" ? "Compte CRM" : "Fournisseur"} value={rootId} onChange={setRootId} options={kind === "CLIENT" ? accounts : suppliers} required />
      <TextField label="Nom complet" value={fullName} onChange={setFullName} required />
      <TextField label="E-mail" type="email" value={email} onChange={setEmail} required />
    </Form>
  );
}
