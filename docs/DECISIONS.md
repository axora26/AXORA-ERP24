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

## ADR-0004 — Defaut d'isolation tenant detecte et corrige sur OrganizationService

**Date** : 2026-09-20
**Contexte** : lors de l'implementation de l'authentification INC-01, un test manuel avec 2 organisations reelles (bootstrap Org A et Org B via `/auth/register-organization`, puis appel authentifie a `GET /api/v1/organizations`) a montre que **les deux utilisateurs recevaient la liste complete de toutes les organisations existantes**, y compris celles de l'autre tenant. La cause : `OrganizationService.list()` faisait `findMany()` sans aucun filtre `organizationId`, et le guard de permission verifiait seulement la possession de la cle `core.organization.manage` dans le tenant de l'appelant, pas le contenu retourne par le service.
**Decision** : `Organization` etant la racine du tenant elle-meme (pas une ressource "sous" un tenant), la route `GET /organizations` (liste globale) a ete supprimee et remplacee par `GET /organizations/me`, qui ne retourne QUE l'organisation de l'utilisateur authentifie (`request.axoraUser.organizationId`), jamais une liste. Aucune route de creation libre d'organisation n'existe plus hors du bootstrap transactionnel `/auth/register-organization`.
**Justification** : reference `docs/foundation/03-security.md` — un guard de permission verifie qu'une ACTION est autorisee, il ne garantit pas que les DONNEES retournees par le service sont elles-memes scopees. Chaque service doit imposer son propre filtre tenant explicite, independamment du guard. Ce pattern (service scope explicitement, guard verifie l'action) doit etre reapplique systematiquement pour tous les futurs modules (INC-02+).
**Verification** : 4 tests e2e ajoutes dans `apps/api/test/tenant-isolation.e2e.test.ts`, executes contre une base PostgreSQL reelle, 5/5 PASS incluant l'assertion croisee explicite `expect(meA.body.slug).not.toBe(slugB)`.
**Reversible** : non applicable — c'est un correctif de securite, pas une decision technique reversible.

## ADR-0006 — Limitation persistante des connexions et audit transactionnel des sessions

**Statut** : Acceptee

**Decision** :

- calculer une cle SHA-256 du couple e-mail normalise/adresse IP afin de ne pas persister ces identifiants dans la table de limitation ;
- bloquer pendant 15 minutes apres cinq echecs dans une fenetre de 15 minutes ;
- persister le mecanisme dans PostgreSQL pour qu'il reste coherent entre instances API ;
- creer la session, mettre a jour `lastLoginAt` et ecrire `auth.login.succeeded` dans une transaction ;
- revoquer la session et ecrire `auth.logout.succeeded` dans une transaction ;
- ne jamais stocker de mot de passe, jeton en clair ou cookie dans les metadonnees d'audit.

**Raison** : un compteur en memoire ne resiste ni aux redemarrages ni au scale-out. Les evenements d'authentification doivent rester fiables et auditables sans exposer de secret.

## ADR-0007 — Socle de plateforme pour la livraison des modules INC-05 a INC-24

