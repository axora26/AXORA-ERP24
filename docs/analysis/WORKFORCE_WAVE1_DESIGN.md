# Conception exécutable — Vague 1 Gestion des ouvriers

## 1. Décision d’architecture

Le premier incrément étend le domaine RH existant sans créer un second moteur de temps ou de paie.

Chaîne cible :

```text
AttendanceEvent (fait brut append-only)
        │ dérivation déterministe + saisie chef de chantier
        ▼
WorkforceMonth / WorkforceDailyEntry (décision journalière)
        │ soumission puis validation par tiers
        ▼
Timesheet/TimesheetEntry validés + quantités de rubriques
        │ préparation transactionnelle
        ▼
PayrollRun / PayrollLine + snapshots détaillés
        │ clôture immuable
        ├── bulletin / livre de paie / charges
        └── EmployeeAdvanceRepayment PAYROLL idempotent
```

Principes non négociables :

1. `AttendanceEvent` reste append-only; aucune absence ou correction ne l’écrase.
2. Une présence journalière est une **décision métier sourcée**. Elle peut provenir des événements, d’une saisie chef de chantier ou d’un congé approuvé.
3. Toute décision mensuelle est validée par une personne distincte du saisisseur/soumetteur, puis verrouillée en API et en base.
4. Toute règle monétaire ou légale est administrée, datée, versionnée et photographiée. Aucun taux légal n’est codé en dur; toute valeur non confirmée est `[NON VÉRIFIÉ]`.
5. Chaque table métier porte `organizationId` et `companyId`; les relations sensibles utilisent des clés composites afin d’empêcher une association inter-tenant.
6. Tous les montants et quantités sont `Decimal`; aucune conversion implicite de devise.
7. Les lignes d’une paie clôturée sont historiques : ni recalcul, ni enrichissement rétroactif.

## 2. Compatibilité avec l’existant

### 2.1 Objets conservés

- `Employee` reste l’identité du salarié/ouvrier.
- `AttendanceEvent` reste la source primaire des pointages `IN/OUT`.
- `Timesheet`/`TimesheetEntry` restent la source d’heures valorisées et imputées au projet/WBS.
- `LeaveRequest` reste l’autorité des congés approuvés.
- `PayrollRun`/`PayrollLine` restent les agrégats de paie et les clés des API/PDF existants.
- `CompanyPayrollPolicy` reste le point d’entrée de configuration générale, mais sa photographie devra référencer des versions détaillées.
- `EmployeeAdvance`/`EmployeeAdvanceRepayment` restent le grand livre des avances et remboursements.

### 2.2 Limites à corriger

- `PayrollLine.adjustments` et `adjustmentNotes` restent lisibles pour compatibilité, mais deviennent des **totaux dérivés** des lignes de rubrique; ils ne sont plus une source éditable une fois le nouveau flux activé.
- `PayrollLine.automaticAmount`, `grossAmount`, `totalDeductions` et `netAmount` sont recalculés côté serveur à partir des détails, puis contrôlés en base.
- Les anciens runs sans détails restent affichés avec la logique historique actuelle; aucune migration ne reconstitue des rubriques supposées.
- `CompanyPayrollPolicy.overtimeCoefficient` reste dans les snapshots historiques. Les nouveaux runs utilisent des rubriques HS taux 1/2 configurées; aucune conversion automatique de l’ancien coefficient vers des taux juridiques.
- Le trigger `axora_payroll_line_evidence` autorise actuellement l’édition de seulement `adjustments`, `adjustmentNotes`, `grossAmount`. Il doit être remplacé dans la nouvelle migration pour autoriser en brouillon les **totaux dérivés contrôlés**, interdire la modification des sources, et verrouiller ligne et détails quand le run est `CLOSED`.
- Le trigger `axora_closed_payroll_evidence` de `20261005071000_payroll_run_derived_totals_guard` autorise les totaux dérivés du run en brouillon. Cette logique est conservée et étendue à `totalGross`, `totalEmployerCharges` si ces colonnes sont ajoutées.

## 3. Présence mensuelle ouvrier / chantier

### 3.1 Cycle de vie

`WorkforceMonthStatus` :

- `DRAFT` : grille éditable par le chef de chantier autorisé;
- `SUBMITTED` : lecture seule pour le saisisseur, décision attendue;
- `VALIDATED` : verrou définitif; seule une opération de correction formelle future pourra créer une nouvelle révision, hors vague 1;
- `REJECTED` : commentaire obligatoire, retour en édition via une nouvelle version de feuille, sans effacer les traces précédentes.

La clé fonctionnelle d’une feuille est `(companyId, projectId, employeeId, period, revision)`. Une seule révision peut être courante. La période est `YYYY-MM`, mais `periodStart`/`periodEnd` sont persistés en dates UTC pour éviter une interprétation locale implicite.

`WorkforceDayStatus` :

- `PRESENT`
- `ABSENT`
- `JUSTIFIED_ABSENCE`
- `WEATHER`
- `LEAVE`
- `SICK`

Un jour `PRESENT` peut porter des heures normales et supplémentaires. Les autres états portent zéro heure dans ce premier incrément, sauf règle future explicitement configurée. Aucune indemnisation n’est inférée de l’état.

### 3.2 Dérivation depuis les pointages

Pour chaque couple salarié/projet/jour :

