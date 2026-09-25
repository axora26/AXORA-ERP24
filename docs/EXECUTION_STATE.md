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
- Polices auto-hebergees (@fontsource) : plus aucune requete vers un CDN tiers.

## Bloque (externe)

- CI GitHub Actions : les jobs echouent en ~2 s sans journal depuis le run 3 (facturation/quota du compte GitHub). Aucun module ne peut etre promu `VERIFIED` tant qu'un run reel n'a pas abouti.
- Lien public vers l'instance locale de developpement : les services de tunnel (trycloudflare.com, localtunnel.me, ngrok.com) sont refuses par la politique reseau de l'environnement de developpement. Le suivi se fait via la page de suivi (captures reelles) et la PR.

## Prochaine etape

INC-12 a INC-17 — Commissioning, MEP, BIM/IFC (connecteur Revit NOT_TESTED), Actifs/GMAO (MTBF/MTTR sur historique reel), Smart Building (connecteurs protocolaires NOT_TESTED), Energie.
