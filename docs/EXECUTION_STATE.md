# AXORA-ERP24 — Etat d'execution courant

**Derniere mise a jour** : 2026-09-21

## Phase courante

**INC-02 — CRM (prospects -> opportunites -> pipeline)** livre en local (voir `docs/foundation/06-product-backlog.md`). INC-00 et INC-01 implementes, aucun encore VERIFIED faute de run CI distant.

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

### INC-01 — interface Core + fiabilisation des gates (2026-09-21)

- `apps/web` : ecran de connexion et shell applicatif (sidebar, topbar, dashboard) responsive, verifies reellement dans un navigateur (375 px et pleine largeur) contre l'API et PostgreSQL reels — connexion, restauration de session au rechargement, rendu mobile.
- **Defaut reel corrige** : `GET /auth/me` ne renvoyait pas `fullName` alors que `POST /auth/login` le renvoyait. Au rechargement d'une page authentifiee, le client plantait (`user.fullName.split` sur `undefined`). `AuthenticatedUser` porte desormais `fullName` ; regression verrouillee par `test/auth-contract.e2e.test.ts`.
- **Defaut reel corrige** : aucune couche de l'application ne chargeait `.env` (ni NestJS, ni @prisma/client v6). Le demarrage documente au README echouait sur une machine propre. `apps/api/src/config/env.ts` charge desormais le `.env` du monorepo **sans jamais ecraser une variable deja presente** (CI/production prioritaires) ; invariant couvert par 4 tests unitaires.
- **Defaut reel corrige** : les tests e2e (base PostgreSQL requise) tournaient dans le gate `pnpm test`, execute en CI sur un runner sans base. Separation effective : `pnpm test` = unitaires purs, `pnpm test:e2e` = e2e (`vitest.e2e.config.ts`, fichier jusqu'ici reference par le script mais inexistant).
- CI : nouveau job `e2e-tests` avec service `postgres:18-alpine` + `prisma migrate deploy`.
- Donnees du dashboard : indicateurs financiers/projets encore fictifs, desormais **explicitement signales par un bandeau "Donnees de demonstration"** dans l'interface (regle AXORA : aucune valeur inventee presentee comme reelle).
- Ports alignes sur 3100 pour le web (`.env`, `.env.example`, CORS par defaut de l'API).

**Gates executes localement sur l'arbre de travail correspondant** : `pnpm typecheck` OK, `pnpm lint` OK (0 erreur, 0 warning), `pnpm test` 16 tests PASS, `pnpm test:e2e` 8 tests PASS contre PostgreSQL 18 reel, `pnpm build:packages` + `pnpm build` OK.

### INC-02 — CRM (2026-09-21)

**Modele de donnees** (`packages/database/prisma/schema.prisma`, migration `20260921172536_inc_02_crm`) : `CrmAccount`, `CrmContact`, `CrmLead`, `CrmPipelineStage`, `CrmOpportunity`, `CrmActivity`. Chaque entite porte `organizationId` ET `companyId`. Montants en `Decimal(18,2)`. `CrmActivity` n'a pas de `updatedAt` : l'historique est append-only par construction.

**Securite du scope entreprise** : `CompanyScopeService` revalide systematiquement tout `companyId` transmis (query ou body) contre les `CompanyMembership` de la SESSION. Un identifiant appartenant a un autre tenant renvoie 403 avec le meme message qu'une entreprise inexistante (pas de divulgation d'existence). Toutes les routes CRM portent `SessionGuard` + `PermissionGuard` + `@RequirePermission` explicite (deny-by-default).

**Parcours livre** : creation de prospect -> conversion transactionnelle en opportunite (creation du compte si absent, du contact, rattachement `sourceLeadId`, deux activites immuables) -> deplacement d'etape avec cloture automatique WON/LOST -> tableau de bord agrege en Decimal exact.

**Defauts reels corriges au passage** :
- le proprietaire d'une organisation n'etait membre d'aucune entreprise (`CompanyMembership` jamais cree au bootstrap) — tout module scope entreprise lui aurait ete refuse ; corrige au bootstrap + migration de rattrapage `20260921180000_backfill_owner_company_membership` ;
- les organisations existantes n'avaient ni pipeline par defaut (migration `20260921180500_backfill_default_pipeline`) ni les nouvelles cles de permission — d'ou `PermissionSyncService`, qui complete au demarrage les roles `isSystem` OWNER avec toutes les cles de `ALL_PERMISSIONS` (ajout uniquement, jamais de retrait, jamais de role personnalise touche) ;
- `pnpm db:validate`, `db:format` et `db:migrate` pointaient vers des scripts inexistants et la CLI Prisma ne trouvait pas le `.env` du monorepo — corrige par `scripts/with-env.mjs` (meme invariant de precedence que le chargeur applicatif) ;
- normalisation de `relatedType` : les valeurs sont en casse mixte (`Lead`, `Opportunity`) alors que le validateur d'enum compare en majuscules, ce qui renvoyait 400 sur des requetes valides — detecte par les tests e2e avant toute livraison.

**Interface** (`apps/web/app/components/crm-workspace.tsx`) : indicateurs, pipeline par etape, liste de prospects avec creation et conversion, liste d'opportunites. **Aucune donnee de demonstration** : quand il n'y a rien, l'ecran affiche un etat vide explicite. Parcours verifie dans un navigateur reel (creation d'un prospect puis conversion, compteurs mis a jour en direct).

**Gates executes localement** : `pnpm typecheck` OK, `pnpm lint` OK (0 erreur, 0 warning), `pnpm test` 26 tests PASS, `pnpm test:e2e` 24 tests PASS sur PostgreSQL 18 reel (dont 16 tests CRM : isolation cross-company, double conversion, decimales exactes, historique immuable), `pnpm build` OK.

## Pas encore fait (a ne jamais presenter comme fait)

- CI GitHub Actions jamais executee sur un runner reel (GitHub Actions) — uniquement verifie en local. Le job `e2e-tests` ajoute le 2026-09-21 n'a jamais tourne sur un runner : sa validite est UNVERIFIED.
- Indicateurs de la vue d'ensemble (CA, projets, budget, activite) : donnees fictives signalees par un bandeau dans l'UI, pas encore connectees a des donnees reelles. L'espace CRM, lui, n'affiche que des donnees reelles.
- CRM : pas d'edition ni de suppression des comptes/contacts, pas de pagination ni de filtres, pas de reorganisation des etapes du pipeline, pas de gestion multi-devises (un pipeline melangeant plusieurs devises est signale `MIXED` et non additionne).
- Aucun utilisateur ne peut encore etre rattache a plusieurs entreprises via l'interface : le cas est gere cote API (400 si `companyId` est requis et absent) mais non expose.
- MFA (TOTP) : colonnes DB presentes (`mfaEnabled`, `mfaSecretEnc`) mais aucune logique d'activation/verification implementee.
- Pas de rotation/expiration automatique des sessions au-dela de la duree fixe (7 jours) ; pas de refresh token.
- Audit log : le modele existe et est utilise pour `organization.bootstrap`, mais pas encore pour login/logout/echecs d'authentification.
- Service worker PWA non implemente (seul le manifest existe).
- Aucun guard de type "role systeme" (ex: empecher la suppression du dernier OWNER) — non requis a ce stade mais a anticiper.

## Prochaine etape immediate

1. Reprendre la CI distante des que la facturation GitHub est regularisee — aucun increment ne peut passer VERIFIED avant.
2. INC-03 — Estimation : Study / DQE / BPU / Pricing (depend de INC-02).
3. Completer INC-01 : MFA (TOTP), audit des echecs d'authentification, administration des roles dans l'UI.
