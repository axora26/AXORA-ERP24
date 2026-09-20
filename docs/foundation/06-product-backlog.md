# AXORA-ERP24 — Matrice de Livraison & Backlog Vertical Priorisé

**Rôle** : AXORA-ERP24-PRODUCT
**Source du mandat** : `AXORA-ERP24.txt` (prompt maître, anciennement nommé AX-A360 — toute occurrence "AX-A360" dans le prompt source est remplacée par **AXORA-ERP24** dans ce document, à la demande explicite de l'utilisateur ; aucune autre substance n'est modifiée)
**Référence fonctionnelle en lecture seule** : `C:/Users/dmgpe/AX-ERP360-source-readonly/docs` (AXORA ERP3602 — 37 modules roadmap, 100 % readiness gates sur son périmètre vérifié actuel)
**État du dépôt cible au moment de l'analyse** : `E:/AXORA ADM/AXORA_ERP24`, branche `feat/foundation`, working tree propre, seul fichier présent = `AXORA-ERP24.txt`. **Aucun code n'existe encore.** Tous les modules ci-dessous partent donc de `NOT_STARTED`.
**Portée de ce document** : analyse et planification uniquement. Aucune modification de code, aucune question posée à l'utilisateur, conformément au mandat de délégation.

---

## 1. Méthode

1. Le prompt maître définit 26 modules produit (§8–§33), un design system et une UX cible (§34–§38), des exigences transverses d'architecture/sécurité/qualité (§39–§55) et des critères de livraison finale (§56–§58).
2. ERP3602 sert de **référence fonctionnelle de maturité** (§4 du prompt : analyser, ne pas copier, ne pas détruire). Sa `MODULE_STATUS.md` montre qu'un ERP construction/MEP/BIM/Smart Building complet peut atteindre `VERIFIED` module par module, en tranches verticales strictement scoping-limitées (jamais "tout un domaine d'un coup"). AXORA-ERP24 reprend cette discipline de tranche verticale, avec une nouvelle architecture, un nouveau design et un périmètre fonctionnel élargi (§1 du prompt).
3. Ce document livre trois artefacts :
   - **§2** — Vocabulaire de maturité (repris du prompt §46 + `MODULE_STATUS.md`).
   - **§3** — Matrice de couverture : tous les modules du prompt, domaine, section source, équivalent ERP3602, dépendances amont, parcours E2E rattaché.
   - **§4** — Graphe de dépendances inter-modules.
   - **§5** — Parcours E2E prioritaires détaillés avec critères d'acceptation par étape (prompt §44).
   - **§6** — Backlog vertical priorisé en incréments livrables (INC-00 → INC-24), ordonné selon la priorité demandée : **Core/auth/RBAC → CRM→contrat→projet → achats/stock/finance → RH/field/QHSE → engineering/BIM/assets/smart building**, puis les extensions (énergie, parc, sous-traitants, portails, workflow/automatisation, IA, analytics/API, multi-plateforme).
   - **§7** — Definition of Done générique + interdits (prompt §45–§46, §56).
   - **§8** — Risques et conditions d'arrêt légitimes (prompt §3).

---

## 2. Vocabulaire de maturité (obligatoire, aucune exception)

| Statut | Signification | Condition d'attribution |
|---|---|---|
| `NOT_STARTED` | Aucun travail engagé | Défaut de tout module tant qu'aucun commit ne le touche |
| `FOUNDATION` | Modèle de données + contrat API posés, pas de parcours utilisateur complet | Migration + endpoints squelettes existent et compilent |
| `IN_PROGRESS` | Parcours partiel fonctionnel, tests incomplets | Au moins un scénario nominal exécutable manuellement |
| `IMPLEMENTED_NOT_VERIFIED` | Fonctionnalité codée et testée localement, **CI pas encore passée sur le SHA exact** | Ne jamais annoncer `VERIFIED` avant preuve CI |
| `VERIFIED` | Le run CI exact-head (lint, typecheck, tests unitaires/intégration, E2E ciblé, migrations, build) est **passé et vérifiable par SHA** | Preuve = numéro de run + SHA, comme dans `MODULE_STATUS.md` d'ERP3602 |
| `BLOCKED` | Dépendance externe manquante (secret, matériel, décision métier/juridique) | Cf. §8 — conditions d'arrêt légitimes |
| `NOT_TESTED` | Intégration/connecteur existant mais non exercé contre un système réel | Ex. connecteur Revit non testé contre un vrai Revit, protocole BMS non testé contre un contrôleur physique |
| `DEPRECATED` | Abandonné consciemment | Doit être justifié dans les décisions |

**Interdits absolus (prompt §46, §56)** : ne jamais déclarer `READY`, `PRODUCTION READY`, `DEPLOYED`, `TESTED`, `CONNECTED`, `COMPLETE` sans preuve d'exécution réelle et vérifiable (numéro de run CI + SHA). Un écran affiché n'est pas une fonctionnalité terminée (prompt §45).

---

## 3. Matrice de couverture des modules

