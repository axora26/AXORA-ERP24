# AXORA-ERP24 — Statut des modules

Vocabulaire obligatoire : `NOT_STARTED`, `FOUNDATION`, `IN_PROGRESS`, `IMPLEMENTED_NOT_VERIFIED`, `VERIFIED`, `BLOCKED`, `NOT_TESTED`, `DEPRECATED`.

Aucun module n'est marque `VERIFIED` sans preuve CI reelle (numero de run + SHA exact). Voir `docs/foundation/06-product-backlog.md` pour la definition complete de chaque increment.

| ID | Module | Increment | Statut | Preuve | Reste a faire |
|---|---|---|---|---|---|
| INC-00 | Bootstrap technique + Design System + Shell | INC-00 | `IMPLEMENTED_NOT_VERIFIED` | commit `ada072f` — install/build/typecheck/test executes en local avec succes. CI GitHub Actions ecrite mais jamais executee sur un runner reel. | Run CI reel avant tout `VERIFIED`. |
| INC-01 | Core — Identity / RBAC / Audit | INC-01 | `IMPLEMENTED_NOT_VERIFIED` | Authentification session opaque, guards session + permission deny-by-default, bootstrap organisation transactionnel, `/organizations/me` tenant-scoped, rate limiting PostgreSQL, audit login/logout sans secret, interface de connexion et shell verifies dans un navigateur reel. Gates locaux : lint/typecheck/build OK, 26 tests unitaires PASS, 24 tests e2e PASS sur PostgreSQL 18 reel. | MFA (TOTP), audit des echecs d'authentification, gestion des utilisateurs et des roles dans l'UI, CI distante. |
| INC-02 | CRM — prospects / opportunites / pipeline | INC-02 | `IMPLEMENTED_NOT_VERIFIED` | Modele CRM complet (comptes, contacts, prospects, pipeline, opportunites, activites append-only), API RBAC scopee entreprise, parcours Lead -> Opportunite transactionnel, tableau de bord commercial sur donnees reelles, interface CRM verifiee dans un navigateur reel (creation et conversion d'un prospect). 16 tests e2e CRM + 10 tests unitaires de validation PASS. | Edition/suppression des comptes et contacts, reaffectation de proprietaire, filtres et pagination, reorganisation des etapes du pipeline, CI distante. |

## Etapes suivantes

1. Executer la CI distante des que la facturation GitHub est regularisee — aucun module ne peut passer `VERIFIED` avant.
2. INC-03 — Estimation : Study / DQE / BPU / Pricing (depend de INC-02).
3. Completer INC-01 : MFA, audit des echecs, administration des roles.
