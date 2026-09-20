# AXORA-ERP24 — Architecture cible (rapport AXORA-ERP24-ARCHITECT)

## 0. Portée et méthode

- Prompt maître analysé intégralement : `E:/AXORA ADM/AXORA_ERP24/AXORA-ERP24.txt` (1715 lignes). Le nom produit `AX-A360` employé dans ce fichier est remplacé partout ci-dessous par **AXORA-ERP24**, conformément à la demande utilisateur. Les rôles d'agents cités dans le prompt (`AX-A360-ARCHITECT`, etc.) sont donc à lire comme `AXORA-ERP24-ARCHITECT`, `AXORA-ERP24-UX`, etc.
- Référence en **lecture seule** inspectée : `C:/Users/dmgpe/AX-ERP360-source-readonly`, branche `main`, HEAD confirmé par `git log` = `7d19e216f660087b474588763cb722296ef37084` (conforme au SHA donné en contexte). Aucun fichier de ce dépôt n'a été modifié.
- Workspace cible `E:/AXORA ADM/AXORA_ERP24` constaté **vide** (uniquement `.git`, `.gitignore`, `.hermes/`, le prompt) : projet greenfield, aucune contrainte de code existant.
- ERP3602 n'est ni touché ni copié tel quel : il sert uniquement de référence fonctionnelle et de retour d'expérience technique, conformément à la section 4 du prompt (protection d'ERP3602).

---

## 1. Inventaire de la référence ERP3602 (lecture seule)

### 1.1 Stack constatée (et non supposée)

| Composant | Version constatée | Fichier source |
|---|---|---|
| Node.js | 24 LTS (`>=24.0.0 <25`) | `package.json` |
| Gestionnaire de paquets | pnpm 11.4.0, workspace `apps/*` + `packages/*` | `pnpm-workspace.yaml` |
| Frontend | Next.js 16.2.11 / React 19.2.8, App Router | `apps/web/package.json` |
| Styles | Tailwind CSS 4.3.x | `apps/web/package.json` |
| Backend | NestJS 11, module monolith | `apps/api/src/*.module.ts` (35 sous-modules) |
| ORM | Prisma ORM 7 (`prisma-client` generator + `@prisma/adapter-pg`) | ADR-004 |
| Base de données | PostgreSQL 18 | `docker-compose.production.yml` |
| Sessions | Tokens opaques aléatoires, hash SHA-256 stocké en base, cookie HttpOnly | ADR-002, `docs/ARCHITECTURE.md` |
| Mots de passe | `scrypt` Node.js natif, sel par mot de passe | `README.md` |
| MFA | TOTP + AES-256-GCM, activation conditionnée à `MFA_ENCRYPTION_KEY` | ADR-006 |
| Schéma DB | 1442 lignes dans `schema.prisma` + 29 fichiers `.prisma` par domaine sous `packages/database/prisma/models/` | inspection directe |
| API | 35 sous-répertoires de modules NestJS sous `apps/api/src/` (crm, projects, procurement, inventory, finance, hr, bim, commissioning, assets, automation, ai, analytics, smart-building, portal, academy, governance, access-control, workforce, payroll, engineering, documents, catalog, logistics, qhse, site…) | inspection directe |
| Frontend routes | 30 dossiers sous `apps/web/app/` | inspection directe |
| CI/CD | 10 workflows GitHub Actions (`ci.yml`, `security-release.yml`, `docker-smoke.yml`, `windows-desktop-complete.yml`, `access-control-gate.yml`, `n0c-artifact*.yml`, `zx-s504-validation-kit.yml`, `inventory-e2e-diagnostic.yml`) | `.github/workflows/` |
| Packaging | Docker (dev + prod compose), installeur Windows complet auto-portant (Node+PostgreSQL embarqués, Inno Setup) | `docker-compose.production.yml`, `desktop/windows/` |
| Reverse-proxy / edge | Caddy (`Caddyfile`) | inspection directe |

### 1.2 Absences constatées (pas d'invention, faits négatifs vérifiés)

- **Aucun** manifest PWA, service worker ou fichier lié PWA trouvé (recherche `manifest|service-worker|sw.js|pwa` : 0 résultat).
- **Aucun** artefact mobile natif (Android/iOS/Capacitor/React Native/Expo : 0 résultat) — seul un wrapper desktop Windows existe (`desktop/windows/`), pas de mobile.
- ERP3602 est un **modular monolith mono-dépôt**, une seule base de données, pas de microservices, pas de message broker constaté.
- `docs/DECISIONS.md` (ADR-007) documente un contournement de production réel : un bug Passenger/N0C impose un transport direct navigateur→API CORS en production, hors du BFF Next.js. C'est une dette d'infrastructure d'hébergement, pas une contrainte à reproduire pour un nouveau produit avec un hébergement propre.

### 1.3 Forces à reprendre (patterns validés)

1. **Monorepo pnpm** avec séparation nette `apps/*` (exécutables) / `packages/*` (bibliothèques partagées type/security/database/ui).
2. **Autorisation strictement côté serveur**, deny-by-default, jamais de `companyId` client comme preuve d'autorisation (invariant `docs/ARCHITECTURE.md §3`).
3. **Sessions opaques** plutôt que JWT auto-porteurs → révocation immédiate, moindre surface d'attaque XSS sur les tokens.
4. **Arithmétique Decimal stricte** pour finance/stock, unités explicites en ingénierie (jamais de float).
5. **Preuves d'évidence immuables** (hash SHA-256, provenance append-only) pour BIM, signatures documentaires, IA — modèle d'audit fort, réutilisable tel quel.
6. **Vocabulaire de statut strict** (`VERIFIED`, `NOT_TESTED`, `BLOCKED`…) et interdiction des faux `PASS` — gouvernance qualité directement alignée avec la section 46 du prompt maître AXORA-ERP24.
7. **ADR log versionné** (`docs/DECISIONS.md`) et fichiers d'état vivants (`ROADMAP_STATUS.md`, `MODULE_STATUS.md`, `PRODUCT_READINESS.md`) relus par un moniteur `/progress`.

### 1.4 Limites à corriger dans AXORA-ERP24

- Pas de PWA / offline / mobile → à concevoir dès le socle, pas en périphérie tardive (le prompt exige PWA installable + mode terrain hors-ligne).
- Le contournement CORS de production (ADR-007) montre une fragilité d'hébergement Passenger : AXORA-ERP24 doit choisir un runtime de déploiement conteneurisé standard (Docker/K8s ou PaaS Node natif) pour ne pas hériter de ce risque.
- Modularité NestJS actuelle reste un import direct de modules dans un seul `app.module.ts` : pas de frontières de compilation strictes (rien n'empêche un module d'importer directement le repository Prisma d'un autre domaine). AXORA-ERP24 doit formaliser des frontières de module plus dures (voir §4).
- Aucune couche d'événements/bus interne constatée (l'« Automation »/AXORA Flow réagit à des event rows en base, pas un vrai bus). Correct pour le volume actuel, mais à anticiper si le workflow engine (module 22) doit scaler.

---

## 2. Positionnement produit AXORA-ERP24

Conforme au prompt (§7) : ERP + CRM + Construction + MEP + BIM + Finance + RH + GED + QHSE + GMAO + Smart Building + Energy + Automation + Analytics + IA, interface unique, cible multi-organisation / multi-société / multi-projet / multi-site / multi-devise / multi-langue / multi-entité / multi-entrepôt.

Différenciateurs demandés vs ERP3602 : nouvelle architecture, nouveau design, plus de fonctionnalités/automatisation, meilleure modularité, sécurité renforcée, meilleur usage mobile, BIM/MEP plus profond, Smart Building, couche IA, workflows configurables, architecture évolutive. **Décision : nouveau produit, pas un fork visuel.**

---

## 3. Stack recommandée pour AXORA-ERP24

Principe directeur du prompt (§39) : « ne créer un microservice que lorsqu'il apporte un bénéfice réel », « éviter une complexité artificielle ». La stack ERP3602 est récente, cohérente et a fait ses preuves (35 modules VERIFIED) : on la reprend comme base par défaut plutôt que de réinventer sans raison, mais avec des améliorations ciblées sur les points faibles identifiés en §1.4.

| Couche | Choix AXORA-ERP24 | Justification |
|---|---|---|
| Langage | TypeScript strict partout (front, back, scripts) | Continuité, embauche/agents plus efficaces, typage de bout en bout partagé via `packages/contracts` |
| Runtime | Node.js LTS courant (aligné sur la version LTS active au moment du build, vérifiée par `node -v` en CI — ne pas figer une version par hypothèse) | Éviter d'hériter une version bientôt EOL sans vérification |
| Gestionnaire de paquets | pnpm (workspaces) | Identique à ERP3602, performant, lockfile strict, `allowBuilds` explicite conservé comme pattern anti-supply-chain |
| API | NestJS (modular monolith), mais avec **frontières de module renforcées** (voir §4) | Patterns DI/guards/pipes matures, déjà validés à 35 domaines dans ERP3602 |
| Base de données | PostgreSQL, une base par déploiement, isolation logique multi-tenant par colonnes `organizationId`/`companyId` (pas de schema-per-tenant sauf preuve de besoin) | Reprend l'invariant serveur-side tenant scope d'ERP3602 ; changement de stratégie de partitionnement seulement si volumétrie le justifie |
| ORM | Prisma (ou équivalent typesafe si Prisma 7 pose un risque de licence/support à l'échéance du projet — à réévaluer en phase 0, pas figé par défaut) | Migrations versionnées + client typé, déjà éprouvé |
| Frontend web | Next.js (App Router) + React, Tailwind CSS + design tokens dédiés AXORA-ERP24 (nouveau design system, pas de réutilisation visuelle d'ERP3602) | Continuité technique justifiée, mais Design System entièrement recréé (§34-35 du prompt : nouveau design obligatoire) |
| PWA | `next-pwa`/Workbox (service worker généré, manifest, cache stratégié par route : app-shell + API-cache + queue offline pour le module Field) | Absent d'ERP3602 → livrable neuf dès Phase 1 |
| Desktop (Windows) | Wrapper léger (Tauri de préférence à Electron pour la taille/sécurité, sinon reprise du pattern launcher .NET d'ERP3602 si Tauri s'avère incompatible avec l'environnement) autour du PWA/Web build | Décision réversible, à valider Phase 1 avec un spike technique |
| Mobile (Android/iOS) | Capacitor au-dessus du même front web/PWA pour le MVP terrain (Field/QHSE/Commissioning offline-first), évaluation native pure seulement si Capacitor plafonne (caméra/scan/biométrie) | Aucun héritage ERP3602 ; choisir la voie la plus rapide à couvrir « Field » offline sans dupliquer la logique métier |
| Auth | Sessions opaques serveur (reprise du modèle ERP3602), MFA TOTP dès le socle (pas conditionnel comme ADR-006, activé par défaut pour les rôles OWNER/ADMIN) | Renforcement sécurité demandé (§41) |
| RBAC | Modèle de permissions déclaratif partagé (`packages/security`), matrices d'autorisation par organisation/société/projet + délégations, évalué uniquement côté serveur | Reprend et étend l'invariant central d'ERP3602 |
| Files/objets | Stockage objet compatible S3 (documents GED, preuves photo QHSE/Field, exports BIM/IFC) dès le socle plutôt que disque local | ERP3602 ne documente pas cette couche explicitement — combler avant que GED/BIM/Field ne deviennent bloquants |
| Recherche globale | Recherche full-text PostgreSQL (`tsvector`) en phase 1, moteur dédié (OpenSearch/Meilisearch) seulement si la volumétrie/latence l'exige | Cohérent avec « pas de complexité artificielle » |
| Automatisation/Workflow engine | Moteur événement→condition→action en base (comme AXORA Flow) pour le MVP, avec une file de tâches asynchrone (BullMQ/Redis) ajoutée dès que des actions différées/retries sont nécessaires (notifications, webhooks, IA) | ERP3602 n'a pas de vrai bus ; AXORA-ERP24 doit anticiper cette brique dès le Core pour éviter la dette |
| IA | Couche adaptateur neutre multi-fournisseur (pattern « Inference Evidence » d'ERP3602 conservé : preuve immuable input/output hashé, jamais de contournement RBAC) | Le pattern d'évidence d'ERP3602 est bon, à généraliser |
| Observabilité | Logs structurés + corrélation id (repris), + métriques (OpenTelemetry) et traces dès le socle | ERP3602 a la corrélation d'ID mais pas de métriques documentées — à ajouter tôt |
| CI/CD | GitHub Actions : lint/typecheck/tests/migrations/build/E2E/Docker smoke/security gate, sur le modèle ERP3602 mais avec gate PWA (Lighthouse) et gate mobile build ajoutés | Reprend un pipeline déjà mature |
| Déploiement | Conteneurs Docker derrière un reverse-proxy standard (éviter le pattern Passenger qui a produit ADR-007) | Ne pas hériter la dette d'hébergement d'ERP3602 |

**Décision explicite** : AXORA-ERP24 reste un **modular monolith** à son lancement (ADR équivalent à l'ADR-001 d'ERP3602), avec extraction en service séparé seulement pour les charges protocolaires lourdes identifiées dès le départ comme candidates : adaptateurs Smart Building/BMS (BACnet/Modbus/MQTT), traitement BIM/IFC volumineux, jobs IA longs. Ces trois candidats seront conçus dès le Core comme des **workers asynchrones séparés du processus API HTTP** (même repo, process distinct, communiquant par file de tâches), sans être des microservices réseau à ce stade — palier intermédiaire réaliste avant un éventuel split réseau futur.

---

## 4. Structure monorepo et frontières de modules

### 4.1 Arborescence proposée

```text
axora-erp24/
  apps/
    api/                 # NestJS — modular monolith HTTP
    worker/               # process asynchrone (queues : automation, IA, BIM, IoT ingestion)
    web/                  # Next.js App Router (PWA)
    field-mobile/         # shell Capacitor autour du build web (offline-first)
    desktop/              # wrapper desktop (Tauri) — évaluation Phase 1
  packages/
    contracts/            # types, DTO, clés de permission partagées (équivalent @axora/types)
    security/             # RBAC, session, mfa, password, throttle (équivalent @axora/security)
    database/             # schéma Prisma modulaire par domaine, migrations, seed DEMO
    ui/                   # design system AXORA-ERP24 (tokens, composants)
    workflow-engine/       # moteur événement→condition→action réutilisable API+worker
    testing/              # helpers E2E/fixtures partagés
  docs/
    ARCHITECTURE.md
    DECISIONS.md
    MODULE_STATUS.md
    MODULE_MATRIX.md
    EXECUTION_STATE.md
    TEST_EVIDENCE.md
  ops/                    # scripts déploiement, backup, restore, provenance de release
  .github/workflows/
```

Cette arborescence est directement dérivée du monorepo ERP3602 (qui fonctionne) avec deux ajouts structurels : `apps/worker` (absent chez ERP3602, comble la lacune §1.4) et `packages/workflow-engine` isolé comme brique propre plutôt que noyée dans un module `automation` ad hoc.

### 4.2 Frontières de modules (renforcement vs ERP3602)

ERP3602 organise déjà le code par domaine métier (un dossier NestJS par domaine), mais rien n'empêche techniquement un module d'importer directement le repository Prisma d'un autre domaine. Pour AXORA-ERP24, règle explicite et outillée :

1. Chaque module métier (`crm`, `projects`, `procurement`, `inventory`, `finance`, `hr`, `mep`, `bim`, `qhse`, `commissioning`, `assets`, `smart-building`, `automation`, `ai`, `analytics`, `field`, `ged`, `portal-client`, `portal-supplier`) expose une **façade de service publique** (`*.public-api.ts`) ; tout accès inter-module passe par cette façade, jamais par le repository Prisma d'un autre domaine.
2. Un linter de frontières (ESLint `boundaries` ou équivalent + règle CI dédiée) fait échouer le build si un module importe un fichier interne (`*.service.ts`, `*.repository.ts`) d'un autre module au lieu de sa façade publique.
3. Le schéma Prisma reste **un seul schéma physique** (transactions cross-domaine nécessaires : ex. Devis→Contrat→Projet, Facture→Paiement→Solde), mais organisé en fichiers `.prisma` par domaine comme chez ERP3602 (déjà 29 fichiers), avec convention de nommage de table préfixée par domaine pour audit facile.
4. Les trois candidats à l'extraction réseau future (Smart Building adapters, BIM heavy processing, IA jobs longs) sont dès le départ développés comme des modules qui **ne font aucun appel HTTP synchrone entrant/sortant vers les autres modules métier** — uniquement via événements et la base — pour rester extractibles sans réécriture.

---

## 5. Stratégie base de données et API

### 5.1 Base de données

- PostgreSQL, une base par environnement, **isolation multi-tenant par colonnes** (`organizationId` obligatoire sur toute table métier, `companyId` explicite où pertinent) — reprise directe de l'invariant ERP3602 §3 (validé par tests d'isolation cross-org).
- Toute opération financière/stock/paiement critique est **transactionnelle** (reprise du principe ERP3602 §40 du prompt et de l'implémentation Decimal stricte constatée).
- Migrations SQL versionnées et committées (pas de migration implicite en prod), avec un gate CI qui rejoue les migrations sur une base vierge avant tout merge — pattern déjà en place chez ERP3602.
- Journal d'audit **append-only** au niveau base (contraintes PostgreSQL interdisant UPDATE/DELETE sur la table d'audit), comme vérifié chez ERP3602 (`AuditLog` protégé nativement, pas seulement côté applicatif).
- Ajout vs ERP3602 : table de **provenance/évidence générique** (hash SHA-256, horodatage, référence opaque) factorisée dans `packages/database` plutôt que réimplémentée par domaine (BIM, signature, IA, IoT le font déjà séparément chez ERP3602 — factoriser dès le départ).
- Données DEMO strictement séparées (organisation DEMO dédiée, flag `isDemo` propagé), conforme §42 du prompt.

### 5.2 API

- Préfixe versionné `/api/v1`, JSON strict, DTO avec rejet des propriétés inconnues, ID de corrélation sur chaque réponse, erreurs structurées — repris tel quel d'ERP3602 (patterns validés).
- Authentification : sessions opaques + cookie HttpOnly, jamais de JWT auto-porteur pour les sessions utilisateur (réduit la surface de vol de token). Option token API dédiée (scoped, révocable) pour les intégrations machine-à-machine du module 26 (API/Intégrations), séparée du système de session utilisateur.
- Autorisation systématiquement server-side via guard NestJS + permission déclarative, jamais déduite d'un champ transmis par le client — invariant non négociable, hérité et renforcé.
- Toute intégration externe non testée réellement est marquée `NOT TESTED` dans la documentation, jamais présentée comme fonctionnelle (conforme §33/§46 du prompt).
- Pas de proxy applicatif fragile type ADR-007 : le déploiement cible un reverse-proxy standard (Caddy/Nginx) devant Next.js et NestJS sur le même réseau interne, sans bootstrap JS de contournement CORS en prod — supprime la classe de bug qui a forcé ADR-007 chez ERP3602.
- Rate limiting et audit sur les endpoints sensibles dès le socle (login, changement de permissions, exports).

---

## 6. Stratégie PWA et mobile

Constat : ERP3602 n'a **aucune** brique PWA ni mobile — c'est l'écart le plus significatif entre l'état de référence et les exigences du prompt AXORA-ERP24 (§38).

Approche recommandée :

1. **Web = source de vérité fonctionnelle unique.** Toute la logique métier reste dans `apps/api` ; le front web (`apps/web`) est conçu responsive dès l'origine (breakpoints mobile/tablette/desktop), pas adapté a posteriori.
2. **PWA installable dès la Phase 1** : manifest, service worker avec stratégie de cache par type de route (app-shell en cache-first, données API en network-first avec repli cache, assets statiques en cache immuable), icônes et écran de démarrage.
3. **Mode hors-ligne ciblé** (§16 du prompt — module Field) : file de mutations en attente stockée localement (IndexedDB), rejouée à la reconnexion avec résolution de conflit explicite (dernière écriture serveur fait autorité, conflits remontés à l'utilisateur — jamais de fusion silencieuse de données financières/stock).
4. **Mobile Android/iOS** : Capacitor encapsule le même build web/PWA pour obtenir rapidement des apps installables avec accès caméra/QR/notifications push natives, en réutilisant 100% du code métier front. Une réévaluation vers du natif pur n'est justifiée que si un besoin non couvrable par les plugins Capacitor apparaît (ex. biométrie matérielle spécifique, scan avancé).
5. **iOS** : architecture compatible dès le départ (Capacitor le permet), mais toute signature/certificat/compte développeur Apple manquant est un blocage à déclarer explicitement (`BLOCKED`), jamais contourné — conforme §38 du prompt.
6. **Desktop Windows** : dans un premier temps, le PWA installable couvre déjà l'usage desktop léger ; un wrapper Tauri (ou reprise du pattern launcher ERP3602 si Tauri est indisponible dans l'environnement cible) n'est construit que si un besoin desktop spécifique (accès filesystem local, impression avancée, service Windows) le justifie.

---

## 7. Sécurité (renforcements ciblés vs ERP3602)

Repris tels quels (déjà solides) : deny-by-default RBAC server-side, sessions opaques hashées, scrypt, validation DTO stricte, pas de secret en dur, CORS restreint, audit append-only.

Renforcements pour AXORA-ERP24 :

- MFA activée par défaut pour les rôles à privilège élevé dès le socle (pas conditionnée à une variable d'environnement optionnelle comme ADR-006 le fait chez ERP3602 par nécessité de compatibilité ascendante — AXORA-ERP24 n'a pas cette contrainte historique).
- Politique de mot de passe configurable par organisation (longueur, expiration, historique) exposée en configuration, jamais codée en dur.
- Chiffrement au repos des secrets applicatifs (clé MFA, clés API tierces) via un gestionnaire de secrets externe (Vault/KMS du fournisseur cloud) plutôt qu'un simple `.env` en production.
- Scan de dépendances et SBOM en CI (extension du pipeline `security-release.yml` d'ERP3602).
- Journalisation des accès aux données sensibles (export, impression, téléchargement GED) en plus des écritures.

---

## 8. Étapes verticales recommandées (roadmap réaliste)

Reprend la logique de phases d'ERP3602 (`MASTER_SPEC.md §Delivery phases`), qui a produit un historique de livraison vérifiable, en intégrant PWA/mobile dès la phase 1 plutôt qu'en fin de parcours :

1. **Phase 0 — Fondations** : monorepo pnpm, CI (lint/typecheck/test/build/migrations), Docker dev, `packages/contracts` + `packages/security` + `packages/database` squelettes, Design System AXORA-ERP24 (tokens + composants de base), gate qualité (`docs/MODULE_STATUS.md`, `docs/DECISIONS.md`, `docs/ARCHITECTURE.md`, `docs/EXECUTION_STATE.md` créés dès le premier commit conformément à la section 48 du prompt).
2. **Phase 1 — Core + Identité + RBAC + PWA shell** : organisations/sociétés/sites/projets, utilisateurs, sessions, MFA, permissions, audit, command-center shell responsive, manifest+service worker PWA installable, recherche globale (full-text Postgres) + command palette.
3. **Phase 2 — CRM + Commercial (Study/DQE/Pricing/Quote/Contrat)** : parcours Lead→Opportunité→Devis→Contrat, moteur d'estimation DQE/BOQ/BPU.
4. **Phase 3 — Achats + Stock/Logistique** : demande→validation→consultation→commande→réception, mouvements de stock tracés, QR/codes-barres, base du mode offline Field (lecture stock hors-ligne).
5. **Phase 4 — Projets + Site/Chantier + Cost Control** : WBS, planning/Gantt, budget engagé/consommé/facturé, journal chantier mobile offline-first (premier livrable Capacitor réel).
6. **Phase 5 — Finance + RH** : AR/AP, trésorerie, présence/pointage QR, paie avec séparation stricte capture→identification→événement→validation→paie.
7. **Phase 6 — MEP + BIM/IFC + GED** : noyau de calcul MEP avec formules vérifiables, connecteur Revit avec distinction explicite détecté/connecté/lu/écrit (jamais simulé), GED avec RFI/transmittals/submittals.
8. **Phase 7 — QHSE + Commissioning + Assets/GMAO** : inspections/NCR, essais/anomalies/retest, actifs + maintenance préventive/corrective.
9. **Phase 8 — Automatisation + Workflow engine + IA (Copilot)** : moteur événement→condition→action généralisé, jobs asynchrones (`apps/worker`), couche IA avec preuve d'évidence immuable et respect strict du RBAC.
10. **Phase 9 — Smart Building + Energy + Analytics/BI** : adaptateurs protocolaires (BACnet/Modbus/MQTT/KNX) en worker séparé avec distinction protocole supporté/connecteur développé/équipement accessible/lecture testée/écriture testée (jamais de simulateur présenté comme preuve réelle), dashboards BI par direction.
11. **Phase 10 — Portails Client/Fournisseur + Académie + API publique documentée** : identités externes isolées, permissions dédiées deny-by-default, API publique versionnée avec rate limiting et audit.
12. **Phase 11 — Mobile natif packagé (Android/iOS) + Desktop wrapper + qualification finale** : builds Capacitor signés (Android) et pipeline iOS (avec blocage explicite si signature Apple absente), wrapper desktop si justifié, audit transversal, rapport final selon le gabarit du prompt (§57).

Chaque phase suit la boucle du prompt (§2/§47) : analyser→développer→tester→corriger→retester→intégrer→auditer, avec mise à jour continue de `docs/EXECUTION_STATE.md`, `docs/DECISIONS.md`, `docs/TEST_EVIDENCE.md`, `docs/MODULE_MATRIX.md`, et interdiction des faux `PASS` (§46).

---

## 9. Risques et points ouverts explicitement non tranchés ici

- Choix définitif Prisma vs alternative ORM : à confirmer en Phase 0 par un spike technique, pas figé par cette analyse seule.
- Choix Tauri vs wrapper .NET pour le desktop : dépend de la disponibilité de Tauri dans l'environnement de build cible, à valider en Phase 1.
- Conformité fiscale/comptable et normes d'ingénierie MEP : restent explicitement **hors périmètre tant qu'aucune source faisant autorité datée n'est fournie**, conformément à l'ADR-005 d'ERP3602 et à la section 14 du prompt — aucune règle fiscale ou normative n'est inventée dans ce rapport.
- Aucun secret, identifiant ou donnée de production n'a été consulté, créé ou requis pour produire cette analyse.

---

## 10. Rôles multi-agents proposés pour la suite (reprise §6 du prompt)

`AXORA-ERP24-ARCHITECT` (ce rapport), `AXORA-ERP24-UX`, `AXORA-ERP24-CORE`, `AXORA-ERP24-CRM`, `AXORA-ERP24-PROJECT`, `AXORA-ERP24-FINANCE`, `AXORA-ERP24-HR`, `AXORA-ERP24-PROCUREMENT`, `AXORA-ERP24-STOCK`, `AXORA-ERP24-MEP`, `AXORA-ERP24-BIM`, `AXORA-ERP24-FIELD`, `AXORA-ERP24-QHSE`, `AXORA-ERP24-ASSETS`, `AXORA-ERP24-SMARTBUILDING`, `AXORA-ERP24-AI`, `AXORA-ERP24-INTEGRATIONS`, `AXORA-ERP24-SECURITY`, `AXORA-ERP24-QA`, `AXORA-ERP24-DEVOPS`, coordonnés par l'architecte pour la cohérence, les frontières de modules (§4.2) et les merges.