1. Charger les `AttendanceEvent` dans le scope tenant, incluant les intervalles traversant minuit par la fonction existante `loadAttendanceFacts` + `attendanceIntervals`.
2. Former uniquement des paires fermées `IN → OUT`; conserver les identifiants d’événements et la durée calculée dans `sourceSnapshot`.
3. Si toutes les paires sont cohérentes et rattachées au même projet, proposer `PRESENT` avec `workedHours` dérivées.
4. Si aucune paire n’existe, ne pas inventer `ABSENT`. Préremplir depuis un `LeaveRequest APPROVED` si applicable, sinon laisser le jour « à qualifier ».
5. Si une paire est ouverte, se chevauche, change de projet ou contredit un congé, créer une anomalie bloquante. Le chef peut qualifier le jour avec un motif, mais la source contradictoire reste visible.
6. Une saisie manuelle sans badge crée ou met à jour la décision journalière, jamais un faux `AttendanceEvent`.
7. À la soumission, recalculer les dérivations et utiliser un verrou optimiste `version`; refuser si les événements sources ont changé depuis le dernier chargement.
8. À la validation, figer `sourceSnapshot`, les totaux et l’empreinte des événements source; le validateur doit être distinct de `createdByUserId` et `submittedByUserId`.

### 3.3 Saisie journalière chef de chantier

Écran orienté chantier et date : liste des ouvriers affectés + ajout contrôlé d’un salarié actif de la même entreprise. Pour chaque ligne : état, heures normales, HS taux 1, HS taux 2, WBS facultatif, justification et indicateur de provenance (`POINTAGE`, `MANUEL`, `CONGÉ`, `MIXTE`).

Contrôles serveur :

- projet dans le scope et non `COMPLETED/CANCELLED`;
- salarié actif à la date et même tenant;
- date incluse dans le mois et dans la période d’emploi;
- une seule décision courante par salarié/projet/date;
- total d’heures compris entre zéro et 24;
- heures normales + HS = heures travaillées;
- état autre que `PRESENT` implique zéro heure;
- `JUSTIFIED_ABSENCE`, `WEATHER`, `LEAVE`, `SICK` exigent une justification ou une source approuvée;
- WBS, s’il est fourni, appartient au projet et doit être une feuille;
- version optimistic-lock obligatoire pour toute mise à jour;
- aucune mutation après `VALIDATED`.

### 3.4 Contrôle par tiers et verrouillage

- `SUBMITTED` exige tous les jours attendus qualifiés ou marqués non applicables selon le calendrier administré; aucun calendrier légal n’est présumé.
- `VALIDATED` exige `validatorUserId != createdByUserId` et `validatorUserId != submittedByUserId`.
- Un trigger PostgreSQL bloque `UPDATE`/`DELETE` d’un `WorkforceMonth VALIDATED`, de ses `WorkforceDailyEntry` et de leurs répartitions.
- Les transitions autorisées sont contrôlées en API et en base : `DRAFT→SUBMITTED`, `SUBMITTED→VALIDATED|REJECTED`; aucune réouverture de `VALIDATED`.
- Chaque transition écrit `AuditLog` dans la transaction.

## 4. Rubriques salarié configurables

### 4.1 Sémantique

`PayrollComponentDirection` : `EARNING` ou `DEDUCTION`.

`PayrollComponentBasis` :

- `FLAT` — montant forfaitaire;
- `DAY` — quantité de jours × valeur unitaire;
- `HOUR` — quantité d’heures × valeur unitaire.

Exemples de codes métier configurés par l’administrateur, sans valeur par défaut : `PANIER`, `TRANSPORT`, `DEPLACEMENT`, `RENDEMENT`, `HS_TAUX_1`, `HS_TAUX_2`, `AVANCE`. Les libellés et valeurs ne sont jamais imposés par le code.

Chaque version de rubrique précise : direction, base, unité, valeur ou coefficient, devise si montant, `taxable`, `contributableEmployee`, `contributableEmployer`, dates d’effet, règles d’arrondi, comptes comptables optionnels et source documentaire. Une rubrique incomplète est inactive pour la paie.

### 4.2 Hiérarchie de valeurs

Ordre de résolution explicite :

1. valeur affectée au salarié **et** au chantier;
2. valeur affectée au salarié;
3. valeur affectée au chantier;
4. valeur de la version de rubrique entreprise;
5. absence de valeur → erreur `NOT_CONFIGURED`, jamais zéro silencieux si une quantité a été saisie.

La valeur résolue et l’identifiant de version sont photographiés dans la ligne de paie. La hiérarchie reflète la capacité Batigest à personnaliser une rubrique au salarié ou au chantier, mais reste propre au modèle AXORA.[3][4]

### 4.3 Quantités

- `DAY` : quantité explicite issue des jours validés ou saisie autorisée, jamais déduite d’un nombre d’heures sans règle.
- `HOUR` : heures normales/HS validées; les HS taux 1 et 2 sont des rubriques distinctes.
- `FLAT` : quantité 1 par défaut seulement si la rubrique est activée pour la période; cette activation doit être explicite.
- Le rendement est une rubrique ordinaire. Aucune formule de productivité n’est présumée.
- La retenue d’avance est générée à partir d’un `EmployeeAdvance` approuvé et d’un montant demandé, borné au solde.

## 5. Bulletin de paie complet

### 5.1 Ordre de calcul

