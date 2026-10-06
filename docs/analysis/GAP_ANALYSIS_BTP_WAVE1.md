# Analyse d’écarts BTP — AXORA ERP24 vs Sage Batigest i7

## 1. Objet, périmètre et méthode

Cette analyse compare l’arbre local au `HEAD f80b22eaa8a9fb6538b3bec0f935b6563ec3ba4f` de la branche `feat/premium-erp-wave1` avec les fonctions BTP documentées officiellement par Sage pour Batigest i7. La fiche Sage Batigest Connect est utilisée seulement comme source complémentaire : Sage le présente comme l’évolution de Batigest i7, et non comme une preuve que toutes ses nouveautés existaient à l’identique dans i7.[1]

La référence Sage retenue couvre notamment devis/factures/situations, suivi de chantier, main-d’œuvre, consommations, stocks, achats, sous-traitance et matériel.[2][3][4][5] Les constats « existant » ci-dessous reposent exclusivement sur des fichiers effectivement lus. Ils ne valent pas qualification d’exécution : `docs/MODULE_STATUS.md` qualifie les modules `IMPLEMENTED_NOT_VERIFIED` et `docs/EXECUTION_STATE.md` indique une CI distante `BLOCKED`.

Échelle : priorité **P0** = nécessaire au premier incrément ouvriers ou à l’intégrité de la paie ; **P1** = écart BTP structurant ; **P2** = enrichissement. Effort **S** = petit, **M** = moyen, **L** = grand, à confirmer par estimation d’équipe.

## 2. Sources consultées

### 2.1 Dépôt local

- `.hermes/wave1/BRIEF.md` — contraintes de mission et intégrité des contenus.
- `docs/MODULE_STATUS.md` — état fonctionnel déclaré et limites connues.
- `docs/EXECUTION_STATE.md` — preuves locales historiques et réserve de CI.
- `packages/database/prisma/schema.prisma` — socle tenant, RBAC, audit, DQE, devis et contrats.
- `packages/database/prisma/modules/hr.prisma` — salariés, pointages, temps, congés, paie, avances.
- `packages/database/prisma/modules/projects.prisma` — projets, WBS, tâches, budgets, prévisions et ressources.
- `packages/database/prisma/modules/field.prisma` — journal chantier, preuves terrain et synchronisation.
- `packages/database/prisma/modules/finance.prisma` — factures, situations, paiements, taxes et rapprochement.
- `packages/database/prisma/modules/accounting.prisma` — comptes, journaux et écritures.
- `packages/database/prisma/modules/inventory.prisma` — articles, dépôts chantier, mouvements, réservations et inventaires.
- `packages/database/prisma/modules/procurement.prisma` — fournisseurs, DA, offres, commandes, réceptions et retours.
- `packages/database/prisma/modules/subcontracting.prisma` — qualification, lots, situations et retenues.
- `apps/api/src/hr/hr.service.ts` — règles réellement appliquées aux pointages, temps, avances et paie.
- `apps/api/src/hr/payroll-calculation.ts` — calcul brut et retenues uniquement paramétrées.
- `apps/api/src/hr/hr-export.ts` — contenu actuel du bulletin PDF.
- `apps/api/src/hr/hr.controller.ts`, `hr-operations.controller.ts`, `hr-export.controller.ts` — routes et permissions existantes.
- `apps/web/app/lib/navigation.ts` — modules et permissions réellement exposés.
- `packages/database/prisma/migrations/20261004004000_payroll_snapshot_guards/migration.sql` — immutabilité des sources et lignes de paie.
- `packages/database/prisma/migrations/20261005071000_payroll_run_derived_totals_guard/migration.sql` — seules les sommes dérivées peuvent évoluer en brouillon.

### 2.2 Sources web officielles

