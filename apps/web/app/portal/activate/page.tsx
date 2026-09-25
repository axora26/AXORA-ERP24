"use client";

import React, { FormEvent, Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { KeyRound } from "lucide-react";
import { PortalError, portalClient } from "../../lib/portal-client";

function ActivateForm(): React.ReactElement {
  const router = useRouter();
  const params = useSearchParams();
  const companyId = params.get("c") ?? "";
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Le jeton voyage dans le fragment (#) : il n'est jamais envoye au serveur web ni aux journaux d'acces.
    setToken(window.location.hash.slice(1));
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (password !== confirm) return setError("Les deux mots de passe diffèrent.");
    if (password.length < 12) return setError("12 caractères minimum.");
    setLoading(true);
    setError("");
    try {
      await portalClient.activate(token, password);
      router.replace(`/portal?c=${encodeURIComponent(companyId)}`);
    } catch (caught) {
      setError(caught instanceof PortalError && caught.status === 401 ? "Invitation invalide, déjà utilisée ou expirée. Demandez un nouveau lien." : "Activation impossible pour le moment.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="portal-form">
      <label htmlFor="password">Choisissez un mot de passe (12 caractères minimum)</label>
      <input id="password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.currentTarget.value)} required minLength={12} />
      <label htmlFor="confirm">Confirmez le mot de passe</label>
      <input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.currentTarget.value)} required minLength={12} />
      {!token && <p className="portal-note">Lien d&apos;invitation incomplet.</p>}
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <button className="primary-button" type="submit" disabled={loading || !token}>
        {loading ? "Activation…" : "Activer mon accès"}
      </button>
    </form>
  );
}

export default function PortalActivatePage(): React.ReactElement {
  return (
    <main className="portal-auth">
      <div className="portal-card">
        <span className="eyebrow">
          <KeyRound size={15} /> Activation
        </span>
        <h2>Activer votre accès</h2>
        <p className="login-intro">Ce lien est personnel et à usage unique.</p>
        <Suspense fallback={<span className="loader" />}>
          <ActivateForm />
        </Suspense>
      </div>
    </main>
  );
}
