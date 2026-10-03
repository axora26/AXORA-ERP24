# AXORA-ERP24

Plateforme entreprise integree (ERP + CRM + Construction + MEP + BIM + Finance + RH + GED + QHSE + GMAO + Smart Building + Energie + Automatisation + Analytics + IA).

Nouveau produit greenfield. Reference fonctionnelle en lecture seule uniquement : AXORA ERP3602 (`C:/Users/dmgpe/AX-ERP360-source-readonly`) — jamais copie, jamais modifie.

## Documentation fondatrice

Toute decision d'architecture, de domaine, de securite, d'UX et de qualite est documentee AVANT le code dans `docs/foundation/` :

| Document | Contenu |
|---|---|
| `docs/foundation/01-architecture.md` | Stack, monorepo, frontieres de modules, strategie DB/API/PWA/mobile, phases verticales |
| `docs/foundation/02-domain-model.md` | 24 bounded contexts, invariants metier, carte de contexte |
| `docs/foundation/03-security.md` | Authentification, RBAC deny-by-default, audit, tenant isolation |
| `docs/foundation/04-ux-design-system.md` | Design tokens, composants, navigation, accessibilite |
| `docs/foundation/05-qa-devops.md` | Pyramide de tests, CI/CD, Docker, observabilite, packaging |
| `docs/foundation/06-product-backlog.md` | Matrice de couverture, graphe de dependances, backlog INC-00 -> INC-24 |

## Etat du produit

Voir `docs/MODULE_STATUS.md` (source de verite du statut reel de chaque module — jamais un statut suppose).

Vocabulaire de statut obligatoire : `NOT_STARTED`, `FOUNDATION`, `IN_PROGRESS`, `IMPLEMENTED_NOT_VERIFIED`, `VERIFIED`, `BLOCKED`, `NOT_TESTED`, `DEPRECATED`. Jamais de `READY`/`DEPLOYED`/`TESTED`/`CONNECTED` sans preuve CI (SHA + run).

## Structure du monorepo

```text
axora-erp24/
  apps/
    api/          # NestJS — API modular monolith
    web/          # Next.js App Router (PWA)
  packages/
    contracts/    # Types, DTO, cles de permission partagees
    security/     # RBAC, session, mfa, password, throttle
    database/     # Schema Prisma modulaire, migrations, seed
    ui/            # Design system AXORA-ERP24 (tokens, composants)
  docs/
    foundation/    # Rapports fondateurs (architecture, domaine, securite, UX, QA, backlog)
    MODULE_STATUS.md
    DECISIONS.md
    ARCHITECTURE.md
    EXECUTION_STATE.md
  ops/             # Scripts de deploiement
```

## Demarrage local (une commande)

Prerequis : Node.js >= 22.12, pnpm 9, et une base PostgreSQL (Docker recommande).

```bash
pnpm install
docker compose -f docker-compose.dev.yml up -d   # PostgreSQL + Redis
pnpm local                                        # migrations + API + web + donnees DEMO
```