**Date** : 2026-09-25
**Statut** : Acceptee
**Contexte** : 20 increments restent a livrer. Chaque module reimplementait la resolution du perimetre entreprise, instanciait son propre `PrismaService` (un pool de connexions PostgreSQL par module) et l'interface web etait une page unique a vues commutees (aucune URL partageable, retour arriere inoperant).
**Decision** :
- `CommonModule` global : une seule instance `PrismaService`, `CompanyScopeService`, `NumberingService`.
- `@ScopedController()` = `SessionGuard` + `PermissionGuard` (deny-by-default) + `CompanyScopeGuard` ; le perimetre entreprise est injecte par `@Scope()` et reste revalide contre les appartenances de la session.
- Validateurs communs (`common/validation.ts`) : montants en chaines decimales exactes uniquement (un nombre JSON est refuse), dates ISO, enums normalises.
- `writeAudit(tx, ...)` : audit ecrit dans la transaction de la mutation.
- Numerotation automatique `PREFIXE-ANNEE-NNNN` par entreprise, atomique (`INSERT ... ON CONFLICT DO UPDATE ... RETURNING`), testee sous concurrence.
- Schema Prisma multi-fichiers (`prisma/modules/*.prisma`, GA depuis Prisma 6.7) : un fichier par module.
- Web : App Router avec une route par module, shell authentifie commun (`AppShell`) alimente par `GET /auth/context` (entreprises + permissions effectives — indication d'interface uniquement, le serveur reste seul juge), palette de commandes Ctrl K, kit UI partage.
- L'API est relayee sur la meme origine que l'interface (`/api/v1` -> port 4000) : cookie de session first-party, une seule URL a ouvrir.
- Formatage des montants par arithmetique sur chaines (aucune conversion flottante, testee au-dela de 2^53).
- Jeu de donnees DEMO cree via l'API HTTP reelle (regles metier, RBAC, audit appliques), organisation marquee `isDemo`, bandeau permanent dans l'interface.
**Reversible** : oui (refactorisation interne, aucun changement de contrat HTTP existant ; `/auth/me` inchange).

## ADR-0008 — Invariants de stock et d'audit garantis par la base de donnees

**Date** : 2026-09-25
**Statut** : Acceptee
**Contexte** : le backlog exige un ledger de mouvements immuable et un solde jamais negatif (BC-06), et un journal d'audit append-only (03-security). Une garantie purement applicative peut etre contournee par un script, une migration ou un futur module.
**Decision** : (1) contrainte `CHECK (quantity >= 0 AND value >= 0)` sur `stock_balances` ; (2) trigger `axora_forbid_mutation` refusant tout `UPDATE`/`DELETE` sur `stock_movements` et `audit_logs`. Toute ecriture de stock passe par `StockLedgerService` (verrou `SELECT ... FOR UPDATE` sur la ligne de solde, cout moyen pondere). Le stock est valorise dans la devise de reference de l'entreprise (`companies.currency`) ; une reception d'article stocke dans une autre devise est refusee (pas de conversion implicite).
**Consequence** : la suppression d'une organisation n'est plus possible tant que ses traces d'audit existent (comportement voulu : aucune route ne le permet).
**Reversible** : oui par migration explicite, jamais silencieusement.

## ADR-0009 — Fichiers immuables adresses par empreinte et synchronisation terrain hors ligne

**Date** : 2026-09-25
**Statut** : Acceptee
**Contexte** : INC-10 introduit les premiers fichiers binaires (plans, PV, photos de chantier) et une saisie terrain devant fonctionner sans reseau sans jamais perdre ni ecraser silencieusement une donnee (BC-09, BC-10).
**Decision** :
- Un fichier est stocke une seule fois par entreprise sous la cle de son empreinte SHA-256 : le televersement est idempotent, l'objet n'est jamais reecrit, la ligne `stored_files` est append-only (trigger). Le type est detecte sur la signature binaire (liste blanche : JPEG, PNG, WebP, PDF, Office, ZIP, IFC, DWG) ; le type annonce par le client est ignore, aucun HTML/SVG n'est servi. Le contenu est servi avec `nosniff`, sur la meme origine, apres controle de permission (`RequireAnyPermission` : GED ou chantier).
- Pilote de stockage local (`FILE_STORAGE_DIR`) derriere l'interface `FileStorage` ; le pilote compatible S3 prevu par l'architecture n'est pas livre (NOT_TESTED).
- Une version de document ne change jamais de contenu (trigger `document_versions_immutable`) ; une revision cree une nouvelle version, l'approbation revient a une personne distincte de l'auteur et du soumetteur.
- Toute saisie terrain (reserve, preuve, correction, journal) passe par `POST /field/sync`, en ligne comme hors ligne : un seul chemin. Chaque operation porte un identifiant genere sur l'appareil (rejeu = `DUPLICATE`, jamais un doublon) ; toute modification porte la version lue (verrou optimiste) : un ecart renvoie `CONFLICT` avec l'etat serveur, et l'utilisateur tranche explicitement (reappliquer sur la version affichee, ou abandonner). Cote navigateur, la file et les photos sont persistees dans IndexedDB et ne quittent la file que sur accuse serveur.
- Preuves de chantier append-only et toujours rattachees a un contexte (CHECK) ; reserve levee uniquement apres photo de correction posterieure au dernier refus, verifiee par une autre personne que le declarant (CHECK en base).
**Limite connue** : sans service worker (INC-24), l'application doit etre ouverte avant la coupure reseau ; la file survit a la fermeture de l'onglet.
**Reversible** : oui (ajout d'un pilote S3 sans changement de contrat HTTP).