- Sage, présentation Batigest Connect, évolution de Batigest i7.[1]
- Sage, découpage fonctionnel Batigest Connect.[2]
- Sage KB, suivi de la main-d’œuvre dans Batigest i7.[3]
- Sage KB, chantier avancé.[4]
- Sage KB, suivi des consommations.[5]
- CNSS RDC, déclaration des cotisations.[6]
- DGI RDC, impôt professionnel sur les rémunérations.[7]
- OHADA, AUDCIF et SYSCOHADA révisé.[8]

## 3. Synthèse décisionnelle

AXORA possède déjà un socle plus transversal qu’un simple suivi de chantier : multi-tenant, RBAC, audit, projets/WBS, achats, stock, finance, comptabilité, RH et sous-traitance. Le principal écart du premier incrément n’est donc pas la création de ces domaines, mais la **jonction contrôlée entre présence journalière chantier, rubriques salariés configurables, paie détaillée et coût réel par chantier**.

La Sage KB décrit une saisie par chantier ou salarié, les heures travaillées, absences, intempéries, plusieurs taux d’heures supplémentaires, paniers et déplacements, puis leur ventilation par tâche et leur analyse historique.[3][4] AXORA sait aujourd’hui enregistrer des paires `IN/OUT`, importer des durées vers une feuille hebdomadaire et calculer une paie mensuelle ou horaire, mais ne possède ni statut journalier d’ouvrier, ni rubriques typées, ni ventilation de chaque rubrique sur le chantier/WBS, ni bulletin détaillé avec charges patronales et remboursement d’avance lié.

## 4. Matrice des écarts