Puis ouvrir **http://localhost:3100** et se connecter avec le compte de demonstration :
`demo@axora-erp24.local` / `Demo2026!Axora` (organisation marquee DEMO, bandeau permanent dans l'interface).

- `pnpm local --no-demo` : demarrage sans donnees de demonstration.
- `pnpm demo:seed` : (re)charge le jeu DEMO sur une API deja demarree — il passe par l'API reelle
  (regles metier, RBAC et audit appliques) et est idempotent.
- L'interface appelle l'API sur la meme origine (`/api/v1`, relaye par Next.js vers le port 4000) :
  une seule URL suffit.

Demarrage manuel equivalent : `pnpm db:generate && pnpm db:migrate:deploy && pnpm build:packages`,
puis `pnpm dev:api` (API, port 4000) et `pnpm dev` (web, port 3100).

## Tranche locale des 3 et 4 octobre 2026

La qualification courante porte sur `feat/product-qualification`, issue de `54930c1`.
Les résultats de septembre sont conservés comme historiques. Le code qualifié est
`b1a6cb1a27575c4c96484c393a0099eabe99baa8`, poussé sur `feat/product-qualification` et
proposé dans la [PR brouillon #2](https://github.com/axora26/AXORA-ERP24/pull/2).
Contrôles locaux réussis ; produit global `IN_PROGRESS`, CI distante `BLOCKED`, aucun statut global
`VERIFIED` n'est annoncé.

Les contrôles locaux ont confirmé 41 migrations sur les bases isolées, 200 tests unitaires,
351 cas API distincts qualifiés et un audit sans vulnérabilité connue. Ce total API
combine 347 cas de la suite complète, un nouveau cas de bulletin historique, deux
nouveaux imports refusés sur projets figés et l'export d'une politique version 0 avec
photographie présente ; les réexécutions ne sont pas additionnées. Les derniers builds
API/web et les reprises API RH/exports 15/15 et navigateur auth/impressions 15/15 réussissent.
Le premier run navigateur global, 163 scénarios dans
18 fichiers, termine avec **157 réussites et 6 échecs** : quatre contrôles d'accès et deux
parcours d'inscription. Les défauts d'impression ont été corrigés puis les 10 PDF et
leurs 11 pages A4 inspectés, sans dépassement ni recouvrement. Une nouvelle globale
sur les derniers bundles de `b1a6cb1` réussit **163/163** en 4,4 minutes. Types et builds API/web réussis ; lint : 0 erreur,
7 avertissements.

Les thèmes clair, sombre et système sont disponibles. La configuration des règles de
paie possède un accès distinct, sans imposer la lecture des employés ou des bulletins.

La fiche projet comporte un onglet **Operations** : presence reelle par paires Entree/Sortie,
temps declares et valides, consommations de stock nettes des retours, stock actuel des magasins
de chantier et affectations du parc. Le rapport couvre de 1 a 31 jours inclusifs en UTC.
Les actifs issus du projet indiquent leur origine de mise en service ; ils ne sont pas presentes
comme des affectations temporaires. Le cockpit et les rapports indiquent **Indisponible** quand
un droit source manque ou quand les devises ne permettent pas un total coherent.

En RH, une carte de service QR peut etre emise, imprimee et revoquee. Les pointages peuvent
preparer une feuille de temps en **brouillon**, puis suivent la soumission et la validation par
un tiers. La paie reprend soit le salaire mensuel de base, soit les heures validees selon des
heures mensuelles de reference et un coefficient supplementaire explicitement configures.
Les preparations conservent les parametres de leur calcul. Les retenues legales et le net a
payer restent **non configures** ; la fiche PDF l'indique.

Les préparations antérieures à la migration qui n'ont pas de photographie de leurs
paramètres ne sont pas recalculées. Leurs nouveaux détails horaires sont absents et
l'interface indique **Non disponible (historique)**.

Les exports DQE PDF/XLSX, avoirs clients/fournisseurs, operations chantier, carte QR et fiche
de paie utilisent les coordonnees et le logo publies sur [axora.cd](https://axora.cd/).
Neuf parcours d'impression metier sont aussi disponibles dans le navigateur : devis, contrats,
demandes d'achat, commandes, receptions, journaux chantier, mise en service, feuilles de temps
et mouvements de stock. Un document DEMO conserve sa mention DEMO.

Le detail des controles locaux et des limites est dans `docs/EXECUTION_STATE.md` et
`docs/MODULE_STATUS.md`. Ces ajouts ne constituent pas une verification CI globale du produit.

Le dernier run GitHub historique du 25 septembre porte une annotation explicite de
blocage du compte pour un problème de facturation, avant attribution d'un runner.
Le filtre historique des PR excluait la base `claude/funny-meitner-l317n1` ; le workflow
courant l'inclut et génère des clés de cartes de service éphémères pour ses jobs de test.
Les nouveaux runs [push 37161782565](https://github.com/axora26/AXORA-ERP24/actions/runs/37161782565)
et [PR 37161799570](https://github.com/axora26/AXORA-ERP24/actions/runs/37161799570) sur `b1a6cb1`
sont bloqués avant exécution : jobs sans runner ni étapes et annotations confirmant encore
le compte verrouillé pour facturation. Aucune CI verte n'est revendiquée.

## Verification (source de verite CI)

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm test:browser   # instance lancee (pnpm local) ; E2E_BASE_URL pour une autre adresse
```

`pnpm test:browser` (Playwright) parcourt les 30 ecrans avec le compte DEMO : erreurs JavaScript et console,
accessibilite axe-core WCAG 2.1 AA, absence de defilement horizontal a 390 et 768 px, securite. Le parcours
hors ligne (service worker) s'execute contre un build de production :
`E2E_BASE_URL=http://localhost:3200` apres `next build && next start -p 3200` dans `apps/web`. Un Chromium
deja installe peut etre designe par `PLAYWRIGHT_CHROMIUM_EXECUTABLE`, sinon `pnpm --filter @axora24/web exec playwright install chromium`.

Aucun statut `PASS` n'est annonce sans execution reelle de ces commandes. Preuves datees par SHA :
`docs/AXORA-ERP24_TEST_EVIDENCE.md` ; rapport de livraison : `docs/AXORA-ERP24_FINAL_DELIVERY_REPORT.md`.
