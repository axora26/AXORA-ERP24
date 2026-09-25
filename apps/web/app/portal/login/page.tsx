"use client";

import React, { FormEvent, Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Globe2 } from "lucide-react";
import { PortalError, portalClient } from "../../lib/portal-client";

function LoginForm(): React.ReactElement {
  const router = useRouter();
  const params = useSearchParams();
  const companyId = params.get("c") ?? "";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await portalClient.login(companyId, email, password);
      router.replace(`/portal?c=${encodeURIComponent(companyId)}`);
    } catch (caught) {
      setError(caught instanceof PortalError && caught.status === 429 ? "Trop de tentatives. Réessayez dans 15 minutes." : caught instanceof PortalError && caught.status === 401 ? "Identifiants invalides." : "Service momentanément indisponible.");
    } finally {
      setLoading(false);
    }
  }

  if (!companyId) {
    return <p className="portal-note">Lien de connexion incomplet : utilisez le lien reçu avec votre invitation.</p>;
  }
  return (
    <form onSubmit={submit} className="portal-form">
      <label htmlFor="email">Adresse e-mail</label>
      <input id="email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.currentTarget.value)} required />
      <label htmlFor="password">Mot de passe</label>
      <input id="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.currentTarget.value)} required />
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <button className="primary-button" type="submit" disabled={loading}>
        {loading ? "Connexion…" : (
          <>
            Se connecter <ArrowRight size={18} />
          </>
        )}
      </button>
    </form>
  );
}

export default function PortalLoginPage(): React.ReactElement {
  return (
    <main className="portal-auth">
      <div className="portal-card">
        <span className="eyebrow">
          <Globe2 size={15} /> Portail partenaires
        </span>
        <h2>Espace client & fournisseur</h2>
        <p className="login-intro">Accès réservé aux personnes invitées. Cet espace est distinct de l&apos;application interne.</p>
        <Suspense fallback={<span className="loader" />}>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
