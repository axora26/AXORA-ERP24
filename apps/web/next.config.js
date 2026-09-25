/**
 * L'interface et l'API partagent la meme origine : /api/v1/* est relaye vers
 * le serveur NestJS (API_INTERNAL_URL). Le cookie de session reste ainsi
 * first-party, et une seule URL suffit pour ouvrir l'application.
 *
 * @type {import('next').NextConfig}
 */
const apiInternalUrl = process.env.API_INTERNAL_URL ?? "http://localhost:4000";
const production = process.env.NODE_ENV === "production";

/**
 * Politique de securite du contenu (production) : tout vient de la meme
 * origine (API relayee, polices auto-hebergees) ; aucun cadre, aucune
 * ressource tierce. Next.js injecte des scripts en ligne pour l'hydratation.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig = {
  reactStrictMode: true,
  // Aucun en-tete revelant le framework.
  poweredByHeader: false,
  // Permet un build de verification sans ecraser le repertoire du serveur de dev.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  devIndicators: false,
  async rewrites() {
    return [{ source: "/api/v1/:path*", destination: `${apiInternalUrl}/api/v1/:path*` }];
  },
  async headers() {
    return [
      {
        // Le service worker doit toujours etre revalide (nouvelle version deployee).
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Appareil photo (preuves de chantier) et position : meme origine uniquement ; micro et paiement refuses.
          { key: "Permissions-Policy", value: "camera=(self), geolocation=(self), microphone=(), payment=(), usb=()" },
          ...(production ? [{ key: "Content-Security-Policy", value: contentSecurityPolicy }] : []),
        ],
      },
    ];
  },
};

module.exports = nextConfig;