| Domaine | Existant prouvé dans AXORA | Référence Batigest i7 / écart vérifié | Priorité | Effort |
|---|---|---|---|---|
| **Personnel / ouvriers** | `Employee`, département, statut, contrat, salaire de base, coût horaire, compétences et carte de service dans `modules/hr.prisma`; CRUD dans `hr.service.ts`; navigation `/hr`. | Sage exige au minimum salariés + chantiers pour le suivi et permet des valeurs de rubriques personnalisées au salarié ou au chantier.[3] Manquent : qualification explicite ouvrier, calendrier/affectation chantier effective par jour, valeurs de rubriques versionnées par salarié, dossier social complet et historique contractuel. | **P0** | **M** |
| **Pointage / présence** | `AttendanceEvent` append-only, sources MANUAL/QR/PIN/BADGE/BIOMETRIC, projet optionnel; paires `IN/OUT`; import vers `TimesheetEntry`; validation par tiers. | Batigest suit heures, absence et intempérie, avec historique jour/semaine/mois.[3] Manquent : grille journalière mensuelle par chantier, états présent/absent/absence justifiée/intempérie/congé/maladie, saisie en masse sans badge, soumission/validation mensuelle par tiers et verrou après validation. | **P0** | **L** |
| **Paie** | `PayrollRun`/`PayrollLine`, politique photographiée, brut automatique, ajustement signé, retenues admin-paramétrées, net conditionnel, clôture et triggers d’immutabilité; export PDF; avances et remboursements séparés. | Le suivi Sage valorise heures normales/supplémentaires et rubriques telles que paniers/déplacements.[3][4] Manquent : catalogue de rubriques, bases forfait/jour/heure, sens gain/retenue, imposable/cotisable, taux 1/2 distincts, charges patronales, détail de calcul, cumuls, remboursement d’avance depuis la ligne de paie et historique de valeurs figées. | **P0** | **L** |
| **Chantiers** | `Project`, WBS, tâches, baseline, avenants, EAC, ressources planifiées; journal chantier signé avec effectif; opérations projet annoncées dans les états. | Batigest organise tranches/tâches, affecte salariés et matériels, compare prévu/réalisé et valorise la main-d’œuvre.[4] Manquent : roster quotidien effectif, affectation ouvrier↔chantier utilisée par la présence, ventilation des rubriques/HS par WBS, comparaison prévision main-d’œuvre vs réalisé au niveau attendu. | **P0** | **L** |
| **Comptabilité** | Plan de comptes, journaux, écritures équilibrées et états sur `POSTED` (`accounting.prisma`, `MODULE_STATUS.md`). | La fiche Sage documente le transfert comptable des écritures d’achats et de sous-traitance selon l’édition.[2] Manquent : génération comptable de la paie et des charges, comptes de rubriques configurables, pièce de paie, extourne/correction, export ou contrôle conforme au plan retenu. L’alignement AUDCIF/SYSCOHADA doit être validé par un comptable.[8] | **P1** | **L** |
| **Stock** | Articles, dépôts SITE, CMP, ledger append-only, soldes non négatifs, transferts, inventaires et réservations (`inventory.prisma`). | Batigest suit stocks chantier, mouvements interstocks, quantités approvisionnées/consommées/restantes et valeur au prix moyen pondéré.[2][4][5] Écart résiduel : analyse prévu/réalisé issue du devis au même niveau tâche/ouvrage, lots/séries et scan hors ligne; historique de solde à date non prouvé. | **P1** | **M** |
| **Achats** | Fournisseurs, DA, approbation tiers, offres, BC, réceptions partielles, retours, stock et avoir préparé (`procurement.prisma`, `finance.prisma`). | Sage documente commandes fournisseurs et intégration des commandes/factures/réceptions/retours au suivi de consommation.[2][5] Manquent : sourcing partiel/multi-commandes, seuils d’approbation et projection automatique prévu/réalisé par tâche depuis toutes les pièces. | **P1** | **M** |
| **Commercial / devis / situations** | DQE, catégories de coûts, bibliothèque, variantes, devis depuis DQE finalisé, contrat, factures client et situation en pourcentage (`schema.prisma`, `finance.prisma`). | Sage couvre métrés, devis, facturation, situations et organisation des documents en tranches/phases/lots.[1][2] Manquent : attachements/métrés contradictoires détaillés, situation par ligne de travaux, décompte, retenue client, avances/acompte et révision de prix; versions de devis restent signalées comme écart dans `MODULE_STATUS.md`. | **P1** | **L** |
| **Sous-traitance** | Profil fournisseur qualifié, documents de vigilance, lot lié BC/WBS, avancement dérivé, situation, facture fournisseur et retenue de garantie (`subcontracting.prisma`). | Sage documente sous-traitants, commandes/factures sous-traitants et paiement direct selon édition.[2] Manquent : équipes et pointage des effectifs sous-traitants, pénalités, compte prorata, paiement direct maître d’ouvrage et liaison QHSE; écarts déjà reconnus dans `MODULE_STATUS.md`. | **P1** | **L** |
| **Matériel** | Ressources projet `VEHICLE`/`ASSET`/`MATERIAL`, parc, GMAO et stock; planification avec dates et quantité (`projects.prisma`, navigation). | Batigest affecte les matériels aux tâches, suit dates début/fin et durée en heures, et le suivi des consommations valorise les heures matériel.[4][5] Manquent : feuille d’heures matériel par chantier/tâche, compteur ou durée réelle, tarif figé, rapprochement planifié/réalisé, indisponibilités et coût directement injecté dans l’analyse chantier. | **P1** | **M** |

## 5. Analyse détaillée du flux main-d’œuvre

### 5.1 Ce qui peut être réutilisé

1. **Identité et sécurité** : `Employee` et le scope `organizationId + companyId` fournissent la racine métier; les contrôleurs RH sont `@ScopedController()` et chaque route existante possède une permission.
2. **Faits de pointage** : `AttendanceEvent` est le journal brut append-only. Il doit rester intact et ne pas être transformé en grille éditable.
3. **Affectation analytique** : `projectId` et `wbsItemId` existent déjà sur `TimesheetEntry`; `ProjectWbsItem` est la bonne dimension de coût.
4. **Contrôle par tiers** : le workflow `Timesheet` impose déjà soumission puis validation par une personne distincte.
5. **Paie figée** : `policySnapshot`, `PayrollLine` et les deux triggers de garde offrent la base d’un historique non recalculé.
6. **Avances** : `EmployeeAdvanceRepayment` est append-only mais n’est pas rattaché à une ligne de paie; le lien doit devenir explicite et idempotent.

