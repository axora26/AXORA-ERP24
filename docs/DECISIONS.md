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

## ADR-0014 — API publique : cles bornees par leur createur, webhooks entrants signes, verite des connecteurs

**Date** : 2026-09-25
**Statut** : Acceptee
**Contexte** : INC-23 ouvre l'ERP a des systemes tiers (BC-24, 03-security §11) : une cle ne doit jamais donner un acces total ni plus que les droits d'une personne ; un webhook entrant ne doit rien traiter avant verification ; aucune integration non testee ne doit paraitre fonctionnelle.
**Decision** :
- Cle d'API = secret aleatoire de 32 octets (prefixe `axk_`), montre une fois ; seule l'empreinte SHA-256 est stockee. Permissions explicites prises dans un catalogue public, bornees a l'emission par celles de l'emetteur ; a chaque requete, permissions effectives = permissions de la cle ∩ permissions actuelles du createur (createur inactif ou sorti de l'entreprise = cle suspendue). Permissions figees et revocation definitive (triggers).
- Limitation par minute et quota journalier par cle via compteurs atomiques (`INSERT … ON CONFLICT … RETURNING`) ; toute requete authentifiee compte, refus compris ; liste d'IP optionnelle ; limiteur d'essais invalides par IP. Journal append-only des requetes.
- Webhook entrant : corps brut conserve par le serveur (`rawBody`), signature HMAC-SHA256 de `horodatage.corps` verifiee avant toute lecture, tolerance 5 min, schema strict, idempotence par `(point d'entree, id d'evenement)` unique en base ; l'effet metier (prospect CRM, meme regle que l'interface) et la trace sont ecrits dans la meme transaction. Limiteur de signatures invalides par point d'entree.
- Registre des connecteurs a grille de verite, statuts du vocabulaire officiel (`IMPLEMENTED_NOT_VERIFIED`, `NOT_TESTED`, `NOT_IMPLEMENTED`) : jamais « TESTED » sans run CI, et aucun connecteur verifie tant qu'un systeme externe n'a pas ete reellement atteint (invariant teste).
- Tests : les valeurs d'environnement propres aux tests sont fixees avant le chargement du `.env` de developpement (le planificateur d'automatisation active en developpement rendait un test dependant du timing).
**Reversible** : oui (nouvelles routes et types d'evenements entrants sans changer le modele).


## ADR-0015 — PWA, travail terrain hors ligne, messages d'erreur en francais, en-tetes de securite

**Date** : 2026-09-25
**Statut** : Acceptee
**Contexte** : INC-24 demande une application installable et utilisable sur chantier sans reseau, sans jamais exposer de donnees d'un autre utilisateur ni presenter une donnee perimee comme fraiche, et un durcissement transverse (messages comprehensibles, en-tetes, dependances). Aucun certificat de signature, compte Apple ni SDK Android n'est disponible dans l'environnement de livraison.
**Decision** :
- **Plateforme livree = PWA** (manifeste complet, icones `any` + `maskable` au trace de la marque, service worker). Chromium ne signale aucune erreur d'installabilite. Les emballages natifs Windows (MSIX), Android (TWA/AAB) et iOS sont `BLOCKED` : ils exigent des identites de signature absentes ; rien n'est simule.
- **Service worker** : cache statique versionne (`axora-static-v1`, ressources immuables en cache d'abord), coquilles de pages en reseau d'abord (`axora-pages-v1`) avec page `/offline` en dernier recours. **Aucune reponse de `/api/*` n'est jamais mise en cache** : les donnees metier restent soumises au RBAC du serveur. Le cache des pages est purge a la deconnexion (message `PURGE`) ; `/sw.js` est servi sans cache pour qu'une nouvelle version soit prise immediatement.
- **Hors ligne terrain** : seule une erreur reseau fait reutiliser le dernier contexte de session connu (un 401 renvoie toujours vers la connexion). Le module terrain conserve sa derniere lecture **par utilisateur et par entreprise** dans le stockage local, affichee avec un bandeau « hors ligne » ; les saisies passent par la file de synchronisation existante (ADR-0009, conflits explicites). Tout est efface a la deconnexion.
- **Messages d'erreur** : un filtre global traduit les messages des exceptions HTTP via un catalogue francais couvrant tous les gabarits anglais du code ; un test echoue si un message litteral n'est pas traduit. Les codes HTTP et la structure des reponses ne changent pas.
- **En-tetes** : API — `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Cross-Origin-Resource-Policy: same-site`, `Cache-Control: no-store` par defaut (sauf reponse qui fixe sa propre politique), pas de `X-Powered-By` (meme configuration dans le harnais e2e). Web — CSP en production (tout en meme origine, `frame-ancestors 'none'`, `object-src 'none'` ; `'unsafe-inline'` reste necessaire aux scripts d'hydratation de Next.js), `Permissions-Policy` (camera et position en meme origine seulement), pas de `X-Powered-By`.
- **Dependances** : `pnpm.overrides` releve `multer`, `postcss` et `deepmerge-ts` vers des versions corrigees ; `pnpm audit --prod` ne signale aucune vulnerabilite connue.
**Consequences** : une CSP sans `'unsafe-inline'` demandera des nonces par requete (rendu dynamique) ; toute nouvelle page utilisable hors ligne doit passer par le cache par utilisateur et la purge a la deconnexion ; tout nouveau message d'erreur doit entrer au catalogue (le test l'impose).
**Reversible** : oui (version du cache incrementee pour invalider les clients ; catalogue et en-tetes centralises).

## ADR-0016 — Operations projet issues des faits existants

**Date** : 2026-10-03
**Statut** : Acceptee
**Contexte** : la gestion de chantier doit reunir personnel, stock, parc et budget sans creer de fausses affectations ni compter deux fois une reception stockee.
**Decision** :
- `GET /projects/:id/operations` exige `projects.project.read` et borne les dates calendaires UTC a 1–31 jours inclusifs. Une lecture RepeatableRead assemble les sources autorisees.
- La presence associe les faits IN/OUT, conserve le projet du IN, charge les bornes hors periode et decoupe les nuits. Une entree ouverte est visible avec anomalie, sans duree inventee.
- Les materiaux proviennent des mouvements ISSUE/RETURN du projet. Les soldes des magasins SITE sont les soldes actuels avec date de lecture, independants du filtre historique. Une reception d'article stocke devient un cout chantier seulement a la sortie ; les receptions directes hors stock sont comptees separement. Les receptions fractionnees utilisent des deltas d'arrondi cumulatifs par ligne.
- Les affectations temporaires proviennent de FleetAssignment. `Asset.projectId` indique une origine de mise en service, affichee comme telle ; il ne cree aucune reservation ni affectation temporaire.
- Les sous-sections privees sont indisponibles sans leurs permissions sources. Les couts individuels et agreges de RH exigent `hr.payroll.read`. Un cout complet est indisponible si une source manque, n'est pas valorisee ou utilise une autre devise. Les mutations de projet et les exports appliquent la meme politique.
**Consequences** : reutilisation du grand livre et du parc ; aucune reservation future de materiel livree par cette tranche. Le budget de base reste visible aux lecteurs du projet.
**Reversible** : oui, par des modeles de reservation planifiee distincts des faits de consommation si une evolution les exige.

## ADR-0017 — Carte QR revocable et preparation de paie explicite

**Date** : 2026-10-03
**Statut** : Acceptee
**Contexte** : un QR ne doit pas etre un identifiant permanent forgeable ni transformer directement une presence en paie validee.
**Decision** :
- La carte de service porte un jeton propre aleatoire, empreinte pour l'identification et copie chiffree pour la reimpression autorisee. Les journaux n'enregistrent pas le secret. La reemission revoque les anciennes cartes ; expiration, revocation et employe inactif sont verifies au pointage, sous le meme verrou employe.
- Le scan QR exige une session habilitee au pointage, une cle d'idempotence et l'heure serveur. La carte personnelle n'est pas une session de connexion ni une approbation d'heures.
- L'import des paires fermees produit une feuille DRAFT avec provenance IN/OUT ; les intervalles ouverts/incoherents bloquent l'import et un remplacement de lignes deja saisies exige une action explicite. Soumission puis validation par un tiers restent obligatoires.
- Le mode MONTHLY_BASE reprend le salaire de base et signale les absences d'heures validees. VALIDATED_HOURS exige des heures validees pour chaque employe inclus et des heures mensuelles de reference/coefficient supplementaire explicites. Taux = salaire de reference / heures de reference ; remuneration = heures normales x taux + heures supplementaires x taux x coefficient, puis elements variables saisis.
- La preparation conserve les parametres et sources de son calcul ; la cloture fige aussi le calcul en base. Une modification ulterieure des parametres s'applique aux nouvelles preparations.
- Les préparations pré-migration sans photographie de paramètres ne sont pas recalculées avec une politique actuelle. Les nouveaux détails horaires sont omis et affichés « Non disponible (historique) » ; les données historiques déjà enregistrées restent disponibles. La configuration des politiques utilise `hr.payrollpolicy.manage` et possède une page distincte, sans imposer la lecture des employés ou des préparations.
- Les cotisations/impots ne sont pas presumes : `statutoryDeductions: NOT_CONFIGURED`, `netAmount: null`. La fiche PDF expose cette limite, y compris lorsqu'elle s'intitule « Fiche de paie ».
**Consequences** : une preparation de remuneration brute est disponible ; le bulletin legal complet et le net exigent le parametrage applicable. Le cout horaire charge impute au projet et la remuneration basee sur le salaire sont deux bases distinctes.
**Reversible** : oui, par politiques versionnees et adaptateurs materiels explicites.

## ADR-0018 — Documents avec identite officielle et droits de leur source

**Date** : 2026-10-03
**Statut** : Acceptee
**Contexte** : les documents metier doivent etre lisibles, identifiables et imprimables sans exposer des donnees d'une autre entreprise ou contourner les droits.
**Decision** :
- `AXORA_BRAND` centralise logo et coordonnees publics releves sur `https://axora.cd/` : AXORA GROUP, infos@axora.cd, +243 810 364 612, 945 Boulevard du 30 Juin, Gombe, Kinshasa. L'entreprise emettrice du document reste explicitement affichee ; aucune identite juridique supplementaire n'est inventee. Les pieces DEMO gardent leur mention.
- Les vrais exports serveur couvrent DQE PDF/XLSX, avoirs, operations projet, carte QR recto/verso et fiche de paie employe. Ils recontrolent les permissions et l'entreprise et servent les fichiers avec une politique privee sans cache.
- Les neuf genres de `/print/:kind/:id` sont `quotes`, `contracts`, `purchase-requests`, `purchase-orders`, `goods-receipts`, `daily-logs`, `commissioning`, `timesheets`, `stock-movements`. L'action ouvre l'impression du navigateur, qui permet aussi l'enregistrement PDF. Ce parcours est distinct d'un export PDF serveur.
- Pour une reception, l'identifiant de route est celui de la commande et `receiptId` selectionne la reception exacte ; une reference absente n'est pas remplacee par une autre. Un mouvement ancien est lu par son getter individuel, sans dependre du plafond de la liste.
- Les titres refletent l'etat : un commissioning non accepte produit un compte rendu, un accepte/remis un proces-verbal de reception. Une feuille de temps imprimee n'expose aucun cout salarial protege.
**Consequences** : pas de signature electronique ou certification juridique implicite. L'impression camera/QR et les PDF doivent conserver leurs preuves de qualification propre, distinctes du succes du build.
**Reversible** : oui, presentation partagee et identite centralisee.

## ADR-0019 — Avoirs et remboursements comme faits comptables distincts

**Date** : 2026-10-03
**Statut** : Acceptee
**Decision** : les lignes et montants de la facture source restent intacts. L'avoir copie prix/taxe/designation et alloue chaque fraction par difference entre les totaux cumulatifs arrondis. Emission, paiement et remboursement partagent le verrou de la facture source. Les remboursements sont append-only, idempotents et bornes par le trop-percu global et le solde de l'avoir ; ils sortent de la banque cote client et entrent cote fournisseur. Les lectures derivent le total net, l'encaisse net, le reste du et le remboursement du. Les couts projets et analytics utilisent ces faits nets, sans mouvement de stock ni change implicite.
**Consequences** : les trop-percus restent des dettes de remboursement explicites ; un retour physique fournisseur reste une operation distincte. Les permissions de lecture de facture, avoir, emission et remboursement restent separees.
**Reversible** : oui, extension du journal sans reecriture des pieces emises.

## ADR-0020 — Un agregat conserve la permission de chaque source

**Date** : 2026-10-03
**Statut** : Acceptee
**Decision** : la vue d'ensemble et le copilote utilisent des sections distinctes pour factures clients/fournisseurs, commandes/demandes d'achat et contrats/devis. Le droit d'une section ne donne pas le compteur d'une source voisine. Le dashboard CRM conserve les opportunites autorisees mais retourne `leads.available: false` et des compteurs null sans `crm.lead.read`, sans interroger cette source. Les montants financiers sont regroupes par devise ; ils ne sont jamais additionnes sous un libelle unique de devise.
**Consequences** : une valeur indisponible n'est pas presentee comme zero reel. La provenance du copilote distingue commandes et demandes ; la preuve historique n'est pas reecrite.
**Reversible** : oui, ajout de sections ou sources avec permission explicite.

## ADR-0021 — Qualification actuelle distincte des archives et de la CI distante

**Date** : 2026-10-04
**Statut** : Acceptee
**Contexte** : les résultats du 25 septembre ne prouvent pas les modifications d'octobre ; les réexécutions ciblées et les défauts trouvés pendant le navigateur global doivent rester identifiables.
**Decision** : conserver les preuves de septembre sous une archive datée et consigner séparément l'arbre courant, les commandes, les résultats et la révision finale de code. Une réexécution ne crée pas de nouveaux cas à additionner ; un contrôle navigateur ciblé après correction ne remplace pas une suite globale. Une valeur horaire pré-migration inconnue n'est pas présentée comme zéro réel. La fermeture d'un gate exige son résultat réel ; aucun statut global `VERIFIED` n'est déduit des seuls contrôles locaux.
**CI** : l'annotation du run historique `36157192308` confirme un compte bloqué pour facturation avant attribution d'un runner. Le workflow de ce commit excluait la base de PR `claude/funny-meitner-l317n1` ; le workflow courant l'inclut explicitement et génère des clés de carte de service éphémères dans les jobs API/navigateur. Ces corrections de configuration ne prouvent pas une résolution de facturation ni un succès de run actuel.
**Preuve CI finale** : le code poussé `b1a6cb1a27575c4c96484c393a0099eabe99baa8`, PR brouillon #2, déclenche les runs push `37161782565` et PR `37161799570`. Les deux échouent avant exécution ; le run PR confirme deux jobs sans runner ni étapes et les mêmes annotations de facturation. Aucun statut `VERIFIED`, action de facturation ou relance manuelle n'en découle.
**Consequences** : chaque reconstruction API/web et vérification n'est qualifiée qu'après obtention de sa sortie ; le rapport décrit le résultat global initial et les reprises ciblées séparément.
**Résultat local final** : 200 unitaires, 351 cas API uniques, reprise RH/exports 15/15 et nouvelle globale navigateur 163/163 réussissent sur `b1a6cb1` ; les 10 PDF / 11 pages sont inspectés après correction. Le produit global reste `IN_PROGRESS` pour ses lacunes ; les preuves locales ne ferment pas la CI distante.
**Tests d'inscription** : le job navigateur utilise `REGISTRATION_LIMIT: "100"` uniquement pour sa base CI éphémère et ses créations de tenants. Le service conserve 5 par défaut ; les reprises locales attendent la fenêtre du quota sans remise à zéro des données.
**Reversible** : oui, nouveaux résultats et nouvelles révisions sont ajoutés sans réécrire leur historique de preuve.
