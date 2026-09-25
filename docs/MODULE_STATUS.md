# AXORA-ERP24 — Statut des modules

Vocabulaire obligatoire : `NOT_STARTED`, `FOUNDATION`, `IN_PROGRESS`, `IMPLEMENTED_NOT_VERIFIED`, `VERIFIED`, `BLOCKED`, `NOT_TESTED`, `DEPRECATED`.

Aucun module n'est marque `VERIFIED` sans preuve CI reelle (numero de run + SHA exact). **La CI GitHub Actions est actuellement bloquee** : chaque job echoue en ~2 s sans journal (runs 3 a 7 sur `feat/foundation`), symptome d'un blocage de facturation/quota du compte GitHub — cause externe, hors du code. Tous les statuts ci-dessous s'appuient donc sur des executions **locales** reelles (PostgreSQL reel, API et navigateur reels) et restent au plus `IMPLEMENTED_NOT_VERIFIED`.

| ID | Module | Statut | Preuve locale | Reste a faire |
|---|---|---|---|---|
| INC-00 | Socle technique + Design System + Shell | `IMPLEMENTED_NOT_VERIFIED` | Monorepo pnpm, CI ecrite, shell web a routes par module, palette Ctrl K, kit UI partage, demarrage `pnpm local`, builds API/web de production OK. | Run CI distant ; theme sombre ; service worker PWA (INC-24). |
| INC-01 | Core — Identity / RBAC / Audit | `IMPLEMENTED_NOT_VERIFIED` | Sessions opaques, RBAC deny-by-default, limitation des connexions, audit login/logout, `/auth/context`, garde de perimetre entreprise, numerotation automatique atomique (test de concurrence). | Administration utilisateurs/roles dans l'UI, consultation du journal d'audit, MFA TOTP. |
| INC-02 | CRM — prospects / opportunites / pipeline | `IMPLEMENTED_NOT_VERIFIED` | 16 tests e2e CRM, parcours prospect -> opportunite verifie en navigateur. | Edition/suppression comptes et contacts, pagination, reorganisation du pipeline. |
| INC-03 | Etudes / DQE / BPU | `IMPLEMENTED_NOT_VERIFIED` | Tests e2e estimation (DQE finalise immuable, decimales exactes), interface Etudes & DQE. | Bibliotheque d'ouvrages, variantes, export Excel/PDF. |
| INC-04 | Devis -> Contrat | `IMPLEMENTED_NOT_VERIFIED` | 8 tests e2e (devis uniquement depuis DQE finalise, contrat uniquement depuis devis accepte, lignes figees). | Versions de devis, archivage de contrat. |
| INC-05 | Projets & Construction | `NOT_STARTED` | — | |
| INC-06 | Achats | `NOT_STARTED` | — | |
| INC-07 | Stock & Logistique | `NOT_STARTED` | — | |
| INC-08 | Finance (AR/AP) | `NOT_STARTED` | — | |
| INC-09 | Ressources Humaines | `NOT_STARTED` | — | |
| INC-10 | Field/Chantier + GED | `NOT_STARTED` | — | |
| INC-11 | QHSE | `NOT_STARTED` | — | |
| INC-12 | Commissioning | `NOT_STARTED` | — | |
| INC-13 | MEP | `NOT_STARTED` | — | |
| INC-14 | BIM / IFC / Revit | `NOT_STARTED` | — | |
| INC-15 | Assets / GMAO | `NOT_STARTED` | — | |
| INC-16 | Smart Building | `NOT_STARTED` | — | |
| INC-17 | Energie | `NOT_STARTED` | — | |
| INC-18 | Gestion de parc | `NOT_STARTED` | — | |
| INC-19 | Sous-traitants | `NOT_STARTED` | — | |
| INC-20 | Portails Client/Fournisseur | `NOT_STARTED` | — | |
| INC-21 | Workflow Engine + Automatisation | `NOT_STARTED` | — | |
| INC-22 | AI / Copilot | `NOT_STARTED` | — | |
| INC-23 | Analytics/BI + API publique | `NOT_STARTED` | — | |
| INC-24 | Multi-plateforme (PWA/Windows/Android/iOS) | `NOT_STARTED` | — | Manifest PWA present, service worker absent. |

## Gates locaux (derniere execution)

2026-09-25 — `pnpm typecheck` OK · `pnpm lint` OK · `pnpm test` 48 tests PASS · `pnpm test:e2e` 45 tests PASS (PostgreSQL 16 local) · `nest build` + `next build` OK · `pnpm local` + `pnpm demo:seed` executes (chaine commerciale complete creee via l'API reelle).
