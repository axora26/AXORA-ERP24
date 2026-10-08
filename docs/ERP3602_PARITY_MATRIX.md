# ERP3602 → ERP24 — matrice de parité fonctionnelle

**Audit réalisé le 8 octobre 2026**

- Cible : `AXORA-ERP24`, branche `feat/erp3602-parity-wave3`, base `cafd5c58c9f2272920639c401810cea7fc1a98e4`.
- Référence fonctionnelle en lecture seule : `AXORA-ERP3602`, branche `main`, SHA `6e2f564094acf4bfc5014ac5347675b62bd11f37`.
- Règle : ERP3602 est utilisé comme benchmark de capacités génériques. Aucun code, texte, composant, branding ou actif propriétaire n'est copié.

## Légende

- **VERIFIED** : modèle persistant, API, autorisation, route utilisateur et couverture automatisée identifiés.
- **FUNCTIONAL** : résultat métier équivalent disponible via un workflow différent.
- **PARTIAL** : capacité présente mais incomplète sur un élément matériel du cycle métier.
- **MISSING** : aucune implémentation exploitable identifiée dans ERP24 au moment de l'audit.

## Matrice synthétique

| Domaine      | Capacité benchmarkée                                                 | ERP24 avant Wave 3 | Décision AXORA                                                                               |
| ------------ | -------------------------------------------------------------------- | -----------------: | -------------------------------------------------------------------------------------------- |
| CRM          | Comptes, contacts, leads, opportunités, activités                    |           VERIFIED | Conserver Account 360, timeline et prochaines actions d'ERP24.                               |
| Études       | Études commerciales, exigences et hypothèses                         |           VERIFIED | Conserver la chaîne d'étude traçable ERP24.                                                  |
| Chiffrage    | DQE/BPU, lots, lignes, variantes, exports                            |           VERIFIED | Conserver les snapshots et calculs à six décimales.                                          |
| Vente        | Devis soumis, acceptés ou rejetés                                    |           VERIFIED | Ajouter ultérieurement une entité de révision formelle de devis.                             |
| Contrats     | Contrat immuable issu d'un devis accepté                             |           VERIFIED | Conserver la neutralité juridique et les snapshots immuables.                                |
| Contrats     | Avenants structurés, soumis, approuvés ou rejetés                    |            MISSING | **Implémenté dans la Wave 3** avec lignes financières, RBAC, audit et concurrence optimiste. |
| Prix         | Source de prix au niveau d'une ligne DQE                             |            PARTIAL | Prévoir une preuve fournisseur durable, datée et vérifiable.                                 |
| Catalogue    | Product 360 unifiant article, équipement, stock et fournisseur       |            MISSING | Vague dédiée ; fédérer les référentiels existants sans les remplacer.                        |
| Projets      | WBS, budget, tâches, jalons, risques, ordres de changement           |           VERIFIED | Conserver le modèle projet ERP24, plus large que la référence sur plusieurs axes.            |
| Cost control | Prévisions EAC, engagé, consommé, facturé et encaissé                |         FUNCTIONAL | Améliorer la visibilité portefeuille et l'accès depuis la navigation.                        |
| Achats       | Fournisseurs, demandes, consultation, commandes, réceptions, retours |           VERIFIED | Conserver les contrôles de stock et avoir fournisseur existants.                             |
| Stock        | Articles, dépôts, mouvements, inventaires, réservations              |           VERIFIED | Prévoir une vague expédition/dispatch/tracking distincte.                                    |
| Finance      | Factures clients/fournisseurs, paiements, trésorerie, comptabilité   |           VERIFIED | Étendre progressivement le centre de sorties et les signatures.                              |
| Logistique   | Expéditions, dispatch, tracking, livraison, annulation               |            MISSING | Vague dédiée après les avenants et la preuve tarifaire.                                      |
| Transverse   | Contrôle d'accès physique                                            |            PARTIAL | ERP24 possède des fondations de présence/accès ; unifier les parcours ultérieurement.        |
| Formation    | Academy, cours et compétences                                        |            MISSING | Backlog RH dédié.                                                                            |
| Gouvernance  | Registre durable de décisions et conformité                          |            MISSING | Backlog administration/audit.                                                                |
| IA           | Preuves immuables des actions et inférences IA                       |            PARTIAL | Étendre le registre d'évidence existant sans exposer de secrets.                             |

## Wave 3 — avenants contractuels

La première tranche de parité ferme un écart à forte valeur pour les entreprises de construction :

- avenant rattaché à un contrat et au tenant `organizationId + companyId` ;
- numérotation de révision sérialisée par contrat ;
- lignes structurées avec plus-value ou moins-value ;
- calcul financier à six décimales ;
- statuts `DRAFT → SUBMITTED → APPROVED/REJECTED` ;
- permissions séparées de lecture, gestion et approbation ;
- journal d'audit transactionnel ;
- contrôle de concurrence par `expectedVersion` ;
- lignes immuables protégées au niveau PostgreSQL ;
- interface intégrée à `/sales`, sans dupliquer le module commercial ;
- navigation renommée **Devis, contrats & avenants**.

## Backlog de parité priorisé

1. Révisions formelles de devis avec snapshots et comparaison.
2. Preuve tarifaire fournisseur et provenance de prix au niveau ligne.
3. Product 360 fédérant catalogue, stock, équipements et références fournisseur.
4. Expéditions et suivi logistique.
5. Centre de sorties et documents transverses.
6. Academy/compétences, registre de gouvernance et preuves IA renforcées.

## Garanties non négociables

Toutes les vagues de parité restent soumises aux garanties ERP24 : isolation multi-tenant, RBAC côté serveur, audit, validation stricte, calculs décimaux exacts, états neutres lorsque les données ne sont pas autorisées, concurrence optimiste, migrations additives et publication fail-closed.
