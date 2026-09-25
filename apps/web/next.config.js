/**
 * L'interface et l'API partagent la meme origine : /api/v1/* est relaye vers
 * le serveur NestJS (API_INTERNAL_URL). Le cookie de session reste ainsi
 * first-party, et une seule URL suffit pour ouvrir l'application.
 *
 * @type {import('next').NextConfig}
 */
const apiInternalUrl = process.env.API_INTERNAL_URL ?? "http://localhost:4000";

const nextConfig = {
  reactStrictMode: true,
  // Permet un build de verification sans ecraser le repertoire du serveur de dev.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  devIndicators: false,
  async rewrites() {
    return [{ source: "/api/v1/:path*", destination: `${apiInternalUrl}/api/v1/:path*` }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