### 5.2 Ruptures à traiter en premier

- Une paire `IN/OUT` ne représente pas une absence, une maladie, un congé ou une intempérie. Ces états sont des **décisions journalières validées**, pas des événements de badge.
- `Timesheet` est hebdomadaire et centré sur les heures; le besoin de paie est une **présence mensuelle** avec état par jour, projet, source et décision.
- `adjustments` et `adjustmentNotes` agrègent toutes les variables de paie en un montant et un texte; ils ne sont ni auditables rubrique par rubrique, ni exploitables pour l’imposable/cotisable ou la comptabilité.
- Une unique `overtimeCoefficient` ne couvre pas les taux 1/2 demandés.
- Le PDF affiche une synthèse, pas les rubriques, bases, quantités, taux, charges patronales, cumuls ou remboursement d’avance.
- Le message final de `hr-export.ts` affirme toujours que les retenues ne sont pas configurées, même après affichage d’un calcul configuré; cet écart rédactionnel doit être corrigé dans un lot de code ultérieur, pas dans cette mission d’analyse.

## 6. Documents métier à produire et sources de données

La liste ci-dessous constitue le catalogue cible complet de la vague; « source » signifie table ou agrégat attendu, sans créer de vérité parallèle.

| Document / export | Source de données principale | Priorité |
|---|---|---|
| Fiche salarié / ouvrier | `Employee`, `Department`, `EmployeeSkill`, affectations projet | P1 |
| Carte de service | `EmployeeServiceCard`, `Employee` (déjà disponible) | P2 |
| Liste mensuelle du personnel actif | `Employee` filtré sur dates/statut | P1 |
| Feuille journalière chef de chantier | présence journalière proposée + `Employee` + `Project` | P0 |
| État mensuel de présence par ouvrier | présence journalière validée, dérivation `AttendanceEvent`, congés | P0 |
| État mensuel de présence par chantier | même source, groupée `Project`/jour | P0 |
| Registre des anomalies de pointage | `AttendanceEvent` + moteur d’intervalles + décisions de présence | P0 |
| Feuille d’heures par tâche/WBS | `TimesheetEntry`, présence validée, `ProjectWbsItem` | P1 |
| Récapitulatif heures normales / HS taux 1 / HS taux 2 | lignes de présence/temps validées + politique photographiée | P0 |
| État des absences, congés, maladies et intempéries | présence journalière + `LeaveRequest` | P0 |
| État des paniers, transports, déplacements et rendement | instances de rubriques de paie/chantier proposées | P0 |
| Préparation de paie mensuelle | `PayrollRun`, `PayrollLine`, détail rubriques et règles figées | P0 |
| Bulletin individuel complet | photographie salarié + `PayrollLine` + détails gains/retenues/charges/cumuls | P0 |
| Livre de paie | toutes lignes clôturées, groupées par rubrique | P0 |
| Journal de paie comptable | clôture de paie + mappings de comptes admin-paramétrés | P1 |
| État des charges patronales | détails de charges patronales figés par salarié/rubrique | P0 |
| État des retenues salariales | détails de retenues figés par salarié/rubrique | P0 |
| État de remboursement des avances | `EmployeeAdvance`, remboursements et lien `PayrollLine` proposé | P0 |
| Certificat/solde de tout compte | historique salarié + paies clôturées + paramètres légaux validés `[NON VÉRIFIÉ]` | P2 |
| Analyse main-d’œuvre par chantier | temps/rubriques validés, coûts figés, `Project`/WBS | P1 |
| Analyse main-d’œuvre par salarié | mêmes sources, groupées salarié/période | P1 |
| Comparatif heures/coûts prévus-réalisés | budget/DQE LABOR + ressources planifiées vs temps/rubriques validés | P1 |
| Journal quotidien chantier | `SiteDailyLog`, présence validée, stock du jour (existant partiel) | P1 |
| Analyse de rentabilité chantier | contrat/facturation, achats, stock, sous-traitance, paie, matériel | P1 |
| État de stock chantier et inventaire | `Warehouse(SITE)`, `StockBalance`, `StockMovement`, `StockCount` | P1 |
| Suivi de consommation prévu/réalisé | DQE/budget vs mouvements, réceptions et retours ventilés WBS | P1 |
| DA / comparatif / BC / réception / retour | modèles Achats existants | P1 |
| Devis / DQE / contrat | modèles DQE, Quote et Contract existants | P1 |
| Situation de travaux détaillée / attachement | modèle détaillé à créer; contrat/WBS/tâches/mesures | P1 |
| Facture / avoir / échéancier client | `CustomerInvoice`, lignes, avoirs, paiements | P1 |
| Dossier sous-traitant | profil, pièces de vigilance, fournisseur | P1 |
| Situation et retenue de sous-traitance | `SubcontractStatement`, `SubcontractRetention`, facture fournisseur | P1 |
| Feuille d’heures matériel | ressource/actif/engin + relevés réels à créer + projet/WBS | P1 |
| Analyse matériel prévu/réalisé | `ProjectResourcePlan` vs heures/coûts matériel réels à créer | P1 |

