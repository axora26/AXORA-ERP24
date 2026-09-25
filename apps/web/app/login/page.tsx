"use client";

import React, { Suspense, useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, CheckCircle2, ShieldCheck, Sparkles } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { Brand } from "../components/brand";

const SHOW_DEMO_HINT = process.env.NEXT_PUBLIC_SHOW_DEMO_LOGIN === "true";

/** Redirection post-connexion limitee aux chemins internes (pas d'open redirect). */
function safeNext(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}

function LoginForm(): React.ReactElement {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    // Session deja ouverte : inutile de se reconnecter.
    api
      .get("/auth/me")
      .then(() => router.replace(safeNext(params.get("next"))))
      .catch(() => undefined);
  }, [params, router]);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await api.post("/auth/login", { email, password });
      router.replace(safeNext(params.get("next")));
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 429) {
        setError("Trop de tentatives. Réessayez dans 15 minutes.");
      } else if (caught instanceof ApiError && caught.status === 401) {
        setError("Identifiants invalides.");
      } else {
        setError("L'API AXORA est momentanément indisponible.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-card">
      <span className="eyebrow">
        <ShieldCheck size={15} /> Accès sécurisé
      </span>
      <h2>Bienvenue</h2>
      <p className="login-intro">Connectez-vous à votre espace de travail AXORA.</p>

      <form onSubmit={submit}>
        <label htmlFor="email">Adresse e-mail</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.currentTarget.value)}
          placeholder="nom@entreprise.com"
          required
        />

        <div className="password-label">
          <label htmlFor="password">Mot de passe</label>
        </div>
        <div className="password-field">
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.currentTarget.value)}
            placeholder="Votre mot de passe"
            minLength={8}
            required
          />
          <button
            type="button"
            onClick={() => setShowPassword((visible) => !visible)}
            aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
          >
            {showPassword ? "Masquer" : "Afficher"}
          </button>
        </div>

        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <button className="primary-button" type="submit" disabled={loading}>
          {loading ? (
            "Connexion…"
          ) : (
            <>
              Se connecter <ArrowRight size={18} />
            </>
          )}
        </button>
      </form>

      {SHOW_DEMO_HINT && (
        <div className="demo-login-hint" role="note">
          <strong>Environnement local de démonstration</strong>
          <span>
            demo@axora-erp24.local · <code>Demo2026!</code>
          </span>
          <button
            type="button"
            onClick={() => {
              setEmail("demo@axora-erp24.local");
              setPassword("Demo2026!");
            }}
          >
            Remplir
          </button>
        </div>
      )}

      <div className="security-note">
        <ShieldCheck size={18} />
        <span>
          <strong>Connexion protégée</strong>
          <small>Session opaque, contrôle RBAC et journal d&apos;audit.</small>
        </span>
      </div>
    </div>
  );
}

export default function LoginPage(): React.ReactElement {
  return (
    <main className="login-page">
      <section className="login-story" aria-label="Présentation AXORA-ERP24">
        <Brand />
        <div className="story-content">
          <span className="eyebrow light">
            <Sparkles size={15} /> Enterprise command center
          </span>
          <h1>Pilotez votre entreprise avec une vision unifiée.</h1>
          <p>
            Finance, projets, construction et opérations réunis dans une plateforme sécurisée, conçue pour la
            performance.
          </p>
          <div className="trust-row">
            <span>
              <ShieldCheck size={18} /> Isolation multi-tenant
            </span>
            <span>
              <CheckCircle2 size={18} /> Audit intégré
            </span>
          </div>
        </div>
        <div className="story-orbit orbit-one" aria-hidden="true" />
        <div className="story-orbit orbit-two" aria-hidden="true" />
        <p className="story-foot">AXORA GROUP · Enterprise Software</p>
      </section>

      <section className="login-panel">
        <div className="mobile-brand">
          <Brand />
        </div>
        <Suspense fallback={<span className="loader" />}>
          <LoginForm />
        </Suspense>
        <p className="login-footer">© 2026 AXORA GROUP · Confidentialité · Assistance</p>
      </section>
    </main>
  );
}
