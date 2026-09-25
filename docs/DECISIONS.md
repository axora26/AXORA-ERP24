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


## ADR-0010 — Passerelles GTB : jeton machine, ingestion unique, preuves physiques attestees

**Date** : 2026-09-25
**Statut** : Acceptee
**Contexte** : INC-16 ouvre la plateforme a des emetteurs non humains (passerelles GTB/BMS/IoT) et exige de ne jamais confondre flux de donnees, simulateur et preuve de communication physique (BC-16, invariants 1 et 2).
**Decision** :
- Chaque passerelle recoit un jeton porteur opaque (`axgw_…`, 192 bits aleatoires) montre une seule fois ; seule son empreinte SHA-256 est stockee, le jeton est revocable par rotation ou desactivation. Les routes `/smart/gateway/*` n'acceptent que ce jeton (aucune session, aucun cookie) et ne voient que les points de leur passerelle ; le perimetre entreprise est porte par la passerelle.
- Toute telemetrie entre par `POST /smart/gateway/readings` (lots de 1 000 lectures maximum, valeurs en chaines decimales). Ingestion serialisee par passerelle (verrou) : meme point + meme instant + meme valeur = doublon ignore ; valeur differente = conflit rapporte, jamais ecrase. Lectures append-only (trigger) ; hors plage plausible conservees en qualite `BAD` et non interpretees ; une lecture tardive enrichit l'historique sans piloter l'etat courant.
- Aucun pilote natif BACnet/Modbus/KNX/MQTT n'est livre : ces protocoles sont modelises et s'integrent via une passerelle de terrain qui pousse vers l'API (niveau « connecteur developpe » = `NO` pour eux, affiche tel quel).
- Les niveaux « lecture reelle » et « ecriture reelle » ne passent a `YES` que par une attestation humaine append-only d'un essai point-a-point (lecture comparee a une mesure de reference, verdict calcule par le serveur ; ecriture = consigne confirmee par relecture + constat sur site). Une passerelle declaree simulateur ne peut jamais en recevoir (trigger) ni etre requalifiee en passerelle physique.
- Une consigne n'est jamais declaree appliquee sur l'acquit de la passerelle : seule une relecture du point dans la tolerance la confirme (CHECK en base).
**Reversible** : oui (ajout ulterieur de pilotes natifs sans changement du modele de preuve).

## ADR-0011 — Portails externes : plan d'identite separe et exposition explicite