Tous les exports financiers doivent conserver `Decimal`, la devise et la photographie des paramètres. Aucun document ne doit afficher un identifiant légal absent : utiliser `[à renseigner]` conformément au brief.

## 7. Risques et dépendances

### 7.1 Données légales et sociales à obtenir

Aucun taux n’est retenu dans cette analyse. Les valeurs suivantes sont **`[NON VÉRIFIÉ]` tant qu’elles ne sont pas remises par l’administrateur, datées, sourcées et validées par un professionnel compétent** :

- barèmes IPR, tranches, abattements, plafonds, arrondis et traitement des avantages;
- cotisations salariales et patronales CNSS, assiettes, plafonds, périodicité et régularisation;
- autres contributions employeur/salarié applicables, dont INPP/ONEM et assurance santé;
- durée légale, heures supplémentaires, taux 1/2, nuit, dimanche, jour férié, intempérie, congés et maladie;
- règles de paie des journaliers, occasionnels, expatriés et sous-traitants;
- mentions obligatoires du bulletin, livre de paie, conservation, monnaie et taux de change;
- plan de comptes et schémas de comptabilisation conformes au référentiel applicable.

La CNSS indique une déclaration mensuelle pour chaque mois où du personnel a été employé.[6] La DGI décrit l’IPR comme portant notamment sur salaires, indemnités, gratifications, primes et autres rémunérations fixes ou variables.[7] L’AUDCIF/SYSCOHADA fixe le cadre comptable, le plan de comptes et la présentation de l’information financière.[8] Ces sources justifient la paramétrabilité et la traçabilité; elles ne suffisent pas à déduire un taux dans le logiciel.

### 7.2 Risques techniques et métier

