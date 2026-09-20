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

## Demarrage local

Prerequis : Node.js >=20, pnpm 9, Docker.

```bash
pnpm install
pnpm db:generate
docker compose -f docker-compose.dev.yml up -d
pnpm dev:api    # API sur http://localhost:4000
pnpm dev        # Web sur http://localhost:3000
```

## Verification (source de verite CI)

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

Aucun statut `PASS` n'est annonce sans execution reelle de ces commandes.
