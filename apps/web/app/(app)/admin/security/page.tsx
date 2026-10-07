"use client";

import React, { useEffect, useState } from "react";
import { ShieldCheck, Smartphone } from "lucide-react";
import { adminApi } from "../../../lib/modules/admin";
import { useMutation, useResource } from "../../../lib/hooks";
import { ActionBar, Button, DataUnavailable, DetailList, Feedback, Loading, PageHeader, Panel, StatusChip, Toggle } from "../../../components/ui";

export default function SecurityPage(): React.ReactElement {
  const organization = useResource(() => adminApi.organization());
  const mutation = useMutation();
  const [mfaRequired, setMfaRequired] = useState(false);

  useEffect(() => {
    if (organization.data) setMfaRequired(organization.data.mfaRequired);
  }, [organization.data?.mfaRequired]);

  if (organization.error && !organization.data && !organization.loading) {
    return <DataUnavailable title="Sécurité" error={organization.error} onRetry={() => void organization.reload()} />;
  }

  const saved = organization.data?.mfaRequired ?? false;
  const dirty = organization.data !== null && mfaRequired !== saved;

  return (
    <>
      <PageHeader
        breadcrumb="Administration / Sécurité"
        title="Sécurité de l’organisation"
        subtitle="Politique de double authentification et protection renforcée des opérations sensibles."
        onRefresh={() => void organization.reload()}
      />
      <Feedback error={organization.error || mutation.error} notice={mutation.notice} />
      {organization.loading && !organization.data ? (
        <Loading label="Chargement de la politique de sécurité…" />
      ) : organization.data ? (
        <div className="module-grid cols-2">
          <Panel
            title="Double authentification obligatoire"
            subtitle="Applique la MFA à tous les comptes de cette organisation."
            actions={<StatusChip status={saved ? "verified" : "draft"} label={saved ? "Obligatoire" : "Facultative"} />}
          >
            <div className="security-policy-lead">
              <ShieldCheck size={28} aria-hidden="true" />
              <p>Les connexions et actions administratives critiques sont protégées par un second facteur vérifié côté serveur.</p>
            </div>
            <Toggle
              label="Imposer la double authentification à tous les utilisateurs"
              checked={mfaRequired}
              disabled={mutation.saving}
              onChange={(value) => { mutation.clear(); setMfaRequired(value); }}
            />
            {dirty && mfaRequired && (
              <p className="inline-warning">Les utilisateurs sans second facteur devront l’activer depuis Mon compte avant de poursuivre leur travail.</p>
            )}
            {dirty && !mfaRequired && (
              <p className="inline-warning">La MFA restera active sur les comptes déjà configurés, mais ne sera plus imposée à toute l’organisation.</p>
            )}
            <ActionBar note="Le changement est audité et exige une preuve MFA fraîche de l’administrateur.">
              <Button disabled={!dirty || mutation.saving} onClick={() => setMfaRequired(saved)}>Annuler</Button>
              <Button
                variant="primary"
                disabled={!dirty || mutation.saving}
                onClick={async () => {
                  const updated = await mutation.run(() => adminApi.updateSecurityPolicy(mfaRequired), "Politique de sécurité enregistrée.");
                  if (updated) await organization.reload();
                }}
              >
                Enregistrer la politique
              </Button>
            </ActionBar>
          </Panel>
          <Panel title="Step-up MFA" subtitle="Une preuve récente protège les opérations critiques pendant cinq minutes dans la session courante.">
            <DetailList items={[
              { label: "Fenêtre de validité", value: "5 minutes, par session" },
              { label: "Actions protégées", value: "Utilisateurs, rôles et politique de sécurité" },
              { label: "Isolation", value: "La validation ne s’applique qu’à la session courante" },
              { label: "Confidentialité", value: <span><Smartphone size={14} aria-hidden="true" /> Aucun code stocké dans le navigateur</span> },
            ]} />
            <p className="inline-note">Lorsqu’une action nécessite une confirmation, la fenêtre de saisie conserve votre contexte et rejoue l’action une seule fois après validation.</p>
          </Panel>
        </div>
      ) : null}
    </>
  );
}
