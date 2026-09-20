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
