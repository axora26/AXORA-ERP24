"use client";

import React, { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Laptop, Moon, Sun } from "lucide-react";
import { api } from "../lib/api";

export type ThemePreference = "light" | "dark" | "system";
const storageKey = "axora.theme";
const ThemeContext = createContext<{ preference: ThemePreference; saving: boolean; error: string; loadPreference: () => Promise<void>; setPreference: (value: ThemePreference) => Promise<void> }>({ preference: "system", saving: false, error: "", loadPreference: async () => undefined, setPreference: async () => undefined });
export const useTheme = () => useContext(ThemeContext);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>("system");
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    try { const saved = localStorage.getItem(storageKey); if (saved === "light" || saved === "dark" || saved === "system") setPreferenceState(saved); }
    catch { /* A blocked preference store does not prevent using the application. */ }
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => { document.documentElement.dataset.theme = preference === "system" ? (media.matches ? "dark" : "light") : preference; };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [preference, ready]);
  const cache = useCallback((value: ThemePreference) => {
    setPreferenceState(value);
    try { localStorage.setItem(storageKey, value); } catch { /* The selection still applies to this tab. */ }
  }, []);
  const loadPreference = useCallback(async () => {
    try { const result = await api.get<{ theme: ThemePreference }>("/auth/preferences"); cache(result.theme); setError(""); }
    catch { /* Keep the last display preference when the server is temporarily unavailable. */ }
  }, [cache]);
  const setPreference = useCallback(async (value: ThemePreference) => {
    cache(value); setSaving(true); setError("");
    try { const result = await api.patch<{ theme: ThemePreference }>("/auth/preferences", { theme: value }); cache(result.theme); }
    catch { setError("Le thème s’applique ici, mais sa sauvegarde sur votre compte a échoué. Sélectionnez-le à nouveau pour réessayer."); }
    finally { setSaving(false); }
  }, [cache]);
  return <ThemeContext.Provider value={{ preference, saving, error, loadPreference, setPreference }}>{children}</ThemeContext.Provider>;
}

export function ThemeSelector() {
  const { preference, saving, setPreference } = useTheme();
  const Glyph = preference === "dark" ? Moon : preference === "light" ? Sun : Laptop;
  return <label className="theme-selector"><Glyph size={16} aria-hidden="true"/><span className="sr-only">Thème d’affichage</span><select value={preference} disabled={saving} onChange={event => void setPreference(event.currentTarget.value as ThemePreference)}><option value="system">Système</option><option value="light">Clair</option><option value="dark">Sombre</option></select></label>;
}