1. Charger salarié, contrat, devise, feuilles de présence et temps validés.
2. Résoudre la version de politique applicable à la période.
3. Calculer la base mensuelle ou horaire selon la politique photographiée.
4. Créer les lignes de gains : base, HS taux 1, HS taux 2, panier, transport, déplacement, rendement et autres rubriques actives.
5. Calculer `grossAmount = somme(EARNING)`.
6. Calculer les retenues salariales administrées sur les assiettes paramétrées.
7. Ajouter les retenues non légales, dont remboursement d’avance.
8. Calculer les charges patronales administrées, séparées du net salarié.
9. Calculer `employeeDeductions`, `netAmount = grossAmount - employeeDeductions` avec refus d’un net négatif, sauf politique future explicite.
10. Calculer les cumuls depuis les runs `CLOSED` de la même année/période de cumul, sans réinterpréter les anciens détails.
11. Photographier toutes les sources, versions, assiettes, quantités, taux/valeurs, arrondis et résultats.

### 5.2 Contenu minimal du bulletin

- entreprise émettrice; identifiants absents affichés `[à renseigner]`;
- salarié, matricule, emploi, période et devise;
- salaire/base de référence et mode de calcul;
- heures normales, HS taux 1 et HS taux 2;
- chaque gain avec code, libellé, base, quantité, valeur/taux et montant;
- brut;
- chaque retenue salariale avec assiette et montant;
- remboursement d’avance avec référence et solde après opération;
- total retenues et net à payer;
- charges patronales détaillées, clairement hors net salarié;
- cumuls période/année disponibles et qualification « historique incomplet » si les anciens runs n’ont pas de détails;
- statut brouillon/clôturé, version de politique et avertissements;
- visa responsable et salarié.

Le bulletin ne doit plus afficher le texte « retenues non configurées » lorsque la politique utilisée est complète. Quand une catégorie obligatoire n’est pas configurée, le run garde `NOT_CONFIGURED` et le net légal reste indisponible.

### 5.3 Avances salariés

En brouillon, une retenue d’avance crée une réservation logique `PayrollAdvanceAllocation`; elle ne crée pas encore de remboursement définitif. À la clôture :

- verrou pessimiste sur `EmployeeAdvance`;
- relecture du principal et des remboursements;
- refus si le solde est insuffisant;
- création idempotente de `EmployeeAdvanceRepayment(method=PAYROLL)` liée à l’allocation;
- mise à jour de l’état `PARTIALLY_REPAID` ou `SETTLED`;
- écriture d’audit dans la même transaction.

L’annulation d’un brouillon supprime l’allocation, pas l’historique de l’avance. Une paie clôturée ne peut pas être annulée dans cette vague; une correction ultérieure devra passer par une contre-écriture explicite.

## 6. Modèle Prisma proposé

Les extraits sont un design, pas une modification du schéma. **Chaque modèle ci-dessous est tenant-scopé** par `organizationId` + `companyId`.

### 6.1 Enums

```prisma
enum WorkforceMonthStatus { DRAFT SUBMITTED VALIDATED REJECTED }
enum WorkforceDayStatus { PRESENT ABSENT JUSTIFIED_ABSENCE WEATHER LEAVE SICK }
enum WorkforceEntrySource { ATTENDANCE MANUAL LEAVE MIXED }
enum PayrollComponentDirection { EARNING DEDUCTION }
enum PayrollComponentBasis { FLAT DAY HOUR }
enum PayrollComponentValueKind { AMOUNT PERCENTAGE COEFFICIENT }
enum PayrollComponentScope { COMPANY EMPLOYEE PROJECT EMPLOYEE_PROJECT }
enum PayrollConfigurationStatus { DRAFT ACTIVE RETIRED }
```

### 6.2 Présence

```prisma
model WorkforceMonth {
  id                String @id @default(cuid())
  organizationId    String
  companyId         String
  projectId         String
  employeeId        String
  period            String
  periodStart       DateTime @db.Date
  periodEnd         DateTime @db.Date
  revision          Int @default(1)
  status            WorkforceMonthStatus @default(DRAFT)
  version           Int @default(1)
  totalWorkedHours  Decimal @default(0) @db.Decimal(7,2)
  totalOvertime1    Decimal @default(0) @db.Decimal(7,2)
  totalOvertime2    Decimal @default(0) @db.Decimal(7,2)
  sourceDigest      String? @db.Char(64)
  createdByUserId   String
  submittedByUserId String?
  submittedAt       DateTime?
  decidedByUserId   String?
  decidedAt         DateTime?
  decisionNote      String?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  entries WorkforceDailyEntry[]
  project Project @relation(fields: [projectId, organizationId, companyId], references: [id, organizationId, companyId], onDelete: Restrict)
  employee Employee @relation(fields: [employeeId, organizationId, companyId], references: [id, organizationId, companyId], onDelete: Restrict)

  @@unique([companyId, projectId, employeeId, period, revision])
  @@unique([id, organizationId, companyId])
  @@index([organizationId, companyId, projectId, period, status])
}

model WorkforceDailyEntry {
  id                  String @id @default(cuid())
  organizationId      String
  companyId           String
  monthId             String
  workDate            DateTime @db.Date
  status              WorkforceDayStatus
  source              WorkforceEntrySource
  workedHours         Decimal @default(0) @db.Decimal(5,2)
  regularHours        Decimal @default(0) @db.Decimal(5,2)
  overtimeHours1      Decimal @default(0) @db.Decimal(5,2)
  overtimeHours2      Decimal @default(0) @db.Decimal(5,2)
  wbsItemId           String?
  justification       String?
  sourceSnapshot      Json
  sourceDigest        String @db.Char(64)
  version             Int @default(1)
  enteredByUserId     String
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  month WorkforceMonth @relation(fields: [monthId, organizationId, companyId], references: [id, organizationId, companyId], onDelete: Restrict)
  wbsItem ProjectWbsItem? @relation(fields: [wbsItemId], references: [id], onDelete: Restrict)

  @@unique([companyId, monthId, workDate])
  @@unique([id, organizationId, companyId])
  @@index([organizationId, companyId, workDate, status])
}
```

