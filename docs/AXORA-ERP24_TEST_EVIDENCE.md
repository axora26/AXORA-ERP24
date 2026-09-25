# AXORA-ERP24 — Preuves de test

Regles (`docs/foundation/05-qa-devops.md`) : un gate n'est `PASS` que s'il a ete **reellement execute** sur le SHA indique ; `NOT_RUN` n'est jamais un `PASS` ; `BLOCKED` exige une cause externe precise. Les sorties brutes completes sont conservees dans les journaux de la session de developpement ; les extraits ci-dessous en sont copies tels quels.

## Environnement d'execution

| Element | Version |
|---|---|
| Systeme | Linux 6.18 (conteneur de developpement) |
| Node.js / pnpm | v22.22.2 / 9.15.9 |
| PostgreSQL | 16.13 (serveur local reel, aucune base simulee) |
| Navigateur | Chromium 141.0.7390.37, pilote par Playwright 1.63.0 |
| Tests unitaires / integration | Vitest |

## Execution A — SHA `c81196e` (code INC-24)

2026-09-25, 12:44:05 → 12:49:17 UTC, arbre de travail propre au demarrage.

| Gate | Commande | Resultat | Extrait de sortie |
|---|---|---|---|
| Schema | `pnpm db:validate` | `PASS` (rc 0, 3 s) | `The schemas at prisma are valid` |
| Typage | `pnpm typecheck` | `PASS` (rc 0, 9 s) | 6 projets `Done`, aucune erreur |
| Lint | `pnpm lint` | `PASS` (rc 0, 9 s) | `✔ No ESLint warnings or errors` |
| Unitaires | `pnpm test` | `PASS` (rc 0, 13 s) | securite `Tests 20 passed (20)` · web `Tests 39 passed (39)` · API `Tests 77 passed (77)` → **136** |
| Integration / API (PostgreSQL reel) | `pnpm test:e2e` | `PASS` (rc 0, 251 s) | `Test Files 31 passed (31)` · `Tests 248 passed (248)` |
| Build API | `cd apps/api && npx nest build` | `PASS` (rc 0) | — |
| Build web | `cd apps/web && NEXT_DIST_DIR=.next-verify npx next build` | voir note | rc 1 : `Cannot find module '@playwright/test'` |
| Dependances | `pnpm audit --prod` | `PASS` (rc 0) | `No known vulnerabilities found` |

Note sur le build web de l'execution A : l'echec provient de fichiers **non commites** ajoutes pendant l'execution (suite navigateur en cours d'ecriture, dependance pas encore installee), inclus par le `tsconfig` du web. Il ne concerne pas le code de `c81196e` ; le build web est rejoue sur l'arbre final (execution B).

## Execution B — arbre final (commit `6c2b576`)

