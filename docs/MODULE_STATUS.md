# AXORA-ERP24 — Statut des modules

Vocabulaire obligatoire : `NOT_STARTED`, `FOUNDATION`, `IN_PROGRESS`, `IMPLEMENTED_NOT_VERIFIED`, `VERIFIED`, `BLOCKED`, `NOT_TESTED`, `DEPRECATED`.

Aucun module n'est marque `VERIFIED` sans preuve CI reelle (numero de run + SHA exact). Voir `docs/foundation/06-product-backlog.md` pour la definition complete de chaque increment.

| ID | Module | Increment | Statut | Preuve (run CI + SHA) | Notes |
|---|---|---|---|---|---|
| INC-00 | Bootstrap technique + Design System + Shell | INC-00 | `IMPLEMENTED_NOT_VERIFIED` | commit `ada072f` (local, CI pas encore executee sur runner) | Monorepo pnpm operationnel : install/build/typecheck/test executes reellement en local avec succes. CI GitHub Actions ecrite mais jamais executee sur un runner reel — ne pas declarer VERIFIED avant un run CI effectif. |
| INC-01 | Core / Identity / Organization / RBAC / Audit | INC-01 | `IMPLEMENTED_NOT_VERIFIED` | commit local (branche `feat/foundation`, apres `ada072f`) | Schema Prisma + migration reelle sur PostgreSQL 18. Authentification complete : bootstrap organisation transactionnel (`POST /auth/register-organization`), login (`POST /auth/login`), logout avec revocation de session (`POST /auth/logout`), session opaque hashee SHA-256 en cookie HttpOnly. SessionGuard + PermissionGuard deny-by-default branches sur toutes les routes Core. **Defaut d'isolation tenant reellement detecte et corrige pendant le developpement** : `OrganizationService.list()` retournait toutes les organisations cross-tenant ; remplace par `getOwn(organizationId)` scope strictement a l'appelant. 5/5 tests automatises PASS (`apps/api/test/tenant-isolation.e2e.test.ts` + `health.test.ts`) contre une base PostgreSQL reelle : 401 sans session, isolation cross-tenant (2 organisations distinctes, chacune ne voit que la sienne), rejet mot de passe errone, revocation session au logout. CI GitHub Actions pas encore executee sur runner reel — ne pas promouvoir VERIFIED avant cela. |
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

2026-09-20 — INC-01 (Core/Identity/RBAC/Audit) implemente avec authentification complete (bootstrap organisation, login, logout, sessions opaques) et guards RBAC deny-by-default reellement branches sur les routes. Un vrai defaut d'isolation tenant a ete detecte manuellement (curl croise entre 2 organisations de test) puis corrige (voir ADR-0004) et couvert par 4 tests automatises supplementaires (5/5 PASS au total dans `apps/api`). Web/API testes bout-en-bout en HTTP reel. Commit `ada072f` (INC-00) puis travail INC-01 sur la meme branche `feat/foundation`.