Contraintes SQL additionnelles : période `YYYY-MM`; `periodStart <= periodEnd`; heures entre 0 et 24; somme normal+HS = worked; état non `PRESENT` ⇒ toutes heures zéro; `SUBMITTED/VALIDATED` exige horodatages/auteurs; tiers validateur; WBS du même projet/tenant; trigger de verrou après validation.

### 6.3 Rubriques et valeurs

```prisma
model PayrollComponent {
  id             String @id @default(cuid())
  organizationId String
  companyId      String
  code           String
  name           String
  isActive       Boolean @default(true)
  createdByUserId String
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  versions PayrollComponentVersion[]
  @@unique([companyId, code])
  @@unique([id, organizationId, companyId])
  @@index([organizationId, companyId, isActive])
}

model PayrollComponentVersion {
  id                    String @id @default(cuid())
  organizationId        String
  companyId             String
  componentId           String
  version               Int
  status                PayrollConfigurationStatus @default(DRAFT)
  direction             PayrollComponentDirection
  basis                 PayrollComponentBasis
  valueKind             PayrollComponentValueKind
  defaultValue          Decimal? @db.Decimal(18,6)
  currency              String? @db.Char(3)
  taxable               Boolean
  contributableEmployee Boolean
  contributableEmployer Boolean
  roundingScale         Int @default(2)
  effectiveFrom         DateTime @db.Date
  effectiveTo           DateTime? @db.Date
  legalSource           String?
  debitAccountCode      String?
  creditAccountCode     String?
  approvedByUserId      String?
  approvedAt            DateTime?
  createdByUserId       String
  createdAt             DateTime @default(now())

  component PayrollComponent @relation(fields: [componentId, organizationId, companyId], references: [id, organizationId, companyId], onDelete: Restrict)
  values PayrollComponentAssignment[]
  @@unique([componentId, version])
  @@unique([id, organizationId, companyId])
  @@index([organizationId, companyId, status, effectiveFrom])
}

model PayrollComponentAssignment {
  id             String @id @default(cuid())
  organizationId String
  companyId      String
  versionId      String
  scope          PayrollComponentScope
  employeeId     String?
  projectId      String?
  value          Decimal @db.Decimal(18,6)
  currency       String? @db.Char(3)
  effectiveFrom  DateTime @db.Date
  effectiveTo    DateTime? @db.Date
  createdByUserId String
  createdAt      DateTime @default(now())

  version PayrollComponentVersion @relation(fields: [versionId, organizationId, companyId], references: [id, organizationId, companyId], onDelete: Restrict)
  employee Employee? @relation(fields: [employeeId, organizationId, companyId], references: [id, organizationId, companyId], onDelete: Restrict)
  project Project? @relation(fields: [projectId, organizationId, companyId], references: [id, organizationId, companyId], onDelete: Restrict)
  @@unique([companyId, versionId, scope, employeeId, projectId, effectiveFrom])
  @@unique([id, organizationId, companyId])
  @@index([organizationId, companyId, employeeId, projectId, effectiveFrom])
}
```

Contraintes SQL : cohérence scope/champs (`COMPANY` sans employee/project, `EMPLOYEE`, `PROJECT`, `EMPLOYEE_PROJECT`); valeur non négative; devise obligatoire pour `AMOUNT`; interdiction de chevauchement de versions `ACTIVE`; version active immuable, remplacée par nouvelle version; approbateur distinct du créateur.

### 6.4 Détails de paie et avances

