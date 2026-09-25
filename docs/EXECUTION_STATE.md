# AXORA-ERP24 — Etat d'execution courant

**Derniere mise a jour** : 2026-09-25 — branche `claude/funny-meitner-l317n1` (PR draft vers `feat/foundation`).

Le detail par module et les preuves sont dans `docs/MODULE_STATUS.md` ; les decisions dans `docs/DECISIONS.md`.

## Mode de travail

Developpement continu, increment par increment (`docs/foundation/06-product-backlog.md`). Chaque increment livre : schema Prisma + migration, API NestJS protegee (`@ScopedController`, permission explicite par route), audit transactionnel, tests e2e sur PostgreSQL reel (isolation tenant, RBAC refuse, invariants metier), ecran web, etape du jeu DEMO. Un increment n'est committe qu'apres `typecheck`, `lint`, `test`, `test:e2e` et builds verts en local, et verification des ecrans dans Chromium.

## Fait

- INC-00 a INC-04 (repris de `feat/foundation`).
- Socle plateforme (ADR-0007) : module commun, garde de perimetre, numerotation, tableau de bord reel, shell web a routes, kit UI, `pnpm local`, jeu DEMO via l'API.
- INC-01 complete : administration utilisateurs / roles / entreprises / audit, mot de passe, MFA TOTP.

## Bloque (externe)

- CI GitHub Actions : les jobs echouent en ~2 s sans journal depuis le run 3 (facturation/quota du compte GitHub). Aucun module ne peut etre promu `VERIFIED` tant qu'un run reel n'a pas abouti.
- Lien public vers l'instance locale de developpement : les services de tunnel (trycloudflare.com, localtunnel.me, ngrok.com) sont refuses par la politique reseau de l'environnement de developpement. Le suivi se fait via la page de suivi (captures reelles) et la PR.

## Prochaine etape

INC-05 — Projets & Construction (projet issu d'un contrat, WBS, budget par feuille, taches, avancement calcule, jalons).
