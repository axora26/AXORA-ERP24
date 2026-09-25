"use client";

import { useEffect } from "react";

/** Enregistre le service worker en production uniquement (le serveur de developpement garde le rechargement a chaud). */
export function ServiceWorkerRegister(): null {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
  }, []);
  return null;
}

/** Purge des pages mises en cache (deconnexion) : aucune coquille ne survit a la session. */
export async function purgeOfflinePages(): Promise<void> {
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: "PURGE" });
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key.startsWith("axora-pages-")).map((key) => caches.delete(key)));
    }
  } catch {
    // Stockage indisponible (navigation privee) : rien a purger.
  }
}
