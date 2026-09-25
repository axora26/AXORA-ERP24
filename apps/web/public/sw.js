/* AXORA-ERP24 — service worker (INC-24).
 *
 * Regles de securite :
 * - JAMAIS de mise en cache des reponses de l'API (/api/*) : les donnees
 *   metier restent soumises au controle d'acces serveur a chaque lecture ;
 *   seul le module Chantier garde sa derniere consultation (stockage local
 *   cloisonne, purge a la deconnexion) et sa file de saisies (IndexedDB).
 * - Seuls sont mis en cache : les ressources statiques versionnees (/_next/static,
 *   icones, polices) et la coquille HTML/RSC des pages deja visitees (sans
 *   donnees : les ecrans chargent leurs donnees par l'API).
 * - Le cache des pages est purge a la deconnexion (message PURGE).
 */
const VERSION = "v1";
const STATIC_CACHE = `axora-static-${VERSION}`;
const PAGES_CACHE = `axora-pages-${VERSION}`;
const OFFLINE_URL = "/offline";
const PRECACHE = [OFFLINE_URL, "/manifest.json", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("axora-") && key !== STATIC_CACHE && key !== PAGES_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "PURGE") event.waitUntil(caches.delete(PAGES_CACHE));
});

function isStatic(url) {
  return url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || /\.(woff2?|ttf|otf)$/.test(url.pathname);
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.type === "basic") (await caches.open(STATIC_CACHE)).put(request, response.clone());
  return response;
}

async function networkFirst(request, fallbackToOffline) {
  try {
    const response = await fetch(request);
    if (response.ok && response.type === "basic") (await caches.open(PAGES_CACHE)).put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await caches.match(request, { ignoreVary: true });
    if (cached) return cached;
    if (fallbackToOffline) return (await caches.match(OFFLINE_URL)) ?? Response.error();
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Donnees metier et fichiers servis par l'API : toujours le reseau, jamais le cache.
  if (url.pathname.startsWith("/api/")) return;
  if (isStatic(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, true));
    return;
  }
  // Charges RSC de navigation cote client et petites ressources (manifeste, icone).
  event.respondWith(networkFirst(request, false));
});
