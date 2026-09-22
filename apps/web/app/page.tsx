"use client";

import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bell,
  Building2,
  Calculator,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  Command,
  FileCheck2,
  FolderKanban,
  HardHat,
  LayoutDashboard,
  LogOut,
  Menu,
  PackageSearch,
  Search,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  UsersRound,
  X,
} from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { CrmWorkspace } from "./components/crm-workspace";
import { EstimationWorkspace } from "./components/estimation-workspace";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

type AuthUser = {
  id: string;
  email: string;
  fullName: string;
  organizationId: string;
};

type Metric = {
  label: string;
  value: string;
  trend: string;
  icon: typeof TrendingUp;
  tone: "blue" | "green" | "amber" | "violet";
};

const metrics: Metric[] = [
  { label: "Chiffre d'affaires", value: "24,8 M$", trend: "+12,4 % ce mois", icon: TrendingUp, tone: "blue" },
  { label: "Projets actifs", value: "18", trend: "4 jalons cette semaine", icon: FolderKanban, tone: "violet" },
  { label: "Budget engagé", value: "68 %", trend: "Dans les objectifs", icon: CircleDollarSign, tone: "green" },
  { label: "Actions critiques", value: "7", trend: "2 à traiter aujourd'hui", icon: FileCheck2, tone: "amber" },
];

type WorkspaceView = "overview" | "crm" | "estimation";

/**
 * Navigation : seules les vues reellement livrees sont activables. Les autres
 * restent desactivees et annoncees comme telles — jamais un ecran vide qui
 * laisserait croire qu'un module existe deja.
 */
const navItems: Array<{ label: string; icon: typeof LayoutDashboard; view?: WorkspaceView }> = [
  { label: "Vue d'ensemble", icon: LayoutDashboard, view: "overview" },
  { label: "CRM & Ventes", icon: UsersRound, view: "crm" },
  { label: "Études & DQE", icon: Calculator, view: "estimation" },
  { label: "Projets", icon: FolderKanban },
  { label: "Construction", icon: HardHat },
  { label: "Finance", icon: CircleDollarSign },
  { label: "Achats", icon: PackageSearch },
  { label: "Analytique", icon: BarChart3 },
];

const projects = [
  { name: "Tour Horizon", code: "PRJ-2408", phase: "Exécution", progress: 72, budget: "8,4 M$", health: "Maîtrisé" },
  { name: "Campus Kintambo", code: "PRJ-2411", phase: "Études", progress: 46, budget: "5,9 M$", health: "Attention" },
  { name: "Résidence Mwezi", code: "PRJ-2415", phase: "Mobilisation", progress: 28, budget: "3,2 M$", health: "Maîtrisé" },
];

/**
 * Initiales defensives : le profil provient de l'API, une valeur manquante ne
 * doit jamais faire planter le shell applicatif (regression reelle corrigee
 * cote API dans session.guard.ts, filet de securite conserve cote client).
 */
function initialsOf(fullName: string | undefined): string {
  const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return "?";
  }
  return parts
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function Brand(): React.ReactElement {
  return (
    <div className="brand">
      <span className="brand-mark"><Command size={20} strokeWidth={2.4} /></span>
      <span className="brand-copy"><strong>AXORA</strong><small>ERP24</small></span>
    </div>
  );
}