```prisma
model PayrollLineComponent {
  id               String @id @default(cuid())
  organizationId   String
  companyId        String
  runId             String
  payrollLineId     String
  employeeId        String
  componentCode     String
  componentName     String
  componentVersion  Int
  direction         PayrollComponentDirection
  basis             PayrollComponentBasis
  valueKind         PayrollComponentValueKind
  quantity          Decimal @db.Decimal(18,6)
  unitValue         Decimal @db.Decimal(18,6)
  baseAmount        Decimal @db.Decimal(18,2)
  amount            Decimal @db.Decimal(18,2)
  taxable           Boolean
  contributableEmployee Boolean
  contributableEmployer Boolean
  sourceType         String
  sourceIds          Json
  calculationSnapshot Json
  createdAt          DateTime @default(now())

  run PayrollRun @relation(fields: [runId, organizationId, companyId], references: [id, organizationId, companyId], onDelete: Restrict)
  @@unique([payrollLineId, componentCode, sourceType])
  @@unique([id, organizationId, companyId])
  @@index([organizationId, companyId, runId, employeeId])
}

model PayrollEmployerCharge {
  id               String @id @default(cuid())
  organizationId   String
  companyId        String
  runId             String
  payrollLineId     String
  employeeId        String
  chargeCode        String
  chargeName        String
  configurationVersion Int
  baseAmount        Decimal @db.Decimal(18,2)
  configuredValue   Decimal @db.Decimal(18,6)
  amount             Decimal @db.Decimal(18,2)
  calculationSnapshot Json
  createdAt          DateTime @default(now())

  run PayrollRun @relation(fields: [runId, organizationId, companyId], references: [id, organizationId, companyId], onDelete: Restrict)
  @@unique([payrollLineId, chargeCode])
  @@unique([id, organizationId, companyId])
  @@index([organizationId, companyId, runId, employeeId])
}

model PayrollAdvanceAllocation {
  id               String @id @default(cuid())
  organizationId   String
  companyId        String
  runId             String
  payrollLineId     String
  employeeId        String
  advanceId         String
  componentLineId   String
  amount             Decimal @db.Decimal(18,2)
  repaymentId       String? @unique
  createdByUserId   String
  createdAt          DateTime @default(now())

  run PayrollRun @relation(fields: [runId, organizationId, companyId], references: [id, organizationId, companyId], onDelete: Restrict)
  employee Employee @relation(fields: [employeeId, organizationId, companyId], references: [id, organizationId, companyId], onDelete: Restrict)
  @@unique([companyId, runId, advanceId])
  @@unique([componentLineId, organizationId, companyId])
  @@unique([id, organizationId, companyId])
  @@index([organizationId, companyId, advanceId])
}
```

Ajouter à `PayrollLine` des champs dérivés : `employeeDeductions`, `employerCharges`, `cumulativeGross`, `cumulativeDeductions`, `cumulativeNet`, `calculationSnapshot`, tous `Decimal`/`Json` et figés à la clôture. Ajouter à `PayrollRun` : `totalGross`, `totalEmployerCharges`, `calculationVersion`. Ne pas remplir rétroactivement les anciens runs; leurs champs nouveaux sont nullable ou accompagnés d’un marqueur historique.

`EmployeeAdvanceRepayment` conserve son scope existant et reçoit `payrollAdvanceAllocationId String? @unique`, avec relation composite recommandée après ajout de `@@unique([id, organizationId, companyId])` sur les objets concernés.

### 6.5 Invariants base de données

- Tous les modèles proposés : `organizationId`, `companyId`, index de scope et clé composite d’identité.
- Toutes les relations vers salarié, projet, run et version : références composites tenant-scopées.
- `PayrollLineComponent.amount` doit correspondre à la formule photographiée et au signe de `direction`; stocker les montants positifs, le sens dans l’enum.
- `grossAmount = base automatique + somme gains variables`; `adjustments = gains variables - retenues non statutaires` seulement si ce champ historique doit rester compatible.
- `totalDeductions = retenues salariales légales + retenues non légales`; `netAmount = grossAmount - totalDeductions`.
- `employerCharges` n’entre jamais dans le net.
- Les totaux `PayrollRun` égalent la somme des lignes, vérifiés à la clôture sous verrou.
- Les détails de run `CLOSED` refusent UPDATE/DELETE; INSERT également refusé.
- Les configurations `ACTIVE` et leurs affectations historiques refusent UPDATE/DELETE.
- Aucun remboursement d’avance ne dépasse le solde sous verrou transactionnel.

## 7. API proposée

Toutes les routes sont sous `@ScopedController()`. Chaque ligne indique une permission explicite; aucune route publique.

### 7.1 Présence mensuelle

| Méthode et chemin | Usage | Permission |
|---|---|---|
| `GET /hr/workforce/months?period=&projectId=&employeeId=&status=` | Lister les feuilles dans le scope | `hr.workforce.read` |
| `POST /hr/workforce/months` | Créer/récupérer une feuille mensuelle idempotente | `hr.workforce.manage` |
| `GET /hr/workforce/months/:id` | Détail, anomalies et provenance | `hr.workforce.read` |
| `POST /hr/workforce/months/:id/derive` | Recalculer les propositions depuis pointages/congés | `hr.workforce.manage` |
| `PUT /hr/workforce/months/:id/days/:date` | Saisir une décision journalière avec `version` | `hr.workforce.manage` |
| `POST /hr/workforce/months/:id/submit` | Soumettre la feuille | `hr.workforce.manage` |
| `POST /hr/workforce/months/:id/validate` | Valider par tiers et verrouiller | `hr.workforce.validate` |
| `POST /hr/workforce/months/:id/reject` | Rejeter avec motif | `hr.workforce.validate` |
| `GET /hr/workforce/calendar?period=&projectId=` | Grille chantier/jour | `hr.workforce.read` |
| `GET /hr/workforce/months/:id/export.pdf` | État mensuel signé/logique | `hr.workforce.read` |
| `GET /hr/workforce/export.xlsx?period=&projectId=` | Consolidé contrôlable | `hr.workforce.export` |

Le scope projet doit être résolu depuis `projectId` et vérifié par le garde de périmètre existant. La lecture RH globale ne doit pas contourner un rôle limité au projet.

### 7.2 Rubriques

