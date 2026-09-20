# AXORA-ERP24 — Journal de decisions (ADR courtes)

Format : chaque decision porte un identifiant, une date, un contexte, la decision prise et sa justification. Aucune decision commerciale/juridique n'est prise ici sans validation utilisateur explicite (voir conditions d'arret legitimes, `docs/foundation/06-product-backlog.md` §8).

## ADR-0001 — Choix du gestionnaire de paquets : pnpm

**Date** : 2026-09-20
**Contexte** : corepack (fourni avec Node 24.19 sur cette machine) est casse — module `corepack/dist/pnpm.js` introuvable dans l'installation nvm4w locale.
**Decision** : installation directe de `pnpm@9` via `npm install -g pnpm@9 --force` (des fichiers pnpm/pnpx orphelins bloquaient l'installation normale ; supprimes explicitement avant reinstallation).
**Justification** : pnpm reste le gestionnaire recommande par `docs/foundation/01-architecture.md` (continuite avec ERP3602, workspaces natifs). Corepack sera retente plus tard si l'environnement est reinstalle ; ce n'est pas bloquant pour le developpement.
**Reversible** : oui.

## ADR-0002 — Prisma sans preview features au demarrage

**Date** : 2026-09-20
**Contexte** : ERP3602 utilise `prisma-client` generator avec `@prisma/adapter-pg` (Prisma 7, tres recent). Pour le scaffolding initial AXORA-ERP24, disponibilite et stabilite priment.
**Decision** : demarrer avec `prisma-client-js` standard (Prisma 6.x) sans preview features, migration vers le pattern adapter-pg d'ERP3602 a evaluer en Phase 0 avancee si un besoin de performance/edge le justifie.
**Justification** : reduit le risque d'echec d'installation/generation sur un scaffolding initial ; le modele de donnees (schema.prisma) reste compatible avec une migration ulterieure du generator.
**Reversible** : oui (spike explicitement note dans `docs/foundation/01-architecture.md` §9).

## ADR-0003 — Delegation multi-agents interrompue par rate-limit

**Date** : 2026-09-20
**Contexte** : 3 tentatives de delegation a 6 sous-agents en parallele (Architecture/UX/Domain/Security/QA-DevOps/Product) ont echoue en cascade : d'abord `reasoning_effort: max` invalide (corrige a `high`), puis rate-limit HTTP 429 Anthropic a 6 agents simultanes, puis a nouveau 429 avec 3 agents.
**Decision** : les 6 rapports fondateurs ont finalement ete produits avec succes (2 vagues de 3 puis 1 agent solo pour le dernier). La phase suivante (scaffolding de code, INC-00) est executee directement par l'orchestrateur plutot que deleguee, pour eviter une nouvelle serie d'echecs sur un travail mecanique qui ne beneficie pas de la parallelisation par sous-agent.
**Justification** : le scaffolding de fichiers ne necessite pas de raisonnement independant par agent — l'executer directement est plus fiable et plus rapide que de re-tenter une delegation sujette au rate-limit.
**Reversible** : oui, la delegation multi-agents reste utilisee pour les phases suivantes (INC-01+) une fois le rate-limit dissipe, avec un maximum de 2-3 agents concurrents au lieu de 6.

## ADR-0004 — Defaut d'isolation tenant detecte et corrige sur OrganizationService

**Date** : 2026-09-20
**Contexte** : lors de l'implementation de l'authentification INC-01, un test manuel avec 2 organisations reelles (bootstrap Org A et Org B via `/auth/register-organization`, puis appel authentifie a `GET /api/v1/organizations`) a montre que **les deux utilisateurs recevaient la liste complete de toutes les organisations existantes**, y compris celles de l'autre tenant. La cause : `OrganizationService.list()` faisait `findMany()` sans aucun filtre `organizationId`, et le guard de permission verifiait seulement la possession de la cle `core.organization.manage` dans le tenant de l'appelant, pas le contenu retourne par le service.
**Decision** : `Organization` etant la racine du tenant elle-meme (pas une ressource "sous" un tenant), la route `GET /organizations` (liste globale) a ete supprimee et remplacee par `GET /organizations/me`, qui ne retourne QUE l'organisation de l'utilisateur authentifie (`request.axoraUser.organizationId`), jamais une liste. Aucune route de creation libre d'organisation n'existe plus hors du bootstrap transactionnel `/auth/register-organization`.
**Justification** : reference `docs/foundation/03-security.md` — un guard de permission verifie qu'une ACTION est autorisee, il ne garantit pas que les DONNEES retournees par le service sont elles-memes scopees. Chaque service doit imposer son propre filtre tenant explicite, independamment du guard. Ce pattern (service scope explicitement, guard verifie l'action) doit etre reapplique systematiquement pour tous les futurs modules (INC-02+).
**Verification** : 4 tests e2e ajoutes dans `apps/api/test/tenant-isolation.e2e.test.ts`, executes contre une base PostgreSQL reelle, 5/5 PASS incluant l'assertion croisee explicite `expect(meA.body.slug).not.toBe(slugB)`.
**Reversible** : non applicable — c'est un correctif de securite, pas une decision technique reversible.
