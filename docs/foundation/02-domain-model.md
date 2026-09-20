# AXORA-ERP24 — Modèle de Domaine (Bounded Contexts, Entités Prioritaires, Invariants)

**Rôle** : AXORA-ERP24-DOMAIN
**Mandat** : `AXORA-ERP24.txt` (prompt maître ; produit obligatoire **AXORA-ERP24**, anciennement nommé AX-A360 dans le texte source — substitution de nom uniquement, aucune autre substance modifiée)
**Référence fonctionnelle en lecture seule (non modifiée)** :
- `C:/Users/dmgpe/AX-ERP360-source-readonly/packages/database/prisma/schema.prisma` (+ fichiers `*.prisma` satellites sous `packages/database/prisma/` et `packages/database/prisma/models/`) — 136 modèles Prisma inspectés (`schema.prisma` = 63 modèles noyau/CRM/achats/stock/projet/RH/finance/BIM ; fichiers satellites = 73 modèles evidence/portails/QHSE/commissioning/assets/smart building/analytics/automation/AI/documents)
- `C:/Users/dmgpe/AX-ERP360-source-readonly/apps/api/src/**` (modules NestJS : core, identity, commercial, catalog, inventory, hr, payroll, site, smart-building, commissioning, workforce, notifications, common/guards)
- `C:/Users/dmgpe/AX-ERP360-source-readonly/docs/ARCHITECTURE.md`, `docs/MODULE_STATUS.md`, `docs/adr/*` (58 ADR)
- Travaux déjà livrés dans ce workspace : `.hermes/agent-reports/product-backlog.md` (AXORA-ERP24-PRODUCT — matrice de modules, backlog INC-00→INC-24, parcours E2E) et `.hermes/agent-reports/security.md` (AXORA-ERP24-SECURITY — modèle de sécurité/tenancy)

**Portée de ce document** : analyse et conception de domaine uniquement. Aucun code écrit, aucune migration exécutée, aucune modification d'ERP3602. Ce document définit un **modèle de domaine initial cohérent**, pas un schéma final : chaque bounded context reste `NOT_STARTED` au sens du vocabulaire de maturité défini dans le backlog produit tant qu'aucune implémentation n'existe.

---

## 1. Méthode

1. ERP3602 sert de référence de faisabilité fonctionnelle (37 modules, 136 modèles Prisma, patterns éprouvés : tenancy Organization→Company, RBAC deny-by-default, audit append-only, traçabilité immuable de provenance via des tables `*Source`/`*Evidence` dédiées plutôt que des colonnes de lien souples). AXORA-ERP24 **s'inspire** de ces patterns sans les copier tels quels : le périmètre est élargi (26 modules vs 37 côté ERP3602 mais avec un scoping projet plus fin, portails étendus, IA, énergie, flotte).
2. Chaque **bounded context** ci-dessous correspond à un sous-domaine métier avec son propre langage ubiquitaire, ses agrégats et ses invariants — délimité pour minimiser le couplage et maximiser la cohérence interne, en suivant la numérotation des modules du prompt maître (§8–§33) et la matrice de couverture déjà produite par AXORA-ERP24-PRODUCT.
3. Les **entités prioritaires** listées par contexte sont les agrégats racines et entités de premier ordre nécessaires pour rendre le contexte réellement exploitable en tranche verticale minimale (cohérent avec le principe « chaque incrément livre un logiciel exploitable », backlog §6) — pas l'exhaustivité des 136 modèles ERP3602, qui restent une réserve de patterns à consulter au moment de l'implémentation détaillée de chaque incrément.
4. Les **invariants** listés sont des règles métier non négociables devant être appliquées **côté serveur et, quand c'est réalisable, garanties en base de données** (contraintes, triggers, transactions) — reprise de la discipline ERP3602 (`Session_company_organization_guard`, trigger append-only sur `AuditLog`, contraintes d'unicité composées `[id, organizationId]` pour forcer la cohérence tenant sur toute relation).
5. Le **modèle multi-tenant** (§2) est le socle partagé (shared kernel) de tous les contextes suivants — c'est la seule structure de données qu'aucun contexte métier ne peut réinterpréter ni contourner.

---

## 2. Socle multi-tenant partagé (Shared Kernel — Core Bounded Context)

### 2.1 Hiérarchie de tenancy cible

```
Organization (tenant racine, 1 par client AXORA-ERP24)
  └─ Company (entité juridique/opérationnelle ; appartient à exactement 1 Organization)
      └─ Branch / Site (agence, dépôt, chantier logistique ; optionnel, appartient à exactement 1 Company)
      └─ Project (chantier/affaire ; appartient à exactement 1 Company — NOUVEAU niveau vs ERP3602)
          └─ Ressources métier de tous les bounded contexts (budgets, documents, stocks, tâches, BIM, QHSE, commissioning...)
```

