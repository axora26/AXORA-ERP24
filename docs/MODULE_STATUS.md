# AXORA-ERP24 — Statut des modules

Vocabulaire obligatoire : `NOT_STARTED`, `FOUNDATION`, `IN_PROGRESS`, `IMPLEMENTED_NOT_VERIFIED`, `VERIFIED`, `BLOCKED`, `NOT_TESTED`, `DEPRECATED`.

Aucun module n'est marque `VERIFIED` sans preuve CI reelle (numero de run + SHA exact). **La CI GitHub Actions est actuellement bloquee** : chaque job echoue en ~2 s sans journal (runs 3 a 7 sur `feat/foundation`), symptome d'un blocage de facturation/quota du compte GitHub — cause externe, hors du code. Tous les statuts ci-dessous s'appuient donc sur des executions **locales** reelles (PostgreSQL reel, API et navigateur reels) et restent au plus `IMPLEMENTED_NOT_VERIFIED`.

| ID | Module | Statut | Preuve locale | Reste a faire |
|---|---|---|---|---|
| INC-00 | Socle technique + Design System + Shell | `IMPLEMENTED_NOT_VERIFIED` | Monorepo pnpm, CI ecrite, shell web a routes par module, palette Ctrl K, kit UI partage, demarrage `pnpm local`, builds API/web de production OK. | Run CI distant ; theme sombre ; service worker PWA (INC-24). |
| INC-01 | Core — Identity / RBAC / Audit / MFA | `IMPLEMENTED_NOT_VERIFIED` | Sessions opaques, RBAC deny-by-default, limitation des connexions, `/auth/context`, garde de perimetre entreprise, numerotation atomique. Administration : utilisateurs, roles personnalises (matrice de permissions), entreprises, journal d'audit filtrable en lecture seule, garde du dernier OWNER, desactivation = revocation des sessions (16 tests e2e). Mot de passe en libre-service (revocation des autres sessions). MFA TOTP RFC 6238 : secret chiffre AES-256-GCM, anti-rejeu, defi a usage unique limite a 5 essais (6 tests e2e + 9 tests unitaires dont vecteurs RFC), parcours verifie dans Chromium. | Delegations temporaires, roles a portee projet, MFA imposee par politique d'organisation, "step-up" MFA sur actions critiques. |
| INC-02 | CRM — prospects / opportunites / pipeline | `IMPLEMENTED_NOT_VERIFIED` | 16 tests e2e CRM, parcours prospect -> opportunite verifie en navigateur. | Edition/suppression comptes et contacts, pagination, reorganisation du pipeline. |
| INC-03 | Etudes / DQE / BPU | `IMPLEMENTED_NOT_VERIFIED` | Tests e2e estimation (DQE finalise immuable, decimales exactes), interface Etudes & DQE. | Bibliotheque d'ouvrages, variantes, export Excel/PDF. |
| INC-04 | Devis -> Contrat | `IMPLEMENTED_NOT_VERIFIED` | 8 tests e2e (devis uniquement depuis DQE finalise, contrat uniquement depuis devis accepte, lignes figees). | Versions de devis, archivage de contrat. |
| INC-05 | Projets & Construction | `IMPLEMENTED_NOT_VERIFIED` | Projet issu d'un contrat ACTIF (un seul projet racine par contrat, montant et devise figes, WBS importable depuis les lignes), numerotation PRJ-AAAA-NNNN, WBS arborescent avec budget porte par les feuilles uniquement (parents derives, sans double comptage), baseline budgetaire figee, avenants avec separation des devoirs (demandeur != approbateur), budget revise = initial + avenants approuves, avancement physique pondere derive des taches, jalons (retard calcule), registre des risques (score P x I), transitions de statut controlees (demarrage apres baseline, cloture sans tache ouverte ni avenant en attente, motif obligatoire pour suspension/annulation), verrou pessimiste par projet. 12 tests e2e. Cockpit, WBS, Gantt, avenants, jalons/risques verifies dans Chromium. | Engage/consomme/facture/paye alimentes par INC-06/07/08/09 ; roles a portee projet ; situations de travaux ; export. |
| INC-06 | Achats | `IMPLEMENTED_NOT_VERIFIED` | Fournisseurs (numerotation FRN, evaluation qualite/delais/prix), demandes d'achat (DA) sur feuilles WBS dans la devise du projet, soumission par le demandeur et approbation par un tiers (separation des devoirs, rejet motive), consultation : offre par fournisseur chiffrant chaque ligne, comparatif trie, commande (BC) uniquement depuis une DA approuvee et une offre retenue (une seule par DA, offre expiree refusee), emission = engagement projet en temps reel (cockpit "Engage"), reception partielle idempotente sous verrou pessimiste (course entre deux receptions testee : une seule passe), "Consomme" projet = valeur recue, annulation uniquement avant reception (DA redevient commandable). 12 tests e2e. Ecrans demandes/comparatif/commandes/receptions verifies dans Chromium. | Rapprochement 3-way avec factures (INC-08), articles stockes (INC-07), seuils de validation par montant, retours fournisseurs. |
| INC-07 | Stock & Logistique | `IMPLEMENTED_NOT_VERIFIED` | Articles (seuil de reapprovisionnement, etiquette QR), depots et magasins de chantier rattaches a un projet, grand livre append-only **garanti en base** (trigger refusant UPDATE/DELETE, egalement pose sur le journal d'audit), soldes non negatifs **garantis en base** (CHECK), valorisation au cout moyen pondere sans residu d'arrondi, sorties chantier imputees au projet (cockpit "Consomme"), retours, transferts a valeur conservee, ajustements motives (permission distincte), inventaires physiques gelant le magasin et transformant les ecarts en ajustements traces, idempotence et verrou pessimiste (course entre deux sorties testee), reception d'achats d'articles stockes = entree en stock dans la devise de reference de l'entreprise (aucune conversion implicite). 12 tests e2e. | Reservations, numeros de serie/lots, inventaire mobile (scan) via PWA (INC-24), multi-devises de valorisation. |
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

2026-09-25 — `pnpm typecheck` OK · `pnpm lint` OK · `pnpm test` 58 tests PASS · `pnpm test:e2e` 103 tests PASS (PostgreSQL 16 local) · `nest build` + `next build` OK · ecrans verifies dans Chromium sans erreur console.
