# AXORA-ERP24 — Etat d'execution courant

**Derniere mise a jour** : 2026-10-04 — code `b1a6cb1a27575c4c96484c393a0099eabe99baa8` poussé sur `feat/product-qualification`, issue de `54930c1` ; [PR brouillon #2](https://github.com/axora26/AXORA-ERP24/pull/2). Contrôles locaux réussis ; produit global `IN_PROGRESS`, CI distante `BLOCKED`, aucun statut global `VERIFIED`.

Le detail par module et les preuves sont dans `docs/MODULE_STATUS.md` ; les decisions dans `docs/DECISIONS.md`.

## Qualification courante des 3 et 4 octobre 2026

| Contrôle | Résultat réellement observé | Réserve sur la qualification finale |
|---|---|---|
| Migrations | 41 migrations recensées, deux schémas à jour sur les bases isolées | `qualification-product-migrations-final.log`, `qualification-test-migrations-final.log` ; la base historique est préservée |
| Types et builds | Types et reconstructions finales API/web réussis | API après correction du libellé PDF ; web après pagination/contraste |
| Lint | 0 erreur, 7 avertissements | Les avertissements d'images restent visibles dans le rapport |
| Unitaires | 200 réussis : sécurité 25, web 74, API 101 | Les suites ciblées sont comprises dans ce total |
| API PostgreSQL | Suite complète : 42 fichiers, 347/347 cas ; après correction historique, RH et exports : 12/12 ; dernière reprise RH/exports : **15/15** | **351 cas uniques** ; réexécutions non additionnées |
| Exports serveur | 6/6 contrôles AppModule PDF/XLSX ; rendu A4, pagination, coordonnées et QR imprimé vérifiés | Libellé de politique version 0 avec photographie présente corrigé et testé |
| Impressions navigateur | Neuf routes métier et facture ; défauts initiaux corrigés et reconstruits | **10 PDF / 11 pages A4** inspectés : aucun dépassement, recouvrement ou page de pied de page seul |
| Dépendances | 0 vulnérabilité connue après `exceljs>uuid: 11.1.1` | Audit de l'arbre local, pas certification future des dépendances |
| Navigateur global initial | 163 scénarios dans 18 fichiers : **157 réussites, 6 échecs** | Quatre contrôles d'accès et deux parcours d'inscription ; run antérieur aux dernières corrections, conservé distinctement |
| Navigateur après correction | Reprise auth/impression **15/15 réussie**, nouvelle globale **163/163 réussie** en 4,4 min | `qualification-browser-final-pass.log`, derniers bundles API/web de `b1a6cb1` ; résultats ciblé et global distincts |
| CI distante finale | Push `37161782565` et PR `37161799570` sur `b1a6cb1` bloqués avant exécution | Jobs initiaux sans runner/étapes ; annotations de compte verrouillé pour facturation confirmées |

Le total API de 351 correspond aux 347 cas complets, au nouveau cas de bulletin historique,
aux deux nouveaux cas d'import refusé sur projet COMPLETED/CANCELLED et à l'export de
politique version 0 avec photographie présente. Les réexécutions ne s'ajoutent pas à ce total.
Le résultat de la nouvelle globale navigateur et le SHA de code sont enregistrés dans
`docs/AXORA-ERP24_TEST_EVIDENCE.md` lorsqu'ils seront disponibles.

Les préparations de paie sans photographie antérieure de leurs paramètres ne sont pas
recalculées avec les règles actuelles. Les nouveaux détails horaires sont omis et présentés
comme **Non disponible (historique)**. Le montant automatique repris de la base et les
heures validées déjà enregistrées restent disponibles.

## Mode de travail

Developpement continu, increment par increment (`docs/foundation/06-product-backlog.md`). Chaque increment livre : schema Prisma + migration, API NestJS protegee (`@ScopedController`, permission explicite par route), audit transactionnel, tests e2e sur PostgreSQL reel (isolation tenant, RBAC refuse, invariants metier), ecran web, etape du jeu DEMO. Un increment n'est committe qu'apres `typecheck`, `lint`, `test`, `test:e2e` et builds verts en local, et verification des ecrans dans Chromium.

## Tranche du 3 octobre 2026

- CRM : annuaire pagine, detail et correction versionnee des comptes/contacts, archivage/restauration sans effacement de l'historique, contact principal unique, conversion concurrente et agregats par devise. Les compteurs de prospects ne sont plus exposes sans `crm.lead.read`.
- Etudes/DQE : correction et suppression des lignes en brouillon, version optimiste du document parent, contenu READY/FINALIZED fige egalement en base, exports PDF/XLSX.
- Finance : avoirs clients/fournisseurs a prix et taxe source figes, repartition des arrondis par deltas cumulatifs, emission serialisee avec les paiements, remboursements idempotents et plafonnes. Facturation, soldes, tresorerie, cockpit et analytics utilisent les montants nets d'avoirs/remboursements ; aucune sortie de stock n'est implicite lors d'un avoir.
- Projet : operations de 1 a 31 jours inclusifs en UTC, presence reelle avec nuits et anomalies, temps valides, stock net consomme, soldes actuels des magasins SITE, affectations FleetAssignment reelles et actifs marques comme origine projet. Rapport PDF. Cockpit et rapport refusent les sommes incompletes ou de devises incompatibles ; les couts RH exigent `hr.payroll.read`.
- RH : cartes QR a jeton propre, expiration/revocation/reemission, PDF recto/verso ; pointage QR a heure serveur. Import des pointages fermes en feuille DRAFT avec provenance IN/OUT, remplacement explicite et validation humaine distincte. Parametres de paie mensuelle ou par heures validees, photographie des parametres a la preparation, calcul cloture protege en base. Retenues legales non configurees et net a payer absent.
- Impression : neuf documents metier dans le navigateur et exports serveur specifiques, avec identite AXORA officielle, entreprise emettrice, references et mention DEMO. Le getter individuel du mouvement de stock applique les memes droits et le meme perimetre que la liste.
- Dashboard/Copilote : agregats separes par permission source pour factures clients/fournisseurs, commandes/demandes et contrats/devis ; montants clients distingues par devise.

### Preuves ciblees locales de cette tranche

Les nombres ci-dessous designent des suites distinctes, sans addition des reexecutions. Ils ne remplacent pas le gate global final ni une preuve CI sur SHA exact.

| Suite | Execution locale observee |
|---|---|
| CRM existant / annuaire / concurrence | 16 / 14 / 5 tests e2e passent |
| Correction brouillons Etudes/DQE | 11 tests e2e passent ; estimation existante 8 et frontieres transactionnelles 9 passent |
| Avoirs / calcul de repartition | 12 tests e2e et 3 tests unitaires passent |
| Operations projet | 7 tests e2e passent, dont dates, nuits, droits, devises et arrondis des receptions |
| Dashboard droits des sources | 5 tests e2e passent |
| Copilote | 10 tests e2e passent apres adaptation de la provenance distincte demandes/commandes |
| Parcours aval existants | Projets 12, finance 10, achats 12, sous-traitance 6 tests e2e passent |
| Stock, getter compris | 13 tests e2e passent ; cette suite remplace le resultat precedent a 12 cas |
| RH existant / operations RH / calculs RH | 9 / 9 tests e2e et 5 unitaires passent ; les 9 opérations RH remplacent les anciennes versions à 6 puis 7 cas |
| Composants web cibles | CRM 2, ventes 3, RH 5, operations projet 2, contenus d'impression 2 tests passent |

Typecheck API et contrats reconstruits, lint cible passe. Le typecheck web passe ; le lint web ne contient pas d'erreur mais conserve des avertissements relatifs aux images. Le parcours navigateur Etudes/DQE a ete exerce ; les autres parcours de la tranche et les exports sont a rattacher au rapport final courant, sans reprendre comme preuve les sorties de septembre.

## Perimetre de base livre historiquement (25 septembre 2026)

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

## Dependances externes et historique

- Le [run du 25 septembre](https://github.com/axora26/AXORA-ERP24/actions/runs/36157192308/job/108144506522), commit `54930c1462a5af4be5428c1846e66d09397e6465`, a échoué avant démarrage : `runner_id: 0`, aucune étape, journal absent. Son annotation dit exactement : « The job was not started because your account is locked due to a billing issue. » Ce constat historique ne prouve pas l'état actuel du compte GitHub. Le workflow de ce commit autorisait seulement les bases de PR `main` et `feat/**` ; le workflow courant inclut explicitement `claude/funny-meitner-l317n1` et génère `SERVICE_CARD_ENCRYPTION_KEY` pour les jobs API et navigateur. Les runs push `37161782565` et PR `37161799570` sont observés `BLOCKED` sur `b1a6cb1`, avant exécution, avec annotations de compte verrouillé pour facturation ; aucune promotion `VERIFIED`.
- Le refus des services de tunnel etait un constat de l'ancien environnement. La presente livraison est locale ; aucune URL publique ni disponibilite distante n'est annoncee.
- Les emballages natifs signes et les connecteurs externes exigent encore les prerequis cites dans `MODULE_STATUS.md` et une execution contre leurs systemes reels.

## Prochaine etape

## Mise à jour du 4 octobre 2026 — avances, comptabilité et responsive

- L'ERP expose maintenant les avances salariés avec persistance Prisma, permissions `hr.advance.*`, audit, approbation à quatre yeux et remboursements bornés au principal. La page RH est ajoutée à la navigation et reste exploitable sur mobile.
- La comptabilité générale et la facturation signée déjà livrées sont maintenues : écritures équilibrées, états financiers, export CSV, PDF facture A4 AXORA, signature HMAC interne, empreinte SHA-256 et QR de vérification.
- Le contrôle de périmètre projet a été corrigé pour respecter les réponses 403/404 attendues sans divulgation de données ; la propriété `projectId` du scope reste non énumérable afin d'empêcher son injection dans les filtres Prisma.
- Contrôles locaux observés : API 108/108 et web 74/74 en unitaires ; avances 1/1, HR 9/9, QHSE 11/11, projets 12/12, exports 6/6 et opérations projet 7/7 en E2E ciblés ; responsive `/hr/advances` validé à 390 et 768 px ; typechecks et builds réussis ; lint web sans erreur avec 8 avertissements d'images existants. La suite E2E globale conserve les contraintes d'environnement documentées et aucun statut CI distant n'est promu `VERIFIED`.

## Incrément du 4 octobre 2026 — RBAC porté par projet

- Les requêtes métier résolvent désormais `projectId` depuis la requête, le corps ou les routes `/projects/:id`, puis vérifient l'appartenance du projet à l'entreprise et à l'organisation de la session.
- `PermissionGuard` transmet ce projet au moteur d'autorisation : une affectation entreprise ou projet ne peut plus autoriser silencieusement un autre chantier. Le refus reste deny-by-default et les messages sont couverts par le catalogue français.
- L'administration expose les projets de l'organisation et permet d'affecter un rôle global, limité à une entreprise ou limité à un projet. Les projets et entreprises sont revalidés côté serveur, OWNER reste organisationnel et chaque mutation reste auditée.
- L'écran Administration → Utilisateurs propose une édition responsive des portées de rôle, avec filtrage des projets par entreprise et empilement mobile.
- Validation locale de cette évolution : typecheck et builds API/web réussis, tests API 106/106 et web 74/74 réussis, lint web sans erreur (8 avertissements d'images préexistants), test unitaire de résolution de périmètre projet ajouté.

Poursuivre le backlog concret ci-dessous ; les preuves locales finales sont enregistrées sur `b1a6cb1`, sans obligation de rejouer les suites actuelles. Conserver la CI distante en `BLOCKED` tant que le compte GitHub reste verrouillé pour facturation. La couverture de base des increments ne signifie pas que tout le perimetre fondateur est termine : le reste fonctionnel comprend notamment la decomposition de prix DQE, les variantes/bibliotheques, le sourcing partiel Achats, les reservations et lots de stock, le rapprochement bancaire, les previsions de tresorerie et le parametrage legal de paie. `docs/MODULE_STATUS.md` distingue ces evolutions des dependances externes (CI, signatures natives, services et equipements reels).

## Mise à jour du 4 octobre 2026 — réservations de stock

L’interface inventaire inclut les réservations de stock avec quantité libre, idempotence, libération motivée et états lisibles. Validation ciblée : API E2E 1/1, navigateur 2/2 et responsive 390/768 px. Le code reste à qualifier par les builds et la suite globale avant toute promotion de statut.

## Incrément du 5 octobre 2026 — retours fournisseur (INC-06)

- **Métier** : `POST /procurement/orders/:id/returns` (permission dédiée `procurement.return.create`). Un retour diminue le reçu **net** de la ligne, jamais au-delà ; la commande redevient `PARTIALLY_RECEIVED` (ou `ISSUED` si tout est retourné) et le reste redevient réceptionnable. Une commande ayant déjà eu une réception ne peut plus être annulée, même entièrement retournée.
- **Stock** : les articles stockés sortent par un mouvement `SUPPLIER_RETURN` au coût moyen, depuis un dépôt où la commande a été réceptionnée, dans la limite du stock **libre** (les réservations restent protégées). Le coût consommé projet n’est diminué que pour les lignes non stockées.
- **Base** (migration `20261005090000_supplier_returns`) : pièces `supplier_returns` et `supplier_return_lines` append-only (trigger), contraintes CHECK sur le reçu net, le cumul retourné, la quantité et le motif ; idempotence par clé unique ; audit `procurement.return.created`.
- **Interface** : bouton « Retour fournisseur » sur la commande, colonne « Retourné », historique des retours avec motif et valeur ; modale validant le reçu net et transmettant une clé d’idempotence stable.
- **Correctif de test** : l’assertion de `inventory.e2e` attendait « Stock insuffisant » alors que le ledger contrôle d’abord le stock **libre** depuis les réservations ; l’échec existait avant cet incrément (vérifié sur l’arbre sans modification) ; le comportement métier n’a pas changé.
- **Contrôles locaux observés** (base isolée `axora_erp24_product_test`) : retours fournisseur 6/6 ; régression Achats, Stock, Réservations, Finance, Sous-traitance, Projets, Portail, GMAO et Opérations projet **83/83** (10 fichiers) ; unitaires sécurité 25, web 77, API 108 ; lint sans erreur (8 avertissements d’images existants), typecheck et build réussis. Parcours navigateur réel sur la commande DEMO `BC-2026-0001` : pièce `RF-2026-0001` créée, reçu net diminué, axe-core sans violation sur la modale, aucun débordement à 390 px. Tentative de `UPDATE` direct sur `supplier_returns` refusée par la base.
- La CI distante reste `BLOCKED` (compte GitHub verrouillé pour facturation) ; aucun statut `VERIFIED` n’est promu.

### Qualification navigateur de la tranche (5-6 octobre 2026)

Suite Playwright rejouée par lots contre l’instance locale (`next dev`, base `axora_erp24_product_dev`, jeu DEMO) :
accessibilité, écrans, impressions et retours **78/78** ; responsive, clavier, états d’erreur, sécurité et thème **78/78** après corrections ; parcours métier (avoirs, DQE, RH, réservations, paie, opérations projet, inscription, MFA, PWA) **tous réussis**, avec un saut PWA attendu hors build de production. Les corrections de cette passe :

- **`/copilot` plantait** (« Application error ») : un `useEffect` renvoyait le résultat de `scrollIntoView`, que les navigateurs récents exposent comme une Promise ; React tentait de l’appeler au démontage. Corps de l’effet passé en bloc. C’était la seule occurrence dans l’application.
- **Palette clavier** : le test attendait « Projets » après une flèche alors que « Ressources projet », ajouté après la qualification `b1a6cb1`, correspond aussi à « projet ». Le test vérifie désormais réellement le déplacement de l’option active (flèche bas puis haut).
- **Thème sombre** : l’audit axe-core des 31 écrans dépassait 60 s contre le serveur de développement ; le délai suit maintenant le nombre d’écrans.
- **Paie** : le test attendait l’apostrophe typographique alors que l’écran utilise l’apostrophe droite depuis `2d858f0` ; l’expression accepte les deux.

Prérequis d’environnement constatés, sans changement de code : `MFA_ENCRYPTION_KEY` doit être défini dans `.env` pour le parcours MFA, et l’API doit être démarrée avec `REGISTRATION_LIMIT=100` (comme le job CI navigateur) pour les parcours qui créent des organisations. Ne pas lancer `pnpm build` pendant que `next dev` tourne : le build écrase `.next` et le serveur de développement renvoie 500 jusqu’à son redémarrage.

## Mise en production sur le VPS (6 octobre 2026)

Guide complet : `deploy/vps/README.md`.

- **Code** : `REGISTRATION_MODE` (`open` par défaut, `first-organization`, `closed`, valeur inconnue = fermé) et `GET /auth/registration` ; les écrans masquent la création d’espace quand elle est fermée. `TRUST_PROXY` (nombre de sauts ou sous-réseaux ; `true` refusé) pour que les budgets anti-abus par IP voient le vrai client derrière Caddy et Next.js.
- **Empaquetage** : `Dockerfile` multi-étapes (API NestJS avec migrations Prisma au démarrage, interface Next.js autonome), `deploy/vps/docker-compose.yml`, `Caddyfile`, `init-env.sh`, `smoke-compose.yml`.
- **Vérifié sur le VPS** : images construites ; pile jetable sans port public : 58 migrations sur base vide, page de connexion, première organisation créée (201), seconde refusée (403, message français), origine étrangère refusée (403). Production démarrée (postgres, api, web, caddy en bonne santé).
- **Accès** : création d’organisations bloquée sur le domaine public (403 vérifié via Caddy) ; accès d’administration privé `https://axora-vps.taild4cfa4.ts.net:10443` (tailnet uniquement), vérifié depuis le poste avec un certificat valide.
- **Hôte** : PostgreSQL et Redis (5432, 6379, 5440), exposés à Internet et sondés par des attaquants, sont désormais bloqués sur l’interface publique (vérifié de l’extérieur) ; accès local, Docker et Tailscale inchangés.
- **Sauvegarde** quotidienne installée ; première sauvegarde réelle effectuée puis restaurée sur une base jetable (58 migrations).
- **En attente** : enregistrement DNS `A erp24 → 57.128.181.32` chez N0C. Le certificat HTTPS sera obtenu automatiquement dans les 5 minutes suivant sa propagation. Le parcours navigateur complet en production (cookie `Secure`) est `NOT TESTED` tant que le HTTPS public n’est pas actif.
