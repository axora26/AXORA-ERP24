"use client";

import React, { useEffect, useState } from "react";
import QRCode from "qrcode";
import { KeyRound, ShieldOff } from "lucide-react";
import { RecoveryCodesReveal } from "../../components/recovery-codes-reveal";
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
        <TextField label="Nouveau mot de passe" type="password" value={next} onChange={setNext} required minLength={12} autoComplete="new-password" hint="12 caractères minimum." />
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
  const [recoveryCode, setRecoveryCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [action, setAction] = useState<"regenerate" | "disable" | null>(null);
  const [issuedCodes, setIssuedCodes] = useState<string[] | null>(null);
  useEffect(() => {
    if (!setup) { setQr(""); return; }
    let active = true;
    void QRCode.toDataURL(setup.otpauthUri, { margin: 1, width: 180 }).then(value => { if (active) setQr(value); }).catch(() => { if (active) setQr(""); });
    return () => { active = false; };
  }, [setup]);
  if (status.loading && !status.data) return <Panel title="Double authentification"><Loading label="Chargement…" /></Panel>;
  const state = status.data;
  const clear = () => { setPassword(""); setCode(""); setRecoveryCode(""); setAction(null); setUseRecovery(false); };
  const passwordField = <TextField label="Mot de passe actuel" type="password" value={password} onChange={setPassword} required maxLength={256} autoComplete="current-password" />;
  const totpField = <TextField label="Code à 6 chiffres" inputMode="numeric" value={code} onChange={v => setCode(v.replace(/[^0-9]/g, "").slice(0, 6))} required minLength={6} maxLength={6} autoComplete="one-time-code" hint="Utilisez un nouveau code après chaque action confirmée." />;
  return <Panel title="Double authentification" subtitle="Sécurisez vos connexions avec une application d’authentification et des codes de récupération." actions={state && <StatusChip status={state.enabled ? "verified" : "draft"} label={state.enabled ? "Activée" : "Désactivée"} />}>
    <Feedback error={status.error || mutation.error} notice={mutation.notice} />
    {!state ? <Button onClick={() => void status.reload()}>Réessayer</Button> : !state.available ? <p className="inline-warning">La double authentification est momentanément indisponible. Contactez l’administrateur.</p> : state.enabled ? <>
      <p className="inline-note">Un code est demandé à chaque connexion. {state.recoveryCodesRemaining} code{state.recoveryCodesRemaining > 1 ? "s" : ""} de récupération disponible{state.recoveryCodesRemaining > 1 ? "s" : ""}.</p>
      {state.recoveryCodesRemaining === 0 && <p className="inline-warning">Générez des codes de récupération pour conserver un accès si vous perdez votre application.</p>}
      {state.requiredByOrganization && <p className="inline-note"><strong>Obligatoire :</strong> votre organisation impose cette protection. Elle ne peut pas être désactivée.</p>}
      {!action ? <ActionBar><Button variant="primary" onClick={() => { clear(); setAction("regenerate"); }}>Générer de nouveaux codes</Button><Button disabled={state.requiredByOrganization} title={state.requiredByOrganization ? "Protection imposée par l’organisation" : undefined} onClick={() => { clear(); setAction("disable"); }}>Désactiver la protection</Button></ActionBar> : <>
        <p className="inline-note">{action === "regenerate" ? "La nouvelle série remplace immédiatement tous vos anciens codes. Confirmez votre mot de passe et un nouveau code de votre application." : "Confirmez votre mot de passe et un code valide pour désactiver la protection."}</p>
        <Form columns={1} saving={mutation.saving} submitLabel={action === "regenerate" ? "Remplacer les codes" : "Désactiver la double authentification"} secondary={<Button disabled={mutation.saving} onClick={clear}>Annuler</Button>} onSubmit={async () => {
          if (action === "regenerate") { const result = await mutation.run(() => accountApi.regenerateRecoveryCodes(password, code), "Nouveaux codes générés."); if (result) { setIssuedCodes(result.recoveryCodes); clear(); await status.reload(); } }
          else { const result = await mutation.run(() => accountApi.disableMfa(password, useRecovery ? { recoveryCode } : { code }), "Double authentification désactivée."); if (result) { clear(); await status.reload(); } }
        }}>{passwordField}{action === "disable" && useRecovery ? <TextField label="Code de récupération" value={recoveryCode} onChange={setRecoveryCode} required maxLength={128} autoComplete="off" hint="Chaque code ne peut être utilisé qu’une fois." /> : totpField}
          {action === "disable" && <Button onClick={() => { setUseRecovery(v => !v); setCode(""); setRecoveryCode(""); }}>{useRecovery ? "Utiliser l’application d’authentification" : "Utiliser un code de récupération"}</Button>}
        </Form>
      </>}
    </> : setup ? <>
      <div className="qr-box">{qr ? <img src={qr} alt="QR code à scanner dans votre application d’authentification" /> : <p>Utilisez la clé manuelle ci-dessous.</p>}<div><p className="inline-note">Scannez le QR code dans votre application ou saisissez cette clé manuellement.</p><code>{setup.secret}</code></div></div>
      <Form columns={1} saving={mutation.saving} submitLabel="Activer la protection" secondary={<Button disabled={mutation.saving} onClick={() => { setSetup(null); clear(); }}>Annuler</Button>} onSubmit={async () => { const result = await mutation.run(() => accountApi.enableMfa(password, code), "Double authentification activée."); if (result) { setIssuedCodes(result.recoveryCodes); setSetup(null); clear(); window.dispatchEvent(new Event("axora:mfa-enrolled")); await status.reload(); } }}>{passwordField}{totpField}</Form>
    </> : <><p className="inline-note">Confirmez votre mot de passe pour configurer une application d’authentification.</p><Form columns={1} submitLabel="Configurer la protection" saving={mutation.saving} onSubmit={async () => { const result = await mutation.run(() => accountApi.startMfaSetup(password)); if (result) { setSetup(result); setCode(""); } }}>{passwordField}</Form><DetailList items={[{ label: "Protection actuelle", value: <span><KeyRound size={13} aria-hidden="true" /> Mot de passe seul</span> }, { label: "Conseil", value: <span><ShieldOff size={13} aria-hidden="true" /> Activez la double authentification pour sécuriser votre compte.</span> }]} /></>}
    {issuedCodes && <RecoveryCodesReveal codes={issuedCodes} onClose={() => setIssuedCodes(null)} />}
  </Panel>;
}