2026-09-25, 13:09:59 → 13:29:22 UTC. Code identique au commit `6c2b576` (suite navigateur, deux correctifs d'accessibilite, job CI) : pendant l'execution, seule de la documentation (`README.md`, `docs/`) a ete modifiee — verifie par `git diff --stat 6c2b576 -- . ':!docs'` vide apres commit.

| Gate | Commande | Resultat | Extrait de sortie |
|---|---|---|---|
| Schema | `pnpm db:validate` | `PASS` (rc 0, 3 s) | `The schemas at prisma are valid` |
| Typage | `pnpm typecheck` | `PASS` (rc 0, 10 s) | 6 projets `Done` (dont la suite navigateur), aucune erreur |
| Lint | `pnpm lint` | `PASS` (rc 0, 9 s) | `✔ No ESLint warnings or errors` |
| Unitaires | `pnpm test` | `PASS` (rc 0, 13 s) | securite `Tests 20 passed (20)` · web `Tests 39 passed (39)` · API `Tests 77 passed (77)` → **136** |
| Build web | `cd apps/web && NEXT_DIST_DIR=.next-verify npx next build` | `PASS` (rc 0, 46 s) | compilation et verification de types OK |
| Navigateur — build de production | `E2E_BASE_URL=http://localhost:3200 pnpm test:browser` | `PASS` (rc 0, 205 s) | `134 passed (3.4m)` · rapport JSON : `expected 134, skipped 0, unexpected 0, flaky 0` |
| Navigateur — serveur de developpement | `pnpm test:browser` (http://localhost:3100) | `PASS` (rc 0, 605 s) | `133 passed (10.0m)`, `1 skipped` : parcours service worker, ignore hors build de production (comportement prevu) |
| Dependances | `pnpm audit --prod` | `PASS` (rc 0) | `No known vulnerabilities found` |
| Integration / API (PostgreSQL reel) | `pnpm test:e2e` | `PASS` (rc 0, 255 s) | `Test Files 31 passed (31)` · `Tests 248 passed (248)` |

Le code de l'API et du schema est identique entre `c81196e` et `6c2b576` (`git diff --stat c81196e 6c2b576 -- apps/api packages` : vide) ; la suite d'integration a neanmoins ete rejouee sur l'arbre final (ligne « Integration / API » ci-dessus).

### Suite navigateur (`apps/web/e2e`, Playwright)

| Fichier | Contenu | Tests |
|---|---|---|
| `auth.setup.ts` | connexion du compte DEMO, session partagee | 1 |
| `screens.spec.ts` | 30 ecrans : titre affiche, aucune exception JS, aucune erreur console, aucune reponse API 5xx | 30 |
| `accessibility.spec.ts` | axe-core WCAG 2.0/2.1 A et AA : `/login`, `/offline`, `/portal/login`, `/login` a 390 px et les 30 ecrans | 34 |
| `responsive.spec.ts` | aucun defilement horizontal a 390 px et 768 px sur les 30 ecrans | 60 |
| `pwa.spec.ts` | manifeste installable, `/sw.js` jamais mis en cache ; sur build de production : rechargement hors ligne du chantier, aucune reponse `/api/*` en cache, purge a la deconnexion, aucune violation CSP | 2 |
| `security.spec.ts` | redirection sans session (4 ecrans), 401 en francais et `no-store` sur l'API, en-tetes de l'interface, identifiants errones | 7 |

Anomalies trouvees par la suite puis corrigees (avant l'execution B) :

1. `/crm` — `scrollable-region-focusable` (serieux) : la frise du pipeline defile horizontalement a 1280 px sans etre atteignable au clavier → zone nommee, focalisable, contour de focus visible.
2. `/offline` (et ecran de chargement, marque mobile de la connexion) — `color-contrast` (serieux) : la marque concue pour le fond sombre (`#7aa5ff`) etait posee sur fond blanc → variante sur fond clair (`#1e4fbf`, contraste AA).

## Installation neuve reproductible (migrations + jeu DEMO)

2026-09-25, 12:41–12:43 UTC, sur une **base distincte creee pour l'occasion** (`axora_erp24_fresh`) ; la base de developpement n'a pas ete touchee (la reinitialisation de la base existante est une operation destructive non autorisee).

```text
$ psql -c 'CREATE DATABASE axora_erp24_fresh OWNER axora'
CREATE DATABASE
$ DATABASE_URL=…/axora_erp24_fresh npx prisma migrate deploy
31 migrations found in prisma/migrations
All migrations have been successfully applied.
$ DATABASE_URL=…/axora_erp24_fresh API_PORT=4100 node apps/api/dist/main.js
AXORA-ERP24 API demarree sur le port 4100
$ API_URL=http://localhost:4100/api/v1 DATABASE_URL=…/axora_erp24_fresh pnpm demo:seed     (21,3 s, rc 0)
Organisation DEMO creee : axora-demo
  + Administration (rôles et comptes) : cree
  + Commercial (CRM, Études, Devis, Contrat) : cree
  … (23 etapes, toutes « cree »)
    API publique : projets 200, analytique 200, factures fournisseurs 403 (permission non accordée)
    webhook entrant : 1er envoi 201, rejeu 200 (idempotent)
  + API publique & intégrations (clé, appels réels, webhook signé) : cree
$ POST /api/v1/auth/login (demo@axora-erp24.local) → 201
$ select … → migrations 31 | organisations 1 | utilisateurs 4 | lignes d'audit 471
```

## Build de production (PWA, en-tetes, installabilite)

Build `NEXT_DIST_DIR=.next-pwa next build` servi par `next start -p 3200`, API reelle en arriere-plan.

- En-tetes interface (`curl -sI /login`) : `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Permissions-Policy: camera=(self), geolocation=(self), microphone=(), payment=(), usb=()`, `Content-Security-Policy: default-src 'self'; … frame-ancestors 'none'; … object-src 'none'`, aucun `X-Powered-By`.
- En-tetes API (`curl -sI /api/v1/auth/context`) : `nosniff`, `DENY`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`.
- Installabilite (Chromium, protocole DevTools `Page.getInstallabilityErrors`, profil persistant) : `[]`.
- Parcours hors ligne (script Playwright, avant la suite versionnee) : `swControlled: true`, rechargement sans reseau avec 6 reserves affichees, saisie en file « 1 en attente » puis synchronisee au retour du reseau et retrouvee sur le serveur, `apiInCache: []`, `cspViolations: []`, stockage local vide et cache des pages reduit a `/login` apres deconnexion. Ce parcours (hors saisie) est desormais couvert par `pwa.spec.ts`.

## Performance (mesures reelles, mono-utilisateur)

API de developpement, compte DEMO, 30 appels par route (millisecondes) :

| Route | p50 | p95 | max |
|---|---|---|---|
| `GET /auth/context` | 8,2 | 10,2 | 11,9 |
| `GET /dashboard/overview` | 23,6 | 28,2 | 31,9 |
| `GET /projects` | 13,7 | 16,0 | 16,2 |
| `GET /finance/summary` | 12,8 | 15,1 | 17,5 |
| `GET /procurement/requests` | 14,9 | 17,9 | 28,6 |
| `GET /qhse/summary` | 11,0 | 12,6 | 12,8 |
| `GET /assets/summary` | 11,9 | 14,8 | 14,9 |
| `GET /workflow/summary` | 10,0 | 12,0 | 15,7 |
| `GET /analytics/series/finance.invoiced` | 10,0 | 14,3 | 18,1 |
| `GET /analytics/series/energy.balance` | 38,6 | 43,6 | 44,6 |
| `POST /copilot/ask` | 39,6 | 45,6 | 50,7 |
| `GET /notifications` | 4,9 | 6,5 | 6,8 |

Interface (build de production, Chromium, Navigation Timing) :

| Page | TTFB | DOMContentLoaded | load | transfere |
|---|---|---|---|---|
| `/login` (1re visite, cache vide) | 5 ms | 33 ms | 123 ms | 239 Ko |
| `/` | 12 ms | 39 ms | 81 ms | 12 Ko |
| `/projects` | 8 ms | 20 ms | 40 ms | 11 Ko |
| `/finance` | 8 ms | 20 ms | 36 ms | 16 Ko |
| `/field` | 11 ms | 28 ms | 43 ms | 19 Ko |
| `/analytics` | 9 ms | 24 ms | 37 ms | 23 Ko |

Limite : mesures locales mono-utilisateur, sans test de charge ; aucun seuil n'est encore fixe par le backlog (`05-qa-devops` §11).

## CI distante — `BLOCKED`

| Run | SHA | Resultat |
|---|---|---|
| 3 a 28 | branches `feat/foundation` puis `claude/funny-meitner-l317n1` | echec en ~2–4 s sans journal |
| 29 ([36136229125](https://github.com/axora26/AXORA-ERP24/actions/runs/36136229125)) | `c81196e` | job `lint-typecheck` : `conclusion: failure`, 3 s, `runner_id: 0`, `runner_name: ""`, aucune etape ; jobs dependants `skipped` |

Aucun runner n'est attribue aux jobs : cause externe au depot (facturation ou quota du compte GitHub). Tant qu'un run n'aboutit pas, aucun module ne peut etre promu `VERIFIED`.

## Gates non executes

| Gate | Statut | Raison |
|---|---|---|
| Emballages natifs MSIX / AAB / iOS | `BLOCKED` | certificat de signature, SDK Android, compte Apple Developer et macOS absents |
| Firefox / Safari | `NOT_RUN` | seul Chromium est installe dans l'environnement |
| Revue clavier manuelle complete | `NOT_RUN` | verification ponctuelle seulement (palette Ctrl K, formulaires, zones defilantes) |
| DAST / detection de secrets | `NOT_RUN` | aucun outil disponible dans l'environnement |
| Test de charge | `NOT_RUN` | hors perimetre local ; mesures mono-utilisateur uniquement |
| Connecteurs externes (SMTP, SMS, S3, banque, LLM, BACnet, Modbus, KNX, MQTT, Revit, GPS, biometrie) | `NOT_TESTED` | aucun systeme ou equipement reel joignable |
