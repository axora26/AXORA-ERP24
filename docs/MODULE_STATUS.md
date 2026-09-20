# AXORA-ERP24 — Statut des modules

Vocabulaire obligatoire : `NOT_STARTED`, `FOUNDATION`, `IN_PROGRESS`, `IMPLEMENTED_NOT_VERIFIED`, `VERIFIED`, `BLOCKED`, `NOT_TESTED`, `DEPRECATED`.

Aucun module n'est marque `VERIFIED` sans preuve CI reelle (numero de run + SHA exact). Voir `docs/foundation/06-product-backlog.md` pour la definition complete de chaque increment.

| ID | Module | Increment | Statut | Preuve (run CI + SHA) | Notes |
|---|---|---|---|---|---|
| INC-00 | Bootstrap technique + Design System + Shell | INC-00 | `IN_PROGRESS` | — | Monorepo pnpm, packages contracts/security/database/ui, apps api/web scaffoldes. CI et Docker dev pas encore verifies en execution reelle. |
| INC-01 | Core / Identity / Organization / RBAC / Audit | INC-01 | `NOT_STARTED` | — | Schema Prisma pose (Organization/Company/Branch/User/Role/Permission/AuditLog) ; endpoints Organization CRUD non securises (pas de guard RBAC) — a traiter avant toute exposition. |
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

2026-09-20 — Scaffolding initial du monorepo (INC-00 en cours), par execution directe (pas de sous-agent) suite aux echecs de delegation (rate-limit).