| Méthode et chemin | Usage | Permission |
|---|---|---|
| `GET /hr/payroll-components` | Catalogue et versions | `hr.payroll.read` |
| `POST /hr/payroll-components` | Créer un code de rubrique | `hr.payrollpolicy.manage` |
| `POST /hr/payroll-components/:id/versions` | Créer une version brouillon | `hr.payrollpolicy.manage` |
| `PATCH /hr/payroll-components/:id/versions/:version` | Éditer une version brouillon | `hr.payrollpolicy.manage` |
| `POST /hr/payroll-components/:id/versions/:version/activate` | Activer par tiers | `hr.payrollpolicy.approve` |
| `POST /hr/payroll-components/:id/assignments` | Valeur salarié/chantier | `hr.payrollpolicy.manage` |
| `GET /hr/payroll-components/resolve?employeeId=&projectId=&date=` | Prévisualiser la valeur résolue | `hr.payroll.read` |

### 7.3 Paie et avances

| Méthode et chemin | Usage | Permission |
|---|---|---|
| `POST /hr/payroll/preview` | Validation sans persistance : sources/configuration manquantes | `hr.payroll.manage` |
| `POST /hr/payroll` | Préparer le run et ses détails | `hr.payroll.manage` |
| `GET /hr/payroll/:id` | Run, lignes, warnings et totaux | `hr.payroll.read` |
| `GET /hr/payroll/:id/employees/:employeeId` | Détail complet salarié | `hr.payroll.read` |
| `POST /hr/payroll/:id/components` | Ajouter une rubrique autorisée en brouillon | `hr.payroll.manage` |
| `PATCH /hr/payroll/:id/components/:componentLineId` | Modifier quantité/source en brouillon, recalcul serveur | `hr.payroll.manage` |
| `POST /hr/payroll/:id/advance-allocations` | Affecter une retenue d’avance | `hr.advance.repay` |
| `DELETE /hr/payroll/:id/advance-allocations/:allocationId` | Retirer l’allocation d’un brouillon | `hr.advance.repay` |
| `POST /hr/payroll/:id/close` | Revalider, créer remboursements et figer | `hr.payroll.close` |
| `GET /hr/payroll/:id/employees/:employeeId/export.pdf` | Bulletin complet | `hr.payroll.read` |
| `GET /hr/payroll/:id/payroll-book.xlsx` | Livre de paie | `hr.payroll.export` |
| `GET /hr/payroll/:id/employer-charges.xlsx` | État charges patronales | `hr.payroll.export` |

Séparer `hr.payroll.close` de `hr.payroll.manage` réduit le risque qu’un préparateur clôture seul. Si le catalogue de permissions ne permet pas cette séparation au premier déploiement, créer la permission avant d’exposer la route; ne pas retomber sur un contrôle uniquement UI.

## 8. Services et transactions

### 8.1 `WorkforceService`

- `deriveMonth(scope, id, actor)` appelle les fonctions d’intervalle existantes;
- produit propositions et anomalies, sans écraser une décision manuelle;
- écrit `sourceSnapshot` avec identifiants, horodatages et digest;
- verrouille la feuille pour soumission/validation;
- met à jour les totaux uniquement côté serveur;
- écrit l’audit transactionnel.

### 8.2 `PayrollComponentService`

- résout les versions applicables à la date;
- refuse chevauchement, configuration inactive ou devise incompatible;
- retourne une structure de calcul pure et testable;
- ne contient aucune constante de taux légal.

### 8.3 `PayrollPreparationService`

Découper l’actuel `preparePayroll` en orchestration + fonctions pures :

- `collectValidatedSources`;
- `resolveCompensationComponents`;
- `calculateEmployeeDeductions`;
- `calculateEmployerCharges`;
- `calculateCumulatives`;
- `persistFrozenPayroll`.

Le run, les lignes, les détails, snapshots et allocations sont créés dans une transaction. La clôture reprend les verrous `company → run → advances`, recalcule les totaux depuis les détails persistés, crée les remboursements et change le statut en dernier.

## 9. Écrans responsive

### 9.1 `/hr/workforce`

- filtres période, chantier, statut et salarié;
- vue calendrier desktop, cartes empilées mobile;
- saisie de masse par jour avec barre d’actions fixe;
- état accessible par libellé + couleur, jamais couleur seule;
- provenance et anomalies visibles;
- actions soumettre/valider/rejeter conditionnées par permissions;
- à 390 px : une carte par ouvrier, champs tactiles, aucun tableau horizontal obligatoire;
- à 768 px : grille condensée avec entête de date collante;
- confirmation claire qu’une validation est irréversible.

### 9.2 `/hr/payroll-components`

- liste code/libellé/statut/date d’effet;
- assistant de version : sens, base, valeur, imposable, cotisable salarié/patronal, comptes;
- affectations entreprise/salarié/chantier;
- prévisualisation de résolution;
- bannière `[NON VÉRIFIÉ]` sur toute valeur légale sans source/validation;
- blocage UI et API de l’activation incomplète.

### 9.3 `/hr/payroll`

- étape 1 : période et contrôle des feuilles validées;
- étape 2 : aperçu des manques de configuration/anomalies;
- étape 3 : détails par salarié, rubriques et avances;
- étape 4 : contrôles totaux et clôture par utilisateur autorisé;
- mobile : résumé puis accordéons salarié; montants alignés; actions non masquées par défilement;
- PDF accessible depuis chaque salarié; exports livre/charges depuis le run.

