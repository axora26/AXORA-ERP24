# syntax=docker/dockerfile:1.7
#
# Image de production AXORA-ERP24 (monorepo pnpm).
#   docker build --target api -t axora-erp24-api .
#   docker build --target web -t axora-erp24-web .
# Le build compile les paquets partages, l'API NestJS et l'interface Next.js
# (sortie "standalone"). Les images finales tournent en utilisateur non root.

# Version qualifiee localement (engines : >=22.12.0).
ARG NODE_VERSION=24.19.0

FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1
# pnpm via npm : evite les cles de signature perimees de corepack selon la version de Node.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && npm install --global --no-audit --no-fund pnpm@9.15.9
WORKDIR /repo

# --- Dependances (couche mise en cache tant que les manifestes ne changent pas)
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/database/package.json packages/database/
COPY packages/security/package.json packages/security/
COPY packages/ui/package.json packages/ui/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
 && pnpm install --frozen-lockfile

# --- Build complet du monorepo
FROM deps AS build
# Adresse de l'API vue depuis le conteneur web (nom de service docker compose).
ARG API_INTERNAL_URL=http://api:4000
COPY . .
# Les rewrites Next.js sont figes au build : l'adresse interne de l'API (service Docker) est fixee ici.
RUN pnpm --filter @axora24/database exec prisma generate \
 && pnpm --filter "./packages/**" build \
 && pnpm --filter @axora24/api build \
 && NEXT_STANDALONE=1 API_INTERNAL_URL=${API_INTERNAL_URL} pnpm --filter @axora24/web build \
 && pnpm --filter @axora24/api deploy --prod /out/api

# --- API NestJS + migrations Prisma
FROM base AS api
ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    API_PORT=4000 \
    FILE_STORAGE_DIR=/data/files
WORKDIR /app
COPY --from=build /out/api ./
COPY --from=build /repo/apps/api/dist ./dist
# Client Prisma genere + schema et migrations (appliquees au demarrage).
# `pnpm deploy` reinstalle @prisma/client avec un client vide (« stub ») : le client
# genere (moteur debian-openssl-3.0.x) est recopie depuis l'etape de build.
COPY --from=build /repo/packages/database/prisma /app/prisma
COPY --from=build /repo/node_modules/.pnpm/@prisma+client@6.19.3_prisma@6.19.3_typescript@5.9.3__typescript@5.9.3/node_modules/.prisma/client \
     /app/node_modules/.pnpm/@prisma+client@6.19.3_prisma@6.19.3_typescript@5.9.3__typescript@5.9.3/node_modules/.prisma/client
RUN npm install --global --no-audit --no-fund prisma@6.19.3 \
 && mkdir -p /data/files \
 && chown -R node:node /data /app
COPY --chmod=0755 deploy/vps/api-entrypoint.sh /usr/local/bin/api-entrypoint
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["api-entrypoint"]
CMD ["node", "dist/main.js"]

# --- Interface Next.js (standalone)
FROM node:${NODE_VERSION}-bookworm-slim AS web
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3100
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3100/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
