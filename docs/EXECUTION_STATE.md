# AXORA-ERP24 — Etat d'execution courant

**Derniere mise a jour** : 2026-09-25 — branche `claude/funny-meitner-l317n1` (PR draft vers `feat/foundation`).

Le detail par module et les preuves sont dans `docs/MODULE_STATUS.md` ; les decisions dans `docs/DECISIONS.md`.

## Mode de travail

Developpement continu, increment par increment (`docs/foundation/06-product-backlog.md`). Chaque increment livre : schema Prisma + migration, API NestJS protegee (`@ScopedController`, permission explicite par route), audit transactionnel, tests e2e sur PostgreSQL reel (isolation tenant, RBAC refuse, invariants metier), ecran web, etape du jeu DEMO. Un increment n'est committe qu'apres `typecheck`, `lint`, `test`, `test:e2e` et builds verts en local, et verification des ecrans dans Chromium.

## Fait

- INC-00 a INC-04 (repris de `feat/foundation`).
- Socle plateforme (ADR-0007) : module commun, garde de perimetre, numerotation, tableau de bord reel, shell web a routes, kit UI, `pnpm local`, jeu DEMO via l'API.
- INC-01 complete : administration utilisateurs / roles / entreprises / audit, mot de passe, MFA TOTP.
- INC-05 : projets (contrat -> projet, WBS, budget par feuilles, baseline, avenants, taches, Gantt, jalons, risques).
- INC-06 : achats (DA, approbation par un tiers, comparatif fournisseurs, commandes, receptions partielles idempotentes, engagement projet).
- INC-07 : stock (grand livre append-only et soldes non negatifs garantis en base, cout moyen pondere, sorties chantier, transferts, inventaires) ; devise de reference par entreprise.
- INC-08 : finance (facturation client et situations, 3-way match, validation par un tiers, paiements anti-doublon, tresorerie, facture PDF).
- INC-09 : RH (employes, badges, pointages append-only, feuilles de temps validees par un tiers et imputees aux projets, conges, preparation de paie sans retenue legale presumee).
- INC-10 : GED (fichiers immuables par empreinte, revisions immuables, visa par un tiers) et chantier (journal signe, preuves horodatees, reserves levees sur preuve verifiee, synchronisation hors ligne avec conflits explicites) — ADR-0009.
- INC-11 : QHSE (inspections a checklist ouvrant automatiquement les NCR, NCR et incidents immuables en base, actions verifiees et NCR cloturees par un tiers, permis de travail, quarts d'heure securite, taux de frequence sur heures RH validees).
- INC-13 : MEP (systemes, equipements de reference, noyau de calcul transparent et versionne, notes de calcul revisionnees validees par un autre ingenieur).
- INC-12 : mise en service (sequence precommissioning -> essai -> anomalie -> correction -> retest -> reception -> remise DOE, garantie en base).
- INC-14 : BIM/IFC (lecteur IFC teste sur fichiers reels buildingSMART IFC2X3/IFC4/IFC4X3, versions verifiees par empreinte, visa, comparaison, liaison MEP, conflits) ; connecteur Revit natif honnetement NOT_TESTED.
- INC-15 : Actifs/GMAO (passeports a origine tracee depuis la mise en service, preventif idempotent, tickets -> OT, temps RH et pieces du grand livre de stock, cloture gardee en base, MTBF/MTTR/disponibilite sur historique reel).
- INC-16 : Smart Building (passerelles a jeton, ingestion idempotente avec conflits, alarmes au seuil fige, consignes confirmees par relecture, cinq niveaux de connectivite, simulateur jamais preuve) ; pilotes protocolaires natifs NOT_TESTED.
- INC-17 : Energie (compteurs, intervalles idempotents par passerelle ou import, tarifs historises, bilans avec couverture, autonomie uniquement sur donnees suffisantes, alertes figees).
- INC-18 : Parc (vehicules/engins adosses a la GMAO, compteurs monotones append-only, affectation a chauffeur habilite et vehicule en regle, carburant plein a plein, echeances, incidents -> tickets GMAO, cout de possession).
- INC-19 : Sous-traitants (fournisseurs qualifies avec vigilance, lots sur commandes emises, situations derivees des taches, factures en Finance, retenues de garantie de premier ordre).
- INC-20 : Portails client & fournisseur (identites externes separees, invitation a usage unique, exposition explicite re-verifiee, revocation immediate en base). Demo locale : /portal/login?c=<id entreprise>, moa@clinique-saint-luc.demo / PortailClient2026! et adv@fournisseur.demo / PortailFournisseur2026!.
- INC-21 : Workflow (evenements en outbox transactionnelle, definitions versionnees, executions idempotentes journalisees, approbations a quatre yeux avec escalade et barriere fail-closed sur achats/factures/situations, webhooks HMAC re-signes, notifications). Demo locale : daf@axora-erp24.local / Controle2026! (une approbation en attente).
- INC-22 : Copilote IA (reponses ancrees et citees, strictement bornees par le RBAC de l'appelant, preuve d'inference append-only a empreinte verifiee en base ; aucun modele generatif appele). Demo : la DAF voit ses demandes d'achat et un refus QHSE trace.
- Incident d'environnement : le conteneur a redemarre (PostgreSQL, API et web arretes) ; base relancee sans perte (29 migrations, donnees demo intactes), serveurs relances.
- INC-23 (partie 1) : Analytique (indicateurs mensuels sur donnees reelles, RBAC par indicateur, instantanes figes, export CSV, tableaux de bord partages).
- INC-23 (partie 2) : API publique v1 (cles bornees par leur createur et re-verifiees a chaque requete, debit, quota, IP, journal, OpenAPI), webhook entrant signe et idempotent vers le CRM, registre des connecteurs a grille de verite (`NOT_TESTED` explicites). Correctif tests : defauts d'environnement de test prioritaires sur le `.env` de developpement.
- Correctif : le catalogue `ALL_PERMISSIONS` est desormais indexe par la cle de permission (une fusion d'objets ecrasait les constantes homonymes READ/MANAGE de modules differents) ; test de non-regression.
- Polices auto-hebergees (@fontsource) : plus aucune requete vers un CDN tiers.
- INC-24 : PWA installable (manifeste, icones `any`/`maskable`, service worker sans cache d'API, page hors ligne), chantier utilisable hors ligne avec purge a la deconnexion, messages d'erreur en francais pour tous les clients (catalogue + test de couverture), en-tetes de securite API et web, contrastes AA et ARIA des graphiques, responsive 390/768 px, audit des dependances sans vulnerabilite, performances mesurees (ADR-0015). Emballages natifs Windows/Android/iOS `BLOCKED` (identites de signature absentes).
- Qualification finale : suite navigateur versionnee (`pnpm test:browser`, Playwright : 30 ecrans, axe-core, responsive, PWA hors ligne, securite ; job CI `browser-tests`), deux defauts d'accessibilite trouves par la suite et corriges, installation neuve reproductible prouvee sur une base distincte, preuves dans `docs/AXORA-ERP24_TEST_EVIDENCE.md`, rapport `docs/AXORA-ERP24_FINAL_DELIVERY_REPORT.md`.

## Bloque (externe)

- CI GitHub Actions : les jobs echouent en ~2 s sans journal depuis le run 3 (facturation/quota du compte GitHub). Aucun module ne peut etre promu `VERIFIED` tant qu'un run reel n'a pas abouti.
- Lien public vers l'instance locale de developpement : les services de tunnel (trycloudflare.com, localtunnel.me, ngrok.com) sont refuses par la politique reseau de l'environnement de developpement. Le suivi se fait via la page de suivi (captures reelles) et la PR.

## Prochaine etape

Les 25 increments du backlog sont implementes. Restent, hors du code : faire aboutir un run CI (attribution de runner / facturation GitHub) pour promouvoir les modules en `VERIFIED` ; fournir les identites de signature pour les emballages natifs ; connecter les systemes externes reels (SMTP, SMS, S3, banque, LLM, equipements GTB) pour tester les connecteurs `NOT_TESTED`. Le reste a faire fonctionnel par module est liste dans `docs/MODULE_STATUS.md`.
