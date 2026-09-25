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

Prerequis : Node.js >= 20, pnpm 9, et une base PostgreSQL (Docker recommande).

```bash
pnpm install
docker compose -f docker-compose.dev.yml up -d   # PostgreSQL + Redis
pnpm local                                        # migrations + API + web + donnees DEMO
```

Puis ouvrir **http://localhost:3100** et se connecter avec le compte de demonstration :
`demo@axora-erp24.local` / `Demo2026!` (organisation marquee DEMO, bandeau permanent dans l'interface).

- `pnpm local --no-demo` : demarrage sans donnees de demonstration.
- `pnpm demo:seed` : (re)charge le jeu DEMO sur une API deja demarree — il passe par l'API reelle
  (regles metier, RBAC et audit appliques) et est idempotent.
- L'interface appelle l'API sur la meme origine (`/api/v1`, relaye par Next.js vers le port 4000) :
  une seule URL suffit.

Demarrage manuel equivalent : `pnpm db:generate && pnpm db:migrate:deploy && pnpm build:packages`,
puis `pnpm dev:api` (API, port 4000) et `pnpm dev` (web, port 3100).

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
