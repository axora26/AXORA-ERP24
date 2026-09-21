# AXORA-ERP24 — Statut des modules

Vocabulaire obligatoire : `NOT_STARTED`, `FOUNDATION`, `IN_PROGRESS`, `IMPLEMENTED_NOT_VERIFIED`, `VERIFIED`, `BLOCKED`, `NOT_TESTED`, `DEPRECATED`.

Aucun module n'est marque `VERIFIED` sans preuve CI reelle (numero de run + SHA exact). Voir `docs/foundation/06-product-backlog.md` pour la definition complete de chaque increment.

| ID | Module | Increment | Statut | Preuve (run CI + SHA) | Notes |
|---|---|---|---|---|---|
| INC-00 | Bootstrap technique + Design System + Shell | INC-00 | `IMPLEMENTED_NOT_VERIFIED` | commit `ada072f` (local, CI pas encore executee sur runner) | Monorepo pnpm operationnel : install/build/typecheck/test executes reellement en local avec succes. CI GitHub Actions ecrite mais jamais executee sur un runner reel — ne pas declarer VERIFIED avant un run CI effectif. |
| INC-01 | Core — Identity / RBAC / Audit | PARTIAL | Authentification session opaque ; guards session + permission deny-by-default ; bootstrap organisation transactionnel ; route tenant-scoped `/organizations/me` ; isolation tenant testée ; rate limiting PostgreSQL ; audit transactionnel login/logout sans secret | Tests API **7/7 PASS** (dont 6 e2e Core) ; sécurité 11/11 ; lint/typecheck/build monorepo PASS ; CI distante bloquée par facturation | Interface utilisateur Core, audit d'échec, MFA ; CI distante |
1. Construire l'interface Core/connexion responsive et la vérifier dans Preview.
2. Reprendre la CI distante après régularisation de la facturation GitHub.
3. Démarrer INC-02 selon le backlog fondateur.
