# AXORA-ERP24 — Etat d'execution courant

**Derniere mise a jour** : 2026-09-20

## Phase courante

**INC-00 — Bootstrap technique + Design System + Shell** (voir `docs/foundation/06-product-backlog.md`).

## Fait (verifie par lecture de fichiers reels, pas suppose)

- Depot Git initialise (`git init -b main`), branche de travail `feat/foundation`.
- 6 rapports fondateurs produits et committes dans `docs/foundation/` (architecture, domain-model, security, ux-design-system, qa-devops, product-backlog).
- Monorepo pnpm scaffolde : `package.json` racine, `pnpm-workspace.yaml`, `tsconfig.base.json`.
- `packages/contracts` : types tenancy/permissions/module-status/http.
- `packages/security` : password (scrypt), authorization (deny-by-default), session (token opaque) + tests unitaires vitest.
- `packages/database` : schema Prisma INC-01 (Organization/Company/Branch/User/CompanyMembership/Session/Role/Permission/RolePermission/RoleAssignment/AuditLog), seed DEMO.
- `packages/ui` : design tokens (charte AXORA #1E3A8A/#2563EB/#111827/#BFC3C9/#FFFFFF, Montserrat/Inter).
- `apps/api` : NestJS bootstrap, module Health (endpoint `/health`), module Core avec OrganizationController/Service (⚠️ PAS encore de guard RBAC — non exposable en environnement partage).
- `apps/web` : Next.js App Router bootstrap, layout + page Command Center minimal, manifest PWA de base.
- `docker-compose.dev.yml` : PostgreSQL 18 + Redis avec healthchecks, volumes nommes `axora_erp24_*`.
- `.env.example` documente.

## Pas encore fait (a ne jamais presenter comme fait)

- `pnpm install` reel pas encore execute/verifie sur cette machine.
- `pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm build` pas encore executes.
- CI GitHub Actions pas encore ecrite.
- Aucun guard RBAC applicatif branche sur les controllers NestJS (RBAC dans `packages/security` existe comme brique, pas encore consomme).
- Aucune migration Prisma reellement appliquee (`pnpm db:migrate` pas execute).
- Service worker PWA non implemente (seul le manifest existe).

## Prochaine etape immediate

1. Executer `pnpm install` a la racine et corriger toute erreur reelle.
2. Executer `pnpm typecheck` et `pnpm build:packages`, corriger les erreurs.
3. Ecrire le pipeline CI (`.github/workflows/ci.yml`) reprenant les gates de `docs/foundation/05-qa-devops.md`.
4. Demarrer `docker-compose.dev.yml`, verifier les healthchecks reels.
5. Committer, puis ouvrir la Phase INC-01 complete (guard RBAC reel + tests d'isolation tenant).