Différence structurante par rapport à ERP3602 (qui s'arrête à Organization→Company) : AXORA-ERP24 introduit un **troisième niveau de scoping — Project** — parce que la gestion de projet/construction, MEP/BIM, QHSE, commissioning et field sont au cœur du produit et exigent des rôles et une visibilité par affaire, pas seulement par société (ex. un chef de chantier ne doit pas voir tous les projets de sa société). C'est une extension délibérée, documentée dans `security.md` §4.1/§5.2, reprise ici comme partie intégrante du modèle de domaine.

### 2.2 Entités prioritaires du socle (INC-00/INC-01)

| Entité (agrégat racine sauf mention) | Rôle | Champs de scoping obligatoires |
|---|---|---|
| `User` | Identité globale (peut appartenir à plusieurs organisations) | aucun (racine globale) |
| `Organization` | Tenant racine | — |
| `Company` | Entité juridique/opérationnelle | `organizationId` (non null) |
| `Branch` / `Site` | Agence, dépôt, site physique | `organizationId`, `companyId` (non null) |
| `Project` | Chantier/affaire — **entité de premier ordre du domaine**, pas un simple attribut | `organizationId`, `companyId` (non null) |
| `Membership` | Rattachement User↔Organization | `organizationId` |
| `CompanyMembership` | Rattachement Membership↔Company (accès explicite) | `organizationId`, `companyId` |
| `ProjectMembership` *(nouveau AXORA-ERP24)* | Rattachement Membership↔Project (rôles terrain) | `organizationId`, `companyId`, `projectId` |
| `Role` / `Permission` / `RolePermission` | RBAC : rôles nommés, permissions typées (constantes partagées, jamais des chaînes libres non contrôlées) | `organizationId` sur `Role` |
| `OrganizationRoleAssignment` / `CompanyRoleAssignment` / `ProjectRoleAssignment` *(nouveau)* | Attribution de rôle à 3 niveaux | scoping correspondant |
| `Session` | Session opaque serveur (contexte actif org/société/**projet**) | `activeOrganizationId`, `activeCompanyId`, `activeProjectId?` |
| `AuditLog` | Journal append-only de toute action sensible | `organizationId?`, `companyId?`, `projectId?` |
| `NumberingSequence` | Numérotation automatique par document/entité, scoping société | `organizationId`, `companyId` |
| `LocaleSettings` / `Currency` / `TaxRule` (configurable) | Paramètres régionaux, devises, taxes | `organizationId` (défaut), surcouche `companyId` |
| `Attachment`, `Comment`, `Task` (génériques, polymorphes) | Objets transverses attachables à toute ressource métier | scoping hérité de la ressource parente |
| `ApprovalRequest` (socle minimal du Workflow Engine, généralisé en BC-21) | Première brique d'approbation générique | scoping hérité + `requestedById`, `approverId` |

### 2.3 Invariants du socle (non négociables, base de tout le reste)

1. **Un `companyId`/`projectId` fourni par le client n'est jamais une preuve d'autorisation.** Le `RequestContext` est reconstruit à chaque requête protégée depuis la session persistée + les appartenances réelles en base (`Membership`/`CompanyMembership`/`ProjectMembership`).
2. **Cohérence référentielle forcée par construction** : toute relation d'un enfant vers son parent de tenancy utilise une clé composée `[id, organizationId]` (pattern ERP3602 `@@unique([id, organizationId])`), rendant une jointure cross-tenant *structurellement impossible*, pas seulement filtrée en application.
3. **Un `Project` appartient à exactement une `Company`, qui appartient à exactement une `Organization`.** Aucune ressource métier de projet (budget, tâche, document, stock affecté) ne peut référencer un `Project` d'une autre société.
4. **RBAC deny-by-default à trois niveaux** : permission effective = union déduplicée (organisation ⊕ société ⊕ projet), jamais une intersection implicite. Un rôle de projet n'accorde **aucun** droit implicite au niveau société/organisation (et réciproquement, un rôle société ne doit pas être présumé s'appliquer à un projet sans affectation ou permission de portée large explicite).
5. **Un identifiant cross-tenant deviné résout en « non trouvé »**, jamais en « accès refusé » explicite (ne pas confirmer l'existence d'une ressource à un tiers non autorisé).
6. **`AuditLog` est append-only** : aucune route `UPDATE`/`DELETE` applicative, renforcée par un déclencheur base de données rejetant toute modification/suppression même par accès direct.
7. **Toute mutation transversale à plusieurs agrégats scoping-critiques (ex. changement de contexte actif de session) est transactionnelle et revérifiée serveur avant écriture.**
8. **Aucune valeur monétaire ou de quantité métier n'utilise un flottant binaire** — type décimal exact partout où une transaction financière, un stock ou une quantité BOQ est en jeu (règle transverse à tous les contextes ci-dessous, pas seulement Finance).
9. **Numérotation automatique scoping société** : deux sociétés différentes peuvent réutiliser la même séquence numérique sans collision (`@@unique([organizationId, companyId, sequenceKey])`), jamais une séquence globale partagée entre tenants.
10. **Paramètres régionaux/devises/taxes configurables par organisation, surchargeables par société** — jamais une règle fiscale ou comptable codée en dur pour un pays donné sans configuration explicite et vérifiée (repris du prompt §14 et de l'ADR-005 ERP3602 par analogie).

---

## 3. Carte des bounded contexts (context map)

```
                         ┌────────────────────────────────────────────┐
                         │   BC-00 CORE / IDENTITY / TENANCY / RBAC    │  (shared kernel — §2)
                         │   + Workflow socle + Notifications + GED*   │
                         └───────────────┬──────────────────────────────┘
                                         │ fournit RequestContext, RBAC, audit, numérotation
        ┌────────────────────────────────┼─────────────────────────────────────────┐
        ▼                                ▼                                         ▼
┌───────────────┐               ┌────────────────────┐                    ┌────────────────┐
│ BC-01 CRM &    │  Devis accepté │ BC-04 PROJET &      │  budget engageant  │ BC-05 ACHATS    │
│ COMMERCIAL     ├──────────────►│ CONSTRUCTION         ├───────────────────►│ (PROCUREMENT)   │
│ (upstream)     │  (via BC-02   │ (cœur du domaine)    │                    │                 │
└───────┬────────┘  BC-03)       └──────┬───────┬───────┘                    └───────┬─────────┘
        │                               │       │                                    │ réception
        ▼                               │       │                                    ▼
┌───────────────┐                       │       │                            ┌────────────────┐
│ BC-02 ESTIMATION│◄──── chiffrage ──────┘       │                            │ BC-06 STOCK &   │
│ (DQE/BOQ/BPU)  │                               │                            │ LOGISTIQUE      │
└───────┬────────┘                               │                            └───────┬─────────┘
        │ devis                                  │                                    │ conso. chantier
        ▼                                        ▼                                    ▼
┌───────────────┐                       ┌────────────────────┐             ┌────────────────────┐
│ BC-03 CONTRACT │──────provenance─────►│ BC-09 FIELD/CHANTIER│◄────────────┤ (stock affecté projet)
│ (Quote→Contract)│                     │ + BC-10 GED (fondation)          └────────────────────┘
└───────┬────────┘                     └──────┬───────┬───────┘
        │ facturation client                  │       │
        ▼                                      ▼       ▼
┌───────────────┐                     ┌────────────┐ ┌────────────┐
│ BC-07 FINANCE  │◄── factures fourn.──┤ BC-11 QHSE │ │ BC-13 MEP  │
│ (AR/AP)        │      (BC-05)        └────────────┘ └──────┬─────┘
└───────┬────────┘                                            │ équipements
        │ coûts projet                                        ▼
        │                                              ┌────────────┐        ┌────────────────┐
        ▼                                              │ BC-14 BIM/ │───────►│ BC-12 COMMISSION│
┌───────────────┐                                      │ IFC/REVIT  │        │ -NING           │
│ BC-08 RH &     │─── chauffeurs ──►┌────────────────┐  └────────────┘        └──────┬──────────┘
│ WORKFORCE      │                  │ BC-18 FLOTTE   │                              │ mise en service
└───────┬────────┘                  └────────────────┘                              ▼
        │ effectifs                                                          ┌────────────────┐
        │                                                                    │ BC-15 ASSETS/   │
        ▼                                                                    │ GMAO            │
┌────────────────────┐                                                       └──────┬──────────┘
│ BC-19 SOUS-TRAITANTS│◄── réutilise BC-03/BC-05/BC-07/BC-11 (pas de duplication)     │
└────────────────────┘                                                              ▼
                                                                              ┌────────────────┐
┌────────────────┐     ┌────────────────┐                                   │ BC-16 SMART     │
│ BC-20 PORTAILS  │◄────┤ expose ressources déjà VERIFIED de BC-03/05/07     │ BUILDING/IoT    │
│ (Client/Fourn.) │      (deny-by-default, jamais d'héritage RBAC interne)   └──────┬──────────┘
└────────────────┘                                                                  ▼
                                                                              ┌────────────────┐
┌────────────────────┐   ┌──────────────────┐   ┌──────────────────┐         │ BC-17 ÉNERGIE   │
│ BC-21 WORKFLOW &    │◄──┤ consommé par TOUS│   │ BC-22 AI/COPILOT │         └────────────────┘
│ AUTOMATISATION      │   │ les contextes ci- │   │ (lit tout, RBAC   │
│ (généralise BC-00)  │   │ dessus (approbations)│  strict de l'appelant) │
└────────────────────┘   └──────────────────┘   └──────────────────┘

┌──────────────────────────┐   ┌──────────────────────────────┐
│ BC-23 ANALYTICS / BI      │◄──┤ BC-24 API & INTÉGRATIONS      │
│ (agrège données VERIFIED) │   │ (webhooks, connecteurs, clés) │
└──────────────────────────┘   └──────────────────────────────┘
```

**Relations de contexte (patterns DDD)** :
- BC-00 est un **shared kernel** : tous les autres contextes en dépendent directement (RequestContext, RBAC, audit, numérotation) et ne peuvent pas le contourner.
- BC-01→BC-02→BC-03→BC-04 est une chaîne **customer/supplier** stricte : chaque aval consomme un objet *figé* de l'amont (le devis accepté copié immuablement en lignes de contrat — cf. invariant §7.3), jamais une référence mutable.
- BC-05/BC-06/BC-07 forment un triangle **customer/supplier** avec BC-04 comme client commun (le budget engage l'achat, l'achat alimente le stock, le stock et l'achat alimentent la finance).
- BC-20 (Portails) est une **anticorruption layer (ACL)** volontaire : il n'expose jamais directement les agrégats internes de BC-03/05/07, seulement des vues accordées explicitement (`PortalResourceGrant`), pour garantir qu'aucune permission interne ne fuite vers une identité externe.
- BC-13/BC-14/BC-12/BC-15/BC-16/BC-17 forment la **chaîne équipement** (prompt §7) : un équipement passe de spécification (MEP) → objet BIM → mise en service (Commissioning) → actif géré (GMAO) → point de télémétrie (Smart Building) → poste de consommation (Énergie). Chaque étape ajoute des métadonnées sans dupliquer l'identité de l'équipement (référence stable, jamais une copie).
- BC-21 (Workflow/Automatisation) est un **service transverse invoqué**, pas un pipeline séquentiel : chaque contexte métier déclenche des événements qu'il consomme, sans connaître son implémentation interne.
- BC-22 (IA) est une **couche de lecture augmentée strictement bornée par le RBAC de l'appelant** — elle n'est jamais une porte dérobée d'accès aux données d'un autre contexte.

---

## 4. Bounded contexts détaillés — entités prioritaires & invariants

Pour chaque contexte : **Agrégats racines prioritaires**, **entités de support**, **invariants métier non négociables**, **dépendances**, **statut de départ**.

### BC-00 — Core / Identity / Tenancy / RBAC / Audit (fondation, §8 du prompt)
*(détaillé en §2 — rappel synthétique de ce qui n'y figure pas encore)*
- Entités additionnelles prioritaires : `Department`, `Team`, `Delegation` (délégation temporaire de validation, bornée dans le temps, elle-même auditée), `AuthorizationMatrix` (vue projetée, pas une source de vérité).
- Invariants additionnels :
  - Une **délégation** doit porter une date d'expiration obligatoire — jamais de délégation permanente silencieuse.
  - Toute création de rôle personnalisé est elle-même une action auditée nécessitant une permission de gestion RBAC dédiée, distincte des permissions qu'elle permet d'attribuer (séparation des pouvoirs).
- Dépendances : aucune (fondation).
- Statut : `NOT_STARTED`.

### BC-01 — CRM & Commercial (§9)
- **Agrégats prioritaires** : `Account` (entreprise cliente/prospect), `Contact`, `Lead`, `Opportunity`, `Activity` (note/appel/rendez-vous/tâche commerciale).
- Invariants :
  1. Un `Lead` ne devient `Opportunity` que par une transition explicite tracée (jamais une simple réécriture de statut sans historique).
  2. Une `Opportunity` gagnée (`WON`) est la **seule** porte d'entrée légitime vers BC-02 (Estimation) puis BC-03 (Devis/Contrat) — pas de chiffrage/contrat orphelin sans opportunité source.
  3. L'historique d'activités client est immuable une fois créé (append-only), consultable mais non réécrit.
  4. Toute entité est scoping `companyId` strict ; isolation cross-company testée.
- Dépendances : BC-00.
- Statut : `NOT_STARTED`.

### BC-02 — Estimation : Study / DQE / BOQ / BPU / Pricing (§11)
- **Agrégats prioritaires** : `CommercialStudy` (cadrage besoin), `DqeDocument` (Détail Quantitatif Estimatif), `DqeLine` (déboursé sec : matériau/main-d'œuvre/matériel/sous-traitance), `PriceLibraryEntry` (bibliothèque d'ouvrages/BPU), `SupplierPriceEvidence` (preuve de prix fournisseur immuable).
- Invariants :
  1. **Arithmétique décimale stricte** : quantité × prix unitaire × coefficient jamais en flottant binaire.
  2. Traçabilité immuable `Study → DqeDocument` (une étude source ne peut être réécrite après génération d'un DQE qui en dépend — pattern `*Source` ERP3602 ADR-0044).
  3. Une preuve de prix fournisseur (`SupplierPriceEvidence`) n'est **jamais écrasée** — une nouvelle offre crée une nouvelle preuve horodatée, l'historique de prix reste consultable.
  4. Versions/variantes de DQE sont des objets distincts et comparables, pas des mutations en place du DQE de référence.
  5. Un calcul de prix n'est jamais présenté comme validé sans exposer les données d'entrée et la formule vérifiable.
- Dépendances : BC-00, BC-01 (opportunité qualifiée).
- Statut : `NOT_STARTED`.

### BC-03 — Commercial Contracting : Devis → Contrat (§9 fin, §10 en amont)
- **Agrégats prioritaires** : `QuoteDocument`, `QuoteRevision` (versionné), `QuoteLine`, `ContractRecord`, `ContractLine`, `ContractVariation` (avenant/change order).
- Invariants :
  1. Un `ContractRecord` ne peut être créé que depuis un `QuoteRevision` au statut `ACCEPTED` — garde base de données, pas seulement applicative.
  2. Les `ContractLine` sont une **copie immuable exacte** des lignes du devis accepté au moment de la conversion (jamais une référence mutable vers le devis, qui pourrait continuer d'évoluer par ailleurs).
  3. **Neutralité juridique** : aucune inférence de portée juridique (signature, attribution, régime fiscal, juridiction) sans profil explicite fourni — l'enregistrement contractuel reste un objet de gestion interne, pas une preuve juridique tant que la signature n'est pas rattachée à une évidence réelle (GED/BC-10).
  4. Une `ContractVariation` référence le contrat d'origine et ne modifie jamais silencieusement les lignes contractuelles historiques — elle ajoute une révision tracée.
  5. Un contrat ne peut engendrer qu'un seul `Project` racine par défaut (règle de traçabilité de provenance immuable) ; toute exception (multi-projets sur un même contrat) doit être un choix explicite et documenté, pas un défaut implicite.
- Dépendances : BC-02.
- Statut : `NOT_STARTED`.

### BC-04 — Projet & Construction (§10) — cœur du domaine
- **Agrégats prioritaires** : `Project` (racine de tenancy — cf. §2), `ProjectWbsItem` (WBS/lots/phases/jalons, arborescence), `ProjectBudgetLine` (budget par nœud WBS **feuille uniquement**), `ProjectCommitment` (engagement financier issu d'achats/contrats), `ProjectRisk`, `ProjectIssue`, `ChangeOrder`, `ProgressBillingStatement` (situation de travaux).
- Invariants :
  1. **Le budget est porté par les nœuds WBS feuilles uniquement** — jamais de double comptage entre un nœud parent et ses enfants ; le budget d'un nœud parent est *dérivé* (somme), jamais saisi indépendamment.
  2. **Chaîne de comparaison budgétaire complète et cohérente à l'unité monétaire près** : Budget initial → Engagé → Commandé → Consommé → Facturé → Payé → Prévision à terminaison — chaque transition est traçable à un événement source réel (commande, réception, facture, paiement), jamais une saisie manuelle non tracée.
  3. L'avancement physique est recalculé à partir de données réelles (tâches closes, situations validées) — pas une valeur saisie librement sans lien vers sa source.
  4. Toute mutation budgétaire critique (engagement, réallocation) est transactionnelle avec verrouillage approprié contre les conditions de course.
  5. Un `ChangeOrder`/`ContractVariation` accepté doit se refléter dans le budget révisé du projet de façon traçable (pas une simple note libre).
- Dépendances : BC-00, BC-03 (provenance contrat).
- Statut : `NOT_STARTED`.

### BC-05 — Achats / Procurement (§12)
- **Agrégats prioritaires** : `Supplier`, `PurchaseRequest`, `PurchaseRequestLine`, `RfqConsultation` (demande de prix/appel d'offres), `PurchaseOrder`, `PurchaseOrderLine`, `GoodsReceipt`, `GoodsReceiptLine`, `SupplierEvaluation`.
- Invariants :
  1. **Rapprochement 3-way match obligatoire** : commande ↔ réception ↔ facture — un paiement fournisseur ne peut être validé sans correspondance cohérente (ou un écart explicitement justifié et audité).
  2. Réception partielle gérée sans casser le solde de la commande (solde résiduel toujours dérivable, jamais recalculé de façon incohérente).
  3. **Idempotence** sur double soumission de commande/réception (clé d'idempotence obligatoire sur les endpoints d'écriture critiques).
  4. Une commande engage un budget projet (BC-04) de façon visible en temps réel — pas de décalage silencieux entre engagement achat et budget projet.
  5. Une demande d'achat validée porte la trace de l'approbateur et du seuil de validation appliqué (séparation des devoirs : demandeur ≠ approbateur pour les seuils définis par politique).
- Dépendances : BC-00, BC-04 (budget engageant).
- Statut : `NOT_STARTED`.

### BC-06 — Stock & Logistique (§13)
- **Agrégats prioritaires** : `InventoryItem` (article), `Warehouse`, `StockLocation`, `StockBalance` (solde dérivé), `StockMovement` (ledger), `StockTransfer`, `StockAdjustment`, `ShipmentTracking`.
- Invariants :
  1. **Ledger de mouvements append-only** : `StockMovement` n'est jamais modifié ni supprimé après création ; toute correction est un nouveau mouvement d'ajustement explicite et audité (`StockAdjustment`), jamais une réécriture rétroactive.
  2. `StockBalance` est **toujours dérivé** de la somme des mouvements — jamais une valeur maintenue indépendamment qui pourrait diverger.
  3. Un solde ne devient jamais négatif sans mouvement d'ajustement explicite tracé et une permission dédiée.
  4. La consommation chantier (`StockMovement` de sortie affecté à un `Project`) doit obligatoirement porter la référence projet — pas de sortie de stock « orpheline » de toute affectation projet quand le contexte est un chantier.
  5. Transferts entre entrepôts : idempotents et transactionnels (déduction source + ajout destination dans la même transaction, jamais en deux étapes séparément committées).
- Dépendances : BC-00, BC-05 (réception).
- Statut : `NOT_STARTED`.

### BC-07 — Finance : AR/AP, Trésorerie (§14)
- **Agrégats prioritaires** : `Customer`/`SupplierAccount` (vues finance de BC-01/BC-05), `FinanceInvoice` (client), `FinancePayableInvoice` (fournisseur), `FinanceInvoiceLine`, `FinancePayment`/`FinancePayablePayment`, `CashAccount`/`BankAccount`, `CostCenter`, `ProjectCostAllocation`, `TreasuryForecastLine`.
- Invariants :
  1. **Type décimal exact obligatoire** sur toute valeur monétaire — aucune exception.
  2. Workflow de validation **avant** paiement — aucun paiement direct sans étape d'approbation franchie et tracée.
  3. **Garde anti-double-paiement** : une facture ne peut être payée deux fois pour le même montant total (contrainte + vérification transactionnelle avant écriture du paiement).
  4. Le solde d'une facture est recalculé à chaque paiement partiel, jamais stocké de façon incohérente avec la somme des paiements enregistrés.
  5. Aucune règle fiscale/comptable spécifique à un pays n'est codée en dur — configuration explicite par organisation/société, et toute règle non vérifiée reste `NOT_TESTED`/`BLOCKED` documentée, jamais présumée conforme.
  6. Une facture fournisseur référence sa source d'engagement (commande BC-05 ou contrat de sous-traitance BC-19) — pas de facture flottante sans provenance.
- Dépendances : BC-00, BC-03 (facturation client), BC-05 (factures fournisseur).
- Statut : `NOT_STARTED`.

### BC-08 — Ressources Humaines & Workforce (§15)
- **Agrégats prioritaires** : `HrDepartment`, `HrPosition`, `HrEmployee`, `HrContract` (contrat de travail), `HrTimesheet`, `HrTimesheetEntry`, `AttendanceEvent`, `LeaveRequest`, `PayrollRun` (calcul, sans logique fiscale pays présumée).
- Invariants :
  1. **Séparation stricte non contournable** : capture (badge/QR/PIN/biométrie) → identification → événement de présence → validation → paie. Chaque étape est un objet distinct ; aucune paie n'est calculée sans validation préalable de la feuille de temps correspondante par un rôle habilité.
  2. Une feuille de temps reste en brouillon tant qu'un rôle validateur distinct du déclarant ne l'a pas approuvée.
  3. Les événements de capture biométrique/badge ne sont déclarés disponibles que si un adaptateur matériel réel est effectivement connecté et testé — sinon `NOT_TESTED`/`BLOCKED` explicite, jamais simulé comme fonctionnel.
  4. Un congé/absence approuvé doit se refléter dans le calcul de présence avant tout calcul de paie couvrant la période concernée.
- Dépendances : BC-00.
- Statut : `NOT_STARTED`.

### BC-09 — Field / Chantier (mobile, offline) (§16)
- **Agrégats prioritaires** : `SiteDailyLog` (journal chantier), `SiteZone`, `SiteProgressEntry`, `SiteIssue` (réserve/incident), `SiteEvidence` (photo/observation horodatée), `SiteChecklistInstance`, `OfflineSyncQueueEntry`.
- Invariants :
  1. Toute `SiteEvidence` (photo, observation) est horodatée et **liée explicitement** à une tâche/zone/réserve — jamais une pièce jointe flottante sans contexte métier.
  2. Une `SiteIssue` (réserve) porte obligatoirement un responsable et une échéance ; sa fermeture est impossible sans preuve de correction rattachée (photo, contrôle QHSE).
  3. **Mode hors ligne** : les entrées créées offline sont mises en file d'attente locale et synchronisées de façon contrôlée à la reprise réseau ; un conflit de synchronisation (ex. même ressource modifiée en ligne entre-temps) est résolu explicitement (jamais une perte silencieuse de donnée terrain).
  4. Toute donnée créée offline porte un identifiant client généré localement, idempotent à la resynchronisation (pas de doublon en cas de renvoi).
- Dépendances : BC-00, BC-04 (projet), BC-06 (stock chantier), BC-10 (GED — fondation partagée).
- Statut : `NOT_STARTED`.

### BC-10 — GED / Gestion Électronique des Documents (§17) — service transverse
- **Agrégats prioritaires** : `ManagedDocument` (racine, arborescence par projet), `ManagedDocumentVersion` (immuable), `DocumentSignatureRequest`/`DocumentSignatureEvent`, `RfiRecord`, `TransmittalRecord`, `SubmittalRecord`.
- Invariants :
  1. **Chaque version d'un document est immuable** une fois publiée — une nouvelle révision crée une nouvelle `ManagedDocumentVersion`, jamais une réécriture du contenu d'une version existante.
  2. Statut de document (brouillon/soumis/approuvé/archivé) appliqué côté serveur avec RBAC dédié par transition ; chaque transition est auditée.
  3. Un `RfiRecord`/`SubmittalRecord` référence les documents et le projet concernés — pas de RFI orpheline sans contexte projet.
  4. Une demande de signature n'est déclarée « signée » que sur preuve d'événement de signature réel rattaché (`DocumentSignatureEvent`) — jamais un statut déclaratif sans évidence.
  5. Les droits de diffusion sont scoping projet/société — un document d'un projet n'est jamais visible par défaut à un autre projet de la même société sans droit explicite.
- Dépendances : BC-00 ; consommé par BC-09, BC-11, BC-12, BC-14, BC-19, BC-20.
- Statut : `NOT_STARTED` (fondation minimale attendue tôt car service transverse — cf. backlog INC-10).

### BC-11 — QHSE (§18)
- **Agrégats prioritaires** : `QhseInspection`, `QhseFinding` (NCR/non-conformité), `QhseCorrectiveAction`, `SafetyIncident`, `WorkPermit`, `ToolboxMeeting`.
- Invariants :
  1. Une `QhseFinding` (NCR) est **immuable sur ses faits constatés** une fois créée (append-only) — seules des actions correctives liées peuvent évoluer, jamais une réécriture du constat initial.
  2. **Séparation des devoirs** : la clôture d'une NCR/action corrective est réservée à un rôle distinct de son créateur.
  3. Chaque action corrective porte un responsable et une échéance ; le dépassement d'échéance est détectable (alimente les KPI, BC-23).
  4. Une NCR liée à un incident de sécurité déclenche l'audit renforcé (BC-00) — aucune suppression possible, y compris par un administrateur.
- Dépendances : BC-00, BC-04, BC-10 (preuves/documents).
- Statut : `NOT_STARTED`.

### BC-12 — Commissioning (§19)
- **Agrégats prioritaires** : `CommissioningActivity` (système/sous-système/équipement), `CommissioningCheckResult` (fiche d'essai), `CommissioningPunchItem` (anomalie/réserve), `CommissioningEvidence`.
- Invariants :
  1. **Aucune acceptation sans passage exhaustif des étapes précédentes** : précommissioning → essai → (anomalie → correction → retest)* → acceptation — garde applicative **et** base de données (séquence non contournable).
  2. Un `CommissioningPunchItem` référence un équipement réel identifié dans BC-13/BC-14 — jamais une anomalie « libre » sans objet technique rattaché.
  3. Un retest est obligatoire après toute anomalie corrigée avant acceptation — pas d'acceptation directe post-correction sans nouvelle preuve d'essai.
  4. La remise au client (DOE) référence les preuves de commissioning réelles, jamais une déclaration sans pièce jointe.
- Dépendances : BC-04, BC-13 (équipements), BC-10 (DOE), BC-14 (référence BIM).
- Statut : `NOT_STARTED`.

### BC-13 — MEP (Mécanique/Électricité/Plomberie/Courants faibles/Incendie) (§20)
- **Agrégats prioritaires** : `MepSystem` (par discipline : CVC, électricité, CFA, plomberie, protection incendie), `MepEquipmentSpecification`, `EngineeringCalculationRecord` (note de calcul avec hypothèses explicites).
- Invariants :
  1. **Aucun calcul n'est présenté comme validé sans exposer ses données d'entrée et sa formule vérifiable** — non négociable, repris explicitement du prompt (§20).
  2. Une norme d'ingénierie n'est jamais codée en dur sans source vérifiée documentée ; les zones de calcul non couvertes restent `NOT_STARTED` explicitement plutôt qu'approximées silencieusement.
  3. Toute modification d'une hypothèse de calcul crée une nouvelle révision de `EngineeringCalculationRecord`, jamais une réécriture in-place (traçabilité de la décision d'ingénierie).
  4. Un équipement spécifié ici est l'**identité de référence stable** reprise sans duplication par BC-14 (BIM), BC-12 (Commissioning) et BC-15 (Assets).
- Dépendances : BC-00, BC-04.
- Statut : `NOT_STARTED`.

### BC-14 — BIM / IFC / Revit (§21)
- **Agrégats prioritaires** : `BimModel`, `BimModelVersion`, `BimElement`, `ClashIssue`, `EquipmentBimBinding` (liaison équipement réel ↔ élément BIM).
- Invariants :
  1. **Distinction explicite et permanente entre 6 états** : connecteur disponible / Revit détecté / connexion établie / document ouvert / lecture testée / écriture testée — chaque état a sa propre preuve, jamais fusionnés en un statut unique optimiste.
  2. **Un simulateur ou un connecteur non exercé contre un Revit réel reste `NOT_TESTED`** — interdiction absolue de le présenter comme `CONNECTED`/`TESTED`.
  3. Import IFC vérifié par empreinte (hash) du fichier source — une version de modèle BIM référence son fichier d'origine de façon vérifiable, jamais une conversion silencieuse non traçable.
  4. Une `ClashIssue` référence les éléments BIM en conflit et un workflow d'approbation de résolution — pas une simple note libre.
  5. `EquipmentBimBinding` ne duplique jamais l'identité de l'équipement (référence vers BC-13/BC-15), il l'enrichit de métadonnées géométriques/spatiales.
- Dépendances : BC-00, BC-13.
- Statut : `NOT_STARTED`.

### BC-15 — Assets / GMAO (§22)
- **Agrégats prioritaires** : `AssetPassport` (identité d'équipement post-commissioning : numéro de série, fabricant, garantie), `MaintenancePlan` (préventif), `MaintenancePlanOccurrence`, `MaintenanceWorkOrder`, `MaintenanceTicket`.
- Invariants :
  1. Un `AssetPassport` référence son origine de mise en service (`CommissioningActivity`, BC-12) quand applicable — pas d'actif « apparu » sans traçabilité d'origine pour les équipements installés par le projet.
  2. Un `MaintenanceWorkOrder` consomme du stock (BC-06) et du temps technicien (BC-08) de façon **traçable** (mouvements de stock et temps rattachés explicitement à l'OT).
  3. **MTBF/MTTR calculés uniquement à partir de l'historique réel d'interventions** — jamais une estimation par défaut présentée comme mesurée.
  4. Un ticket ne devient OT que par une transition explicite tracée ; la clôture d'un OT exige une preuve d'intervention rattachée (compte-rendu, pièces consommées).
- Dépendances : BC-00, BC-12 (mise en service), BC-14 (passeport lié BIM), BC-06, BC-08.
- Statut : `NOT_STARTED`.

### BC-16 — Smart Building / GTB / BMS / IoT (§23)
- **Agrégats prioritaires** : `BuildingGateway`/`AccessControlGateway`-équivalent générique, `SmartTelemetryPoint`, `SmartTelemetryReading` (série temporelle), `SmartAlarm`, `SmartSetpoint` (consigne).
- Invariants :
  1. **Distinction explicite à 5 niveaux** : protocole supporté / connecteur développé / équipement réseau accessible / lecture réelle testée / écriture réelle testée — jamais fusionnés.
  2. **Un simulateur n'est jamais une preuve de communication avec un équipement physique** — statut par défaut `NOT_TESTED` tant qu'aucun contrôleur réel n'a été exercé.
  3. `SmartTelemetryReading` est un append-only en série temporelle — jamais réécrit, seule une nouvelle lecture peut corriger l'interprétation (avec horodatage propre).
  4. Une alarme référence le point de télémétrie et le seuil déclencheur exact — traçabilité complète de pourquoi elle s'est déclenchée.
- Dépendances : BC-00, BC-15 (actifs).
- Statut : `NOT_STARTED`.

### BC-17 — Énergie (§24)
- **Agrégats prioritaires** : `EnergyMeter`, `SmartEnergyInterval` (relevé d'intervalle), `EnergyProductionRecord` (PV, groupe électrogène, batterie), `EnergyAlert`.
- Invariants :
  1. **Calculs d'autonomie basés uniquement sur des données réellement disponibles** — jamais d'extrapolation présentée comme certaine sans données sources suffisantes.
  2. Ingestion d'intervalles énergétiques idempotente (rejeu d'un même intervalle ne crée pas de doublon comptabilisé deux fois).
  3. Un compteur/point de mesure référence un équipement ou un point de comptage identifié — pas une valeur agrégée sans source traçable.
- Dépendances : BC-00, BC-16 (télémétrie).
- Statut : `NOT_STARTED`.

### BC-18 — Gestion de parc / Flotte (§25)
- **Agrégats prioritaires** : `FleetVehicle` (véhicule/engin/machine), `FleetAssignment` (affectation chauffeur/projet), `FuelLog`, `FleetMaintenanceRecord` (lié à BC-15).
- Invariants :
  1. Une affectation de véhicule référence un `HrEmployee` (chauffeur, BC-08) et éventuellement un `Project` (BC-04) — pas d'affectation flottante sans responsable identifié.
  2. Le kilométrage et la consommation sont des séries d'événements horodatés (append-only), jamais une valeur unique écrasée à chaque relevé.
  3. La maintenance d'un véhicule réutilise le modèle GMAO (BC-15) plutôt que de dupliquer une logique d'ordre de travail parallèle.
- Dépendances : BC-00, BC-08 (chauffeurs), BC-15 (maintenance), BC-07 (coûts).
- Statut : `NOT_STARTED` (pas de module ERP3602 équivalent direct — à construire).

### BC-19 — Sous-traitants (§26)
- **Agrégats prioritaires** : `SubcontractorQualification`, `SubcontractPackage` (lot confié), `SubcontractorProgressStatement`, `SubcontractorRetention` (retenue de garantie).
- Invariants :
  1. Ce contexte **réutilise** les briques Contrat (BC-03), Achats (BC-05), Finance (BC-07) et QHSE (BC-11) plutôt que de dupliquer leur logique — un `SubcontractPackage` référence un `ContractRecord`/`PurchaseOrder` existant.
  2. Une situation de sous-traitant (`SubcontractorProgressStatement`) suit le même invariant de traçabilité que BC-04 (avancement dérivé de données réelles, jamais saisi librement).
  3. Une retenue de garantie est un objet de premier ordre avec une date de libération conditionnelle explicite — jamais une déduction implicite non tracée sur le paiement.
- Dépendances : BC-00, BC-03, BC-05, BC-07, BC-11.
- Statut : `NOT_STARTED`.

### BC-20 — Portails Client & Fournisseur (§27–§28)
- **Agrégats prioritaires** : `PortalPrincipal` (typé `CLIENT`/`SUPPLIER`, strictement séparé de `User`), `PortalInvitation`, `PortalSession` (table dédiée, cookie distinct), `PortalResourceGrant` (règle d'exposition explicite par ressource).
- Invariants :
  1. **Séparation stricte des identités** : un `PortalPrincipal` ne partage jamais de table de session avec les utilisateurs internes ; aucune attribution automatique de droits internes.
  2. **Aucun héritage implicite des permissions RBAC internes** — toute exposition de ressource (projet, document, facture) au portail nécessite un `PortalResourceGrant` explicite et scoping société.
  3. Un principal externe est rattaché à exactement une société et à un enregistrement métier racine (compte CRM ou fournisseur) dans cette société — jamais cross-société.
  4. Invitation à usage unique ; suspension/révocation invalide immédiatement toutes les sessions et invitations actives du principal concerné.
- Dépendances : BC-00, BC-03 (contrat), BC-05 (achats), BC-07 (factures) pour exposer des ressources réelles.
- Statut : `NOT_STARTED`.

### BC-21 — Workflow Engine & Automatisation (§29–§30) — service transverse généralisé
- **Agrégats prioritaires** : `WorkflowDefinition` (Événement → Condition → Action → Approbation → Notification → Escalade), `ApprovalInstance` (généralisation de `ApprovalRequest` du socle BC-00), `AutomationRule`, `AutomationEvent`, `AutomationExecution`.
- Invariants :
  1. Un `WorkflowDefinition` est configurable sans code spécifique nouveau pour chaque module consommateur — les modules métier déclenchent des `AutomationEvent` typés, jamais un appel direct à la logique d'approbation d'un autre module.
  2. Une `ApprovalInstance` exige un approbateur **distinct du demandeur** pour les seuils définis par politique d'organisation (séparation des devoirs, cohérent avec BC-05/BC-07/BC-08/BC-11).
  3. Une `AutomationExecution` déclenchée est idempotente et journalisée (succès/échec), jamais silencieuse en cas d'échec.
  4. Un webhook sortant déclenché par une automatisation est signé (HMAC) et horodaté anti-rejeu.
- Dépendances : BC-00 (socle minimal dès le début) ; consommé par pratiquement tous les autres contextes.
- Statut : `NOT_STARTED` (socle minimal attendu tôt — cf. backlog INC-01, généralisation en INC-21).

### BC-22 — AXORA-ERP24 AI / Copilot (§31)
- **Agrégats prioritaires** : `AiInferenceEvidence` (traçabilité de chaque interaction : requête, sources consultées, réponse, filtrage RBAC appliqué), `AiCopilotSession`.
- Invariants :
  1. **L'IA hérite strictement des droits de l'utilisateur qui l'invoque** — elle ne contourne jamais le RBAC, n'accède à aucune donnée que l'utilisateur ne pourrait pas lire lui-même.
  2. Chaque réponse du Copilot est **traçable à une source de données réelle** avec preuve du filtrage RBAC appliqué à l'utilisateur demandeur (`AiInferenceEvidence` obligatoire, pas d'appel modèle sans trace).
  3. Toute action d'écriture proposée par l'IA passe par les **mêmes vérifications de permission et d'audit** qu'une action humaine directe — jamais un chemin d'écriture privilégié.
  4. Un module n'est exposé au Copilot que lorsqu'il est au moins `IMPLEMENTED_NOT_VERIFIED` — pas d'exposition anticipée d'un domaine non fiabilisé.
- Dépendances : BC-00 (RBAC), tous les contextes de données interrogés.
- Statut : `NOT_STARTED`.

### BC-23 — Analytics / BI (§32)
- **Agrégats prioritaires** : `DashboardDefinition` (configurable), `DashboardWidget`, `OperationalAnalyticsSnapshot` (agrégats périodiques matérialisés par domaine).
- Invariants :
  1. Un snapshot analytique référence sa fenêtre temporelle et ses filtres de scoping (organisation/société/projet) de façon explicite — jamais un agrégat global qui mélangerait plusieurs tenants.
  2. Chaque indicateur affiché est connecté à une donnée réelle de l'application — aucune valeur fictive présentée comme réelle sur un tableau de bord de production.
  3. Les données `DEMO` n'apparaissent jamais dans les tableaux de bord d'une organisation de production, et inversement.
- Dépendances : BC-00, données réelles déjà produites par les contextes métier (au minimum Phase B/C/D du backlog).
- Statut : `NOT_STARTED`.

### BC-24 — API & Intégrations (§33)
- **Agrégats prioritaires** : `ApiKey` (scoping restreint, permissions explicites), `WebhookSubscription`, `WebhookDelivery`, `ExternalConnectorState` (par connecteur : disponible/implémenté/accessible/lecture testée/écriture testée — même grille que BC-14/BC-16).
- Invariants :
  1. Toute intégration externe non testée réellement est étiquetée `NOT_TESTED` dans la documentation produit — jamais présentée comme fonctionnelle.
  2. Une clé API n'a jamais un accès total par défaut — permissions explicites, rate limiting et quotas configurables par clé/IP.
  3. Webhooks entrants : vérification de signature obligatoire avant tout traitement, idempotence par identifiant d'événement.
- Dépendances : BC-00 ; agrège potentiellement tous les contextes.
- Statut : `NOT_STARTED`.

---

## 5. Invariants transverses (s'appliquent à tous les bounded contexts)

Ces règles ne sont pas répétées contexte par contexte mais s'appliquent partout, dès la première migration :

1. **Scoping tenant non contournable** : toute nouvelle table métier porte `organizationId`/`companyId` non nullable, et `projectId` quand la ressource est de nature projet — jamais un scoping optionnel « à ajouter plus tard ».
2. **Arithmétique décimale exacte** pour toute quantité, prix, taux, ou durée facturable.
3. **Append-only pour tout objet à valeur probante** : audit, mouvements de stock, constats QHSE/NCR, résultats d'essai commissioning, lectures de télémétrie — la correction se fait par un nouvel enregistrement, jamais par réécriture.
4. **Séparation des devoirs** sur toute étape d'approbation à enjeu financier ou de conformité (demandeur ≠ approbateur, créateur NCR ≠ clôtureur).
5. **États de connecteur honnêtes** (BIM/Revit, Smart Building, intégrations API) : jamais de simulateur présenté comme preuve de communication réelle.
6. **Aucune donnée `DEMO`** ne se mélange avec une donnée de production, dans aucun contexte, aucun export, aucun tableau de bord.
7. **Transactions obligatoires** sur toute mutation multi-agrégats affectant du stock, de la finance ou un paiement.
8. **Vocabulaire de statut honnête** repris tel quel du backlog produit : `PASS`/`PARTIAL`/`FAIL`/`BLOCKED`/`NOT TESTED`/`NOT VERIFIED` — jamais `READY`/`PRODUCTION READY`/`DEPLOYED`/`TESTED`/`CONNECTED`/`COMPLETE` sans preuve d'exécution vérifiable (SHA + run CI).

---

## 6. Alignement avec le backlog déjà produit

Ce modèle de domaine ne redéfinit pas l'ordre d'exécution : il fournit le **contenu structurel** (agrégats, invariants) que `.hermes/agent-reports/product-backlog.md` orchestre déjà en incréments `INC-00 → INC-24`. Correspondance directe :

| Bounded context (ce document) | Incrément(s) porteur(s) (backlog) |
|---|---|
| BC-00 Core/Tenancy/RBAC | INC-00, INC-01 |
| BC-01 CRM | INC-02 |
| BC-02 Estimation | INC-03 |
| BC-03 Devis→Contrat | INC-04 |
| BC-04 Projet/Construction | INC-05 |
| BC-05 Achats | INC-06 |
| BC-06 Stock/Logistique | INC-07 |
| BC-07 Finance | INC-08 |
| BC-08 RH | INC-09 |
| BC-09 Field + BC-10 GED (fondation) | INC-10 |
| BC-11 QHSE | INC-11 |
| BC-12 Commissioning | INC-12 |
| BC-13 MEP | INC-13 |
| BC-14 BIM/IFC/Revit | INC-14 |
| BC-15 Assets/GMAO | INC-15 |
| BC-16 Smart Building | INC-16 |
| BC-17 Énergie | INC-17 |
| BC-18 Flotte | INC-18 |
| BC-19 Sous-traitants | INC-19 |
| BC-20 Portails | INC-20 |
| BC-21 Workflow/Automatisation (généralisation) | INC-21 |
| BC-22 AI/Copilot | INC-22 |
| BC-23 Analytics/BI + BC-24 API | INC-23 |
| Multi-plateforme (hors bounded context métier) | INC-24 |

Aucune divergence d'ordre n'est introduite : le graphe de dépendances dures (§4 du backlog produit) reste la référence d'exécution ; ce document en détaille le **contenu de domaine**.

---

## 7. Ce que ce document ne prétend pas être

- **Ce n'est pas un schéma Prisma/SQL final.** Chaque bounded context devra affiner ses entités de support (champs, énumérations, index) au moment de son incrément d'implémentation, en s'inspirant des modèles ERP3602 correspondants (lecture seule) sans les copier mécaniquement — le périmètre AXORA-ERP24 diverge déjà sur au moins deux points structurants : le niveau `Project` dans la tenancy (absent d'ERP3602) et le module `Flotte` (BC-18, sans équivalent ERP3602 direct).
- **Ce n'est pas une déclaration de complétude.** Tous les bounded contexts sont `NOT_STARTED` au moment de la rédaction — aucun code n'existe dans `E:/AXORA ADM/AXORA_ERP24` en dehors du prompt maître et des rapports d'analyse.
- **ERP3602 n'a pas été modifié** : toutes les lectures ci-dessus proviennent de `C:/Users/dmgpe/AX-ERP360-source-readonly` en lecture seule, aucune écriture n'y a été effectuée.
- **Aucune question bloquante n'a été identifiée** pour l'établissement de ce modèle — les seuls points explicitement laissés ouverts (règles fiscales par pays, connecteurs physiques Revit/BMS/biométrie, signature numérique) sont déjà documentés comme `BLOCKED`/`NOT TESTED` légitimes potentiels dans le backlog produit (§8) et le modèle de sécurité, pas des questions à poser maintenant.
