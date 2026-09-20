# AX-A360 — Modèle de Sécurité et de Gouvernance Technique

**Agent :** AXORA-ERP24-SECURITY
**Produit :** AX-A360 (nouveau produit, inspiré de la couverture fonctionnelle d'AXORA ERP3602)
**Référence :** `C:/Users/dmgpe/AX-ERP360-source-readonly/packages/security` et `docs/` (lecture seule, non modifiés)
**Portée de ce document :** modèle de sécurité cible. Aucun code n'a été écrit ou modifié. Aucune affirmation `READY`/`TESTED`/`PRODUCTION READY` n'est faite : ce document définit ce qui doit être construit et vérifié.

---

## 0. Méthode et sources

Ce modèle a été établi après inspection réelle de la référence ERP3602 (lecture seule) :

- `packages/security/src/{authorization,mfa,password,session,throttle}.ts` et leurs tests ;
- `docs/ARCHITECTURE.md` (tenancy, authentification, autorisation, audit, conventions API) ;
- ADR pertinentes : `0006-database-security-invariants`, `0033-core-organization-company-branch-administration`, `ADR-0058-external-portal-access-foundation`.

ERP3602 n'a pas été modifié. AX-A360 est un **nouveau produit**, développé dans un workspace séparé (`E:/AXORA ADM/AXORA_ERP24`). Le modèle ci-dessous reprend les invariants de sécurité éprouvés d'ERP3602 (défense en profondeur, deny-by-default, audit append-only, scoping serveur) et les étend explicitement pour la portée élargie d'AX-A360 (multi-projet fin, portails externes, IA, intégrations Smart Building/BIM).

Statut de chaque exigence : `SPEC` (définie ici, à implémenter), `INHERITED` (pattern repris tel quel d'ERP3602), `EXTENDED` (pattern ERP3602 étendu pour AX-A360). Rien n'est `PASS`/`DEPLOYED`/`TESTED` à ce stade — c'est un document de conception.

---

## 1. Authentification

### 1.1 Principes (EXTENDED depuis ERP3602)

- Authentification par **session opaque côté serveur**, pas de JWT auto-porteur pour les sessions utilisateur internes. Un JWT peut être envisagé uniquement pour des jetons d'intégration machine-à-machine courte durée, jamais comme remplacement de la session utilisateur.
- Mot de passe dérivé avec **scrypt** (`N=16384, r=8, p=1`, clé 64 octets, sel 16 octets aléatoire par mot de passe), format versionné (`scrypt-v1$...`) permettant une migration future de paramètres sans invalider les hachages existants. Longueur mot de passe : 12–256 caractères imposée côté serveur.
- Comparaison de mot de passe et de tout secret dérivé via `timingSafeEqual` (pas de `===`) pour éviter les attaques temporelles.
- Aucune information sur l'existence d'un compte n'est révélée par les messages d'erreur de connexion (message générique unique pour identifiant inconnu / mot de passe invalide / compte verrouillé).
- Throttling anti-bruteforce par clé dérivée `SHA-256(email_normalisé \0 adresse_IP)` (`INHERITED`), avec verrouillage progressif et audit de chaque échec.
- Politique de mot de passe **configurable par organisation** (longueur minimale, complexité, expiration, réutilisation), avec valeurs par défaut sûres. Aucune conformité réglementaire spécifique n'est déclarée sans vérification dédiée.

### 1.2 Canaux d'authentification cibles

| Canal | Statut cible | Note |
|---|---|---|
| Email + mot de passe | SPEC — obligatoire | Base commune à tous les rôles internes |
| MFA TOTP | SPEC — voir §3 | Optionnel puis imposable par politique d'organisation |
| SSO (OIDC/SAML) | SPEC — évolution différée | Architecture prête (fournisseur d'identité externe pluggable), non activé tant qu'aucun IdP n'est réellement configuré et testé |
| Portail externe (client/fournisseur) | EXTENDED — plan d'identité séparé | Voir §4.4, ne partage jamais la table de session interne |
| API machine-à-machine | SPEC | Clé API scoping restreint, rotation obligatoire, jamais de mot de passe utilisateur |

### 1.3 Interdictions strictes

- Aucun mot de passe, token, secret ou clé API en clair dans le code source, les logs, les messages d'erreur ou les réponses API.
- Aucun identifiant de session ou jeton brut journalisé (seul le hash est persistable, jamais le brut).
- Aucune tentative de connexion échouée ne doit distinguer « utilisateur inexistant » de « mot de passe erroné ».

---

## 2. Sessions

### 2.1 Modèle (INHERITED, étendu au multi-contexte)

- Génération : 32 octets aléatoires cryptographiquement sûrs (`crypto.randomBytes`), encodés `base64url`.
- Persistance : seul `SHA-256(token_brut)` est stocké en base ; le jeton brut n'existe jamais côté serveur après émission.
- Transport : cookie `HttpOnly`, `Secure`, `SameSite=Strict` (ou `Lax` si un flux de redirection cross-site légitime l'exige, à justifier explicitement), scellé par domaine.
- Révocation : `logout` supprime la ligne de session ; changement de mot de passe, désactivation de compte ou détection d'anomalie doit invalider toutes les sessions actives de l'utilisateur.
- Changement de contexte (organisation/société/projet actif) : autorisé **uniquement après revérification serveur** de l'appartenance (`Membership`/`CompanyMembership`/`ProjectMembership`), jamais sur simple foi d'un identifiant fourni par le client.
- Durée de vie : expiration glissante courte (ex. inactivité) + expiration absolue (ex. 12–24h), configurable par organisation ; sessions actives consultables et révocables individuellement par l'utilisateur et par un administrateur habilité.
- Un identifiant `companyId`/`projectId` transmis par le navigateur n'est **jamais** une preuve d'autorisation : le contexte de la requête (`RequestContext`) est reconstruit à chaque requête protégée depuis la session persistée et les appartenances en base.

### 2.2 Invariant base de données (INHERITED)

- Garde-fou PostgreSQL équivalent à `Session_company_organization_guard` : rejette toute session dont `activeCompanyId` n'appartient pas à `activeOrganizationId`. Étendu à un garde-fou `Session_project_company_guard` pour AX-A360 (un `activeProjectId` non nul doit appartenir à `activeCompanyId`).
- Ces contraintes protègent contre un défaut applicatif ou un accès direct à la base contournant la couche service.

### 2.3 Portails externes

- Table de session dédiée (`PortalSession`), cookie distinct (ex. `axa_portal_session`), jamais interopérable avec la session interne. Un cookie externe ne peut jamais authentifier une route interne et réciproquement (vérifié par test d'isolation, §14).

---

## 3. MFA readiness (Authentification multifacteur)

### 3.1 TOTP (INHERITED d'ERP3602, prêt à activer)

- Algorithme TOTP RFC 6238, SHA-1/6 chiffres par défaut (compatibilité applications d'authentification standard), période 30s, fenêtre de validation limitée (0–2 pas), anti-rejeu via `lastAcceptedCounter` (un code TOTP ne peut être accepté deux fois).
- Secret TOTP généré côté serveur (20 à 64 octets), jamais transmis en clair au-delà de l'enrôlement initial (affiché une seule fois + QR code `otpauth://`).
- Secret TOTP **chiffré au repos** (`AES-256-GCM`, IV 12 octets, tag d'authentification 16 octets, format versionné `aes-256-gcm-v1$...`), clé de chiffrement applicative distincte des secrets de session, gérée comme un secret d'infrastructure (§9), jamais committée.
- Codes de récupération : 10 par défaut (5–20 configurable), générés aléatoirement, **seul le hash SHA-256 normalisé** est stocké, comparaison en `timingSafeEqual`. Chaque code de récupération est à usage unique (invalidé après consommation).

### 3.2 Politique d'activation

- MFA optionnelle par défaut à l'enrôlement produit, **imposable par politique d'organisation** pour les rôles sensibles (administration, finance, RBAC, intégrations).
- Toute action de gouvernance critique (modification RBAC, export massif de données, changement de secret d'intégration, suppression irréversible) peut exiger une **réaffirmation MFA** récente (« step-up »), indépendamment de la session active.
- Aucune méthode MFA n'est déclarée disponible tant qu'elle n'est pas réellement implémentée et testée (pas de simulation présentée comme fonctionnelle — cf. interdiction des faux PASS).

### 3.3 Évolutions prévues, non engagées à ce stade

- WebAuthn/Passkeys (matériel FIDO2) : architecture compatible, activation conditionnée à une implémentation et des tests dédiés.
- SMS/e-mail OTP : déconseillé comme facteur unique (moins robuste), envisageable uniquement en complément si un fournisseur réel est configuré.

---

## 4. Scoping Tenant / Company / Project

### 4.1 Hiérarchie cible

```
Organization (tenant racine)
  -> Company (entité juridique/opérationnelle, appartient à 1 organisation)
    -> Branch / Site (optionnel)
    -> Project (chantier / affaire, appartient à 1 company)
      -> Ressources métier (budgets, documents, tâches, stocks, BIM, etc.)
```

### 4.2 Invariants de scoping (INHERITED + EXTENDED au niveau projet)

- Toute ressource métier porte une référence explicite et non nullable à son `organizationId` et `companyId` (et `projectId` quand applicable), vérifiée en base par contrainte de clé étrangère cohérente.
- `assertTenantAccess`-équivalent AX-A360 vérifie, à chaque requête protégée :
  1. l'organisation active correspond à l'organisation de l'appartenance (`Membership`) ;
  2. si une société active est définie, elle figure dans les sociétés autorisées de l'appartenance ;
  3. **extension AX-A360** : si un projet actif est défini, il appartient à la société active ET l'utilisateur dispose d'une affectation projet (`ProjectMembership`) explicite ou d'une permission d'organisation/société couvrant tous les projets.
- Un identifiant cross-tenant fourni par le client (organisation, société ou projet auquel l'utilisateur n'a pas droit) résout systématiquement en **« non trouvé »**, jamais en « accès refusé » explicite, pour ne pas confirmer l'existence de la ressource à un tiers non autorisé.
- `mergePermissions` (organisation ⊕ société ⊕ projet) reste une union déduplicée et triée, jamais une intersection implicite qui masquerait un droit retiré à un niveau inférieur — toute restriction doit être un refus explicite, pas une omission silencieuse.

### 4.3 Garde-fous base de données (INHERITED, étendus)

- Déclencheurs PostgreSQL de cohérence tenant équivalents à ceux d'ERP3602 (`Session_*_guard`) pour chaque niveau de scoping ajouté par AX-A360 (société↔organisation, projet↔société).
- Déclencheur **append-only** sur `AuditLog` (rejet `UPDATE`/`DELETE`, SQLSTATE dédié) — voir §7.
- Ces garde-fous constituent la défense en profondeur : ils protègent même si un défaut applicatif ou un accès direct (script, migration mal écrite) contourne la couche service NestJS-équivalente.

### 4.4 Plan d'identité externe (portails client/fournisseur)

- Les identités externes (`PortalPrincipal`, typées `CLIENT`/`SUPPLIER`) sont **strictement séparées** des `User`/`Membership` internes : pas d'attribution automatique de droits internes, pas de table de session partagée.
- Un principal externe est rattaché à exactement une société et à un enregistrement métier racine (compte CRM ou fournisseur) dans cette société ; il ne franchit jamais les frontières de société.
- Toute exposition de ressource (projet, document, facture) à un principal externe nécessite une **règle d'exposition explicite** par ressource — aucun héritage implicite des permissions RBAC internes.
- Invitation et session externes : secrets opaques aléatoires, seul le hash SHA-256 est persisté ; invitation à usage unique ; suspension/révocation invalide immédiatement les sessions et invitations actives.

---

## 5. RBAC — Deny-by-default

### 5.1 Principe fondamental

- **Aucune permission n'est accordée par défaut.** Toute action protégée nécessite une correspondance explicite et positive entre la permission requise et une permission effective de l'appelant.
- L'autorisation est évaluée **côté serveur** sur chaque requête, jamais déduite de l'état de l'interface. La visibilité d'un bouton ou d'un menu côté client est un confort UX, jamais un contrôle de sécurité.
- L'IA (AX-A360 Copilot, module 24) hérite strictement des droits de l'utilisateur qui l'invoque : elle **ne contourne jamais le RBAC**, n'accède à aucune donnée que l'utilisateur ne pourrait pas lire lui-même, et toute action qu'elle propose de réaliser en écriture passe par les mêmes vérifications de permission et d'audit qu'une action humaine directe.

### 5.2 Modèle de rôles cible

- Permissions = constantes typées partagées (pas de chaînes libres non contrôlées), regroupées par domaine (`core.*`, `crm.*`, `project.*`, `finance.*`, `stock.*`, `hr.*`, `mep.*`, `bim.*`, `qhse.*`, `assets.*`, `smartbuilding.*`, `portal.*`, `ai.*`, …).
- Attribution à deux niveaux minimum, étendue à un troisième pour AX-A360 :
  - **Rôle d'organisation** (`OrganizationRoleAssignment`) — portée sur toute l'organisation ;
  - **Rôle de société** (`CompanyRoleAssignment`) — portée sur une société précise ;
  - **Rôle de projet** (`ProjectRoleAssignment`, nouveau AX-A360) — portée sur un projet précis, pour les rôles terrain/chantier (chef de chantier, sous-traitant interne, contrôleur QHSE affecté) qui ne doivent pas voir tous les projets d'une société.
- Matrices d'autorisation et délégations temporaires (ex. remplacement de validateur pendant congé) sont des objets de première classe, eux-mêmes audités et bornés dans le temps (date d'expiration obligatoire pour une délégation).
- Principe du moindre privilège : rôles prédéfinis granulaires plutôt que rôles larges « admin fourre-tout » ; toute création de rôle personnalisé est elle-même une action auditée nécessitant une permission de gestion RBAC dédiée (`core.rbac.manage`), distincte des permissions qu'elle permet d'attribuer (séparation des pouvoirs — un gestionnaire RBAC ne s'auto-octroie pas silencieusement des droits métier).

### 5.3 Séparation des devoirs (SoD)

- Certaines combinaisons de permissions sont marquées incompatibles par politique (ex. « créer une facture fournisseur » + « valider le paiement » pour la même personne sur le même dossier) et doivent être détectables par un contrôle de conflit, au minimum en alerte, à terme en blocage configurable.
- Les validations/approbations (achats, factures, variations contractuelles, congés) exigent un approbateur différent du demandeur pour les seuils définis par politique d'organisation.

---

## 6. Permissions — conventions techniques

- Vérification de permission = fonction pure, testable indépendamment de la couche HTTP, prenant en entrée le contexte validé (utilisateur, organisation, société, projet actifs, permissions effectives) et retournant une décision binaire explicite.
- Échec de permission → erreur structurée uniforme (statut HTTP 403 ou 404 selon la politique de non-divulgation du §4.2), jamais une exception non gérée ni un comportement dégradé silencieux (ex. liste vide au lieu d'un refus explicite est interdit — ça masquerait un bug de scoping).
- Endpoints publics (`@Public`-équivalent) : liste blanche explicite et minimale (santé, authentification, endpoints portail dédiés), jamais un opt-out générique. Toute méthode HTTP non sûre (POST/PUT/PATCH/DELETE) reste protégée par la vérification d'origine (§8) même sur un endpoint public.
- Toute nouvelle permission ajoutée à un module doit être documentée dans la matrice de permissions du produit et couverte par au moins un test RBAC positif et un test RBAC négatif (refus).

---

## 7. Audit

### 7.1 Principe (INHERITED — append-only)

- Le journal d'audit (`AuditLog`) est **append-only** : aucune opération applicative d'`UPDATE`/`DELETE` n'est exposée, et un déclencheur PostgreSQL rejette toute tentative de modification/suppression même par un accès direct à la base.
- Chaque entrée d'audit capture au minimum : horodatage, acteur (utilisateur interne ou `null` + identifiant du principal externe en métadonnées pour les actions portail), organisation/société/projet, type d'événement, ressource cible, résultat (succès/échec), et une empreinte du contexte de requête (corrélation).
- Événements obligatoirement audités : connexion réussie/échouée, déconnexion, changement de contexte organisation/société/projet, toute modification RBAC (rôles, permissions, délégations), création/révocation MFA, toute action d'administration sensible (secrets, intégrations, exports massifs), toute validation/approbation métier (achats, factures, variations, paie), export de données, actions réalisées via l'IA Copilot en écriture.
- Aucune donnée secrète (mot de passe, jeton, secret MFA, clé API) n'apparaît en clair dans une entrée d'audit.

### 7.2 Conservation et exploitation

- Rétention et anonymisation d'audit : différées tant qu'un design explicite (politique légale/contractuelle par juridiction) n'a pas été validé — ERP3602 traite volontairement ce point comme non résolu (cf. ADR-0006), AX-A360 adopte la même prudence : pas d'effacement silencieux de preuves d'audit.
- Le journal d'audit est consultable selon RBAC dédié (`core.audit.read`), lui-même scoping-restreint (un administrateur de société ne voit pas l'audit d'une autre société).

---

## 8. Validation des entrées, CSRF et CSP

### 8.1 Validation des entrées

- Chaque endpoint définit un contrat de données (DTO) strict : types explicites, contraintes de longueur/format, **rejet des propriétés inconnues** (pas de « mass assignment » silencieux), validation exécutée côté serveur avant toute logique métier.
- Toute valeur monétaire ou de quantité critique utilise un type décimal exact, jamais un flottant binaire.
- Les identifiants de ressource acceptés en entrée ne sont jamais traités comme preuve d'autorisation — ils sont résolus puis revérifiés contre le contexte serveur (cf. §4.2).

### 8.2 Protection CSRF

- Modèle de session par cookie ⇒ exposition CSRF potentielle sur les méthodes non sûres. Contrôles requis :
  - `SameSite=Strict` (ou `Lax` justifié) sur le cookie de session comme première ligne de défense ;
  - vérification d'origine/referer sur toute requête HTTP non sûre (POST/PUT/PATCH/DELETE) — équivalent renforcé de l'`OriginGuard` global d'ERP3602, actif y compris sur les endpoints publics ;
  - jeton anti-CSRF synchronisé (double-submit ou en-tête personnalisé vérifié serveur) pour les formulaires classiques si un flux non-JSON est introduit ; pour les appels API JSON avec en-tête `Content-Type` contrôlé, la combinaison SameSite + vérification d'origine + absence de CORS ouvert constitue la défense principale.
  - CORS restreint à la liste explicite des origines Web/mobile configurées, credentials uniquement pour ces origines, jamais de wildcard `*` combiné à `credentials: true`.

### 8.3 Content Security Policy et en-têtes de sécurité

- CSP stricte par défaut : `default-src 'self'`, pas de `unsafe-inline`/`unsafe-eval` en production (nonces ou hachages pour le JS/CSS strictement nécessaire), `frame-ancestors 'none'` sauf besoin d'intégration explicitement whitelisté.
- En-têtes complémentaires obligatoires : `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` restrictive, suppression des en-têtes révélant la stack technique.
- Téléversements et contenus utilisateur (GED, photos chantier, pièces jointes) servis depuis une politique CSP/`Content-Disposition` empêchant l'exécution de script dans le contexte de l'application (voir §10).

---

## 9. Secrets

- Aucun secret (mot de passe, token, clé API, clé de chiffrement, certificat privé) n'est committé dans le code source ou les fichiers de configuration versionnés. `.gitignore` du workspace exclut déjà `.env`, `.env.*` (sauf `.env.example`), `*.pem`, `*.key`.
- Les secrets d'exécution (clé de chiffrement MFA, secrets de session, clés d'intégration tierces, identifiants de base de données) sont fournis par variables d'environnement ou un gestionnaire de secrets dédié, jamais en dur.
- Clés de chiffrement applicatives (ex. `MFA_ENCRYPTION_KEY` 32 octets base64url) : générées par un CSPRNG, rotation planifiée documentée, jamais réutilisées entre environnements (dev/staging/prod strictement séparés).
- Les fichiers d'exemple (`.env.example`) ne contiennent que des placeholders explicitement non fonctionnels.
- Toute intégration externe non testée réellement doit être marquée `NOT TESTED` dans la documentation produit, jamais présentée comme fonctionnelle.

---

## 10. Fichiers (téléversements, GED, pièces jointes)

- Validation stricte côté serveur : type MIME réel (sniffing de contenu, pas seulement l'extension ou l'en-tête déclaré par le client), taille maximale par type de ressource, quarantaine/scan antivirus si un moteur est réellement disponible dans l'environnement de déploiement.
- Stockage hors racine web directement exécutable ; service des fichiers via endpoint contrôlé qui revérifie le scoping tenant/company/project et la permission de lecture avant de streamer le contenu — un identifiant de fichier n'est jamais une capacité d'accès à lui seul (pas d'URL « secrète » comme unique protection).
- Noms de fichiers et métadonnées utilisateur assainis avant stockage/affichage (prévention traversée de chemin, injection dans les en-têtes `Content-Disposition`).
- Versionnement et statut GED (brouillon/soumis/approuvé/archivé) appliqués côté serveur avec RBAC dédié par statut (ex. seul un rôle habilité peut faire passer un document en « approuvé »), chaque transition auditée.
- Documents marqués `DEMO` restent physiquement et logiquement séparés des documents de production (organisation de démonstration dédiée, cf. prompt §42).

---

## 11. Intégrations (API, webhooks, connecteurs)

- API publique versionnée (`/api/v1`), authentification par clé API scoping-restreinte (permissions explicites, jamais un accès total par défaut), rate limiting par clé/IP, quotas configurables.
- Chaque connecteur externe (Revit, BIM/IFC, BACnet/Modbus/MQTT/KNX pour Smart Building, fournisseurs de notification e-mail/push) distingue explicitement, sans jamais les confondre dans la documentation ou l'UI :
  1. protocole/connecteur supporté par le logiciel ;
  2. connecteur effectivement implémenté ;
  3. équipement/service externe réellement accessible dans l'environnement ;
  4. lecture réelle testée ;
  5. écriture réelle testée.
- Un simulateur ou un mock n'est jamais présenté comme une preuve de communication avec un système ou équipement réel. Statut par défaut de toute intégration non vérifiée : `NOT TESTED`.
- Webhooks sortants : signature HMAC du payload avec secret par abonnement, horodatage anti-rejeu, retry avec backoff borné, jamais de secret d'intégration transmis en clair dans l'URL.
- Webhooks entrants : vérification de signature obligatoire avant tout traitement, validation stricte du schéma, idempotence par identifiant d'événement pour éviter les doubles traitements.
- Toute permission déléguée à l'IA (Copilot) pour appeler une intégration externe reste bornée par le RBAC de l'utilisateur au nom duquel elle agit (cf. §5.1).

---

## 12. Journalisation (logs applicatifs, hors audit métier)

- Distinction claire entre **journal d'audit métier** (§7, append-only, valeur probante) et **logs techniques** (diagnostics, performance, erreurs), qui suivent des règles de rétention différentes mais partagent l'interdiction de contenu secret.
- Aucun mot de passe, jeton de session brut, secret MFA, clé API, numéro de carte ou donnée personnelle sensible non nécessaire au diagnostic n'apparaît en clair dans les logs. Masquage systématique (`***`) des champs sensibles connus au niveau du logger central.
- Chaque requête protégée porte un identifiant de corrélation propagé du frontend à la base, permettant de relier un incident applicatif à une trace complète sans avoir à exposer de données sensibles dans les logs eux-mêmes.
- Niveaux de log différenciés par environnement (verbeux en développement, restreint en production) ; les logs de production ne doivent pas devenir une fuite d'information secondaire (stack traces internes non exposées au client, uniquement à la télémétrie serveur).

---

## 13. Sécurité applicative transverse (rappels architecturaux)

- Autorisation **serveur uniquement** — la couche NestJS-équivalente d'AX-A360 reste l'unique frontière de règles métier, d'autorisation, de transaction et d'audit (cohérent avec `docs/ARCHITECTURE.md` §5 d'ERP3602).
- Toute opération financière, de stock ou de paiement critique est transactionnelle (tout-ou-rien), avec verrouillage approprié pour éviter les conditions de course (ex. double décrément de stock, double paiement).
- Migrations de base de données versionnées et revues, jamais de modification de schéma de production hors migration contrôlée.
- Séparation stricte des environnements (dev/staging/prod), jeux de données `DEMO` isolés et identifiables, aucune donnée réelle de production utilisée en démonstration.

---

## 14. Tests d'isolation (exigences de vérification)

Aucun de ces tests n'est déclaré `PASS` par ce document — ils constituent la checklist de vérification obligatoire avant toute qualification d'un module comme « terminé » au sens du prompt maître (§45).

### 14.1 Isolation tenant/société/projet

- Un utilisateur de l'Organisation A ne peut lire, lister ni modifier une ressource de l'Organisation B, même en forgeant un identifiant valide (résultat attendu : « non trouvé »).
- Un utilisateur avec accès à la Société X d'une organisation ne peut pas accéder à la Société Y de la même organisation sans affectation explicite.
- Un utilisateur affecté au Projet 1 d'une société ne peut pas accéder aux ressources du Projet 2 de la même société sans affectation ou permission de portée société/organisation.
- Une tentative de changement de contexte actif (organisation/société/projet) vers un périmètre non autorisé est rejetée côté serveur, indépendamment de ce que l'interface autorise à afficher.

### 14.2 Isolation RBAC

- Pour chaque permission sensible : un test positif (le rôle habilité réussit) et un test négatif (un rôle non habilité échoue avec un refus explicite, pas un comportement dégradé).
- Une élévation de privilège via modification directe de payload (ex. injection d'un `role` ou `permissions` dans le corps de requête) est rejetée — les permissions effectives proviennent uniquement du contexte serveur, jamais de l'entrée client.
- Les rôles de projet n'accordent aucun droit implicite au niveau société ou organisation.

### 14.3 Isolation des sessions et de l'authentification

- Un cookie de session interne ne peut pas authentifier un endpoint portail externe, et réciproquement.
- Une session révoquée (logout, changement de mot de passe, révocation admin) est immédiatement inopérante sur toute requête suivante.
- Un jeton de session ou de récupération MFA ne peut pas être rejoué après consommation.

### 14.4 Isolation des données et fichiers

- Un identifiant de fichier/document deviné ou énuméré ne permet pas l'accès sans la permission et le scoping tenant corrects.
- Les données `DEMO` n'apparaissent jamais dans les recherches, exports ou tableaux de bord d'une organisation de production, et inversement.

### 14.5 Garde-fous base de données

- Tentative directe (hors couche applicative) de modification/suppression d'une ligne `AuditLog` : rejetée par le déclencheur PostgreSQL.
- Tentative directe d'incohérence de scoping (ex. société assignée à une session d'une autre organisation) : rejetée par déclencheur, valeurs persistées inchangées après l'échec.

### 14.6 Preuves attendues

Chaque catégorie ci-dessus doit produire, au moment de l'implémentation, des tests automatisés reproductibles (unitaires + intégration + E2E selon le cas) archivés et exécutables en CI, avec statut honnête (`PASS`/`PARTIAL`/`FAIL`/`BLOCKED`/`NOT TESTED`) — jamais une déclaration de succès sans exécution réelle correspondante.

---

## 15. Synthèse — écarts et priorités immédiates

| Domaine | Statut | Prochaine action |
|---|---|---|
| Authentification / mot de passe / sessions | SPEC, patterns INHERITED validés en référence | Implémenter le package sécurité AX-A360 (peut réutiliser l'approche scrypt/session éprouvée) |
| MFA TOTP | SPEC, patterns INHERITED validés | Implémenter enrôlement + step-up sur actions sensibles |
| Scoping projet (3ᵉ niveau) | EXTENDED — nouveau par rapport à ERP3602 | Concevoir `ProjectMembership`/`ProjectRoleAssignment` et garde-fous DB associés |
| RBAC deny-by-default | SPEC, patterns INHERITED | Définir la matrice de permissions complète par module avant tout développement fonctionnel |
| Audit append-only | SPEC, pattern INHERITED | Reproduire le déclencheur PostgreSQL dès la première migration |
| CSRF/CSP/en-têtes | SPEC (non documenté explicitement dans ERP3602 inspecté) | Spécifier et implémenter dès la mise en place du serveur HTTP |
| Portails externes | EXTENDED | Reprendre le plan d'identité séparé, l'étendre à l'exposition projet |
| Intégrations Smart Building/BIM | SPEC | Appliquer strictement la distinction connecteur/accès réel/lecture testée/écriture testée |
| Tests d'isolation | SPEC — checklist définie ici | À exécuter et journalier dès les premières fonctionnalités transversales (Core) |

**Aucun changement de code n'a été effectué. Aucune question bloquante n'a été identifiée pour l'établissement de ce modèle.**
