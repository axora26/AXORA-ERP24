# AXORA-ERP24 — Statut des modules

Vocabulaire obligatoire : `NOT_STARTED`, `FOUNDATION`, `IN_PROGRESS`, `IMPLEMENTED_NOT_VERIFIED`, `VERIFIED`, `BLOCKED`, `NOT_TESTED`, `DEPRECATED`.

Aucun module n'est marque `VERIFIED` sans preuve CI reelle (numero de run + SHA exact). Voir `docs/foundation/06-product-backlog.md` pour la definition complete de chaque increment.

| ID | Module | Increment | Statut | Preuve (run CI + SHA) | Notes |
|---|---|---|---|---|---|
| INC-00 | Bootstrap technique + Design System + Shell | INC-00 | `IMPLEMENTED_NOT_VERIFIED` | commit `ada072f` (local, CI pas encore executee sur runner) | Monorepo pnpm operationnel : install/build/typecheck/test executes reellement en local avec succes. CI GitHub Actions ecrite mais jamais executee sur un runner reel — ne pas declarer VERIFIED avant un run CI effectif. |
| INC-01 | Core / Identity / Organization / RBAC / Audit | INC-01 | `FOUNDATION` | commit `ada072f` (local) | Schema Prisma pose et migration reellement appliquee sur PostgreSQL 18 (`20260920213943_init_core_rbac_audit`), seed DEMO verifie. Endpoints Organization CRUD fonctionnels en HTTP reel (curl 200) mais **sans guard RBAC/session branche** — non exposable en environnement partage. Reste a faire : auth (login/session), guards de permission, tests d'isolation tenant. |
| INC-02 | CRM | INC-02 | `NOT_STARTED` | — | |
| INC-03 | DQE/BOQ/BPU/Estimation | INC-03 | `NOT_STARTED` | — | |
| INC-04 | Devis -> Contrat | INC-04 | `NOT_STARTED` | — | |
| INC-05 | Projet & Construction | INC-05 | `NOT_STARTED` | — | |
| INC-06 | Achats | INC-06 | `NOT_STARTED` | — | |
| INC-07 | Stock & Logistique | INC-07 | `NOT_STARTED` | — | |
| INC-08 | Finance (AR/AP) | INC-08 | `NOT_STARTED` | — | |
| INC-09 | Ressources Humaines | INC-09 | `NOT_STARTED` | — | |
| INC-10 | Field/Chantier + fondation GED | INC-10 | `NOT_STARTED` | — | |
| INC-11 | QHSE | INC-11 | `NOT_STARTED` | — | |
| INC-12 | Commissioning | INC-12 | `NOT_STARTED` | — | |
| INC-13 | MEP | INC-13 | `NOT_STARTED` | — | |
| INC-14 | BIM / IFC / Revit | INC-14 | `NOT_STARTED` | — | |
| INC-15 | Assets / GMAO | INC-15 | `NOT_STARTED` | — | |
| INC-16 | Smart Building | INC-16 | `NOT_STARTED` | — | |
| INC-17 | Energie | INC-17 | `NOT_STARTED` | — | |
| INC-18 | Gestion de parc | INC-18 | `NOT_STARTED` | — | |
| INC-19 | Sous-traitants | INC-19 | `NOT_STARTED` | — | |
| INC-20 | Portails Client/Fournisseur | INC-20 | `NOT_STARTED` | — | |
| INC-21 | Workflow Engine + Automatisation | INC-21 | `NOT_STARTED` | — | |
| INC-22 | AI / Copilot | INC-22 | `NOT_STARTED` | — | |
| INC-23 | Analytics/BI + API publique | INC-23 | `NOT_STARTED` | — | |
| INC-24 | Multi-plateforme (PWA/Windows/Android/iOS) | INC-24 | `NOT_STARTED` | — | Manifest PWA minimal pose dans apps/web/public ; service worker non implemente. |

## Derniere mise a jour

2026-09-20 — Scaffolding initial du monorepo verifie de bout en bout : `pnpm install` (644 packages), `pnpm db:generate`, `pnpm build:packages`, typecheck api+web, 11/11 tests unitaires `packages/security`, build production api (nest build) et web (next build), migration Prisma appliquee sur PostgreSQL 18 reel (Docker), seed DEMO, API demarree et testee (`curl /health` -> 200, `curl /api/v1/organizations` -> donnees reelles), Web demarre et teste (`curl /` -> 200, shell rendu). Commit `ada072f` sur branche `feat/foundation`. Execution directe (pas de sous-agent) suite aux echecs de delegation (rate-limit Anthropic).