function LoginScreen({ onAuthenticated }: { onAuthenticated: (user: AuthUser) => void }): React.ReactElement {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!response.ok) {
        setError(response.status === 429 ? "Trop de tentatives. Réessayez dans 15 minutes." : "Identifiants invalides.");
        return;
      }
      const result = (await response.json()) as { user: AuthUser };
      onAuthenticated(result.user);
    } catch {
      setError("L'API AXORA est momentanément indisponible.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-story" aria-label="Présentation AXORA-ERP24">
        <Brand />
        <div className="story-content">
          <span className="eyebrow light"><Sparkles size={15} /> Enterprise command center</span>
          <h1>Pilotez votre entreprise avec une vision unifiée.</h1>
          <p>Finance, projets, construction et opérations réunis dans une plateforme sécurisée, conçue pour la performance.</p>
          <div className="trust-row">
            <span><ShieldCheck size={18} /> Isolation multi-tenant</span>
            <span><CheckCircle2 size={18} /> Audit intégré</span>
          </div>
        </div>
        <div className="story-orbit orbit-one" aria-hidden="true" />
        <div className="story-orbit orbit-two" aria-hidden="true" />
        <p className="story-foot">AXORA GROUP · Enterprise Software</p>
      </section>

      <section className="login-panel">
        <div className="mobile-brand"><Brand /></div>
        <div className="login-card">
          <span className="eyebrow"><ShieldCheck size={15} /> Accès sécurisé</span>
          <h2>Bienvenue</h2>
          <p className="login-intro">Connectez-vous à votre espace de travail AXORA.</p>

          <form onSubmit={submit}>
            <label htmlFor="email">Adresse e-mail</label>
            <input id="email" name="email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail((event.currentTarget as HTMLInputElement).value)} placeholder="nom@entreprise.com" required />

            <div className="password-label"><label htmlFor="password">Mot de passe</label><button type="button">Mot de passe oublié ?</button></div>
            <div className="password-field">
              <input id="password" name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" value={password} onChange={(event) => setPassword((event.currentTarget as HTMLInputElement).value)} placeholder="Votre mot de passe" minLength={8} required />
              <button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}>{showPassword ? "Masquer" : "Afficher"}</button>
            </div>

            {error && <div className="form-error" role="alert">{error}</div>}
            <button className="primary-button" type="submit" disabled={loading}>{loading ? "Connexion…" : <>Se connecter <ArrowRight size={18} /></>}</button>
          </form>

          <div className="security-note"><ShieldCheck size={18} /><span><strong>Connexion protégée</strong><small>Session opaque, contrôle RBAC et journal d'audit.</small></span></div>
        </div>
        <p className="login-footer">© 2026 AXORA GROUP · Confidentialité · Assistance</p>
      </section>
    </main>
  );
}

