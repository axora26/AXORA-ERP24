# AXORA-ERP24 — Stratégie QA / DevOps (rapport AXORA-ERP24-QA-DEVOPS)

**Rôle** : AXORA-ERP24-QA-DEVOPS
**Mandat** : `AXORA-ERP24.txt` (prompt maître, 1715 lignes, lu intégralement ; produit nommé `AX-A360` dans le texte source — substitution de nom uniquement)
**Référence technique en lecture seule (non modifiée)** : `C:/Users/dmgpe/AX-ERP360-source-readonly` — `.github/workflows/*.yml` (10 workflows), `docker-compose.yml` / `docker-compose.edge.yml` / `docker-compose.production.yml`, `package.json` (pnpm workspace, scripts `check`/`test`/`db:*`), `ops/*.ps1` (backup, restore, déploiement, preuves de release)
**Rapports amont déjà produits et pris en compte pour cohérence** : `architecture.md` (stack, monorepo, 12 phases verticales), `domain-model.md` (24 bounded contexts, invariants), `security.md` (authn/authz/audit/CSRF/secrets, checklist de tests d'isolation §14), `product-backlog.md` (vocabulaire de maturité, matrice M01–M26, backlog INC-00→INC-24, parcours E2E §5, Definition of Done §7)
**État constaté du workspace au moment de la rédaction** : `E:/AXORA ADM/AXORA_ERP24` ne contient aucun code (`.git`, `.gitignore`, `.hermes/`, le prompt, et les 4 rapports amont). **Aucune commande n'a été exécutée sur un projet réel** : ce document est une **spécification exécutable** (scripts, workflows, gates) à mettre en place au fil des incréments, pas un compte-rendu d'exécution. Aucune affirmation `PASS`/`VERIFIED`/`DEPLOYED` n'est faite ici — seul le prompt et les rapports amont sont vérifiés comme lus.
**Périmètre** : conception uniquement. Aucun fichier créé hors ce rapport, aucun fichier d'ERP3602 touché, aucune question posée à l'utilisateur.

---

## 0. Principe directeur

Le prompt maître interdit tout faux `PASS` (§46) et exige des preuves d'exécution réelles (§43, §50, §56). Le backlog produit (`product-backlog.md` §2) définit déjà un vocabulaire de maturité par **module** (`NOT_STARTED` → `FOUNDATION` → `IN_PROGRESS` → `IMPLEMENTED_NOT_VERIFIED` → `VERIFIED` / `BLOCKED` / `NOT_TESTED`). Ce rapport ajoute la couche complémentaire : un vocabulaire de maturité par **gate de contrôle qualité** (lint, tests, sécurité, build, etc.), tel que demandé explicitement pour ce mandat :

| Statut de gate | Signification | Condition d'attribution |
|---|---|---|
| `PASS` | Le contrôle a été **réellement exécuté** sur le SHA courant et a réussi | Sortie de commande/CI archivée (log, run ID, rapport JUnit/JSON) |
| `PARTIAL` | Le contrôle a tourné mais couvre un périmètre incomplet, ou a réussi avec des exceptions documentées (ex. flaky isolé, périmètre réduit temporaire) | Écart documenté dans `docs/AXORA-ERP24_TEST_EVIDENCE.md` avec justification |
| `FAIL` | Le contrôle a été exécuté et a échoué | Boucle de correction du prompt §47 déclenchée immédiatement |
| `NOT_RUN` | Le contrôle existe (script/job écrit) mais n'a **pas encore été exécuté** sur ce SHA | Ne jamais confondre avec `PASS` — statut par défaut de tout gate non déclenché |
| `BLOCKED` | Le contrôle ne peut pas être exécuté pour une cause externe légitime (prompt §3/§8 backlog) : matériel absent (Revit, BMS, biométrie), secret/licence absent, décision commerciale/juridique | Documenté avec la cause précise, jamais contourné par une simulation |

**Correspondance explicite avec le vocabulaire module du backlog** : un gate `PASS` sur tous les contrôles requis d'un incrément est la **condition nécessaire mais non suffisante** pour que ce module passe de `IMPLEMENTED_NOT_VERIFIED` à `VERIFIED` (`product-backlog.md` §2) — la promotion `VERIFIED` exige en plus le numéro de run CI + SHA exact, comme déjà précisé dans le backlog. `NOT_RUN` sur un gate obligatoire bloque toute promotion à `VERIFIED`, quel que soit l'état apparent de l'interface (prompt §45 : « une page affichée n'est pas une fonctionnalité terminée »). Un `NOT_TESTED` de module (backlog) provient toujours d'au moins un gate `BLOCKED` ou `NOT_RUN` documenté ici — jamais d'un gate simulé.

