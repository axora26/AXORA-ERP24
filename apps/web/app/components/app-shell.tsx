"use client";

import React, { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AlertTriangle, Building2, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Search, ShieldCheck, WifiOff, X } from "lucide-react";
import { api, ApiError, setActiveCompanyId } from "../lib/api";
import { visibleGroups, type NavGroup } from "../lib/navigation";
import { SessionContext, type SessionApi, type SessionContextValue } from "../lib/session";
import { Brand } from "./brand";
import { NotificationBell } from "./notification-bell";
import { purgeOfflinePages } from "./sw-register";
import { purgeOfflineData, readContext, saveContext, setOfflineScope } from "../lib/offline-cache";
import { useModalFocus } from "../lib/use-modal-focus";
import { ThemeSelector, useTheme } from "./theme";
import { NavBreadcrumbs } from "./nav-breadcrumbs";
import { NavSidebar } from "./nav-sidebar";
import { MfaStepUpProvider } from "./mfa-step-up-provider";

const COMPANY_STORAGE_KEY = "axora.activeCompanyId";
const SIDEBAR_STORAGE_KEY = "axora.nav.sidebar.collapsed";

type ContextResponse = Omit<SessionContextValue, "activeCompanyId">;

export function mfaEnrollmentDestination(pathname: string, required: boolean | undefined): string | null {
  return required && pathname !== "/account" ? "/account" : null;
}

