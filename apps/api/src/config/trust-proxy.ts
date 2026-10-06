/**
 * Reglage Express `trust proxy` derive de TRUST_PROXY.
 *
 * Derriere un reverse proxy (Caddy, Next.js), l'adresse du client n'est connue
 * que par X-Forwarded-For. Les budgets anti-abus (connexion, inscription, MFA)
 * sont indexes par adresse IP : sans confiance explicite, tous les clients
 * partageraient l'adresse du proxy et se bloqueraient mutuellement ; avec une
 * confiance aveugle (`true`), n'importe quel client pourrait choisir son adresse
 * et contourner ces budgets. Seuls un nombre de sauts ou une liste de
 * sous-reseaux/mots-cles Express sont donc acceptes.
 */
export type TrustProxySetting = false | number | string[];

export function trustProxySetting(env: NodeJS.ProcessEnv = process.env): TrustProxySetting {
  const raw = (env.TRUST_PROXY ?? "").trim();
  if (raw === "" || raw.toLowerCase() === "false") return false;
  if (raw.toLowerCase() === "true") {
    throw new Error("TRUST_PROXY=true is refused: give a hop count or the trusted proxy subnets (e.g. loopback, 172.16.0.0/12)");
  }
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}