Colonnes : **ID** module AXORA-ERP24 · **Domaine** · **§ prompt** · **Équivalent ERP3602** (maturité *sur ERP3602*, pour référence de faisabilité — n'implique rien sur AXORA-ERP24) · **Dépendances amont obligatoires** · **Parcours E2E rattaché (§5)** · **Incrément de backlog porteur (§6)**.

| ID | Module AXORA-ERP24 | § prompt | Équivalent fonctionnel ERP3602 (référence) | Dépendances amont | Parcours E2E | Incrément |
|---|---|---|---|---|---|---|
| M01 | Core / Administration (orgs, entreprises, rôles, RBAC, audit, numérotation, workflows de base) | §8 | Bootstrap+Identity+Organization+Company+RBAC — `VERIFIED` | Aucune (fondation) | Auth/RBAC transverse à tous | INC-01 |
| M02 | CRM & Commercial (leads→opportunités→devis) | §9 | CRM — `VERIFIED` | M01 | Parcours commercial (§5.1) | INC-02 |
| M03 | Gestion de projet & construction (WBS, planning, budgets) | §10 | Projects — `VERIFIED` | M01, M02(contrat) | Parcours projet (§5.2) | INC-05 |
| M04 | DQE/BOQ/BPU/Estimation | §11 | Study + DQE + Pricing — `VERIFIED` | M01, M02 | Parcours commercial (§5.1) | INC-03 |
| M05 | Achats | §12 | Procurement — `VERIFIED` | M01, M03 (budget engageant) | Parcours achats (§5.3) | INC-06 |
| M06 | Stock & Logistique | §13 | Inventory + Logistics — `VERIFIED` | M01, M05 (réception) | Parcours stock (§5.4) | INC-07 |
| M07 | Finance | §14 | Finance AR/AP — `VERIFIED` | M01, M02(contrat), M05(achats→factures fournisseur) | Parcours finance (§5.5) | INC-08 |
| M08 | Ressources Humaines | §15 | HR (+ Payroll, Attendance) — `VERIFIED` | M01 | Parcours RH (§5.6) | INC-09 |
| M09 | AXORA-ERP24 Field / Chantier (mobile, offline) | §16 | Site — `VERIFIED` (hors mode offline mobile packagé) | M01, M03 | Parcours chantier (§5.7) | INC-10 |
| M10 | GED (gestion électronique des documents) | §17 | GED — `VERIFIED` | M01 | Transverse (RFI/submittals/DOE dans §5.7, §5.9) | INC-10 (fondation), approfondi dans INC-11/12/14 |
| M11 | QHSE | §18 | QHSE — `VERIFIED` | M01, M03, M10 | Parcours QHSE (§5.8) | INC-11 |
| M12 | Commissioning | §19 | Commissioning — `VERIFIED` | M01, M03, M13(équipements), M10 | Parcours commissioning (§5.9) | INC-12 |
| M13 | MEP (ingénierie CVC/électricité/CFA/plomberie/incendie) | §20 | MEP Engineering — `VERIFIED` | M01, M03 | Alimente §5.9 (équipements testés) | INC-13 |
| M14 | BIM / IFC / Revit | §21 | BIM — `VERIFIED` (connecteur Revit natif : non couvert par ERP3602, à construire) | M01, M13 | Alimente chaîne équipement (prompt §7 chaîne équipement) | INC-14 |
| M15 | Assets / GMAO | §22 | Assets + GMAO — `VERIFIED` | M01, M12(mise en service), M14(passeport équipement) | Parcours maintenance (§5.10) | INC-15 |
| M16 | Smart Building (GTB/BMS/KNX/BACnet/Modbus/MQTT/IoT) | §23 | Smart Building/IoT — `VERIFIED` (évidence de télémétrie ; connecteurs protocolaires physiques = évolution future explicite chez ERP3602) | M01, M15 | Transverse dashboards | INC-16 |
| M17 | Énergie | §24 | Energy — `VERIFIED` | M01, M16 | Transverse dashboards | INC-17 |
| M18 | Gestion de parc (véhicules/engins) | §25 | Non couvert explicitement par les 37 modules ERP3602 (à construire) | M01, M08(chauffeurs), M15(maintenance) | — (nouveau parcours à définir) | INC-18 |
| M19 | Sous-traitants | §26 | Couvert partiellement via Procurement/Contract/Site (pas de module dédié ERP3602) | M01, M03, M05, M07 | Étend parcours projet/achats/finance | INC-19 |
| M20 | Portail Client | §27 | Client Portal — `VERIFIED` (identité/session ; exposition ressources métier = extension explicite) | M01, M02/M03/M07(ressources exposées) | — | INC-20 |
| M21 | Portail Fournisseur | §28 | Supplier Portal — `VERIFIED` (idem) | M01, M05 | — | INC-20 |
| M22 | Workflow Engine (approbations configurables) | §29 | Governance (proposals) — `VERIFIED`, partiel vs. moteur générique demandé | M01 | Transverse à toutes les approbations | INC-01 (socle minimal), INC-21 (moteur complet) |
| M23 | Automatisation (règles/déclencheurs/webhooks) | §30 | AXORA Flow — `VERIFIED` | M01, M22 | Transverse | INC-21 |
| M24 | AXORA-ERP24 AI / Copilot | §31 | AI inference evidence — `VERIFIED` (traçabilité seulement ; pas d'appel modèle production) | M01(RBAC), données des modules interrogés | — | INC-22 |
| M25 | Analytics / BI | §32 | Analytics — `VERIFIED` | M01, données sources par domaine | Transverse dashboards direction | INC-23 |
| M26 | API & Intégrations | §33 | API interne versionnée — implicite dans chaque module ERP3602 | M01 | Transverse | INC-23 |
| X-UX | Design System, Command Center, Recherche globale, Notifications | §34–§37 | Core UI shell — `VERIFIED` | M01 | Transverse | INC-00 (socle), affiné à chaque incrément |
| X-PLAT | Plateformes cibles (Web/PWA/Windows/Android/iOS) | §38 | Non traité par ERP3602 (Web uniquement) | Tous modules Web stabilisés | — | INC-24 |

---

## 4. Graphe de dépendances (dépendances dures uniquement)

```
M01 Core/RBAC/Audit  ─────────────────────────────────────────────┐
   │                                                               │
   ├─► M02 CRM ──► M04 DQE/Estimation ──► (Devis) ──► M02b Contrat │
   │                                                       │       │
   │                                                       ▼       │
   ├─► M03 Projet/WBS/Budget ◄─────────────────────────────┘       │
   │        │                                                      │
   │        ├─► M05 Achats ──► M06 Stock/Logistique                │
   │        │        │                                              │
   │        │        └─► M19 Sous-traitants                        │
   │        │                                                      │
   │        ├─► M09 Field/Chantier ──► M10 GED (fondation)         │
   │        │        │                                              │
   │        │        └─► M11 QHSE                                  │
   │        │                                                      │
   │        ├─► M13 MEP ──► M14 BIM/IFC/Revit                      │
   │        │        │            │                                │
   │        │        └────────────┴─► M12 Commissioning            │
   │        │                              │                       │
   │        │                              ▼                       │
   │        │                        M15 Assets/GMAO                │
   │        │                              │                       │
   │        │                              ▼                       │
   │        │                        M16 Smart Building ──► M17 Énergie
   │        │                                                      │
   │        └─► M07 Finance ◄── (factures fournisseur M05, contrat M02b)
   │
   ├─► M08 RH ──► (chauffeurs) M18 Gestion de parc
   │
   ├─► M22 Workflow Engine (socle minimal dès M01) ──► M23 Automatisation
   ├─► M20/M21 Portails Client/Fournisseur (après M02b/M05/M07 pour exposer des ressources réelles)
   ├─► M24 AI/Copilot (lit tous les modules déjà VERIFIED, jamais avant leur RBAC)
   └─► M25/M26 Analytics/BI + API publique (agrège tous les domaines déjà VERIFIED)

X-UX (Design System/Command Center) : livré en socle avec M01, complété à chaque incrément suivant.
X-PLAT (multi-plateforme) : dépend de la stabilisation Web de tous les modules ciblés par le packaging.
```

**Règle de dépendance stricte** : un module ne peut jamais démarrer son incrément avant que ses dépendances amont ci-dessus soient au moins `IMPLEMENTED_NOT_VERIFIED`. Le Workflow Engine (M22) et GED (M10) sont volontairement introduits tôt en version minimale car ils sont consommés transversalement (approbations, pièces jointes) par presque tous les modules suivants — les construire en plein seulement plus tard créerait une dette de reprise massive.

---

## 5. Parcours E2E prioritaires (prompt §44) — détaillés avec critères d'acceptation par étape

| # | Parcours | Étapes | Modules impliqués | Critère d'acceptation (chaque étape doit être vérifiable, pas seulement affichée) |
|---|---|---|---|---|
| 5.1 | **Commercial** | Lead → Opportunité → Devis → Contrat → Projet | M02, M04, M02b, M03 | Chaque transition crée un enregistrement traçable côté serveur (pas seulement un changement de statut UI) ; un Contrat ne peut référencer qu'un Devis `ACCEPTED` existant ; un Projet créé depuis Contrat porte la provenance immuable (pattern ERP3602 ADR-0039). RBAC : lecture/écriture séparées par rôle commercial vs. direction. |
| 5.2 | **Projet** | Projet → Budget → Planning → Tâches → Avancement | M03 | Budget WBS = feuilles uniquement (pas de double comptage sur nœuds parents) ; avancement recalculé à partir de données réelles (tâches closes), jamais saisi à la main sans traçabilité ; comparaison Budget initial/engagé/commandé/consommé/facturé/payé/prévision (prompt §10) exposée et cohérente à un euro/franc près en arithmétique décimale exacte. |
| 5.3 | **Achats** | Demande → Validation → Consultation → Commande → Réception | M05 | Workflow d'approbation réel (pas de bouton qui ne fait rien) ; rapprochement commande/réception/facture 3-way match ; réception partielle gérée sans casser le solde ; idempotence sur double soumission. |
| 5.4 | **Stock** | Réception → Entrée → Affectation → Sortie chantier | M06, M09 | Ledger de mouvements immuable (append-only) ; solde jamais négatif sans mouvement d'ajustement explicite et audité ; affectation projet trace la consommation chantier réelle (prompt §13). |
| 5.5 | **Finance** | Facture → Validation → Paiement → Solde | M07 | Arithmétique décimale exacte (jamais flottant) ; workflow de validation avant paiement ; solde recalculé à chaque paiement partiel ; aucune règle fiscale/comptable pays codée en dur sans configuration explicite (prompt §14, ADR-005 ERP3602). |
| 5.6 | **RH** | Employé → Présence → Timesheet → Validation | M08 | Séparation stricte capture → identification → événement de présence → validation → paie (prompt §15) ; timesheet en brouillon tant que non validé par un rôle habilité ; aucune paie calculée sans validation préalable. |
| 5.7 | **Chantier** | Tâche → Photo → Contrôle → Réserve → Correction → Fermeture | M09, M10, M11 | Photo horodatée et liée à la tâche/zone ; réserve = objet propre avec responsable et échéance ; fermeture impossible sans preuve de correction (photo/QHSE) ; mode hors ligne testé avec synchronisation différée contrôlée et non silencieusement perdue. |
| 5.8 | **QHSE** | Inspection → NCR → Action corrective → Vérification → Clôture | M11 | NCR immuable une fois créée (append-only sur les faits), actions correctives assignées avec échéance, clôture réservée à un rôle distinct du créateur (séparation des devoirs, pattern ERP3602 QHSE). |
| 5.9 | **Commissioning** | Équipement → Test → Anomalie → Correction → Retest → Acceptation | M12, M13, M14 | Fiche d'essai avec résultats immuables, anomalie liée à un équipement réel (BIM/MEP), retest obligatoire avant acceptation, aucune acceptation sans passage par toutes les étapes précédentes. |
| 5.10 | **Maintenance** | Actif → Ticket → OT → Intervention → Clôture | M15 | Actif = passeport équipement traçable (numéro de série, garantie) ; OT (Ordre de Travail) lié à un ticket ; intervention consomme du stock (M06) et du temps (M08) de façon traçable ; MTBF/MTTR calculés à partir de données réelles d'historique, jamais simulées. |

---

## 6. Backlog vertical priorisé — incréments livrables (INC-00 → INC-24)

Principe directeur : **chaque incrément doit produire un logiciel réellement exploitable en bout de tranche** (interface + règles métier + serveur + API + base de données + migration + RBAC + audit + tests + états loading/empty/erreur — prompt §45), jamais une simple maquette. L'ordre respecte la priorité demandée par l'utilisateur.

Gabarit appliqué à chaque incrément : *Valeur livrée · Modules prompt couverts · Dépendances · Périmètre fonctionnel minimal exploitable · Exigences techniques non négociables · Parcours E2E validé · Definition of Done · Statut de sortie autorisé · Risques/blocages potentiels.*

### Phase A — Fondation (bloquant tout le reste)

#### INC-00 — Bootstrap technique + Design System + Shell applicatif
- **Valeur livrée** : un socle installable en une commande, avec une coquille applicative (navigation, thème clair/sombre, états vide/erreur) sur laquelle brancher tout module.
- **Modules prompt** : §34–§38 (Design System, Command Center vide, plateformes), §39–§41 (architecture, DB, sécurité de base), §49–§52 (Git, CI/CD, Docker, documentation).
- **Dépendances** : aucune.
- **Périmètre fonctionnel minimal** : layout sidebar rétractable + top bar + recherche (UI seule, sans données), thème clair/sombre, design tokens, page de connexion, page 404/erreur, squelette de navigation par domaine (vide tant que M01 n'existe pas).
- **Exigences techniques** : dépôt Git avec discipline de commit atomique (prompt §49) ; pipeline CI (lint/typecheck/build) ; Docker compose dev avec base de données ; `docs/AXORA-ERP24_EXECUTION_STATE.md`, `_DECISIONS.md`, `_TEST_EVIDENCE.md`, `_MODULE_MATRIX.md`, `_ARCHITECTURE.md` créés dès ce stade (prompt §48) ; choix de stack justifié par inspection réelle de l'environnement (prompt §5), pas par habitude ERP3602.
- **Parcours E2E validé** : build + démarrage + accessibilité clavier de base sur la coquille.
- **Definition of Done** : CI verte sur SHA exact ; Docker compose démarre et expose un healthcheck ; aucune donnée fictive présentée comme réelle.
- **Statut de sortie autorisé** : `VERIFIED` seulement avec run CI documenté par SHA.
- **Risques** : choix de stack = décision technique réversible, ne justifie pas une question utilisateur (prompt §67 — décisions techniques raisonnables prises seul).

#### INC-01 — Core / Identity / Organization / Company / RBAC / Audit
- **Valeur livrée** : première tranche réellement utilisable — un utilisateur peut se connecter, une organisation/entreprise existe, les permissions sont appliquées côté serveur, chaque action sensible est auditée.
- **Modules prompt** : §8 (Core complet), §41 (sécurité), §22 en germe (approbations minimales pour Workflow Engine).
- **Dépendances** : INC-00.
- **Périmètre fonctionnel minimal** : utilisateurs, organisations, entreprises/filiales/agences, départements/équipes/sites, rôles/permissions/groupes/délégations, matrice d'autorisation, journal d'audit, numérotation automatique, paramètres régionaux/langues/monnaies/taxes configurables, pièces jointes/commentaires/tâches génériques, approbation générique minimale (brique de M22).
- **Exigences techniques** : sessions serveur sécurisées (jamais de JWT auto-suffisant sans révocation), hash de mot de passe robuste, RBAC *deny-by-default* vérifié côté serveur (pas seulement masquage UI — prompt §8, §41), isolation multi-tenant testée par tentative d'accès croisé, MFA prévu en configuration (activable, jamais bloquant si non configuré), audit en append-only (aucune route UPDATE/DELETE sur les logs).
- **Parcours E2E validé** : connexion → changement de contexte entreprise → tentative d'action hors permission refusée côté serveur → audit visible.
- **Definition of Done** : tests RBAC (accès autorisé + accès refusé + isolation tenant croisée) exécutés et verts ; tests d'audit (création + non-modifiabilité) verts.
- **Statut de sortie autorisé** : `VERIFIED` uniquement si les tests d'isolation tenant et RBAC deny-by-default passent réellement en CI.
- **Risques** : aucun blocage légitime attendu à ce stade (pas de dépendance externe).

### Phase B — Chaîne commerciale → contrat → projet (priorité 2 demandée)

#### INC-02 — CRM (prospects → opportunités → pipeline)
- **Valeur livrée** : une équipe commerciale peut suivre un prospect jusqu'à l'opportunité qualifiée dans l'outil, avec activités et historique réels.
- **Modules prompt** : §9 (partie amont : prospects, contacts, entreprises, opportunités, pipeline, activités, rendez-vous, appels, tâches commerciales).
- **Dépendances** : INC-01.
- **Périmètre fonctionnel minimal** : CRUD scoping entreprise pour comptes/contacts/leads/opportunités/activités ; pipeline avec étapes configurables ; tableau de bord commercial basique connecté à des données réelles (pas de mock).
- **Exigences techniques** : toutes les entités scoping company via RBAC de M01 ; historique client immuable des activités.
- **Parcours E2E validé** : sous-ensemble de §5.1 (Lead → Opportunité).
- **Definition of Done** : isolation cross-company testée ; CRUD + pipeline testés en intégration.
- **Statut de sortie autorisé** : `VERIFIED` sur preuve CI.
- **Risques** : aucun.

#### INC-03 — Estimation : Study / DQE / BPU / Pricing
- **Valeur livrée** : une opportunité qualifiée peut être chiffrée avec un moteur d'estimation professionnel, avant transformation en devis.
- **Modules prompt** : §11 (DQE/BOQ/BPU intégral), partie centrale de §9 (offre).
- **Dépendances** : INC-02.
- **Périmètre fonctionnel minimal** : DQE avec quantités/prix en Decimal exact, unités explicites, déboursés secs (matériaux/main-d'œuvre/matériel/sous-traitance), coefficients/frais généraux/marges/taxes, versions/variantes, comparatif fournisseurs (lié à M05 en préfiguration), bibliothèque d'ouvrages, export Excel/PDF.
- **Exigences techniques** : arithmétique décimale stricte (jamais de flottant sur un prix) ; traçabilité immuable Study → DQE (pattern ADR-0044 ERP3602) ; aucune évidence de prix fournisseur écrasée.
- **Parcours E2E validé** : sous-ensemble de §5.1 (chiffrage avant devis).
- **Definition of Done** : tests d'arithmétique décimale exacts ; export PDF/Excel testé, pas seulement codé.
- **Statut de sortie autorisé** : `VERIFIED` sur preuve CI ; ne jamais présenter un calcul de prix comme validé sans données/formule vérifiables (prompt §20, extensible ici par analogie).
- **Risques** : aucun ; règles fiscales par pays restent explicitement `NOT_STARTED`/configurables tant qu'aucune source réglementaire n'est fournie (prompt §14, §41 ADR-005 ERP3602).

#### INC-04 — Devis → Contrat
- **Valeur livrée** : un DQE validé devient un devis versionné, puis un contrat interne traçable, prêt à générer un projet.
- **Modules prompt** : §9 (devis, propositions, contrats, commandes), fin du workflow cible §9.
- **Dépendances** : INC-03.
- **Périmètre fonctionnel minimal** : devis versionné dérivé du DQE, cycle soumission/acceptation/rejet, contrat créé uniquement depuis un devis `ACCEPTED`, numérotation locale entreprise, lignes de contrat = copie immuable exacte du devis accepté.
- **Exigences techniques** : aucune inférence de portée juridique (signature, attribution, régime fiscal, juridiction) sans profil explicite (prompt §14 fin ; pattern ADR-0035 ERP3602 — "legally neutral contract records").
- **Parcours E2E validé** : fin du parcours §5.1 (Devis → Contrat → Projet, jusqu'à la création de Projet en INC-05).
- **Definition of Done** : garde base de données empêchant un contrat sans devis accepté équivalent exact ; tests de cycle de vie du devis.
- **Statut de sortie autorisé** : `VERIFIED` sur preuve CI ; ne jamais afficher "contrat signé" sans preuve de signature réelle (renvoi vers évidence GED/signature, prompt §17/§41).
- **Risques** : signature numérique / certificat manquant → `BLOCKED` légitime si la fonctionnalité de signature elle-même est demandée à ce stade (prompt §3) ; l'enregistrement contractuel neutre reste livrable sans cela.

#### INC-05 — Projet & Construction (WBS, planning, budget)
- **Valeur livrée** : un contrat devient un projet pilotable avec structure de coûts, planning et suivi d'avancement réel.
- **Modules prompt** : §10 intégral.
- **Dépendances** : INC-04 (provenance contrat), INC-01.
- **Périmètre fonctionnel minimal** : portefeuille de projets, WBS/lots/phases/jalons, planning + Gantt, équipes/responsabilités/ressources, budgets par nœud WBS feuille uniquement, comparaison budget initial/engagé/commandé/consommé/facturé/payé/prévision, risques/problèmes/décisions/réunions/actions, variations/change orders, situations de travaux.
- **Exigences techniques** : budgets exacts en Decimal ; pas de double comptage entre nœuds parent/enfant WBS ; transactions pour toute mutation budgétaire critique.
- **Parcours E2E validé** : §5.2 intégral.
- **Definition of Done** : cockpit budget/coût testé avec scénarios d'engagement/consommation réels (pas de données fictives affichées comme réelles).
- **Statut de sortie autorisé** : `VERIFIED` sur preuve CI.
- **Risques** : aucun blocage légitime attendu.

### Phase C — Achats / Stock / Finance (priorité 3 demandée)

#### INC-06 — Achats (Procurement)
- **Valeur livrée** : le budget projet engage réellement des commandes fournisseurs avec workflow d'approbation.
- **Modules prompt** : §12 intégral.
- **Dépendances** : INC-05 (budget engageant), INC-01 (workflow d'approbation).
- **Périmètre fonctionnel minimal** : demande d'achat → demande de prix/consultation → comparaison fournisseurs → validation → bon de commande → réception (totale/partielle) → retour → rapprochement commande/réception/facture → suivi délais → évaluation fournisseurs.
- **Exigences techniques** : idempotence sur soumission de commande, protection de concurrence sur réception partielle, arithmétique décimale exacte, engagement budgétaire visible dans M03 en temps réel.
- **Parcours E2E validé** : §5.3 intégral.
- **Definition of Done** : tests de concurrence (double réception simultanée) verts.
- **Statut de sortie autorisé** : `VERIFIED` sur preuve CI.
- **Risques** : aucun.

#### INC-07 — Stock & Logistique
- **Valeur livrée** : la réception fournisseur alimente un stock traçable jusqu'à la consommation chantier.
- **Modules prompt** : §13 intégral.
- **Dépendances** : INC-06 (réception), INC-09/INC-10 pour la consommation chantier (dépendance faible, peut démarrer avant si affectation projet simplifiée).
- **Périmètre fonctionnel minimal** : articles/catégories/magasins/entrepôts/emplacements, entrées/sorties/transferts/réservations, inventaires, numéros de série/lots, seuils, valorisation, consommation chantier, affectation projet, traçabilité, QR code/codes-barres, inventaire mobile, demandes depuis chantier.
- **Exigences techniques** : ledger de mouvements immuable append-only ; solde jamais négatif sans ajustement explicite audité.
- **Parcours E2E validé** : §5.4 intégral.
- **Definition of Done** : tests de non-négativité du solde et d'idempotence de transfert verts.
- **Statut de sortie autorisé** : `VERIFIED` sur preuve CI.
- **Risques** : aucun ; le mode mobile complet (scan physique) dépend de INC-24 pour le packaging natif — la fonctionnalité web/PWA peut être `VERIFIED` avant.

#### INC-08 — Finance (AR/AP)
- **Valeur livrée** : factures clients et fournisseurs, paiements et soldes réels, reliés au contrat et aux achats.
- **Modules prompt** : §14 intégral.
- **Dépendances** : INC-04 (contrat → facturation client), INC-06 (facture fournisseur), INC-01.
- **Périmètre fonctionnel minimal** : clients/fournisseurs, factures/avoirs, paiements/encaissements/décaissements, échéanciers, dépenses, caisses/banques, rapprochements, budgets/trésorerie/prévisions, coûts projets/centres de coûts, engagements, validation des dépenses, tableaux financiers.
- **Exigences techniques** : Decimal strict partout ; workflow validation avant paiement ; garde base de données anti-double-paiement ; règles fiscales/comptables **configurables et non présumées** (jamais de conformité déclarée sans vérification spécifique, prompt §14).
- **Parcours E2E validé** : §5.5 intégral.
- **Definition of Done** : tests d'arithmétique et de non-double-paiement verts ; sortie imprimable facture testée (pas seulement codée).
- **Statut de sortie autorisé** : `VERIFIED` sur preuve CI ; toute règle fiscale pays non vérifiée reste explicitement `NOT_TESTED`/`BLOCKED`.
- **Risques** : conformité fiscale/comptable pays = décision commerciale/juridique potentielle → question utilisateur légitime uniquement si un client réel exige une juridiction précise (prompt §3).

### Phase D — RH / Field / QHSE (priorité 4 demandée)

#### INC-09 — Ressources Humaines
- **Valeur livrée** : gestion des employés jusqu'à la validation des feuilles de temps, séparée strictement de la paie.
- **Modules prompt** : §15 intégral.
- **Dépendances** : INC-01.
- **Périmètre fonctionnel minimal** : employés/contrats/postes/départements/compétences/documents, présences/horaires/feuilles de temps/pointage, congés/absences/missions/évaluations/formations, équipements affectés, dépenses/avances, paie (calcul, sans logique fiscale pays présumée), préparation QR/PIN/badge/biométrie via adaptateurs si matériel réellement disponible (sinon `BLOCKED`/`NOT_TESTED` explicite).
- **Exigences techniques** : séparation stricte capture → identification → événement de présence → validation → paie (prompt §15, non contournable techniquement).
- **Parcours E2E validé** : §5.6 intégral.
- **Definition of Done** : tests de séparation des étapes (aucune paie sans validation) verts.
- **Statut de sortie autorisé** : `VERIFIED` sur preuve CI ; biométrie/badge physique reste `NOT_TESTED` tant qu'aucun matériel réel n'est disponible.
- **Risques** : `BLOCKED` légitime si un dispositif biométrique physique est requis mais absent (prompt §3).

#### INC-10 — Field/Chantier + fondation GED
- **Valeur livrée** : les équipes terrain peuvent journaliser l'activité de chantier avec preuves, avec ou sans connexion réseau.
- **Modules prompt** : §16 intégral, §17 (fondation GED : arborescence, versions, statuts, métadonnées, recherche, droits, approbation, archivage — RFI/transmittals/submittals/fiches techniques/plans/PV/rapports/DOE en germe).
- **Dépendances** : INC-05 (projet), INC-01, INC-07 (stock chantier).
- **Périmètre fonctionnel minimal** : journal chantier, présence, équipes, tâches, avancement, photos horodatées, observations/réserves/incidents, matériels/stocks/livraisons, inspections, signatures, rapports journaliers, formulaires/checklists, plans/documents ; GED fondation (arborescence projet, versions/révisions immuables, statuts, droits, recherche).
- **Exigences techniques** : mode hors ligne avec file de synchronisation contrôlée et non silencieusement destructive (prompt §16 — pas de perte de données terrain) ; GED versions immuables (pattern ADR-0024 ERP3602).
- **Parcours E2E validé** : §5.7 intégral.
- **Definition of Done** : test de synchronisation différée (création hors ligne → reprise réseau → conflit résolu explicitement) vert.
- **Statut de sortie autorisé** : `VERIFIED` sur preuve CI pour le web/PWA ; le mode offline natif mobile complet dépend de INC-24 pour la preuve sur device réel.
- **Risques** : aucun blocage légitime à ce stade pour la version web/PWA.

#### INC-11 — QHSE
- **Valeur livrée** : inspections, non-conformités et actions correctives réellement pilotées jusqu'à clôture avec séparation des devoirs.
- **Modules prompt** : §18 intégral.
- **Dépendances** : INC-10 (GED, chantier), INC-01.
- **Périmètre fonctionnel minimal** : inspections, NCR/non-conformités, réserves, actions correctives, observations, incidents/accidents, permis, toolbox meetings, checklists, audits, preuves photographiques, responsables/échéances, KPI.
- **Exigences techniques** : NCR immuable une fois créée (faits append-only), clôture réservée à un rôle distinct du créateur.
- **Parcours E2E validé** : §5.8 intégral.
- **Definition of Done** : test de séparation des devoirs (créateur ≠ clôtureur) vert.
- **Statut de sortie autorisé** : `VERIFIED` sur preuve CI.
- **Risques** : aucun.

### Phase E — Engineering / BIM / Assets / Smart Building (priorité 5 demandée)

#### INC-12 — Commissioning
- **Valeur livrée** : mise en service d'équipements avec traçabilité complète essai → anomalie → correction → retest → acceptation.
- **Modules prompt** : §19 intégral.
- **Dépendances** : INC-13 (équipements MEP), INC-10 (GED/DOE), INC-05.
- **Périmètre fonctionnel minimal** : systèmes/équipements/sous-systèmes, procédures, précommissioning, essais, fiches d'essais, résultats, anomalies, réserves, corrections, retests, acceptation, mise en service, remise client, DOE.
- **Exigences techniques** : aucune acceptation sans passage exhaustif des étapes précédentes (garde applicative + base de données).
- **Parcours E2E validé** : §5.9 intégral.
- **Definition of Done** : test de garde de séquence (acceptation bloquée sans retest) vert.
- **Statut de sortie autorisé** : `VERIFIED` sur preuve CI.
- **Risques** : aucun.

#### INC-13 — MEP (ingénierie CVC/électricité/CFA/plomberie/incendie)
- **Valeur livrée** : espace d'ingénierie avec calculs vérifiables (pas de "boîte noire"), pour alimenter DQE, BIM et commissioning.
- **Modules prompt** : §20 intégral.
- **Dépendances** : INC-05 (projet), INC-01.
- **Périmètre fonctionnel minimal** : équipements/locaux/systèmes par discipline (CVC, électricité, CFA, plomberie, protection incendie), calculs avec hypothèses/notes de calcul/fiches techniques explicites, validations, équipements sélectionnés, quantitatifs, coordination.
- **Exigences techniques** : tout calcul présenté comme validé doit exposer données d'entrée + formule vérifiable (prompt §20, non négociable) ; kernel de calcul en arithmétique exacte/rationnelle si possible (pattern ERP3602 MEP kernel).
- **Parcours E2E validé** : alimente §5.9.
- **Definition of Done** : tests unitaires sur chaque formule de calcul avec cas de référence vérifiables.
- **Statut de sortie autorisé** : `VERIFIED` sur preuve CI ; jamais de calcul "validé" sans preuve de formule (prompt §20).
- **Risques** : aucune norme d'ingénierie ne doit être codée en dur sans source vérifiée (prompt §41 ADR-005 par analogie) → zones de calcul non couvertes restent `NOT_STARTED` explicitement plutôt qu'approximées.

#### INC-14 — BIM / IFC / Revit
- **Valeur livrée** : modèles BIM exploitables (métadonnées, éléments, quantités) avec un connecteur Revit dont l'état de connexion est toujours vérifiable et jamais simulé.
- **Modules prompt** : §21 intégral.
- **Dépendances** : INC-13 (équipements), INC-01.
- **Périmètre fonctionnel minimal** : projets BIM/modèles/versions, import IFC, propriétés/éléments/catégories/niveaux/zones/systèmes/équipements, quantités, documents liés (GED), clash issues, commentaires, workflows d'approbation.
- **Exigences techniques** : distinguer explicitement à tout moment *connecteur disponible / Revit détecté / connexion établie / document ouvert / lecture testée / écriture testée* (prompt §21, non négociable) ; import IFC vérifié par hash (pattern ADR-0023 ERP3602).
- **Parcours E2E validé** : alimente la chaîne équipement (prompt §7).
- **Definition of Done** : import IFC testé sur fichier réel ; chacun des six états de connexion Revit a un test dédié ou est marqué `NOT_TESTED` explicitement.
- **Statut de sortie autorisé** : `VERIFIED` pour l'import/gestion IFC seul, indépendamment du connecteur Revit natif ; **le connecteur Revit natif reste `NOT_TESTED` tant qu'aucun Revit réel n'a été exercé** — jamais simulé comme s'il l'était (prompt §21, interdiction absolue).
- **Risques** : absence de licence Revit/environnement Windows+Revit disponible pour tester → `BLOCKED`/`NOT_TESTED` légitime, à documenter, sans bloquer le reste du module.

#### INC-15 — Assets / GMAO
- **Valeur livrée** : passeport d'équipement post-commissioning, tickets et ordres de travail jusqu'à la clôture, avec indicateurs réels.
- **Modules prompt** : §22 intégral.
- **Dépendances** : INC-12 (mise en service), INC-14 (passeport équipement BIM), INC-07 (stock pièces détachées), INC-08 (coûts).
- **Périmètre fonctionnel minimal** : actifs/équipements/localisations/numéros de série/fabricants/garanties/documents/pièces détachées, gammes de maintenance préventive/corrective, interventions, tickets, ordres de travail, techniciens, historiques, coûts, SLA, disponibilité, MTBF/MTTR.
- **Exigences techniques** : MTBF/MTTR calculés uniquement à partir d'historique réel d'interventions (jamais estimés par défaut) ; intervention consomme stock (M06) et temps (M08) de façon traçable.
- **Parcours E2E validé** : §5.10 intégral.
- **Definition of Done** : test de calcul MTBF/MTTR sur jeu de données réel (démo identifiée `DEMO`, jamais confondue avec production).
- **Statut de sortie autorisé** : `VERIFIED` sur preuve CI.
- **Risques** : aucun.

#### INC-16 — Smart Building (GTB/BMS/IoT)
- **Valeur livrée** : ingestion et visualisation de télémétrie d'équipements, avec état de connectivité protocolaire toujours honnête.
- **Modules prompt** : §23 intégral.
- **Dépendances** : INC-15 (actifs), INC-01.
- **Périmètre fonctionnel minimal** : modèle bâtiments/équipements/capteurs/contrôleurs, ingestion télémétrie (batch/API), alarmes, consignes, tendances, tableaux de bord ; adaptateurs KNX/BACnet/Modbus/MQTT en couche connecteur modulaire.
- **Exigences techniques** : distinguer explicitement *protocole supporté / connecteur développé / équipement réseau accessible / lecture réelle testée / écriture réelle testée* (prompt §23, non négociable) ; un simulateur n'est jamais une preuve de communication physique.
- **Parcours E2E validé** : transverse (alimente dashboards M25).
- **Definition of Done** : ingestion testée via adaptateur générique/API réel ; chaque protocole physique non testé contre un contrôleur réel reste `NOT_TESTED`.
- **Statut de sortie autorisé** : `VERIFIED` pour la plateforme d'ingestion/évidence ; connecteurs protocolaires physiques `NOT_TESTED` tant qu'aucun équipement réel n'est disponible.
- **Risques** : `BLOCKED`/`NOT_TESTED` légitime en l'absence de matériel BMS physique — ne jamais compenser par un simulateur présenté comme preuve.

#### INC-17 — Énergie
- **Valeur livrée** : suivi de consommation/production énergétique avec alertes et comparaisons basées sur données réelles.
- **Modules prompt** : §24 intégral.
- **Dépendances** : INC-16 (télémétrie), INC-01.
- **Périmètre fonctionnel minimal** : consommation/production, réseau/PV/batteries/groupes électrogènes/onduleurs, compteurs, charges, puissance/énergie, tendances, alertes, coûts, comparaison, intensité énergétique, tableaux de bord.
- **Exigences techniques** : calculs d'autonomie basés uniquement sur données réellement disponibles (prompt §24, pas d'extrapolation fictive).
- **Parcours E2E validé** : transverse (alimente M25).
- **Definition of Done** : tests d'ingestion d'intervalles énergétiques avec garde de rejeu/idempotence.
- **Statut de sortie autorisé** : `VERIFIED` sur preuve CI.
- **Risques** : aucun si les compteurs/API sources sont disponibles ; sinon `NOT_TESTED` sur les adaptateurs physiques.

### Phase F — Extensions (après le cœur prioritaire, dans l'ordre de valeur)

#### INC-18 — Gestion de parc (véhicules/engins)
- **Modules prompt** : §25. **Dépendances** : INC-09 (chauffeurs), INC-15 (maintenance), INC-08 (coûts).
- **Périmètre** : véhicules/engins/machines, affectation, chauffeurs, kilométrage, carburant, maintenance, documents, assurance, consommation, incidents, coûts.
- **Definition of Done / Statut** : mêmes exigences transverses (RBAC, audit, Decimal, tests) qu'un module cœur ; `VERIFIED` sur preuve CI.

#### INC-19 — Sous-traitants
- **Modules prompt** : §26. **Dépendances** : INC-05, INC-06, INC-08.
- **Périmètre** : qualification, contrats, lots, équipes, documents, assurances, avancement, situations, paiements, retenues, qualité, HSE, performances — réutilise les briques Contrat/Achats/Finance/QHSE plutôt que de dupliquer leur logique.

#### INC-20 — Portails Client & Fournisseur
- **Modules prompt** : §27–§28. **Dépendances** : INC-04 (contrat), INC-06 (achats), INC-08 (factures), INC-01 (identités externes séparées).
- **Exigence non négociable** : identités externes CLIENT/SUPPLIER strictement séparées des identités internes, sessions isolées, exposition de ressources métier **deny-by-default** et explicitement accordée (pattern ERP3602 Client/Supplier Portal `VERIFIED`).

#### INC-21 — Workflow Engine généralisé + Automatisation
- **Modules prompt** : §29–§30. **Dépendances** : INC-01 (socle minimal déjà en place), tous les modules produisant des approbations (M02b, M05, M07, M08, M11).
- **Objectif** : généraliser le moteur d'approbation ad hoc de INC-01 en moteur configurable Événement → Condition → Action → Approbation → Notification → Escalade, réutilisable par tout module sans code spécifique nouveau.

#### INC-22 — AXORA-ERP24 AI / Copilot
- **Modules prompt** : §31. **Dépendances** : RBAC (INC-01) et **tous** les modules interrogés doivent être au moins `IMPLEMENTED_NOT_VERIFIED` avant que le Copilot ne les expose, puisque l'IA ne doit jamais contourner le RBAC (prompt §31, non négociable).
- **Definition of Done** : chaque réponse du Copilot est traçable à une source de données réelle avec preuve du filtrage RBAC appliqué à l'utilisateur demandeur.

#### INC-23 — Analytics/BI + API publique & Intégrations
- **Modules prompt** : §32–§33. **Dépendances** : données réelles déjà produites par les modules cœur (Phase B/C/D au minimum).
- **Exigence non négociable** : toute intégration externe non testée doit être étiquetée `NOT_TESTED`, jamais présentée comme fonctionnelle (prompt §33).

#### INC-24 — Multi-plateforme (PWA / Windows / Android / iOS) + durcissement transverse final
- **Modules prompt** : §38 (plateformes), §54 (performance), §55 (accessibilité), §56–§57 (critères de livraison, rapport final).
- **Dépendances** : stabilisation Web de tous les modules ciblés par le packaging.
- **Exigence non négociable** : si signature/certificat/compte développeur Apple manquant → indiquer le blocage de signature sans falsifier le résultat, tout en livrant ce qui est compilable/testable localement (prompt §38).
- **Livrable final** : `AXORA-ERP24 — FINAL DELIVERY REPORT` structuré selon le gabarit du prompt §57, avec chaque section appuyée par une preuve réelle (SHA, run CI, capture de test), jamais une déclaration non vérifiée.

---

## 7. Definition of Done générique (s'applique à **chaque** incrément ci-dessus)

Reprise stricte du prompt §45–§46, à cocher avant toute promotion de statut :

- [ ] Interface fonctionnelle (pas de bouton factice, pas d'écran vide sans explication)
- [ ] UX cohérente avec le Design System AXORA-ERP24
- [ ] Responsive (desktop / laptop / tablette / smartphone)
- [ ] Règles métier appliquées **côté serveur**
- [ ] API versionnée, validée, avec gestion d'erreurs structurée
- [ ] Base de données : migration contrôlée, contraintes d'intégrité référentielle
- [ ] RBAC deny-by-default vérifié par test (accès autorisé + refusé + isolation tenant)
- [ ] Audit des actions sensibles, append-only
- [ ] États loading / empty / erreur gérés explicitement
- [ ] Tests exécutés réellement (unitaires + intégration + E2E ciblé) — pas seulement écrits
- [ ] Export/impression si applicable au module
- [ ] Performance mesurée (pas seulement supposée) sur les opérations à risque (grands tableaux, recherche)
- [ ] Aucune donnée de démonstration confondue avec une donnée réelle (marquage `DEMO` explicite)
- [ ] Statut annoncé (`PASS`/`PARTIAL`/`FAIL`/`BLOCKED`/`NOT TESTED`/`NOT VERIFIED`) reflète une exécution réelle, jamais supposée

**Interdiction absolue** (prompt §46) : ne jamais annoncer `READY`, `PRODUCTION READY`, `DEPLOYED`, `TESTED`, `CONNECTED`, `COMPLETE` sans preuve d'exécution vérifiable par un tiers (SHA + run CI + capture de test).

---

## 8. Conditions d'arrêt légitimes (prompt §3) — rappel pour l'exécution du backlog

Une question à l'utilisateur ne devient légitime, pendant l'exécution de ce backlog, que dans ces cas précis :

1. identifiant/secret absent pour un connecteur externe (paiement, e-mail, BMS physique, Revit) ;
2. authentification externe nécessaire (OAuth tiers, certificat) ;
3. décision commerciale ou juridique (régime fiscal pays, mentions légales de contrat) ;
4. suppression irréversible de données réelles (jamais sur ERP3602 — prompt §4) ;
5. modification destructive d'une production existante ;
6. achat ou abonnement payant (licence Revit, service cloud facturé) ;
7. signature numérique/certificat absent ;
8. action physique sur un équipement (test sur contrôleur BMS/biométrie réel) ;
9. choix métier critique non déductible raisonnablement.

Dans tous les autres cas, l'exécuteur du backlog doit trancher lui-même et continuer, en documentant la décision dans `docs/AXORA-ERP24_DECISIONS.md`.

---

## 9. Synthèse — ordre d'exécution recommandé

`INC-00 → INC-01 → INC-02 → INC-03 → INC-04 → INC-05 → INC-06 → INC-07 → INC-08 → INC-09 → INC-10 → INC-11 → INC-12 → INC-13 → INC-14 → INC-15 → INC-16 → INC-17 → INC-18 → INC-19 → INC-20 → INC-21 → INC-22 → INC-23 → INC-24`

Chaque flèche est une **dépendance dure vérifiée en §4** ; aucun incrément ne doit démarrer avant que ses prérequis directs soient au moins `IMPLEMENTED_NOT_VERIFIED`. Les incréments d'une même phase (ex. B : INC-02→INC-05) peuvent être parallélisés par workstreams multi-agents (prompt §6) tant que les dépendances internes à la phase sont respectées (ex. INC-03 avant INC-04).

**État courant (au moment de la rédaction)** : dépôt vide de code → **tous les modules et incréments sont `NOT_STARTED`**. Le premier travail d'exécution attendu est INC-00.