**Date** : 2026-09-25
**Statut** : Acceptee
**Contexte** : INC-20 ouvre l'ERP a des personnes externes (maitrise d'ouvrage, fournisseurs). Le risque principal est une fuite de droits internes ou de donnees d'une autre societe (BC-20, 03-security §2.3 et §4.4).
**Decision** :
- Tables dediees `portal_principals`, `portal_invitations`, `portal_sessions` ; cookie `axora_portal_session` distinct du cookie interne. La garde portail ne lit que le cookie portail, la garde interne que le cookie interne : aucune interoperabilite (tests croises).
- Un principal appartient a une seule societe et a un seul enregistrement racine (compte CRM pour un client, fournisseur pour un fournisseur) — CHECK et trigger interdisent tout changement ulterieur.
- Invitation : jeton aleatoire dont seule l'empreinte est stockee, transmis dans le fragment d'URL (jamais journalise par un serveur), usage unique (trigger), 7 jours. Mot de passe portail : 12 caracteres minimum, scrypt ; connexion limitee par la meme mecanique de throttling que l'interne (cle prefixee), comparaison a une empreinte factice si l'email est inconnu (pas d'enumeration par chronometrage).
- Deny-by-default : une ressource n'est visible que par une autorisation explicite (`portal_resource_grants`), creee uniquement si la ressource appartient a l'enregistrement racine et est dans un etat publiable (facture emise, document approuve, commande emise) ; la regle est **re-verifiee a chaque lecture**. Les vues externes n'exposent jamais de couts internes (budget, engage, consomme).
- Suspension / revocation : un trigger revoque sessions et invitations ouvertes dans la meme transaction ; la revocation est definitive.
- Actions externes auditees avec `actorUserId = null` et l'identifiant du principal en metadonnees.
**Reversible** : oui (ajout de types de ressources exposables sans changer le modele de securite).

## ADR-0012 — Moteur de workflow : outbox transactionnelle, execution idempotente, barriere fail-closed

**Date** : 2026-09-25
**Statut** : Acceptee
**Contexte** : INC-21 doit automatiser des regles (notifications, approbations, integrations) sans qu'un module appelle la logique d'approbation d'un autre (BC-21) et sans jamais contourner les separations de devoirs existantes.
**Decision** :
- Les modules emettent des evenements types dans la MEME transaction que la mutation (table `automation_events`, immuable) ; le moteur les traite apres validation (declenchement differe + tache periodique, `AUTOMATION_AUTORUN`), ou a la demande (`POST /workflow/run`).
- Une execution est unique par (definition, evenement) ; ses effets (notifications, approbation, livraison de webhook) sont ecrits dans la meme transaction que la ligne d'execution : un doublon concurrent echoue sur la contrainte d'unicite et n'a aucun effet. Le journal est append-only ; un echec technique est journalise dans une transaction separee.
- Une definition est versionnee et immuable (trigger) ; seul son etat actif change. Elle ne s'applique qu'aux evenements posterieurs a sa creation.
- Les actions sont limitees a NOTIFY, REQUIRE_APPROVAL et WEBHOOK : le moteur ne modifie jamais directement une donnee metier. Une approbation de workflow ne remplace pas l'approbation metier : elle la **conditionne** (`WorkflowGate`), de facon fail-closed (refus tant qu'un evenement susceptible de creer une approbation n'est pas evalue).
- Webhooks : secret genere par la plateforme, montre une fois, chiffre (INTEGRATION_ENCRYPTION_KEY) ; signature HMAC-SHA256 de `horodatage.corps` recalculee a chaque tentative (le destinataire rejette un horodatage de plus de 5 minutes) ; corps et URL figes en base ; cibles HTTPS publiques uniquement (cibles locales admises seulement si `WEBHOOK_ALLOW_PRIVATE_TARGETS=true`, developpement) ; redirections non suivies ; 5 tentatives bornees puis relance manuelle auditee.
**Consequences** : latence de quelques secondes entre la mutation et l'effet ; la barriere peut demander de reessayer pendant ce delai. La resolution DNS des cibles n'est pas epinglee (rebinding DNS non couvert) : documente comme limite.
**Reversible** : oui (nouvelles actions ou evenements sans changer le modele).

## ADR-0013 — Copilote : reponses ancrees et deterministes, preuve d'inference obligatoire

**Date** : 2026-09-25
**Statut** : Acceptee
**Contexte** : INC-22 exige que le copilote n'accede jamais a une donnee que l'utilisateur ne pourrait pas lire lui-meme, et que chaque reponse soit tracable a une source reelle avec la preuve du filtrage RBAC (BC-22). Aucun fournisseur de modele generatif n'est configure dans l'environnement de livraison.
**Decision** :
- Le copilote est un moteur deterministe : planification par mots-cles et references de pieces, outils de lecture parametres par le perimetre entreprise, composition de phrases a partir des seules valeurs lues. Il ne produit aucune affirmation non sourcee ; une question hors perimetre recoit la liste de ce qui peut etre demande.
- Les droits consultes sont exactement ceux que la garde RBAC a resolus pour la requete ; `ai.copilot.use` ne donne acces a aucune donnee, chaque outil exige la permission de lecture de son module (deny-by-default). La synthese reutilise les sections du tableau de bord, deja soumises a la meme regle.
- Chaque question laisse une preuve append-only (`ai_inference_evidence`) : controles d'acces accordes et refuses, sources citees, reponse, empreinte SHA-256 recalculee par la base (CHECK), moteur et fournisseur de modele (null). La preuve appartient au proprietaire de la session (trigger).
- Aucun chemin d'ecriture : le copilote ne propose que des liens vers les ecrans, qui appliquent leurs propres controles.
**Consequences** : comprehension limitee aux formulations prevues ; un futur branchement LLM devra se limiter a reformuler les faits deja sources et renseigner `modelProvider` (NOT_TESTED tant qu'aucun fournisseur n'est configure).
**Reversible** : oui (ajout d'outils ou d'un reformulateur sans changer la preuve).