function Dashboard({ user, onLogout }: { user: AuthUser; onLogout: () => Promise<void> }): React.ReactElement {
  const [mobileNav, setMobileNav] = useState(false);
  const [view, setView] = useState<WorkspaceView>("overview");
  const initials = initialsOf(user.fullName);
  const firstName = (user.fullName ?? "").trim().split(" ")[0] || user.email;

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? "open" : ""}`}>
        <div className="sidebar-head"><Brand /><button className="close-nav" onClick={() => setMobileNav(false)} aria-label="Fermer le menu"><X size={20} /></button></div>
        <nav aria-label="Navigation principale">
          <p>ESPACE DE TRAVAIL</p>
          {navItems.map((item) => (
            <button
              key={item.label}
              className={item.view === view ? "active" : ""}
              disabled={!item.view}
              title={!item.view ? "Disponible dans un prochain incrément" : undefined}
              onClick={() => {
                if (item.view) {
                  setView(item.view);
                  setMobileNav(false);
                }
              }}
            >
              <item.icon size={18} />
              <span>{item.label}</span>
              {item.view === view && <i />}
            </button>
          ))}
          <p>ADMINISTRATION</p>
          <button disabled><Building2 size={18} /><span>Organisation</span></button>
          <button disabled><ShieldCheck size={18} /><span>Accès & sécurité</span></button>
        </nav>
        <div className="sidebar-card"><Sparkles size={19} /><div><strong>AXORA Intelligence</strong><small>Assistant bientôt disponible</small></div></div>
        <button className="sign-out" onClick={() => void onLogout()}><LogOut size={18} /> Déconnexion</button>
      </aside>
      {mobileNav && <button className="nav-backdrop" onClick={() => setMobileNav(false)} aria-label="Fermer le menu" />}

      <main className="workspace">
        <header className="topbar">
          <button className="menu-button" onClick={() => setMobileNav(true)} aria-label="Ouvrir le menu"><Menu size={21} /></button>
          <div className="search-box"><Search size={18} /><input aria-label="Recherche globale" placeholder="Rechercher un projet, client, document…" /><kbd>Ctrl K</kbd></div>
          <div className="top-actions"><button className="icon-button" aria-label="Notifications"><Bell size={19} /><i /></button><div className="user-menu"><span>{initials}</span><div><strong>{user.fullName || user.email}</strong><small>Administrateur</small></div><ChevronDown size={15} /></div></div>
        </header>

        <div className="dashboard-content">
          {view === "crm" ? <CrmWorkspace /> : view === "estimation" ? <EstimationWorkspace /> : <>
          <section className="welcome-row">
            <div><p className="breadcrumb">Command Center / Vue d'ensemble</p><h1>Bonjour, {firstName}</h1><p>Voici la situation consolidée de vos opérations.</p></div>
            <button className="secondary-button"><span>Cette semaine</span><ChevronDown size={16} /></button>
          </section>

          <div className="demo-banner" role="note">
            <AlertTriangle size={17} />
            <p>
              <strong>Données de démonstration</strong>
              <small>
                Les indicateurs financiers, projets et activités ci-dessous sont des exemples fixes. Ils
                ne proviennent d&apos;aucune source réelle et seront remplacés par les données de votre
                organisation au fil des incréments (CRM, Finance, Projets).
              </small>
            </p>
          </div>

          <section className="metrics-grid" aria-label="Indicateurs clés">
            {metrics.map((metric) => <article className="metric-card" key={metric.label}><div className={`metric-icon ${metric.tone}`}><metric.icon size={20} /></div><div className="metric-label">{metric.label}</div><strong>{metric.value}</strong><small className={metric.tone}>{metric.trend}</small></article>)}
          </section>

          <section className="dashboard-grid">
            <article className="panel performance-panel">
              <div className="panel-head"><div><h2>Performance financière</h2><p>Encaissements et dépenses · 6 derniers mois</p></div><button aria-label="Options">•••</button></div>
              <div className="chart-legend"><span><i className="revenue" />Encaissements</span><span><i className="expense" />Dépenses</span></div>
              <div className="bar-chart" aria-label="Graphique de performance financière">
                {[54, 63, 58, 78, 70, 86].map((height, index) => <div className="bar-group" key={index}><div className="bars"><i className="bar revenue" style={{ height: `${height}%` }} /><i className="bar expense" style={{ height: `${Math.max(28, height - 24)}%` }} /></div><span>{["Avr", "Mai", "Juin", "Juil", "Août", "Sept"][index]}</span></div>)}
              </div>
            </article>

            <article className="panel activity-panel">
              <div className="panel-head"><div><h2>Activité récente</h2><p>Mises à jour de votre équipe</p></div><button>Tout voir</button></div>
              <div className="activity-list">
                <div><span className="activity-icon blue"><FileCheck2 size={16} /></span><p><strong>Situation de travaux validée</strong><small>Tour Horizon · il y a 18 min</small></p></div>
                <div><span className="activity-icon green"><CircleDollarSign size={16} /></span><p><strong>Paiement client enregistré</strong><small>1,2 M$ · il y a 1 h</small></p></div>
                <div><span className="activity-icon violet"><UsersRound size={16} /></span><p><strong>Nouvelle opportunité créée</strong><small>Infrastructure Kasaï · il y a 3 h</small></p></div>
              </div>
            </article>
          </section>

          <section className="panel projects-panel">
            <div className="panel-head"><div><h2>Projets prioritaires</h2><p>Suivi des opérations à plus forte valeur</p></div><button>Voir tous les projets <ArrowRight size={15} /></button></div>
            <div className="table-wrap"><table><thead><tr><th>Projet</th><th>Phase</th><th>Progression</th><th>Budget</th><th>Santé</th></tr></thead><tbody>{projects.map((project) => <tr key={project.code}><td><strong>{project.name}</strong><small>{project.code}</small></td><td><span className="phase-chip">{project.phase}</span></td><td><div className="progress-cell"><div><i style={{ width: `${project.progress}%` }} /></div><span>{project.progress}%</span></div></td><td>{project.budget}</td><td><span className={`health ${project.health === "Attention" ? "warning" : "ok"}`}><i />{project.health}</span></td></tr>)}</tbody></table></div>
          </section>
          </>}
        </div>
      </main>
    </div>
  );
}

export default function Home(): React.ReactElement {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 5_000);

    void fetch(`${API_URL}/auth/me`, {
      credentials: "include",
      signal: controller.signal,
    })
      .then(async (response) => response.ok ? response.json() as Promise<{ user: AuthUser }> : null)
      .then((result) => result && setUser(result.user))
      .catch(() => undefined)
      .finally(() => {
        window.clearTimeout(timeoutId);
        setChecking(false);
      });

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, []);

  async function logout(): Promise<void> {
    await fetch(`${API_URL}/auth/logout`, { method: "POST", credentials: "include" }).catch(() => undefined);
    setUser(null);
  }

  if (checking) return <main className="loading-screen"><Brand /><span className="loader" /><p>Ouverture de votre espace sécurisé…</p></main>;
  return user ? <Dashboard user={user} onLogout={logout} /> : <LoginScreen onAuthenticated={setUser} />;
}
