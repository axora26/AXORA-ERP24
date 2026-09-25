"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AlertTriangle, Bell, Building2, LogOut, Menu, Search, X } from "lucide-react";
import { api, ApiError, setActiveCompanyId } from "../lib/api";
import { isActive, visibleGroups, type NavItem } from "../lib/navigation";
import { SessionContext, type SessionApi, type SessionContextValue } from "../lib/session";
import { Brand } from "./brand";

const COMPANY_STORAGE_KEY = "axora.activeCompanyId";

type ContextResponse = Omit<SessionContextValue, "activeCompanyId">;

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
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get<ContextResponse>("/auth/context")
      .then((context) => {
        if (cancelled) return;
        const stored = readStoredCompany();
        const active =
          context.companies.find((company) => company.id === stored)?.id ?? context.companies[0]?.id ?? null;
        setActiveCompanyId(context.companies.length > 1 ? active : null);
        setSession({ ...context, activeCompanyId: active });
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        if (caught instanceof ApiError && caught.status === 401) {
          router.replace(`/login?next=${encodeURIComponent(pathname)}`);
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
        setSession((current) => (current ? { ...current, activeCompanyId: companyId } : current));
      },
      logout,
    };
  }, [session, logout]);

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

  const groups = visibleGroups(sessionApi.can);
  const activeCompany = sessionApi.companies.find((company) => company.id === sessionApi.activeCompanyId);

  return (
    <SessionContext.Provider value={sessionApi}>
      <div className="app-shell">
        <aside className={`sidebar ${mobileNav ? "open" : ""}`}>
          <div className="sidebar-head">
            <Brand />
            <button className="close-nav" onClick={() => setMobileNav(false)} aria-label="Fermer le menu">
              <X size={20} />
            </button>
          </div>
          <nav aria-label="Navigation principale">
            {groups.map((group) => (
              <React.Fragment key={group.label}>
                <p>{group.label.toUpperCase()}</p>
                {group.items.map((item) => {
                  const active = isActive(pathname, item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={active ? "active" : ""}
                      aria-current={active ? "page" : undefined}
                      onClick={() => setMobileNav(false)}
                    >
                      <item.icon size={18} />
                      <span>{item.label}</span>
                      {active && <i />}
                    </Link>
                  );
                })}
              </React.Fragment>
            ))}
          </nav>
          <button className="sign-out" onClick={() => void logout()}>
            <LogOut size={18} /> Déconnexion
          </button>
        </aside>
        {mobileNav && <button className="nav-backdrop" onClick={() => setMobileNav(false)} aria-label="Fermer le menu" />}

        <main className="workspace">
          <header className="topbar">
            <button className="menu-button" onClick={() => setMobileNav(true)} aria-label="Ouvrir le menu">
              <Menu size={21} />
            </button>
            <button className="search-box" type="button" onClick={() => setPaletteOpen(true)}>
              <Search size={18} />
              <span>Rechercher un module, une action…</span>
              <kbd>Ctrl K</kbd>
            </button>
            <div className="top-actions">
              {sessionApi.companies.length > 1 ? (
                <label className="company-switch">
                  <Building2 size={15} aria-hidden="true" />
                  <span className="sr-only">Entreprise active</span>
                  <select
                    value={sessionApi.activeCompanyId ?? ""}
                    onChange={(event) => {
                      sessionApi.switchCompany(event.currentTarget.value);
                      window.location.reload();
                    }}
                  >
                    {sessionApi.companies.map((company) => (
                      <option key={company.id} value={company.id}>
                        {company.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                activeCompany && (
                  <span className="company-pill" title="Entreprise active">
                    <Building2 size={14} aria-hidden="true" />
                    {activeCompany.name}
                  </span>
                )
              )}
              <button className="icon-button" aria-label="Notifications" type="button">
                <Bell size={19} />
              </button>
              <Link className="user-menu" href="/account" title="Mon compte">
                <span>{initialsOf(sessionApi.user.fullName)}</span>
                <div>
                  <strong>{sessionApi.user.fullName || sessionApi.user.email}</strong>
                  <small>{sessionApi.roles.join(", ") || "Aucun rôle"}</small>
                </div>
              </Link>
            </div>
          </header>

          {sessionApi.organization?.isDemo && (
            <div className="demo-strip" role="note">
              <AlertTriangle size={14} aria-hidden="true" />
              Organisation de démonstration (DEMO) — les données affichées sont fictives et ne proviennent d&apos;aucune
              entreprise réelle.
            </div>
          )}

          <div className="dashboard-content">{children}</div>
        </main>

        {paletteOpen && (
          <CommandPalette
            items={groups.flatMap((group) => group.items)}
            onClose={() => setPaletteOpen(false)}
            onNavigate={(href) => {
              setPaletteOpen(false);
              router.push(href);
            }}
          />
        )}
      </div>
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
  items,
  onClose,
  onNavigate,
}: {
  items: NavItem[];
  onClose: () => void;
  onNavigate: (href: string) => void;
}): React.ReactElement {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  const matches = items.filter((item) => {
    const needle = normalize(query.trim());
    if (!needle) return true;
    return normalize(`${item.label} ${item.keywords ?? ""}`).includes(needle);
  });

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Palette de commandes">
        <div className="palette-input">
          <Search size={18} aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            placeholder="Aller à…"
            aria-label="Rechercher un module"
            onChange={(event) => {
              setQuery(event.currentTarget.value);
              setCursor(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") onClose();
              if (event.key === "ArrowDown") setCursor((value) => Math.min(value + 1, matches.length - 1));
              if (event.key === "ArrowUp") setCursor((value) => Math.max(value - 1, 0));
              if (event.key === "Enter" && matches[cursor]) onNavigate(matches[cursor].href);
            }}
          />
        </div>
        <ul>
          {matches.length === 0 && <li className="palette-empty">Aucun module ne correspond.</li>}
          {matches.map((item, index) => (
            <li key={item.href}>
              <button
                type="button"
                className={index === cursor ? "active" : ""}
                onMouseEnter={() => setCursor(index)}
                onClick={() => onNavigate(item.href)}
              >
                <item.icon size={16} aria-hidden="true" />
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
