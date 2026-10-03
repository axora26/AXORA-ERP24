# AXORA-ERP24 — Preuves de test

Regles (`docs/foundation/05-qa-devops.md`) : un gate n'est `PASS` que s'il a ete **reellement execute** sur le SHA indique ; `NOT_RUN` n'est jamais un `PASS` ; `BLOCKED` exige une cause externe precise. Les sorties brutes completes sont conservees dans les journaux de la session de developpement ; les extraits ci-dessous en sont copies tels quels.

## Qualification courante — 3 et 4 octobre 2026

**Branche** : `feat/product-qualification`, base `54930c1462a5af4be5428c1846e66d09397e6465`.
**Révision finale de code** : `b1a6cb1a27575c4c96484c393a0099eabe99baa8`, poussée sur `feat/product-qualification` ; [PR brouillon #2](https://github.com/axora26/AXORA-ERP24/pull/2) vers `claude/funny-meitner-l317n1`.
**Environnement** : poste Windows, PostgreSQL réel sur bases isolées, API et interface locales réelles.
Les versions et mesures du conteneur de septembre, conservées plus bas, ne décrivent pas ce poste.

Ce tableau décrit les exécutions réellement obtenues pendant la qualification. Le rattachement
au SHA final est établi : aucun changement de source hors documentation depuis `b1a6cb1`.
La dernière reconstruction API et sa reprise RH/exports ont
réussi : 15/15 cas après correction du libellé PDF de paie avec politique version 0.
Les 10 PDF navigateur sont vérifiés et la nouvelle globale réussit ses 163 scénarios.
Le produit global reste `IN_PROGRESS` pour les lacunes du backlog et la CI demeure `BLOCKED`
par le verrouillage du compte GitHub pour facturation ; aucun statut global `VERIFIED`.
Les 134 scénarios historiques ne sont pas repris comme preuve actuelle.

| Contrôle | Exécution observée | Source de preuve locale |
|---|---|---|
| Migrations isolées | 41 migrations recensées ; schémas à jour sur les deux bases, données historiques préservées | `qualification-product-migrations-final.log`, `qualification-test-migrations-final.log` ; `migrate status` sort avec code 0 sur chaque base |
| Types | Réussite API, web et packages | `qualification-types-current.log` |
| Builds | Reconstructions finales API après correction du libellé PDF et web après pagination/contraste réussies | `qualification-api-export-version-zero-rebuild.log`, `qualification-web-pagination-rebuild.log` ; builds précédents également conservés |
| Lint | 0 erreur, 7 avertissements d'images | `qualification-lint-current.log` |
| Unitaires | 200 réussis : sécurité 25, web 74, API 101 | `qualification-units-current.log` |
| Unitaires web après corrections visuelles | 74/74 rejoués, compris dans les 200 | `qualification-web-print-units.log` |
| API complète | 42 fichiers, 347/347 réussis, 264,92 s | `qualification-api-final-e2e.log` |
| API après correctif historique | RH 7 et exports 5 : 12/12 réussis, 39,93 s | `qualification-api-legacy-e2e.log` |
| Première reprise API après garde d'import | Opérations RH : 9/9 réussis, 14,84 s, début le 4 octobre à 00:05:36 local | Transcript outil, session 37987 ; aucun fichier journal n'a été créé pour cette première reprise |
| API après garde d'import | RH 9 et exports 5 : **14/14 réussis**, 18,34 s, dont deux nouveaux refus COMPLETED/CANCELLED | `qualification-api-hr-exports-final.log` |
| API finale après correction du libellé PDF | RH 9 et exports 6 : **15/15 réussis**, 30,97 s ; nouveau cas de politique version 0 avec photographie présente | `qualification-hr-export-version-zero.log` |
| API qualifiée courante | **351 cas uniques qualifiés** ; reconstruction API finale réussie | 347 complets + 1 historique + 2 nouveaux cas d'import + 1 export version 0, sans cumul des relectures |
| PDF/XLSX serveur | 6/6 contrôles AppModule : permissions, isolation, cache, signatures PDF, décimales XLSX exactes et libellé de politique version 0 | `apps/api/test/exports.e2e.test.ts`, `qualification-hr-export-version-zero.log` |
| Mise en page PDF serveur et QR | Rendu A4, pagination, logo et coordonnées ; QR imprimé vérifié après rendu raster | Scripts et artefacts de QA PDF serveur de la session, décrits ci-dessous |
| Imprimés navigateur initiaux | 10 assertions métier passent mais l'inspection visuelle des 8 PDF trouve une page supplémentaire de coordonnées et un recouvrement du tableau de mise en service ; défauts corrigés et revalidés | Originaux préservés dans `qualification-browser-pdfs/initial/` avec `qa/inspection.json` et les quatre premiers rendus inspectés |
| Imprimés navigateur finaux | **10 PDF / 11 pages A4** inspectés après correction : 9 documents à 1 page, mise en service à 2 ; aucun dépassement, recouvrement ou page de pied de page seul | `qualification-browser-pdfs/qa/inspection.json`, tous les rendus `{genre}-{page}.png` ; coordonnées officielles en marge basse sur chaque page |
| Exemple de paie automatique DEMO | Préparation future de novembre 2026 pour Patrick Ilunga, DRAFT : MONTHLY_BASE version 0, photographie présente, brut automatique 4200 USD, 0 heure, aucun net ; PDF d'une page inspecté | `qualification-demo-automatic-payroll-november.log`, `export-qa/automatic-payroll-november.png`, `outputs/AXORA-demo-preparation-paie-automatique.pdf` ; exemple fictif, sans validation, clôture ou paiement |
| Dépendances | Aucune vulnérabilité connue après surcharge `exceljs>uuid: 11.1.1` | `qualification-audit-current.log`, `package.json`, `pnpm-lock.yaml` |
| Navigateur global initial | 163 scénarios dans 18 fichiers : **157 réussites, 6 échecs**, 4,5 min | `qualification-browser-final.log` ; quatre cas `auth-surfaces`, un `mfa-recovery` et un `onboarding` |
| Reprise navigateur ciblée finale | Authentification et impressions : **15/15 réussis** après corrections et disponibilité du quota d'inscription | `qualification-browser-print-final.log` ; résultat ciblé distinct de la nouvelle globale |
| Suite navigateur globale finale | **163/163 réussis**, 4,4 min, sur les derniers bundles API/web de `b1a6cb1` | `qualification-browser-final-pass.log` ; distinct du run initial 157/6 et de la reprise ciblée 15/15 |
| CI finale push et PR | **BLOCKED** avant exécution sur `b1a6cb1` : deux jobs sans runner ni étapes, autres jobs skipped ; compte verrouillé pour facturation confirmé par annotations | Push `37161782565`, PR `37161799570` ; preuves détaillées ci-dessous |
| Contrôle des espaces du candidat préparé | `git -c core.whitespace=-blank-at-eof diff --cached --check` passe ; le contrôle standard signale seulement deux lignes blanches finales dans des migrations déjà appliquées | Octets et sommes de contrôle de ces migrations conservés ; aucun résultat standard « clean » annoncé |
| Recherche de secrets dans le candidat | 249 fichiers parcourus, aucun des motifs recherchés détecté ; `.env` ignoré | Contrôle de session limité aux motifs recherchés, distinct d'un scanner de secrets ou DAST |
| Première reprise des surfaces d'accès | 4 réussites, 1 échec : contraste en thème sombre à 375 px | `qualification-browser-auth-final.log` ; run intermédiaire avant correction, suivi de la reprise finale 15/15 |

Le total API de **351 cas uniques** est 347 plus le nouveau cas de bulletin historique sans
photographie de politique, les deux nouveaux cas d'import refusé sur projets COMPLETED/CANCELLED
et la régression d'export pour une photographie présente avec la politique version 0.
Les réexécutions de 12, 9, 14 puis 15 cas apportent des preuves sur les correctifs ; elles ne produisent
pas de nouveaux cas à ajouter au total. Les suites ciblées unitaires sont également
comprises dans les 200, sans cumul des réexécutions.

Les journaux `qualification-*.log` sont conservés dans le répertoire `work/` du workspace de
qualification, hors du dépôt Git. Les preuves PDF y comprennent `render-export-fixtures.cjs`,
`verify-export-layout.py`, `verify-printed-qr.cjs` et `export-qa/`. Ce sont les noms réels des
originaux de session ; ils ne sont pas présentés comme des fichiers versionnés du dépôt.

La vérification des exports couvre les six PDF : DQE, carte de service, préparation de paie,
avoir client, avoir fournisseur et opérations du projet. Elle vérifie 401 sans session, 403
sans permission, 404 hors tenant ou hors entreprise autorisée, les grants minimaux et
`Cache-Control: private, no-store`. La carte exige `hr.card.manage`, le bulletin un salarié
appartenant à la préparation et l'avoir fournisseur aussi `finance.payable.read`. Le XLSX conserve
comme textes la quantité `123456789012.123456`, le prix, la ligne et le total de la source.
Les neuf routes d'impression navigateur sont implémentées. Leurs 10 assertions métier du
run initial passent, mais l'inspection raster initiale des huit PDF produits trouve deux défauts :
sept documents ont une seconde page ne contenant que les coordonnées ; la mise en service
coupe son tableau et le bloc blanc des coordonnées masque sa première ligne de données
sur la seconde page. L'extraction de texte sans dépassement de page ne détecte pas ce
recouvrement. La correction du pied de page et de la hauteur de page est ensuite intégrée
et reconstruite. La seconde inspection couvre les huit imprimés puis le bon de réception
et la facture : les 11 pages des 10 PDF sont rasterisées et vues, avec lignes et totaux
lisibles, logo officiel, mention DEMO et coordonnées complètes en bas de chaque page.
Le succès des exports serveur reste une preuve distincte de celle de ces imprimés.

Les bulletins pré-migration sans photographie de paramètres ne sont pas recalculés. Les nouveaux
détails de présence, d'heures normales/supplémentaires et de taux sont absents et affichés
**Non disponible (historique)** ; les montants et heures validées déjà conservés restent lisibles.
Les cotisations et impôts restent non configurés ; aucun net légal n'est calculé.

Un cas supplémentaire a été trouvé dans le PDF de paie : une photographie de paramètres
présente avec la version initiale 0 recevait à tort le libellé historique. La version 0 est
valide ; l'absence de photographie demeure le critère historique. La correction et sa
régression passent dans les 15 cas RH/exports finaux, sans reconstruction d'une politique inconnue.

### CI GitHub : constat historique vérifié et correction actuelle du workflow

Le [run 36157192308 du 25 septembre](https://github.com/axora26/AXORA-ERP24/actions/runs/36157192308)
sur `54930c1462a5af4be5428c1846e66d09397e6465` est `failure`. Le job
[lint-typecheck](https://github.com/axora26/AXORA-ERP24/actions/runs/36157192308/job/108144506522)
a `runner_id: 0`, un nom de runner vide et `steps: []`. `gh run view --log-failed` retourne
`log not found: 108144506522`. L'[annotation de GitHub](https://api.github.com/repos/axora26/AXORA-ERP24/check-runs/108144506522/annotations)
donne la cause exacte : « The job was not started because your account is locked due to a billing issue. »
Les jobs dépendants sont `skipped`. La notice de migration future d'Ubuntu n'est pas l'échec causal.

Le [workflow de ce commit](https://github.com/axora26/AXORA-ERP24/blob/54930c1462a5af4be5428c1846e66d09397e6465/.github/workflows/ci.yml#L3-L8)
n'autorisait que les bases de PR `main` et `feat/**`, donc excluait une PR ciblant
`claude/funny-meitner-l317n1`. Le workflow courant ajoute explicitement cette base et une clé
`SERVICE_CARD_ENCRYPTION_KEY` éphémère dans les jobs API et navigateur. Les pushes `feat/**`
étaient déjà autorisés. Aucun résultat distant actuel ni levée du blocage du compte n'est déduit
du run historique. Les nouveaux runs ci-dessous apportent maintenant une preuve directe
sur la révision finale.

Sur `b1a6cb1a27575c4c96484c393a0099eabe99baa8`, les runs
[push 37161782565](https://github.com/axora26/AXORA-ERP24/actions/runs/37161782565) et
[PR 37161799570](https://github.com/axora26/AXORA-ERP24/actions/runs/37161799570) terminent
en échec avant exécution. Dans le run PR, `dependency-audit` (`111316601919`) et
`lint-typecheck` (`111316602152`) ont `runner_id: 0`, `runner_name: ""`, `steps: []` ;
unitaires, API, build et navigateur sont skipped. Leurs annotations confirment encore :
**« The job was not started because your account is locked due to a billing issue. »**
La notice Ubuntu est distincte et n'explique pas ce blocage. Originaux lus en lecture seule :
`qualification-ci-pr-b1.json`, `qualification-ci-pr-b1-audit-annotations.json`,
`qualification-ci-pr-b1-lint-annotations.json`. Aucun réglage de facturation ni relance
de CI n'a été effectué pour cette inspection.

Le job navigateur définit aussi `REGISTRATION_LIMIT: "100"` pour sa base CI éphémère,
qui reçoit le seed et les organisations créées par ses scénarios. Le service garde la limite
par défaut de 5 inscriptions ; les reprises locales attendent la fenêtre de quota sans
réinitialisation des données ou affaiblissement du réglage local.

## Archive — qualification du 25 septembre 2026

Toutes les versions, résultats, mesures et limites de la section suivante sont historiques.
Ils sont conservés pour leurs révisions `c81196e` et `6c2b576`, et ne qualifient pas les ajouts d'octobre.

### Environnement d'execution historique

| Element | Version |
|---|---|
| Systeme | Linux 6.18 (conteneur de developpement) |
| Node.js / pnpm | v22.22.2 / 9.15.9 |
| PostgreSQL | 16.13 (serveur local reel, aucune base simulee) |
| Navigateur | Chromium 141.0.7390.37, pilote par Playwright 1.63.0 |
| Tests unitaires / integration | Vitest |

### Execution A — SHA `c81196e` (code INC-24)

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

### Execution B — arbre final (commit `6c2b576`)

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

### Installation neuve reproductible (migrations + jeu DEMO)

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

### Build de production (PWA, en-tetes, installabilite)

Build `NEXT_DIST_DIR=.next-pwa next build` servi par `next start -p 3200`, API reelle en arriere-plan.

- En-tetes interface (`curl -sI /login`) : `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Permissions-Policy: camera=(self), geolocation=(self), microphone=(), payment=(), usb=()`, `Content-Security-Policy: default-src 'self'; … frame-ancestors 'none'; … object-src 'none'`, aucun `X-Powered-By`.
- En-tetes API (`curl -sI /api/v1/auth/context`) : `nosniff`, `DENY`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`.
- Installabilite (Chromium, protocole DevTools `Page.getInstallabilityErrors`, profil persistant) : `[]`.
- Parcours hors ligne (script Playwright, avant la suite versionnee) : `swControlled: true`, rechargement sans reseau avec 6 reserves affichees, saisie en file « 1 en attente » puis synchronisee au retour du reseau et retrouvee sur le serveur, `apiInCache: []`, `cspViolations: []`, stockage local vide et cache des pages reduit a `/login` apres deconnexion. Ce parcours (hors saisie) est desormais couvert par `pwa.spec.ts`.

### Performance (mesures reelles, mono-utilisateur)

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

### CI distante historique — `BLOCKED`

| Run | SHA | Resultat |
|---|---|---|
| 3 a 28 | branches `feat/foundation` puis `claude/funny-meitner-l317n1` | echec en ~2–4 s sans journal |
| 29 ([36136229125](https://github.com/axora26/AXORA-ERP24/actions/runs/36136229125)) | `c81196e` | job `lint-typecheck` : `conclusion: failure`, 3 s, `runner_id: 0`, `runner_name: ""`, aucune etape ; jobs dependants `skipped` |

Aucun runner n'est attribue aux jobs : cause externe au depot (facturation ou quota du compte GitHub). Tant qu'un run n'aboutit pas, aucun module ne peut etre promu `VERIFIED`.

### Gates non executes dans cette qualification historique

| Gate | Statut | Raison |
|---|---|---|
| Emballages natifs MSIX / AAB / iOS | `BLOCKED` | certificat de signature, SDK Android, compte Apple Developer et macOS absents |
| Firefox / Safari | `NOT_RUN` | seul Chromium est installe dans l'environnement |
| Revue clavier manuelle complete | `NOT_RUN` | verification ponctuelle seulement (palette Ctrl K, formulaires, zones defilantes) |
| DAST / detection de secrets | `NOT_RUN` | aucun outil disponible dans l'environnement |
| Test de charge | `NOT_RUN` | hors perimetre local ; mesures mono-utilisateur uniquement |
| Connecteurs externes (SMTP, SMS, S3, banque, LLM, BACnet, Modbus, KNX, MQTT, Revit, GPS, biometrie) | `NOT_TESTED` | aucun systeme ou equipement reel joignable |