| Risque | Effet | Réduction attendue |
|---|---|---|
| Double vérité `AttendanceEvent` / saisie journalière | heures ou états contradictoires | Conserver les événements bruts; produire une décision journalière dérivée avec provenance et anomalies explicites. |
| Recalcul d’une paie historique | bulletin différent après changement de règle | Photographier politiques, rubriques, salarié et sources dans le run; interdire UPDATE/DELETE après clôture. |
| Mélange de devises | agrégats faux | Une devise par run; refus sans conversion explicite, comme `preparePayroll`. |
| Arrondis cumulés | différence bulletin/livre/comptabilité | Decimal partout; règle d’arrondi versionnée; totaux dérivés et contrôlés en base. |
| Auto-validation chef de chantier | fraude ou erreur non détectée | Soumission et validation par tiers, y compris import automatique. |
| Remboursement d’avance en double | retenue excessive | Lien unique remboursement↔ligne de paie, verrou sur avance, plafond du principal et idempotence. |
| Portée tenant/projet insuffisante | fuite inter-entreprise | `organizationId + companyId` sur chaque modèle; relations composites; RBAC projet pour saisie chantier. |
| Paie clôturée mais détails modifiables | perte de preuve | Étendre les triggers existants à toutes les lignes de détail et snapshots. |
| Situation « présent » sans heures | coût ambigu | État journalier et durée sont deux dimensions; la paie horaire exige une quantité validée, la paie mensuelle conserve une alerte. |
| Couverture juridique obsolète | calcul non conforme | Politiques datées `effectiveFrom/effectiveTo`, approbation admin, source documentaire et aucun taux par défaut. |

## 8. Priorisation recommandée

1. **P0 — Décision de présence mensuelle** : saisie journalière chantier, dérivation des événements, statuts non pointés, tiers validateur et verrou.
2. **P0 — Rubriques et paie détaillée** : catalogue versionné, affectations salarié/chantier, instances figées, HS taux 1/2, avances et bulletin complet.
3. **P0 — Paramètres sociaux/patronaux** : moteur générique administré, sans valeur légale embarquée, avec état `NOT_CONFIGURED` bloquant le net légal.
4. **P1 — Coût chantier et comptabilité de paie** : ventilation WBS, analyses prévu/réalisé, journaux comptables paramétrés.
5. **P1/P2 — Extension Batigest** : matériel réel, situations détaillées, sous-traitants pointés et documents avancés.

## 9. Conclusion

Le premier incrément doit compléter, et non remplacer, `AttendanceEvent`, `Timesheet`, `PayrollRun` et `PayrollLine`. Le noyau attendu est une chaîne vérifiable : **fait de pointage → décision journalière chantier → validation par tiers → rubriques quantifiées → paie photographiée → bulletin et remboursement d’avance figés**. Cette chaîne répond à l’écart le plus net avec le suivi de main-d’œuvre Batigest i7, tout en maintenant les invariants AXORA de tenant, permission, décimal, audit et immutabilité.

## Sources

[1] [Sage Batigest Connect](https://www.sage.com/fr-fr/produits/sage-batigest-connect)
[2] [Découpage fonctionnel Sage Batigest Connect](https://www.sage.com/fr-fr/-/media/files/sagedotcom/france/documents/pdf/documentation-produits/2025/7-df-batigest_connect_072025.pdf)
[3] [Sage KB — Le suivi de la main-d’œuvre dans le chantier avancé de Batigest i7](https://fr-kb.sage.com/portal/app/portlets/results/viewsolution.jsp?page=1&position=1&q=Le+suivi+de+main+d%27oeuvre&solutionid=211010150057894)
[4] [Sage KB — Le chantier avancé](https://fr-kb.sage.com/portal/app/portlets/results/viewsolution.jsp?page=1&position=1&q=Le+chantier+avanc%C3%A9&solutionid=211010150098011)
[5] [Sage KB — Le suivi des consommations dans Batigest](https://fr-kb.sage.com/portal/app/portlets/results/viewsolution.jsp?page=1&position=1&q=Le+suivi+de+consommations+dans+Batigest&solutionid=211010150057898)
[6] [CNSS RDC — Déclaration des cotisations](https://cnss.cd/?page_id=1698)
[7] [DGI RDC — Impôt professionnel sur les rémunérations](https://dgi.gouv.cd/impot-professionnel-sur-les-remunerations)
[8] [OHADA — AUDCIF et SYSCOHADA révisé](https://www.ohada.org/acte-uniforme-relatif-au-droit-comptable-et-a-linformation-financiere-audcif)