Navigation à ajouter ultérieurement : « Présence ouvriers » (`hr.workforce.read`) et « Rubriques de paie » (`hr.payroll.read` ou `hr.payrollpolicy.manage`). Aucun changement n’est effectué dans `navigation.ts` par cette mission.

## 10. Tests

### 10.1 Unitaires

- paires `IN/OUT`, passage de minuit, paire ouverte, chevauchement et projet contradictoire;
- conversion événements → proposition journalière sans création de faux pointage;
- priorité des valeurs entreprise/salarié/chantier/salarié+chantier;
- calcul `FLAT`, `DAY`, `HOUR`, `AMOUNT`, `PERCENTAGE`, `COEFFICIENT` en Decimal;
- HS taux 1/2 comme rubriques séparées;
- brut, retenues, charges patronales et net;
- cumuls avec ancien run sans détails → marqueur incomplet;
- solde d’avance et concurrence simulée;
- aucune constante de taux dans les fixtures de production; les tests utilisent des paramètres explicitement fictifs.

### 10.2 E2E API sur PostgreSQL réel

1. isolation organisation et entreprise sur chaque nouvelle route;
2. rôle projet : accès à son chantier, 403 sur autre chantier, 404 sans divulgation hors tenant;
3. saisie manuelle sans badge puis dérivation conservant les événements bruts;
4. congé approuvé proposé comme `LEAVE`;
5. anomalie de paire ouverte bloque la soumission tant qu’elle n’est pas qualifiée;
6. soumission et validation par tiers; auto-validation refusée;
7. UPDATE/DELETE SQL direct refusé après validation;
8. activation de version de rubrique par tiers; chevauchement refusé;
9. préparation refusée si feuille non validée ou rubrique requise non configurée;
10. paie multi-rubriques avec bases forfait/jour/heure et deux HS;
11. retenue/charge patronale calculées depuis paramètres fictifs administrés;
12. devise incompatible refusée;
13. allocation d’avance bornée, double allocation idempotente, concurrence sans dépassement;
14. clôture crée exactement un remboursement et le rejeu ne duplique rien;
15. mutation API et SQL direct des détails d’une paie clôturée refusées;
16. totaux run = somme des lignes = somme des détails;
17. anciens runs toujours lisibles et non recalculés;
18. chaque permission de lecture/gestion/validation/export/close refusée isolément lorsqu’absente.

### 10.3 E2E web / Playwright

- chef chantier : mois → date → saisie de cinq états → soumission;
- valideur distinct : contrôle anomalies → validation → champs verrouillés;
- administrateur : crée version de panier fictive → activation par tiers;
- gestionnaire paie : aperçu → avance → préparation → clôture → PDF;
- RBAC : boutons absents et API refusée pour rôle lecture seule;
- responsive 390 px et 768 px, aucun défilement horizontal global;
- axe-core sans violation sur les trois écrans et modales;
- clavier complet, focus restauré après fermeture de modale;
- PDF inspecté : rubriques, retenues, charges, net, cumuls et mention historique.

## 11. Migration et retour arrière

### 11.1 Migration ascendante

Ordre recommandé dans une migration additive unique ou deux migrations atomiques successives :

1. créer enums;
2. créer tables de présence, rubriques, détails et allocations;
3. ajouter clés composites/indexes manquants nécessaires aux FK;
4. ajouter colonnes nullable de compatibilité à `PayrollRun`/`PayrollLine`;
5. ajouter contraintes CHECK et exclusion de chevauchement;
6. créer triggers de configuration immuable et présence validée;
7. remplacer les fonctions triggers de paie en conservant leurs noms, puis attacher les nouveaux détails;
8. ajouter permissions au seed/catalogue et rôles système explicitement;
9. ne migrer aucune donnée historique vers de fausses rubriques;
10. marquer les runs antérieurs `detailAvailability = HISTORICAL_UNAVAILABLE` ou équivalent nullable interprété par API.

Avant application : sauvegarde, validation Prisma, migration sur base vierge et copie restaurée, comptage des runs/lignes/avances. Après : comparer les comptes, vérifier les deux fonctions trigger, préparer et clôturer un run fictif sur base isolée.

### 11.2 Compatibilité des triggers

La fonction issue de `20261004004000_payroll_snapshot_guards` protège sources et snapshot; celle de `20261005071000_payroll_run_derived_totals_guard` permet la mise à jour des totaux dérivés du run en brouillon. La migration doit :

- conserver le refus total dès `OLD.status = CLOSED`;
- autoriser en brouillon seulement les colonnes dérivées recalculées par le serveur;
- refuser changement de `runId`, `employeeId`, source de base, snapshot et devise;
- vérifier les identités comptables à chaque INSERT/UPDATE de détail;
- interdire tout INSERT/UPDATE/DELETE de détail quand le parent est clôturé;
- empêcher la clôture si les totaux ne se réconcilient pas;
- couvrir par un test SQL direct chaque table protégée.

### 11.3 Rollback

Le rollback logiciel doit précéder le rollback de schéma :

- désactiver les nouvelles routes et écrans;
- empêcher toute nouvelle préparation utilisant les détails;
- si aucun run nouveau n’est clôturé : supprimer triggers/tables/colonnes en ordre inverse;
- si un run nouveau est clôturé : **ne pas supprimer les tables de preuve**. Revenir à l’ancienne UI en lecture seule, conserver les tables et déployer une migration corrective forward-only;
- ne jamais convertir les détails vers `adjustmentNotes` comme unique archive;
- restaurer la version précédente des fonctions trigger seulement après vérification qu’aucune ligne nouvelle n’en dépend;
- vérifier les comptes de `PayrollRun`, `PayrollLine`, remboursements et montants avant/après.

