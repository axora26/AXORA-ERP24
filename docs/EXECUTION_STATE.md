# AXORA-ERP24 — Etat d'execution courant

**Derniere mise a jour** : 2026-09-20

## Phase courante

**INC-01 — Core / Identity / Organization / RBAC / Audit** en cours (voir `docs/foundation/06-product-backlog.md`). INC-00 termine et verifie.

## Fait (verifie par execution reelle, pas suppose)

### INC-00 (commit `ada072f`)
- Depot Git initialise, branche de travail `feat/foundation`.
- 6 rapports fondateurs committes dans `docs/foundation/`.
- Monorepo pnpm : `pnpm install` reussi (644 packages), `pnpm build:packages` OK (contracts/security/database/ui).
- `packages/security` : 11/11 tests unitaires vitest PASS (password scrypt, RBAC deny-by-default, session opaque).
- `packages/database` : schema Prisma INC-01, migration `20260920213943_init_core_rbac_audit` appliquee sur PostgreSQL 18 reel, seed DEMO verifie.
- `apps/api` : build NestJS OK (`nest build`). `apps/web` : build Next.js OK (`next build`), warning `themeColor` corrige.
- `docker-compose.dev.yml` : PostgreSQL 18 + Redis, healthchecks **healthy** verifies (bug point de montage Postgres 18 corrige).
- CI GitHub Actions ecrite (`.github/workflows/ci.yml`) — **jamais executee sur un runner reel**.

### INC-01 (en cours, apres `ada072f`)
- `apps/api/src/auth/` complet : `AuthService` (bootstrap organisation transactionnel, login, logout), `SessionGuard` (cookie opaque, hash SHA-256, jamais de JWT auto-porteur), `PermissionGuard` (deny-by-default, grants resolus serveur uniquement), `RequirePermission` decorateur.
- Toutes les routes Core protegees par `SessionGuard` + `PermissionGuard`.
- **Defaut d'isolation tenant reel detecte manuellement** (2 organisations de test, curl croise) puis corrige : voir `docs/DECISIONS.md` ADR-0004. `GET /organizations` (liste globale, faille) supprime, remplace par `GET /organizations/me` (scope strict a l'appelant).
- 4 nouveaux tests e2e (`apps/api/test/tenant-isolation.e2e.test.ts`) executes contre PostgreSQL reel : 401 sans session, isolation cross-tenant (assertion croisee explicite), rejet mot de passe errone, revocation session au logout.
- `vitest.config.ts` + `unplugin-swc` ajoutes (le transform esbuild par defaut de vitest cassait silencieusement l'injection de dependances NestJS — decorateurs non preserves).
- **Total tests `apps/api`** : 5/5 PASS (`health.test.ts` + `tenant-isolation.e2e.test.ts`).
- Verification manuelle HTTP complete : bootstrap 2 organisations reelles, login, `/auth/me`, isolation confirmee visuellement avant l'ecriture des tests automatises.

## Pas encore fait (a ne jamais presenter comme fait)

- CI GitHub Actions jamais executee sur un runner reel (GitHub Actions) — uniquement verifie en local.
- Pas de rate limiting sur `/auth/login` (brute-force possible) — a ajouter avant toute exposition publique.
- MFA (TOTP) : colonnes DB presentes (`mfaEnabled`, `mfaSecretEnc`) mais aucune logique d'activation/verification implementee.
- Pas de rotation/expiration automatique des sessions au-dela de la duree fixe (7 jours) ; pas de refresh token.
- Audit log : le modele existe et est utilise pour `organization.bootstrap`, mais pas encore pour login/logout/echecs d'authentification.
- Service worker PWA non implemente (seul le manifest existe).
- Aucun guard de type "role systeme" (ex: empecher la suppression du dernier OWNER) — non requis a ce stade mais a anticiper.

## Prochaine etape immediate

1. Construire l'interface Core/connexion responsive et l'ouvrir dans Preview.
2. Poursuivre sans marquer INC-00/INC-01 VERIFIED tant que la CI distante n'a pas exécuté les gates.
3. Reprendre le diagnostic CI dès que la facturation GitHub est régularisée.
