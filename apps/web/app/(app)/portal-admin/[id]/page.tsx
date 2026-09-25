"use client";

import React, { useState } from "react";
import { useParams } from "next/navigation";
import type { PortalInvitationIssued, PortalPrincipalView } from "@axora24/contracts";
import { Ban, Eye, EyeOff, MailPlus, PlayCircle, ShieldX } from "lucide-react";
import { PRINCIPAL_STATUS_CHIP, PRINCIPAL_STATUS_LABEL, RESOURCE_LABEL, portalAdminApi } from "../../../lib/modules/portal-admin";
import { formatDateTime } from "../../../lib/format";
import { useMutation, useResource } from "../../../lib/hooks";
import { useSession } from "../../../lib/session";
import { ActionBar, Button, DataTable, DetailList, Empty, Feedback, Form, Grid, Loading, Modal, PageHeader, Panel, StatusChip, TextAreaField } from "../../../components/ui";
import { InvitationReveal } from "../../../components/invitation-reveal";

export default function PortalPrincipalPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const session = useSession();
  const mutation = useMutation();
  const resource = useResource(() => portalAdminApi.principal(id), [id]);
  const candidates = useResource(() => (session.can("portal.grant.manage") ? portalAdminApi.candidates(id) : Promise.resolve([])), [id]);
  const [override, setOverride] = useState<PortalPrincipalView | null>(null);
  const [issued, setIssued] = useState<PortalInvitationIssued | null>(null);
  const [statusChange, setStatusChange] = useState<"ACTIVE" | "SUSPENDED" | "REVOKED" | null>(null);
  const principal = override ?? resource.data;

  if (resource.loading && !principal) return <Loading label="Chargement de l'accès…" />;
  if (!principal) return <Feedback error={resource.error || "Accès introuvable."} />;
  const canManage = session.can("portal.principal.manage") && principal.status !== "REVOKED";
  const canGrant = session.can("portal.grant.manage") && principal.status !== "REVOKED";

  async function apply(action: () => Promise<PortalPrincipalView>, success: string): Promise<void> {
    const updated = await mutation.run(action, success);
    if (updated) {
      setOverride(updated);
      setStatusChange(null);
      await candidates.reload();
    }
  }

  return (
    <>
      <PageHeader
        breadcrumb="Portails externes / accès"
        title={principal.fullName}
        subtitle={`${principal.email} · portail ${principal.kind === "CLIENT" ? "client" : "fournisseur"} · ${principal.rootName}`}
        onRefresh={() => {
          setOverride(null);
          void resource.reload();
          void candidates.reload();
        }}
        actions={<StatusChip status={PRINCIPAL_STATUS_CHIP[principal.status] ?? "pending"} label={PRINCIPAL_STATUS_LABEL[principal.status]} />}
      />
      <Feedback error={mutation.error || candidates.error} notice={mutation.notice} />
      {canManage && (
        <ActionBar note="Suspendre ou révoquer invalide immédiatement toutes les sessions et invitations de cette personne.">
          {(principal.status === "INVITED" || principal.status === "ACTIVE") && (
            <Button
              onClick={async () => {
                const result = await mutation.run(() => portalAdminApi.reinvite(id), "Nouvelle invitation émise (les précédentes sont révoquées).");
                if (result) {
                  setIssued(result);
                  setOverride(result.principal);
                }
              }}
            >
              <MailPlus size={15} aria-hidden="true" /> {principal.status === "ACTIVE" ? "Lien de réinitialisation" : "Renvoyer l'invitation"}
            </Button>
          )}
          {principal.status === "SUSPENDED" && (
            <Button onClick={() => setStatusChange("ACTIVE")}>
              <PlayCircle size={15} aria-hidden="true" /> Réactiver
            </Button>
          )}
          {principal.status !== "SUSPENDED" && (
            <Button variant="danger" onClick={() => setStatusChange("SUSPENDED")}>
              <Ban size={15} aria-hidden="true" /> Suspendre
            </Button>
          )}
          <Button variant="ghost" onClick={() => setStatusChange("REVOKED")}>
            <ShieldX size={15} aria-hidden="true" /> Révoquer définitivement
          </Button>
        </ActionBar>
      )}
      <div className="stack">
        <Grid>
          <Panel title="Accès">
            <DetailList
              items={[
                { label: "Enregistrement racine", value: `${principal.kind === "CLIENT" ? "Compte CRM" : "Fournisseur"} ${principal.rootName}` },
                { label: "Activé le", value: principal.activatedAt ? formatDateTime(principal.activatedAt) : "Pas encore" },
                { label: "Dernière connexion", value: principal.lastLoginAt ? formatDateTime(principal.lastLoginAt) : "Jamais" },
                { label: "Invitation en attente", value: principal.pendingInvitation ? "Oui" : "Non" },
                { label: "Motif du dernier changement", value: principal.statusReason ?? "—" },
              ]}
            />
          </Panel>
          <Panel className="compact" title="Ressources exposables" subtitle="Seules les ressources de l'enregistrement racine, dans un état publiable, sont proposées.">
            <DataTable
              rows={(candidates.data ?? []).map((row) => ({ ...row, id: `${row.resourceType}-${row.resourceId}` }))}
              empty={<Empty icon={<Eye size={22} />} title="Aucune ressource exposable" body={principal.kind === "CLIENT" ? "Projets, factures émises et documents approuvés du compte." : "Commandes émises et factures du fournisseur."} />}
              columns={[
                {
                  key: "resource",
                  header: "Ressource",
                  render: (row) => (
                    <>
                      <strong>{row.label}</strong>
                      <small>{RESOURCE_LABEL[row.resourceType]}</small>
                    </>
                  ),
                },
                {
                  key: "action",
                  header: "",
                  render: (row) =>
                    row.granted ? (
                      <StatusChip status="active" label="Exposée" />
                    ) : canGrant ? (
                      <Button onClick={() => void apply(() => portalAdminApi.grant(id, row.resourceType, row.resourceId), "Ressource exposée.")}>
                        <Eye size={14} aria-hidden="true" /> Exposer
                      </Button>
                    ) : null,
                },
              ]}
            />
          </Panel>
        </Grid>
        <Panel title="Historique des expositions">
          <DataTable
            rows={principal.grants ?? []}
            empty={<Empty icon={<EyeOff size={22} />} title="Rien n'est exposé" body="Deny-by-default : le portail est vide tant qu'aucune ressource n'est exposée." />}
            columns={[
              { key: "resource", header: "Ressource", render: (grant) => <strong>{grant.label}</strong> },
              { key: "type", header: "Type", render: (grant) => RESOURCE_LABEL[grant.resourceType] },
              { key: "by", header: "Exposée par", render: (grant) => `${grant.grantedByName} · ${formatDateTime(grant.grantedAt)}` },
              {
                key: "state",
                header: "État",
                render: (grant) =>
                  grant.revokedAt ? (
                    <StatusChip status="archived" label={`Retirée ${formatDateTime(grant.revokedAt)}`} />
                  ) : canGrant ? (
                    <Button variant="ghost" onClick={() => void apply(() => portalAdminApi.revoke(grant.id), "Exposition retirée.")}>
                      <EyeOff size={14} aria-hidden="true" /> Retirer
                    </Button>
                  ) : (
                    <StatusChip status="active" label="Active" />
                  ),
              },
            ]}
          />
        </Panel>
      </div>
      {statusChange && (
        <Modal title={statusChange === "ACTIVE" ? "Réactiver l'accès" : statusChange === "SUSPENDED" ? "Suspendre l'accès" : "Révoquer définitivement"} onClose={() => setStatusChange(null)}>
          <Feedback error={mutation.error} />
          <ReasonForm saving={mutation.saving} onSubmit={(reason) => apply(() => portalAdminApi.setStatus(id, statusChange, reason), "État mis à jour.")} />
        </Modal>
      )}
      {issued && <InvitationReveal issued={issued} onClose={() => setIssued(null)} />}
    </>
  );
}

function ReasonForm({ saving, onSubmit }: { saving: boolean; onSubmit: (reason: string) => Promise<void> }): React.ReactElement {
  const [reason, setReason] = useState("");
  return (
    <Form columns={1} submitLabel="Valider" saving={saving} onSubmit={() => onSubmit(reason)}>
      <TextAreaField label="Motif" value={reason} onChange={setReason} required />
    </Form>
  );
}