## 12. Lots indépendants ordonnés

### Lot 0 — Contrats, permissions et moteur pur

**Contenu** : types de contrats, permissions, fonctions de calcul Decimal, règles de dérivation sans persistance.

**Acceptation** :
- aucune valeur légale par défaut;
- fonctions pures couvertes pour rubriques et totaux;
- permissions listées dans le catalogue, deny-by-default;
- aucun changement de comportement des runs existants.

**Migration/rollback** : aucune migration métier; rollback par retrait des contrats inutilisés.

### Lot 1 — Présence mensuelle chantier

**Contenu** : modèles `WorkforceMonth`/`WorkforceDailyEntry`, API, écran responsive, dérivation et validation tiers.

**Acceptation** :
- six états journaliers disponibles;
- saisie sans badge sans créer d’`AttendanceEvent`;
- provenance des paires de pointage visible;
- tiers obligatoire;
- verrou API et base après validation;
- isolation tenant/projet et tests responsive réussis.

**Migration/rollback** : tables additives; suppression possible seulement sans feuille validée, sinon conservation lecture seule.

### Lot 2 — Catalogue de rubriques versionné

**Contenu** : composants, versions, affectations et résolution.

**Acceptation** :
- forfait/jour/heure, gain/retenue, imposable/cotisable salarié/patronal;
- panier, transport, déplacement, rendement, HS 1/2 et avance représentables sans code spécifique de taux;
- hiérarchie de valeurs déterministe;
- activation par tiers; version active immuable;
- aucune période active chevauchante.

**Migration/rollback** : tables additives; désactivation des routes avant retrait, conservation si référencées par une paie.

### Lot 3 — Paie détaillée et avances

**Contenu** : détails de ligne, charges, allocations d’avance, moteur et API enrichie.

**Acceptation** :
- base + heures + rubriques → brut;
- retenues salariales et charges patronales séparées;
- net indisponible si configuration obligatoire absente;
- remboursement d’avance créé une fois à la clôture;
- totaux réconciliés et concurrence couverte;
- anciens runs inchangés et lisibles.

**Migration/rollback** : colonnes nullable et tables additives; après première clôture, rollback uniquement forward-fix avec preuves conservées.

### Lot 4 — Bulletin, livre de paie et exports

**Contenu** : PDF complet, livre de paie XLSX, état charges et présence PDF/XLSX.

**Acceptation** :
- toutes les rubriques montrent base/quantité/valeur/montant;
- brut, retenues, charges, net, cumuls et avance concordent avec API;
- mentions absentes affichées `[à renseigner]`;
- aucun texte contradictoire lorsque les retenues sont configurées;
- rendu A4, données DEMO marquées, accessibilité et permissions export.

**Migration/rollback** : aucune migration supplémentaire; revenir aux anciens exports uniquement pour runs historiques, pas pour runs détaillés clôturés.

### Lot 5 — Coût chantier et comptabilité de paie

**Contenu** : ventilation WBS, analyse main-d’œuvre prévu/réalisé et écriture comptable paramétrée.

**Acceptation** :
- coûts issus exclusivement des feuilles/rubriques validées;
- ventilation projet/WBS sans double compte avec `TimesheetEntry.costAmount`;
- comptes configurés, aucune nomenclature OHADA présumée;
- écriture équilibrée, idempotente et traçable au run;
- validation métier par un comptable sur paramètres `[NON VÉRIFIÉ]`.

**Migration/rollback** : mapping comptable additif; une écriture `POSTED` n’est jamais supprimée, correction par contre-écriture.

## 13. Critères de fin de vague

La vague est acceptable seulement si :

- une feuille mensuelle complète peut être saisie sur mobile sans badge, soumise, validée par tiers et verrouillée;
- les événements de pointage restent inchangés et traçables;
- une paie contient des rubriques configurables avec les trois bases et les deux sens;
- les HS taux 1/2 n’utilisent aucun taux codé;
- le bulletin expose base, heures, rubriques, brut, retenues, charges patronales, net, cumuls et avance;
- le remboursement d’avance est atomique, idempotent et borné;
- tous les nouveaux modèles sont tenant-scopés et toutes les routes ont une permission;
- les anciens runs restent lisibles sans recalcul;
- les triggers refusent toute mutation après validation/clôture;
- les suites unitaires, API E2E, web E2E, responsive et export ont une sortie réelle enregistrée;
- les paramètres légaux restent administrés et marqués `[NON VÉRIFIÉ]` jusqu’à validation documentaire.

## Sources

[3] [Sage KB — Le suivi de la main-d’œuvre dans le chantier avancé de Batigest i7](https://fr-kb.sage.com/portal/app/portlets/results/viewsolution.jsp?page=1&position=1&q=Le+suivi+de+main+d%27oeuvre&solutionid=211010150057894)
[4] [Sage KB — Le chantier avancé](https://fr-kb.sage.com/portal/app/portlets/results/viewsolution.jsp?page=1&position=1&q=Le+chantier+avanc%C3%A9&solutionid=211010150098011)