function initialsOf(fullName: string | undefined): string {
  const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function readStoredCompany(): string | null {
  try {
    return window.localStorage.getItem(COMPANY_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Shell applicatif authentifie : charge le contexte de session aupres de
 * l'API, redirige vers /login sans session valide, et fournit le contexte
 * (utilisateur, entreprise active, permissions) a tous les modules.
 */
export function AppShell({ children }: { children: ReactNode }): React.ReactElement {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const [session, setSession] = useState<SessionContextValue | null>(null);
  const [failure, setFailure] = useState("");
  const [mobileNav, setMobileNav] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [offline, setOffline] = useState(false);
  const mobileNavRef = useModalFocus<HTMLElement>(mobileNav, () => setMobileNav(false));
  const { loadPreference, error: themeError } = useTheme();
  useEffect(() => { if (session?.user.id) void loadPreference(); }, [session?.user.id, loadPreference]);

  useEffect(() => {
    try {
      setSidebarCollapsed(window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true");
    } catch {
      // La largeur standard reste disponible si le stockage est bloqué.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const open = (context: ContextResponse) => {
      const stored = readStoredCompany();
      const active =
        context.companies.find((company) => company.id === stored)?.id ?? context.companies[0]?.id ?? null;
      setActiveCompanyId(context.companies.length > 1 ? active : null);
      setOfflineScope(context.user.id, active);
      setSession({ ...context, activeCompanyId: active });
    };
    api
      .get<ContextResponse>("/auth/context")
      .then((context) => {
        if (cancelled) return;
        saveContext(context);
        open(context);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        if (caught instanceof ApiError && caught.status === 401) {
          router.replace(`/login?next=${encodeURIComponent(pathname)}`);
          return;
        }
        // Sans reseau seulement : derniere session connue (aucune donnee metier), pour ouvrir le chantier hors ligne.
        const cached = caught instanceof ApiError && caught.status === 0 ? readContext<ContextResponse>() : null;
        if (cached) {
          setOffline(true);
          open(cached);
        } else {
          setFailure(caught instanceof ApiError ? caught.message : "L'API AXORA est momentanément injoignable.");
        }
      });
    return () => {
      cancelled = true;
    };
    // Le contexte n'est charge qu'une fois par montage du shell.
  }, []);

  useEffect(() => {
    const destination = mfaEnrollmentDestination(pathname, session?.mfaEnrollmentRequired);
    if (destination) router.replace(destination);
  }, [pathname, router, session?.mfaEnrollmentRequired]);

  useEffect(() => {
    const enrolled = () => setSession((current) => current ? { ...current, mfaEnrollmentRequired: false } : current);
    window.addEventListener("axora:mfa-enrolled", enrolled);
    return () => window.removeEventListener("axora:mfa-enrolled", enrolled);
  }, []);

  useEffect(() => {
    const goOffline = () => setOffline(true);
    const goOnline = () => setOffline(false);
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const logout = useCallback(async () => {
    await api.post("/auth/logout").catch(() => undefined);
    purgeOfflineData();
    await purgeOfflinePages();
    setActiveCompanyId(null);
    router.replace("/login");
  }, [router]);

  const sessionApi = useMemo<SessionApi | null>(() => {
    if (!session) return null;
    const granted = new Set(session.permissions);
    return {
      ...session,
      can: (permission: string) => granted.has(permission),
      switchCompany: (companyId: string) => {
        try {
          window.localStorage.setItem(COMPANY_STORAGE_KEY, companyId);
        } catch {
          // stockage indisponible : le choix vaut pour la session d'onglet
        }
        setActiveCompanyId(companyId);
        setOfflineScope(session.user.id, companyId);
        setSession((current) => (current ? { ...current, activeCompanyId: companyId } : current));
      },
      logout,
    };
  }, [session, logout]);
  const groups = useMemo(() => sessionApi ? visibleGroups(sessionApi.can) : [], [sessionApi]);

  if (failure) {
    return (
      <main className="loading-screen">
        <Brand />
        <div className="form-error" role="alert">
          {failure}
        </div>
        <button className="secondary-button" type="button" onClick={() => window.location.reload()}>
          Réessayer
        </button>
      </main>
    );
  }

  if (!sessionApi) {
    return (
      <main className="loading-screen">
        <Brand />
        <span className="loader" />
        <p>Ouverture de votre espace sécurisé…</p>
      </main>
    );
  }

  const activeCompany = sessionApi.companies.find((company) => company.id === sessionApi.activeCompanyId);

  return (
    <SessionContext.Provider value={sessionApi}>
      <MfaStepUpProvider>
      <div className="app-shell">
        <a className="skip-link" href="#main-content">Aller au contenu principal</a>
        <aside id="axora-sidebar" className={`sidebar ${mobileNav ? "open" : ""} ${sidebarCollapsed ? "collapsed" : ""}`} ref={mobileNavRef} role={mobileNav ? "dialog" : undefined} aria-modal={mobileNav ? true : undefined} aria-label={mobileNav ? "Navigation principale" : undefined} tabIndex={mobileNav ? -1 : undefined}>
          <div className="sidebar-head">
            <Brand />
            <button
              type="button"
              className="sidebar-collapse"
              aria-label={sidebarCollapsed ? "Déployer la barre latérale" : "Réduire la barre latérale"}
              aria-controls="axora-sidebar"
              aria-expanded={!sidebarCollapsed}
              title={sidebarCollapsed ? "Déployer la barre latérale" : "Réduire la barre latérale"}
              onClick={() => {
                setSidebarCollapsed((current) => {
                  const next = !current;
                  try {
                    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
                  } catch {
                    // La préférence reste limitée à l'onglet courant.
                  }
                  return next;
                });
              }}
            >
              {sidebarCollapsed ? <PanelLeftOpen size={18} aria-hidden="true" /> : <PanelLeftClose size={18} aria-hidden="true" />}
            </button>
            <button className="close-nav" onClick={() => setMobileNav(false)} aria-label="Fermer le menu">
              <X size={20} aria-hidden="true" />
            </button>
          </div>
          <NavSidebar groups={groups} pathname={pathname} onNavigate={() => setMobileNav(false)} />
          <button className="sign-out" onClick={() => void logout()} title="Déconnexion">
            <LogOut size={18} aria-hidden="true" /> <span>Déconnexion</span>
          </button>
        </aside>
        {mobileNav && <button className="nav-backdrop" onClick={() => setMobileNav(false)} aria-label="Fermer le menu" />}

        <main className="workspace">
          <header className="topbar">
            <div className="topbar-primary">
              <button className="menu-button" onClick={() => setMobileNav(true)} aria-label="Ouvrir le menu" aria-expanded={mobileNav}>
                <Menu size={21} aria-hidden="true" />
              </button>
              <button className="search-box" type="button" onClick={() => setPaletteOpen(true)}>
                <Search size={18} aria-hidden="true" />
                <span>Rechercher un module, une action…</span>
                <kbd>Ctrl K</kbd>
              </button>
            </div>
            <div className="company-context" aria-label="Contexte de travail">
              <div className="company-context-copy">
                <span>{sessionApi.organization?.name ?? "Organisation"}</span>
                <strong>Société active</strong>
              </div>
              {sessionApi.companies.length > 1 ? (
                <label className="company-switch">
                  <Building2 size={16} aria-hidden="true" />
                  <span className="sr-only">Changer la société active</span>
                  <select
                    aria-label="Société active"
                    value={sessionApi.activeCompanyId ?? ""}
                    onChange={(event) => {
                      sessionApi.switchCompany(event.currentTarget.value);
                      window.location.reload();
                    }}
                  >
                    {sessionApi.companies.map((company) => (
                      <option key={company.id} value={company.id}>{company.name}</option>
                    ))}
                  </select>
                </label>
              ) : activeCompany ? (
                <span className="company-pill" title="Société active">
                  <Building2 size={15} aria-hidden="true" />
                  {activeCompany.name}
                </span>
              ) : null}
            </div>
            <div className="top-actions">
              <ThemeSelector/>
              <NotificationBell />
              <Link className="user-menu" href="/account" title="Mon compte">
                <span>{initialsOf(sessionApi.user.fullName)}</span>
                <div>
                  <strong>{sessionApi.user.fullName || sessionApi.user.email}</strong>
                  <small>{sessionApi.roles.join(", ") || "Aucun rôle"}</small>
                </div>
              </Link>
            </div>
          </header>

          {sessionApi.mfaEnrollmentRequired && (
            <div className="security-strip" role="alert">
              <ShieldCheck size={14} aria-hidden="true" />
              Votre organisation exige la double authentification. Configurez-la maintenant pour retrouver l’accès aux modules métier.
            </div>
          )}
          {offline && (
            <div className="offline-strip" role="status">
              <WifiOff size={14} aria-hidden="true" />
              Hors ligne — dernière session connue. Les saisies de chantier sont mises en file et synchronisées au retour du réseau ; les autres écrans attendent la connexion.
            </div>
          )}
          {sessionApi.organization?.isDemo && (
            <div className="demo-strip" role="note">
              <AlertTriangle size={14} aria-hidden="true" />
              Organisation de démonstration (DEMO) — les données affichées sont fictives et ne proviennent d&apos;aucune
              entreprise réelle.
            </div>
          )}

          <div className="dashboard-content" id="main-content" tabIndex={-1}>
            <NavBreadcrumbs pathname={pathname} />
            {themeError && <div className="form-error" role="alert">{themeError}</div>}
            {children}
          </div>
        </main>

        {paletteOpen && (
          <CommandPalette
            groups={groups}
            onClose={() => setPaletteOpen(false)}
            onNavigate={(href) => {
              setPaletteOpen(false);
              router.push(href);
            }}
          />
        )}
      </div>
      </MfaStepUpProvider>
    </SessionContext.Provider>
  );
}

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** Palette de commandes (Ctrl K) : navigation clavier vers les modules accessibles. */
function CommandPalette({
  groups,
  onClose,
  onNavigate,
}: {
  groups: NavGroup[];
  onClose: () => void;
  onNavigate: (href: string) => void;
}): React.ReactElement {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useModalFocus<HTMLDivElement>(true, onClose);
  const resultsId = useId();
  const items = groups.flatMap((group) => group.items.map((item) => ({ ...item, group: group.label })));

  const matches = items.filter((item) => {
    const needle = normalize(query.trim());
    if (!needle) return true;
    return normalize(`${item.label} ${item.keywords ?? ""}`).includes(needle);
  });

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Palette de commandes" ref={dialogRef} tabIndex={-1}>
        <div className="palette-input">
          <Search size={18} aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            placeholder="Aller à…"
            aria-label="Rechercher un module"
            role="combobox"
            aria-expanded={true}
            aria-controls={resultsId}
            aria-autocomplete="list"
            aria-activedescendant={matches[cursor] ? `${resultsId}-${cursor}` : undefined}
            onChange={(event) => {
              setQuery(event.currentTarget.value);
              setCursor(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") { event.preventDefault(); setCursor((value) => Math.max(0, Math.min(value + 1, matches.length - 1))); }
              if (event.key === "ArrowUp") { event.preventDefault(); setCursor((value) => Math.max(value - 1, 0)); }
              if (event.key === "Enter" && matches[cursor]) { event.preventDefault(); onNavigate(matches[cursor].href); }
            }}
          />
          <button type="button" className="icon-button" onClick={onClose} aria-label="Fermer la recherche"><X size={18} aria-hidden="true"/></button>
        </div>
        <ul id={resultsId} role="listbox" aria-label="Modules accessibles">
          {matches.length === 0 && <li className="palette-empty" role="presentation">Aucun module ne correspond. Essayez un autre nom.</li>}
          {matches.map((item, index) => (
            <li key={item.href} id={`${resultsId}-${index}`} role="option" aria-selected={index === cursor}>
              <button
                type="button"
                tabIndex={-1}
                className={index === cursor ? "active" : ""}
                onMouseEnter={() => setCursor(index)}
                onClick={() => onNavigate(item.href)}
                data-group={item.group}
                aria-label={`${item.label}, groupe ${item.group}`}
              >
                <item.icon size={16} aria-hidden="true" />
                <span>{item.label}</span>
                <small>{item.group}</small>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
