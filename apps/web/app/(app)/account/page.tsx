"use client";

import React, { useEffect, useState } from "react";
import QRCode from "qrcode";
import { KeyRound, ShieldCheck, ShieldOff } from "lucide-react";
import { accountApi } from "../../lib/modules/admin";
import { useMutation, useResource } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import { ActionBar, Button, DetailList, Feedback, Form, Loading, PageHeader, Panel, StatusChip, TextField } from "../../components/ui";

export default function AccountPage(): React.ReactElement {
  const session = useSession();
  return (
    <>
      <PageHeader
        breadcrumb="Mon compte"
        title="Mon compte"
        subtitle="Identité, mot de passe et double authentification."
      />
      <Panel title="Identité">
        <DetailList
          items={[
            { label: "Nom", value: session.user.fullName },
            { label: "E-mail", value: session.user.email },
            { label: "Organisation", value: session.organization?.name ?? "—" },
            { label: "Rôles", value: session.roles.join(", ") || "Aucun" },
            { label: "Entreprises", value: session.companies.map((company) => company.name).join(", ") },
            { label: "Permissions effectives", value: String(session.permissions.length) },
          ]}
        />
      </Panel>
      <div className="module-grid cols-2">
        <PasswordPanel />
        <MfaPanel />
      </div>
    </>
  );
}

function PasswordPanel(): React.ReactElement {
  const mutation = useMutation();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  return (
    <Panel title="Mot de passe" subtitle="Le changement déconnecte vos autres appareils.">
      <Feedback error={mutation.error} notice={mutation.notice} />
      <Form
        columns={1}
        submitLabel="Changer le mot de passe"
        saving={mutation.saving}
        onSubmit={async () => {
          if (next !== confirm) {
            mutation.setError("La confirmation ne correspond pas au nouveau mot de passe.");
            return;
          }
          const done = await mutation.run(
            () => accountApi.changePassword(current, next),
            "Mot de passe modifié. Vos autres sessions ont été fermées.",
          );
          if (done) {
            setCurrent("");
            setNext("");
            setConfirm("");
          }
        }}
      >
        <TextField label="Mot de passe actuel" type="password" value={current} onChange={setCurrent} required />
        <TextField label="Nouveau mot de passe" type="password" value={next} onChange={setNext} required hint="8 caractères minimum." />
        <TextField label="Confirmation" type="password" value={confirm} onChange={setConfirm} required />
      </Form>
    </Panel>
  );
}

function MfaPanel(): React.ReactElement {
  const status = useResource(() => accountApi.mfaStatus());
  const mutation = useMutation();
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [qr, setQr] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (!setup) return;
    QRCode.toDataURL(setup.otpauthUri, { margin: 1, width: 180 })
      .then(setQr)
      .catch(() => setQr(""));
  }, [setup]);

  if (status.loading && !status.data) return <Panel title="Double authentification"><Loading label="Chargement…" /></Panel>;
  const state = status.data;

  return (
    <Panel
      title="Double authentification (TOTP)"
      subtitle="Code à 6 chiffres d'une application d'authentification (Google Authenticator, Microsoft Authenticator, FreeOTP…)."
      actions={state && <StatusChip status={state.enabled ? "verified" : "draft"} label={state.enabled ? "Activée" : "Désactivée"} />}
    >
      <Feedback error={status.error || mutation.error} notice={mutation.notice} />
      {!state?.available ? (
        <p className="inline-warning">
          La double authentification n&apos;est pas disponible sur ce serveur : la clé de chiffrement MFA_ENCRYPTION_KEY
          n&apos;est pas configurée. Contactez l&apos;exploitant de la plateforme.
        </p>
      ) : state.enabled ? (
        <>
          <p className="inline-note">
            Votre compte exige un code à chaque connexion. Pour désactiver la protection, confirmez votre mot de passe et un
            code valide.
          </p>
          <Form
            columns={2}
            submitLabel="Désactiver la double authentification"
            saving={mutation.saving}
            onSubmit={async () => {
              const done = await mutation.run(() => accountApi.disableMfa(password, code), "Double authentification désactivée.");
              if (done) {
                setPassword("");
                setCode("");
                await status.reload();
              }
            }}
          >
            <TextField label="Mot de passe" type="password" value={password} onChange={setPassword} required />
            <TextField label="Code à 6 chiffres" inputMode="numeric" value={code} onChange={setCode} required />
          </Form>
        </>
      ) : setup ? (
        <>
          <div className="qr-box">
            {qr ? <img src={qr} alt="QR code d'enrôlement TOTP" /> : <span className="loader" />}
            <div>
              <p className="inline-note" style={{ padding: 0 }}>
                1. Scannez ce QR code avec votre application d&apos;authentification, ou saisissez la clé ci-dessous.
                Elle n&apos;est affichée qu&apos;une seule fois.
              </p>
              <code>{setup.secret}</code>
              <p className="inline-note" style={{ padding: "12px 0 0" }}>2. Saisissez le code affiché pour confirmer.</p>
            </div>
          </div>
          <Form
            columns={1}
            submitLabel="Activer"
            saving={mutation.saving}
            onSubmit={async () => {
              const done = await mutation.run(() => accountApi.enableMfa(code), "Double authentification activée.");
              if (done) {
                setSetup(null);
                setCode("");
                await status.reload();
              }
            }}
          >
            <TextField label="Code à 6 chiffres" inputMode="numeric" value={code} onChange={setCode} required />
          </Form>
        </>
      ) : (
        <ActionBar note="Recommandé pour les comptes d'administration, de finance et de gestion des droits.">
          <Button
            variant="primary"
            disabled={mutation.saving}
            onClick={async () => {
              const created = await mutation.run(() => accountApi.startMfaSetup());
              if (created) setSetup(created);
            }}
          >
            <ShieldCheck size={15} aria-hidden="true" /> Configurer
          </Button>
        </ActionBar>
      )}
      {state?.enabled === false && !setup && (
        <DetailList
          items={[
            { label: "Protection actuelle", value: <span><KeyRound size={13} aria-hidden="true" /> Mot de passe seul</span> },
            { label: "Risque", value: <span><ShieldOff size={13} aria-hidden="true" /> Vol d&apos;identifiants</span> },
          ]}
        />
      )}
    </Panel>
  );
}