Toute déclaration de gate est stockée sous forme de preuve dans `docs/AXORA-ERP24_TEST_EVIDENCE.md` (créé au prompt §48, alimenté par ce document) : SHA, commande exacte exécutée, horodatage, résultat brut (extrait de sortie ou lien d'artefact CI), pas une simple ligne de statut sans preuve jointe.

---

## 1. Constat technique repris d'ERP3602 (référence de faisabilité, lecture seule)

Confirmé par inspection directe de `C:/Users/dmgpe/AX-ERP360-source-readonly` :

- **Monorepo pnpm** (`pnpm@11.4.0`, Node `>=24.0.0 <25`), scripts racine `check` = `db:format && db:validate && typecheck && lint && test` — pattern de gate local **agrégé en une commande**, à reprendre pour AXORA-ERP24.
- **CI GitHub Actions** (`ci.yml`) : service PostgreSQL 18 en conteneur, `pnpm install --frozen-lockfile`, vérification d'arbre Git propre, génération/vérification de **provenance de release** (`ops/new-release-provenance.ps1`) dès la CI (pas seulement au packaging), Prisma format/validate/generate, build des packages partagés, migrations réelles (`db:migrate:deploy`), seed CI, typecheck, lint, **~50 suites E2E API** (`tsx test/*.e2e.ts` par domaine), tests navigateur ciblés (`test:browser:*`), démarrage réel de l'API et du Web avec polling de santé avant tests E2E, upload d'artefact de provenance, logs de runtime dumpés en cas d'échec.
- **`docker-smoke.yml`** : validation de syntaxe Compose (`docker compose config`), validation PowerShell statique des scripts d'exploitation (`ops/*.ps1`), montée réelle de la stack complète (`docker compose up -d --build`), attente de santé API/Web/Postgres, **smoke test backup/restore isolé**, **smoke test de persistance au redémarrage**, arrêt propre avec suppression des volumes.
- **`security-release.yml`** : `pnpm audit --prod --audit-level=high` sur chaque PR/push — gate minimal mais réel, à étendre.
- **Autres workflows constatés** (noms) : `access-control-gate.yml`, `windows-desktop-complete.yml`, `inventory-e2e-diagnostic.yml`, `n0c-artifact*.yml`, `n0c-premium-rc.yml`, `zx-s504-validation-kit.yml` — non ouverts en détail ici (hors du périmètre direct QA/DevOps générique), mais leur existence confirme une pratique déjà mature de gates spécialisés par domaine à risque (accès, packaging Windows, diagnostics d'un module).
- **Docker** : trois fichiers Compose (`dev`, `edge`, `production`) avec `depends_on: condition: service_healthy`, healthchecks `pg_isready` / requêtes HTTP internes, volumes nommés, variables d'environnement paramétrées (`AXORA_*`), labels de release SHA (`com.axora.release.sha`) et rotation de logs (`max-size`/`max-file`) en production — patterns directement réutilisables.
- **Packaging** : installeur Windows auto-portant (`desktop/windows/`, hors périmètre de lecture détaillée ici), scripts PowerShell d'exploitation production (`backup-postgres`, `restore-postgres-test`, `prune-backups`, `preflight-production`, `deploy-production`, `rollback-production`, `production-readiness`, `production-host-readiness`, `replicate-backup`, `new-production-intake`, `finalize-production-evidence`) — un cycle de vie de release complet et vérifiable existe déjà comme référence.

**Différences volontaires pour AXORA-ERP24** (cohérentes avec `architecture.md` §3/§7) :
- Ajout d'un **process worker** (`apps/worker`) absent d'ERP3602 → nécessite ses propres gates (tests d'idempotence de jobs, tests de reprise après crash de la queue).
- Ajout **PWA** dès la phase 1 → gate Lighthouse/axe-core absent d'ERP3602.
- Ajout **mobile Capacitor** (Android prioritaire, iOS best-effort) → gate de build mobile absent d'ERP3602.
- Scoping tenant à 3 niveaux (Organisation→Société→**Projet**, nouveau) → tests d'isolation étendus vs. ERP3602 (`security.md` §14).
- Reverse-proxy standard (pas de contournement CORS type ADR-007) → un test de non-régression CORS/Origin est ajouté au gate sécurité.

Aucune commande n'a été exécutée dans ce dépôt de référence dans le cadre de ce rapport (lecture seule stricte, conforme au mandat).

---

## 2. Pyramide de tests — définition par niveau, alignée sur les phases verticales

Reprend la pyramide imposée par le prompt (§43) et les 12 phases de `architecture.md` §8. Chaque niveau est **exécutable localement** (pas seulement en CI) via les scripts pnpm du §6.

### 2.1 Lint / Format / Typecheck (gate 0 — bloquant, < 2 min)
- ESLint (config stricte, règle `boundaries` dédiée pour les frontières de module — `architecture.md` §4.2 : un module métier ne peut importer que la façade publique `*.public-api.ts` d'un autre module, jamais son `*.service.ts`/`*.repository.ts` interne).
- Prettier (format imposé, vérifié en CI, jamais reformattage silencieux en pré-commit sans contrôle).
- TypeScript strict (`strict: true`, `noUncheckedIndexedAccess`, pas de `any` implicite) sur `apps/*` et `packages/*`.
- Prisma `format` + `validate` sur le schéma modulaire.
- Commande locale : `pnpm check:fast` (lint + typecheck + prisma validate, sans tests).

### 2.2 Tests unitaires (gate 1 — par package/module, < 5 min)
- Portée : logique pure (calculs DQE/BOQ Decimal exact, formules MEP §20, moteur de permissions `mergePermissions`, moteur de règles workflow, adaptateurs de parsing IFC, calculs MTBF/MTTR).
- Exigence non négociable héritée du domaine (`domain-model.md` §5) : **aucune assertion sur un flottant binaire** pour une valeur monétaire/quantité — tests dédiés à l'arithmétique décimale exacte (cas limites d'arrondi, devises multiples).
- Chaque formule d'ingénierie MEP (`BC-13`) a un test avec un jeu de données de référence documenté et sa source (prompt §20 : jamais de calcul « validé » sans donnée/formule vérifiable) — un test manquant pour une formule = la formule reste `NOT_STARTED`, jamais présumée correcte.
- Outillage : Vitest (rapide, ESM natif, cohérent Next.js/NestJS modernes) ou Jest si contrainte d'écosystème NestJS l'impose — **décision à confirmer en Phase 0 par un spike technique** (cohérent avec le point ouvert d'`architecture.md` §9), pas figée arbitrairement ici.
- Commande locale : `pnpm test:unit` (par workspace, parallélisé).

### 2.3 Tests d'intégration (gate 2 — avec base PostgreSQL réelle, < 10 min)
- Portée : repositories Prisma contre une vraie base (jamais un mock d'ORM pour les invariants de contrainte — les gardes-fous PostgreSQL de `security.md` §4.3/§7.1 ne peuvent être vérifiés que contre un moteur réel).
- **Tests de garde-fous base de données obligatoires** (repris de `security.md` §14.5) :
  - tentative directe d'`UPDATE`/`DELETE` sur `AuditLog` → doit être rejetée par le déclencheur PostgreSQL ;
  - tentative d'incohérence de scoping (société d'une autre organisation assignée à une session, projet d'une autre société) → rejetée par contrainte/déclencheur, état inchangé après échec ;
  - contrainte `@@unique([id, organizationId])` sur toute relation parent/enfant de tenancy → une jointure cross-tenant doit être structurellement impossible, testée par tentative explicite.
- Tests de migration (gate dédié, §2.6) exécutés dans le même environnement.
- Commande locale : `pnpm test:integration` (nécessite `docker compose -f docker-compose.dev.yml up -d postgres` au préalable, cf. §5).

### 2.4 Tests API / contrats (gate 3 — serveur démarré, < 15 min)
- Un fichier `test/<domaine>.e2e.ts` par bounded context (`domain-model.md` §4), sur le modèle ERP3602 déjà éprouvé (~50 fichiers `*.e2e.ts` observés) — convention reprise : un fichier par BC, exécuté via `tsx`, contre une API réellement démarrée (pas de mock HTTP).
- **Tests RBAC obligatoires par permission sensible** (`security.md` §14.2) : un test positif (rôle habilité réussit) + un test négatif (rôle non habilité refusé explicitement) — jamais un seul sens testé.
- **Tests d'isolation tenant obligatoires** (`security.md` §14.1) : accès cross-organisation, cross-société, cross-projet, chacun avec assertion explicite « non trouvé » (jamais « accès refusé » qui confirmerait l'existence — cf. invariant §4.2 du modèle de domaine).
- **Tests de non-double-traitement** : idempotence sur commande/réception (BC-05), anti-double-paiement (BC-07), idempotence de webhook entrant (BC-24), idempotence de resynchronisation offline (BC-09) — chaque invariant listé dans `domain-model.md` a un test correspondant, pas une confiance implicite dans le code.
- Commande locale : `pnpm --filter @axora/api test:e2e` (le serveur est démarré par le script, healthcheck `/api/v1/health/ready` avant tir des tests — pattern ERP3602 `ci.yml` repris à l'identique).

### 2.5 Tests E2E navigateur (gate 4 — Playwright, < 20 min)
- Un test E2E automatisé par **parcours prioritaire** du prompt §44 / `product-backlog.md` §5 (10 parcours : Commercial, Projet, Achats, Stock, Finance, RH, Chantier, QHSE, Commissioning, Maintenance), exécuté contre le build de production réel (Web + API démarrés), pas contre un environnement de développement à chaud.
- Outillage : Playwright (multi-navigateur, traces/vidéos à l'échec, exécutable localement et en CI headless).
- Chaque test de parcours vérifie **la chaîne complète serveur** (pas seulement le rendu) : ex. Devis → Contrat vérifie qu'un contrat ne peut être créé que depuis un devis `ACCEPTED` (tentative de contournement testée en négatif également).
- Commande locale : `pnpm --filter @axora/web test:e2e` (Playwright, `--project=chromium` par défaut, matrice complète en CI nocturne).

### 2.6 Tests de migration (gate 5 — bloquant tout merge touchant le schéma)
- Rejeu complet des migrations sur une base vierge (`prisma migrate deploy` contre un conteneur PostgreSQL neuf) avant tout merge — pattern déjà en place chez ERP3602 (`architecture.md` §5.1), repris à l'identique.
- Test de **migration descendante non destructive documentée** : toute migration qui modifie une colonne existante doit avoir un plan de rollback documenté dans `docs/AXORA-ERP24_DECISIONS.md`, vérifié par relecture (pas d'automatisation destructive de rollback en prod sans validation humaine explicite — cohérent avec l'interdiction §4 du prompt).
- Test de **seed DEMO isolé** : le jeu de données `DEMO` (prompt §42) se charge sur une base migrée sans erreur et reste identifiable (`isDemo=true` propagé), jamais mélangé à un jeu de production.
- Commande locale : `pnpm db:migrate:test` (nouvelle base éphémère → migrate deploy → validate schema drift = 0 → seed demo → assert isDemo).

### 2.7 Tests d'accessibilité (gate 6 — axe-core + revue clavier manuelle)
- Audit automatisé `axe-core` (via Playwright `@axe-core/playwright`) sur chaque page/état partagé du Design System (`ux-design-system.md` §4.5 : `EmptyState`, `LoadingState`, `ErrorState`, `PermissionDeniedState`, `PrerequisiteState`, `ContextRequiredState`) et sur les 10 parcours E2E — seuil : zéro violation `critical`/`serious` pour promotion `VERIFIED`, violations `moderate` documentées si non bloquantes.
- Contraste AA vérifié programmatiquement en clair **et** en sombre séparément (jamais un seul test supposé valable pour les deux thèmes — `ux-design-system.md` §8).
- Revue clavier manuelle obligatoire pour la Command Palette, la Sidebar, les modales/drawers (piège de focus, restitution de focus à la fermeture) — checklist documentée, non automatisable entièrement, exécutée et journalisée par un humain ou un agent avec preuve (capture + note), jamais déclarée sans preuve.
- Commande locale : `pnpm --filter @axora/web test:a11y`.

### 2.8 Tests responsive (gate 7 — Playwright multi-viewport)
- Matrice de viewports imposée par `ux-design-system.md` §7.1 : 375px (smartphone), 480–767px, 768–1023px (tablette), 1024–1439px (laptop), ≥1440px (grand écran) — captures + assertions structurelles (pas de défilement horizontal forcé sur une table métier critique, fallback carte sous 640px vérifié par sélection DOM, pas seulement visuel).
- Test dédié Field (`ux-design-system.md` §7.3) : formulaires une colonne, boutons ≥44px, bandeau hors-ligne visible en mode réseau coupé (simulation Playwright `context.setOffline(true)`).
- Commande locale : `pnpm --filter @axora/web test:responsive`.

### 2.9 Tests de sécurité applicative (gate 8 — dédié, distinct de l'audit de dépendances)
- **Suite d'isolation complète** reprenant `security.md` §14.1–§14.5 comme spécification de tests (pas de nouvelle invention) : tenant/société/projet, RBAC positif/négatif, sessions (cookie interne ≠ cookie portail, révocation immédiate, anti-rejeu MFA/récupération), fichiers (ID deviné sans droit → refus), garde-fous base de données.
- **Scan de dépendances** : `pnpm audit --prod --audit-level=high` (repris tel quel d'ERP3602) + génération SBOM (`cyclonedx` ou équivalent disponible dans l'environnement) archivé par run.
- **Scan de secrets** : détection de secret committé (ex. `gitleaks` ou équivalent disponible) sur chaque PR — absent d'ERP3602 constaté, ajouté comme renforcement explicite (`architecture.md` §7).
- **Vérification des en-têtes de sécurité** (`security.md` §8.3) : test HTTP automatisé vérifiant présence de `Strict-Transport-Security`, `X-Content-Type-Options`, CSP stricte, absence de `Access-Control-Allow-Origin: *` combiné à credentials.
- **Test de non-régression CORS/Origin** (spécifique AXORA-ERP24, cf. §1) : vérifie qu'aucune requête cross-origin non whitelistée n'est acceptée — garde contre la reproduction du contournement ADR-007 d'ERP3602.
- Commande locale : `pnpm test:security` (suite dédiée, ne remplace pas les tests RBAC de §2.4 qui restent dans les E2E API par domaine).

### 2.10 Tests de build et de packaging (gate 9)
- Build complet de tous les workspaces (`pnpm -r build`), zéro erreur TypeScript, zéro warning bloquant configuré (prompt §53 : pas de warning sérieux ignoré).
- Build PWA : manifest valide, service worker généré, audit Lighthouse PWA (installable, offline app-shell) avec seuil minimal documenté (ex. score PWA ≥ 90 pour `VERIFIED`, en dessous = `PARTIAL` documenté avec écart).
- Build mobile Capacitor (Android) : `cap build android` réussit localement si le SDK Android est disponible dans l'environnement ; sinon statut `BLOCKED` explicite (absence de SDK = dépendance externe légitime, prompt §3).
- Build iOS : architecture compatible testée par `cap build ios` **si** un environnement macOS/Xcode est disponible ; sinon `BLOCKED` documenté (signature/certificat Apple absent = blocage légitime explicite prompt §38, jamais contourné).
- Build Docker : `docker build` de chaque image (api, web, worker) sans erreur, taille d'image mesurée (pas seulement supposée raisonnable).
- Commande locale : `pnpm build && pnpm --filter @axora/web build:pwa` ; mobile/desktop via scripts dédiés `ops/build-mobile.*`, `ops/build-desktop.*` (à créer en Phase 11 selon `architecture.md` §8 phase 11).

### 2.11 Tests de performance (gate 10 — mesuré, pas supposé, prompt §54)
- Budget de bundle JS par route (vérifié en CI, échec si dépassement d'un seuil documenté par route critique : Command Center, DataTable dense).
- Détection de requêtes N+1 sur les endpoints à fort volume (Stock, Finance, BI) via un plugin de comptage de requêtes Prisma en test d'intégration (seuil de requêtes par appel documenté et vérifié, pas juste « ça semble rapide »).
- Test de charge basique sur les endpoints de recherche globale et de tableaux denses (ex. `k6` ou `autocannon`, dataset `DEMO` volumétrique dédié) — seuil de latence p95 documenté par endpoint, exécuté localement/CI nocturne (pas sur chaque PR pour rester dans un temps de gate raisonnable).
- Commande locale : `pnpm test:perf` (hors gate bloquant de PR, gate nocturne/pré-release).

### 2.12 Tests de régression (gate 11 — transverse)
- Toute correction de bug (prompt §47) ajoute un test de régression ciblé avant fermeture — vérifié par revue de PR (checklist), pas automatisable à 100 % mais traçable dans `docs/AXORA-ERP24_DECISIONS.md`.
- Suite de régression = union des gates 2.2 à 2.9 rejouée intégralement avant toute release (§7).

---

## 3. Mapping tests ↔ invariants métier (traçabilité, extrait représentatif)

Ce mapping n'est pas exhaustif (24 bounded contexts × plusieurs invariants chacun, `domain-model.md` §4) mais fixe le **principe de traçabilité obligatoire** : chaque invariant métier non négociable listé dans `domain-model.md`/`security.md` doit pointer vers au moins un test identifié, sinon il reste `NOT_RUN`/`NOT_STARTED` explicite.

| Invariant (source) | Type de test | Gate |
|---|---|---|
| `companyId`/`projectId` client jamais preuve d'autorisation (`domain-model.md` §2.3.1) | Intégration + API (reconstruction serveur du `RequestContext`) | 2.3 / 2.4 |
| Clé composée `[id, organizationId]` rend une jointure cross-tenant impossible (§2.3.2) | Intégration (tentative de jointure directe) | 2.3 |
| `AuditLog` append-only, déclencheur DB (§2.3.6, `security.md` §7.1) | Intégration (tentative directe UPDATE/DELETE) | 2.3 |
| Budget WBS porté par feuilles uniquement, jamais double comptage (BC-04 inv.1) | Unitaire (calcul d'agrégation) + Intégration | 2.2 / 2.3 |
| 3-way match commande/réception/facture obligatoire (BC-05 inv.1) | API E2E (scénario complet + écart explicite) | 2.4 |
| Ledger de stock append-only, solde toujours dérivé (BC-06 inv.1/2) | Intégration + API E2E (double mouvement concurrent) | 2.3 / 2.4 |
| Anti-double-paiement (BC-07 inv.3) | API E2E (paiement concurrent simulé) | 2.4 |
| Séparation capture→identification→présence→validation→paie (BC-08 inv.1) | API E2E (tentative de saut d'étape rejetée) | 2.4 |
| Mode hors ligne Field : pas de perte silencieuse, conflit résolu explicitement (BC-09 inv.3) | E2E navigateur (offline simulé) | 2.5 |
| NCR immuable, clôture par rôle distinct du créateur (BC-11 inv.1/2) | API E2E RBAC positif/négatif | 2.4 |
| Aucune acceptation Commissioning sans étapes précédentes (BC-12 inv.1) | API E2E (garde de séquence) | 2.4 |
| Calcul MEP jamais validé sans données/formule vérifiable (BC-13 inv.1) | Unitaire (formule + jeu de référence documenté) | 2.2 |
| 6 états de connexion Revit jamais fusionnés, jamais simulés comme `CONNECTED` (BC-14 inv.1/2) | API E2E + test manuel documenté si Revit réel disponible, sinon `BLOCKED`/`NOT_TESTED` explicite | 2.4 / `BLOCKED` |
| MTBF/MTTR calculés uniquement sur historique réel (BC-15 inv.3) | Unitaire (jeu de données `DEMO` documenté) | 2.2 |
| Simulateur BMS jamais preuve de communication réelle (BC-16 inv.2) | Idem BIM/Revit — `BLOCKED`/`NOT_TESTED` si pas de contrôleur réel | `BLOCKED` |
| Portails externes jamais d'héritage RBAC implicite (BC-20 inv.2) | API E2E + test d'isolation session portail/interne | 2.4 / 2.9 |
| Webhook sortant signé HMAC, anti-rejeu (BC-21 inv.4) | Intégration (vérification signature + rejeu rejeté) | 2.3 |
| IA n'accède jamais à plus que les droits de l'appelant (BC-22 inv.1) | API E2E RBAC (appel Copilot avec utilisateur restreint) | 2.4 |
| Données `DEMO` jamais mélangées à la production (transverse §5.6) | Intégration + E2E (recherche/export/dashboard) | 2.3 / 2.5 |

---

## 4. Quality gates exécutables localement — synthèse des commandes

Toutes les commandes ci-dessous sont à définir dans `package.json` racine (monorepo pnpm) dès `INC-00` (`architecture.md` §8 Phase 0), sur le modèle du `pnpm check` déjà éprouvé chez ERP3602 mais étendu :

| Commande | Contenu | Durée cible | Bloquant PR |
|---|---|---|---|
| `pnpm check:fast` | lint + typecheck + prisma format/validate | < 2 min | Oui |
| `pnpm test:unit` | tests unitaires tous packages | < 5 min | Oui |
| `pnpm test:integration` | tests intégration (nécessite Postgres via Docker) | < 10 min | Oui |
| `pnpm db:migrate:test` | migration à blanc + drift check + seed DEMO | < 3 min | Oui (si schéma modifié) |
| `pnpm --filter @axora/api test:e2e` | suite API E2E par domaine | < 15 min | Oui |
| `pnpm --filter @axora/web test:e2e` | Playwright, 10 parcours prioritaires | < 20 min | Oui |
| `pnpm --filter @axora/web test:a11y` | axe-core sur pages/états partagés | < 8 min | Oui |
| `pnpm --filter @axora/web test:responsive` | matrice viewports Playwright | < 10 min | Oui |
| `pnpm test:security` | isolation RBAC/tenant/session/fichiers + headers + CORS | < 10 min | Oui |
| `pnpm audit --prod --audit-level=high` | dépendances | < 1 min | Oui |
| `pnpm test:secrets-scan` | détection de secret committé | < 1 min | Oui |
| `pnpm build` | build complet monorepo | < 10 min | Oui |
| `pnpm test:perf` | budgets bundle + N+1 + charge basique | < 15 min | Non (nocturne/pré-release) |
| `pnpm check` (agrégat) | `check:fast` + `test:unit` + `test:integration` + `db:migrate:test` | < 20 min | Oui — gate local avant push, reproduit en CI |

**Règle** : toute commande listée « Bloquant PR = Oui » doit exister comme job CI distinct (jamais fusionnée en un seul job opaque) pour permettre un diagnostic ciblé et une reprise rapide (prompt §47 boucle de correction).

---

## 5. Docker Compose — développement et test

Deux fichiers distincts, alignés sur le pattern ERP3602 (dev minimal / production durcie), avec ajout du worker absent chez ERP3602 :

### 5.1 `docker-compose.dev.yml` (développement local)

```yaml
services:
  postgres:
    image: postgres:18-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: axora
      POSTGRES_PASSWORD: axora_dev
      POSTGRES_DB: axora_erp24
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U axora -d axora_erp24"]
      interval: 5s
      timeout: 5s
      retries: 10
    volumes:
      - axora_erp24_postgres_data:/var/lib/postgresql

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 10
    # File de tâches (workflow engine différé, notifications, jobs IA/BIM/IoT — architecture.md §3)

  api:
    build: { context: ., dockerfile: apps/api/Dockerfile }
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_healthy }
    environment:
      NODE_ENV: development
      DATABASE_URL: postgresql://axora:***@postgres:5432/axora_erp24?schema=public
      REDIS_URL: redis://redis:6379
    ports: ["4000:4000"]
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:4000/api/v1/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
      interval: 5s
      timeout: 5s
      retries: 20

  worker:
    build: { context: ., dockerfile: apps/worker/Dockerfile }
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_healthy }
    environment:
      NODE_ENV: development
      DATABASE_URL: postgresql://axora:***@postgres:5432/axora_erp24?schema=public
      REDIS_URL: redis://redis:6379
    # process asynchrone séparé — automation, IA, BIM lourd, ingestion IoT (architecture.md §3)

  web:
    build: { context: ., dockerfile: apps/web/Dockerfile }
    depends_on:
      api: { condition: service_healthy }
    environment:
      NODE_ENV: development
      AXORA_API_INTERNAL_ORIGIN: http://api:4000
    ports: ["3000:3000"]
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
      interval: 5s
      timeout: 5s
      retries: 20

volumes:
  axora_erp24_postgres_data:
```

Notes :
- Séparation nette du nommage de base (`axora_erp24`) et des volumes (`axora_erp24_*`) pour ne **jamais** entrer en collision avec un environnement ERP3602 déjà présent sur la même machine (prompt §4, protection d'ERP3602 — évite tout risque de partage accidentel de volume Docker entre les deux produits).
- Ajout explicite de `redis` (absent d'ERP3602), nécessaire dès que `apps/worker` existe (`architecture.md` §3, file de tâches BullMQ/Redis).
- Aucun secret réel dans ce fichier — mots de passe de développement uniquement, jamais copiés depuis un `.env` de production (prompt §51).

### 5.2 `docker-compose.test.yml` (CI et tests d'intégration isolés)

- Base éphémère dédiée (`axora_erp24_test`), pas de volume persistant nommé (recréée à chaque run), healthcheck strict avant toute connexion des tests d'intégration/migration (§2.3/§2.6).
- Utilisée par `pnpm test:integration` et `pnpm db:migrate:test` en local comme en CI, pour garantir que les tests locaux et CI tournent contre exactement le même environnement (élimine la classe de bug « ça marche chez moi »).

### 5.3 `docker-compose.production.yml` (aperçu — détaillé au moment du packaging, INC-24)

- Reprend les patterns ERP3602 validés : labels `com.axora-erp24.release.sha`, rotation de logs (`max-size`/`max-file`), `depends_on: service_healthy`, reverse-proxy standard (Caddy/Nginx) — **sans** le contournement CORS d'ADR-007 (`architecture.md` §5.2/§7).
- Ajout du service `worker` en production avec ses propres réplicas indépendants de l'API HTTP (`architecture.md` §3, palier avant extraction réseau future).

---

## 6. Pipeline CI GitHub Actions — proposition de structure

Sur le modèle ERP3602 (`ci.yml`, `docker-smoke.yml`, `security-release.yml`) mais réorganisé en **jobs séparés et parallélisables** plutôt qu'un unique job séquentiel de 300+ lignes, pour un diagnostic plus rapide et un feedback plus court sur PR (l'unique job ERP3602 constaté fonctionne mais mélange tous les niveaux de gate — AXORA-ERP24 explicite la même couverture en jobs nommés) :

```
.github/workflows/
  ci-fast.yml          # lint, typecheck, format, prisma validate — sur chaque push/PR, < 3 min
  ci-unit.yml          # tests unitaires, matrice par package pnpm — parallèle
  ci-integration.yml   # service postgres+redis, tests intégration + migration + garde-fous DB
  ci-api-e2e.yml       # démarrage API réel, suite test/*.e2e.ts par domaine (reprend le pattern ERP3602)
  ci-web-e2e.yml       # Playwright : 10 parcours prioritaires + a11y (axe-core) + responsive
  ci-security.yml      # audit deps + SBOM + scan secrets + suite isolation RBAC/tenant/session + headers/CORS
  ci-build.yml         # build monorepo + build PWA (+ audit Lighthouse) + build images Docker
  docker-smoke.yml     # compose config validate, up réel, healthchecks, backup/restore smoke, restart-persistence smoke
  mobile-build.yml     # build Capacitor Android (bloquant si SDK dispo), iOS best-effort (BLOCKED documenté sinon)
  nightly-perf.yml     # budgets bundle, détection N+1, tests de charge k6/autocannon — non bloquant PR
  release.yml          # déclenché sur tag — provenance de release, packaging Docker+Windows+Android, rapport final
```

**Règles transverses (toutes appliquées, reprises et étendues d'ERP3602)** :
- `concurrency: cancel-in-progress` par PR/branche (évite les runs redondants — pattern déjà présent `ci.yml`).
- `permissions: contents: read` par défaut, élévation explicite seulement pour `release.yml` (principe du moindre privilège appliqué à la CI elle-même).
- Vérification d'arbre Git propre avant génération de provenance (pattern ERP3602 repris tel quel — empêche une release construite sur un état non commité).
- **Génération et vérification de provenance de release dès `ci-fast.yml`** (pas seulement à la release) : SHA source, horodatage, hash des artefacts — pattern `ops/new-release-provenance.ps1` / `ops/verify-release-provenance.ps1` d'ERP3602 repris à l'identique pour AXORA-ERP24.
- Upload systématique des logs runtime et artefacts de test (traces Playwright, captures a11y, JUnit) en cas d'échec, jamais seulement un statut rouge sans preuve exploitable.
- `workflow_dispatch` activé sur chaque workflow pour permettre un rejeu manuel ciblé pendant le débogage (pattern ERP3602 conservé).

**Gate de fusion (branch protection)** : `ci-fast`, `ci-unit`, `ci-integration`, `ci-api-e2e`, `ci-web-e2e`, `ci-security`, `ci-build`, `docker-smoke` tous requis avant merge sur la branche principale. `mobile-build` requis uniquement si des fichiers `apps/field-mobile/**` ou `apps/desktop/**` sont modifiés (gate conditionnel par chemin, évite un ralentissement inutile des PR backend/API pures). `nightly-perf` n'est jamais un gate de merge (feedback différé, seuils de régression suivis dans le temps).

---

## 7. Observabilité (logs / métriques / traces)

Aligné sur `architecture.md` §3 (« Observabilité : logs structurés + corrélation id + métriques OpenTelemetry + traces dès le socle ») :

### 7.1 Logs
- Format structuré JSON (un champ par ligne : `timestamp`, `level`, `service`, `correlationId`, `organizationId?`, `companyId?`, `projectId?`, `message`, `context`), jamais de log texte libre non parsable en production.
- **Masquage systématique** des champs sensibles connus au niveau du logger central (`security.md` §12) : mot de passe, jeton de session brut, secret MFA, clé API — aucune exception, y compris en niveau `debug`.
- Corrélation : un identifiant de requête généré à l'entrée (reverse-proxy ou première couche applicative) propagé du frontend → API → worker → base, permettant de relier une erreur utilisateur à une trace complète sans exposer de données sensibles dans le log lui-même.
- Niveaux différenciés par environnement (`debug`/`info` en dev, `info`/`warn`/`error` en production) — vérifié par test (un test d'intégration vérifie qu'aucun secret connu n'apparaît dans un log capturé lors d'un scénario d'authentification, cf. gate sécurité §2.9).
- Rétention et rotation définies par environnement (jamais illimitée en local, politique explicite en production alignée sur la rotation Docker déjà en place chez ERP3602 `max-size`/`max-file`).

### 7.2 Métriques
- Standard **OpenTelemetry Metrics** (vendor-neutre, évite le verrouillage propriétaire), exposé via endpoint `/metrics` compatible Prometheus scraping (ou export OTLP vers un collecteur si l'environnement de déploiement cible en fournit un — à confirmer en Phase 0, pas figé arbitrairement).
- Métriques minimales dès le socle (`INC-00`/`INC-01`) : latence par route (histogramme), taux d'erreur HTTP par code, nombre de requêtes par tenant (détection d'anomalie de charge), durée des requêtes base de données lentes (seuil configurable), taille de la file de tâches worker (profondeur de queue, âge du job le plus ancien — détection de dérive du worker).
- Métriques métier ajoutées incrément par incrément (ex. INC-06 : nombre de commandes en attente d'approbation ; INC-16 : dernière lecture de télémétrie par point, pour détecter un capteur silencieux).
- **Aucune métrique n'est présentée comme temps réel si elle est en fait calculée en batch différé** — la fraîcheur de chaque métrique est documentée (cohérent avec l'interdiction transverse des faux statuts, prompt §46 par analogie).

### 7.3 Traces
- OpenTelemetry Tracing, propagation de contexte W3C Trace Context de bout en bout (Web → API → worker → base/queue), échantillonnage configurable (100 % en dev/test, taux réduit configurable en production pour maîtriser le volume).
- Chaque transaction critique (paiement, engagement budgétaire, transition de contrat) génère une trace nommée explicitement, exploitable pour le diagnostic d'incident sans dépendre uniquement des logs.
- Export vers un backend de traces compatible OTLP (Jaeger/Tempo/autre — choix d'infrastructure différé à la Phase 0/9 selon l'environnement de déploiement réel, pas présumé ici).

### 7.4 Healthchecks
- `/api/v1/health` (liveness — le process répond) et `/api/v1/health/ready` (readiness — dépendances critiques, base de données et file de tâches, réellement joignables) — distinction reprise telle quelle d'ERP3602 (`ci.yml`/`docker-compose.yml` l'utilisent déjà de façon cohérente).
- Le worker expose son propre healthcheck (profondeur de queue raisonnable, dernier job traité récemment) — nouveauté vs. ERP3602 qui n'a pas de worker séparé.
- Chaque service Docker (api, web, worker, postgres, redis) a un healthcheck Compose déclaré et vérifié par `docker-smoke.yml` (§6) avant toute déclaration de stack fonctionnelle.

### 7.5 Alerting (préparation, pas d'implémentation figée ici)
- Seuils d'alerte définis par métrique critique (taux d'erreur 5xx, profondeur de queue anormale, latence p95 dépassée, échec de sauvegarde planifiée) — le canal d'alerte réel (e-mail/Slack/PagerDuty) dépend d'un fournisseur réellement configuré (cohérent avec le principe transverse du prompt §37 : toute intégration de notification basée sur un fournisseur réellement configuré, jamais présumé).

---

## 8. Packaging et release

### 8.1 Docker (production)
- Images multi-stage (build → runtime minimal), une image par service (`api`, `web`, `worker`), taille mesurée et suivie dans le temps (gate build §2.10).
- Labels de provenance (`com.axora-erp24.release.sha`, date de build, version sémantique) — pattern ERP3602 repris à l'identique.
- Scan de vulnérabilités d'image (ex. Trivy ou équivalent disponible dans l'environnement) ajouté au gate sécurité avant publication d'image (renforcement vs. ERP3602 qui n'a constaté qu'un `pnpm audit` sur les dépendances applicatives, pas sur l'image finale).

### 8.2 Web / PWA
- Build Next.js standard + manifeste PWA + service worker (Workbox) généré en build de production uniquement (jamais en dev, pour ne pas piéger le cache pendant le développement).
- Audit Lighthouse (Performance/PWA/Accessibilité/Best Practices/SEO) archivé par release, seuils minimaux documentés par catégorie — statut `PASS`/`PARTIAL` selon score, jamais `PASS` sans le rapport Lighthouse joint.

### 8.3 Windows
- Réutilisation du pattern d'installeur auto-portant d'ERP3602 (`desktop/windows/`, Node+PostgreSQL embarqués, Inno Setup) **si** le spike technique Tauri (`architecture.md` §6.6/§9) n'aboutit pas à une alternative plus légère validée en Phase 1 — décision réversible, non tranchée définitivement ici.
- Gate `windows-desktop-complete`-équivalent : build de l'installeur + test d'installation silencieuse sur un environnement Windows propre (ou conteneur Windows si disponible) + vérification de démarrage post-installation.

### 8.4 Android / iOS
- Android : build Capacitor signé (keystore de release géré comme un secret d'infrastructure, jamais committé — `security.md` §9), gate CI conditionnel (§6) exécuté si le SDK Android est disponible ; sinon `BLOCKED` documenté avec la dépendance manquante précise.
- iOS : build Capacitor testé uniquement si un environnement macOS/Xcode et une identité de signature Apple sont réellement disponibles ; en leur absence, le blocage est déclaré explicitement (`BLOCKED`, jamais falsifié) conformément au prompt §38, tout en livrant ce qui est compilable/testable côté web partagé.

### 8.5 Versionnement et changelog
- SemVer sur chaque package publiable (`packages/*` si publiés en interne, `apps/*` versionnés par tag de release global).
- Changelog généré à partir des commits conventionnels (`feat(...)`, `fix(...)`, `test(...)` — convention déjà utilisée dans les exemples du prompt §49), vérifié par un gate de lint de message de commit sur les PR (Conventional Commits), pour garantir un rapport final exploitable (prompt §57) sans reconstruction manuelle.

### 8.6 Sauvegarde / restauration (production)
- Reprise directe des scripts PowerShell ERP3602 (`backup-postgres`, `restore-postgres-test`, `prune-backups`, `replicate-backup`) comme référence de conception, adaptés au nom de base `axora_erp24` — le smoke test backup/restore isolé (`docker-smoke.yml` ERP3602) est un gate à reproduire à l'identique avant toute déclaration de packaging production `VERIFIED`.
- Test de restauration **dans un environnement isolé** (jamais restauré directement sur une instance de production existante) avant chaque validation de release majeure.

---

## 9. Alignement avec les phases verticales d'`architecture.md` et le backlog `INC-00`→`INC-24`

Chaque phase/incrément porte un **socle de gates minimal obligatoire** avant promotion `VERIFIED` (au sens du backlog). Ce tableau est le contrat entre ce rapport et `product-backlog.md` §6/§7 :

| Phase (`architecture.md` §8) | Incréments (`product-backlog.md` §6) | Gates minimaux obligatoires (en plus du socle 2.1–2.4 systématique) | Gates spécifiques ajoutés |
|---|---|---|---|
| Phase 0 — Fondations | INC-00 | 2.1, 2.10 (build), Docker dev up (docker-smoke réduit) | Provenance de release dès le premier commit ; `docs/AXORA-ERP24_*` créés (prompt §48) |
| Phase 1 — Core/Identité/RBAC/PWA shell | INC-01 | 2.1–2.4, 2.7 (a11y shell), 2.9 (isolation RBAC/tenant complète) | Audit append-only testé ; PWA installable testée (Lighthouse) |
| Phase 2 — CRM/Estimation/Contrat | INC-02, INC-03, INC-04 | 2.1–2.5 | Arithmétique décimale (DQE), garde base « contrat sans devis accepté » |
| Phase 3 — Achats/Stock | INC-06, INC-07 | 2.1–2.5, 2.9 (idempotence) | Test de concurrence (double réception simultanée) |
| Phase 4 — Projet/Site/Cost control | INC-05, INC-10 (partiel) | 2.1–2.5, 2.8 (responsive Field) | Test offline/sync (E2E navigateur avec réseau coupé) |
| Phase 5 — Finance/RH | INC-08, INC-09 | 2.1–2.5, 2.9 (anti-double-paiement) | Séparation capture→paie testée en E2E API |
| Phase 6 — MEP/BIM/GED | INC-13, INC-14, INC-10 (fondation GED) | 2.1–2.4, 2.2 renforcé (formules MEP) | Import IFC par hash testé ; connecteur Revit `NOT_TESTED` explicite si pas de Revit réel |
| Phase 7 — QHSE/Commissioning/Assets | INC-11, INC-12, INC-15 | 2.1–2.5 | Garde de séquence Commissioning ; séparation des devoirs QHSE testée |
| Phase 8 — Automatisation/Workflow/IA | INC-21, INC-22 (socle dès INC-01) | 2.1–2.4, 2.9 (RBAC Copilot) | Webhook HMAC + anti-rejeu testé ; traçabilité `AiInferenceEvidence` testée |
| Phase 9 — Smart Building/Energy/BI | INC-16, INC-17, INC-23 (partiel) | 2.1–2.4 | Distinction 5 niveaux connecteur BMS testée ou `NOT_TESTED`/`BLOCKED` explicite |
| Phase 10 — Portails/API publique | INC-20, INC-23 (partiel) | 2.1–2.4, 2.9 (isolation session portail) | Rate limiting clé API testé ; `PortalResourceGrant` deny-by-default testé |
| Phase 11 — Multi-plateforme + qualification finale | INC-18, INC-19, INC-24 | Tous les gates 2.1–2.12 | Build mobile signé (ou `BLOCKED` documenté) ; rapport final `AXORA-ERP24 — FINAL DELIVERY REPORT` (prompt §57) appuyé par SHA + run CI par section |

**Règle de non-régression inter-phases** : chaque nouvelle phase rejoue **l'intégralité** de la suite de régression (§2.12) des phases précédentes en CI, jamais seulement les tests de la phase courante — un module `VERIFIED` en Phase 2 qui casse silencieusement en Phase 6 doit être détecté avant merge, pas découvert au rapport final.

---

## 10. Boucle de correction automatique (prompt §47) — application QA/DevOps

1. Un gate `FAIL` en CI déclenche l'archivage immédiat de la sortie brute (log complet, pas un résumé) dans l'artefact de run.
2. La cause est identifiée avant toute tentative de correction (pas de correction spéculative) — cohérent avec la discipline `systematic-debugging` déjà disponible comme skill.
3. Correction appliquée, commit atomique dédié (`fix(<domaine>): <description précise>`), jamais mélangé à une nouvelle fonctionnalité.
4. Relance ciblée du gate qui a échoué en premier (boucle rapide), puis relance de la suite de régression complète (§2.12) avant nouvelle tentative de merge.
5. Aucun gate n'est désactivé/skip pour « débloquer » un merge sans décision documentée dans `docs/AXORA-ERP24_DECISIONS.md` (traçabilité obligatoire de toute exception, jamais un contournement silencieux).

---

## 11. Risques et points ouverts explicitement non tranchés ici

- **Choix définitif de framework de test unitaire** (Vitest vs Jest) : à trancher en Phase 0 par spike technique, cohérent avec le point ouvert équivalent d'`architecture.md` §9 sur l'ORM — non figé arbitrairement par ce rapport.
- **Backend de traces/métriques concret** (Jaeger/Tempo/Grafana Cloud/autre) : dépend de l'environnement de déploiement cible réel, non choisi ici sans validation d'infrastructure.
- **Disponibilité d'un environnement Revit réel, d'un contrôleur BMS physique, d'un dispositif biométrique** : conditions déjà identifiées comme `BLOCKED`/`NOT_TESTED` légitimes par `security.md` et `product-backlog.md` — ce rapport ne les lève pas, il fournit seulement le protocole de test à exécuter **si** ces éléments deviennent disponibles.
- **Seuils précis de performance (p95, budgets de bundle)** : à calibrer avec des mesures réelles dès les premiers incréments, pas inventés a priori — un seuil non mesuré reste `NOT_RUN`, jamais présumé correct.
- **Fournisseur de scan de vulnérabilité d'image et de détection de secrets** : dépend des outils réellement installables dans l'environnement CI cible (à vérifier en Phase 0), pas présumé disponible sans confirmation.
- **Aucun secret, identifiant ou donnée de production n'a été consulté, créé ou requis pour produire ce rapport.**
- **Aucune commande n'a été exécutée** dans le workspace cible ni dans la référence ERP3602 au-delà de la lecture de fichiers — toutes les commandes proposées ci-dessus sont des spécifications à valider par exécution réelle dès `INC-00`.

---

## 12. Ce que ce document ne prétend pas être

- **Ce n'est pas un rapport d'exécution.** Aucun gate décrit ici n'a été lancé ; tous seraient `NOT_RUN` s'ils étaient évalués aujourd'hui, car aucun code n'existe encore dans `E:/AXORA ADM/AXORA_ERP24` en dehors du prompt maître et des rapports d'analyse.
- **Ce n'est pas une garantie de conformité réglementaire ou normative** (fiscale, comptable, ingénierie) — hors périmètre, cohérent avec `architecture.md` §9 et `product-backlog.md` §8.
- **ERP3602 n'a pas été modifié** : toute lecture ci-dessus provient de `C:/Users/dmgpe/AX-ERP360-source-readonly` en lecture seule.
- **Aucune question bloquante n'a été identifiée** pour l'établissement de cette stratégie — les seuls points explicitement laissés ouverts (§11) sont déjà documentés comme décisions différées légitimes, pas des questions à poser maintenant.

**Statut de ce document : `SPEC` — stratégie QA/DevOps exécutable proposée, aucune implémentation livrée, aucun fichier source modifié, aucun test réellement exécuté.**
