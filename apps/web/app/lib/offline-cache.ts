import { ApiError } from "./api";

/**
 * Derniere consultation conservee sur l'appareil pour travailler sans reseau
 * (module Chantier uniquement). Cloisonnee par utilisateur et entreprise,
 * utilisee SEULEMENT en l'absence de reseau (jamais sur un refus 401/403),
 * purgee a la deconnexion. Le service worker, lui, ne met jamais l'API en cache.
 */
const PREFIX = "axora.offline.";
const CONTEXT_KEY = "axora.context.cache";
let scope = "";

export function setOfflineScope(userId: string, companyId: string | null): void {
  scope = `${userId}.${companyId ?? "-"}`;
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function isNetworkError(caught: unknown): boolean {
  return caught instanceof ApiError && caught.status === 0;
}

export async function cachedLoad<T>(name: string, loader: () => Promise<T>): Promise<T> {
  const key = `${PREFIX}${scope}.${name}`;
  try {
    const value = await loader();
    try {
      if (scope) storage()?.setItem(key, JSON.stringify({ savedAt: new Date().toISOString(), value }));
    } catch {
      // Quota ou stockage indisponible : le mode hors ligne sera simplement moins riche.
    }
    return value;
  } catch (caught) {
    if (!isNetworkError(caught) || !scope) throw caught;
    const raw = storage()?.getItem(key);
    if (!raw) throw caught;
    return (JSON.parse(raw) as { value: T }).value;
  }
}

export function saveContext(context: unknown): void {
  try {
    storage()?.setItem(CONTEXT_KEY, JSON.stringify(context));
  } catch {
    // Sans stockage, pas d'ouverture hors ligne : comportement en ligne inchange.
  }
}

export function readContext<T>(): T | null {
  try {
    const raw = storage()?.getItem(CONTEXT_KEY);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** Deconnexion : plus aucune donnee de session ni de chantier sur l'appareil. */
export function purgeOfflineData(): void {
  const store = storage();
  if (!store) return;
  for (let index = store.length - 1; index >= 0; index -= 1) {
    const key = store.key(index);
    if (key && (key.startsWith(PREFIX) || key === CONTEXT_KEY)) store.removeItem(key);
  }
}
