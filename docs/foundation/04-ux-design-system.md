# AXORA-ERP24 — Design System & Architecture de l'Information

**Agent :** AXORA-ERP24-UX
**Produit :** AXORA-ERP24 (nouveau produit ; source de mandat `AXORA-ERP24.txt`, nommé `AX-A360` dans le prompt maître — substitution de nom uniquement, aucune autre substance modifiée)
**Référence UI en lecture seule :** `C:/Users/dmgpe/AX-ERP360-source-readonly/apps/web` (AXORA ERP3602 — inspectée, non modifiée)
**Portée de ce document :** spécification de design system et d'architecture de l'information. **Aucun code source n'a été créé ni modifié. Aucune question n'a été posée à l'utilisateur.** Rien n'est `READY`/`DEPLOYED`/`TESTED` — ce document définit ce qui doit être construit et vérifié par les agents d'implémentation (AXORA-ERP24-CORE, AXORA-ERP24-ARCHITECT, etc.).

---

## 0. Méthode et sources

Établi après inspection réelle de :
- `AXORA-ERP24.txt` — prompt maître (§34–§38 design, §8–§33 les 26 modules, §55 accessibilité) ;
- `apps/web/app/brand-charter.css` — charte de marque ERP3602 (ramps royal-blue / silver-chrome / navy, tokens `--axc-*`, motifs de surface, focus ring, print) ;
- `apps/web/app/workspace-nav.tsx` — navigation globale ERP3602 (groupes → liens, permissions, ancre de section, méga-menu au survol/clic) ;
- `apps/web/app/module-launcher.tsx` et `app/module-catalog.ts` — command palette / lanceur de modules filtrable par permission ;
- `apps/web/app/command-center.tsx` — page d'accueil connectée à des données de session réelles ;
- `.hermes/agent-reports/product-backlog.md` — matrice des 26 modules AXORA-ERP24 (M01–M26) et graphe de dépendances ;
- `.hermes/agent-reports/security.md` — modèle RBAC (permissions par module, contexte org/société/projet revérifié serveur) — la navigation **doit** filtrer strictement par permission, jamais par confiance client ;
- Skill `ui-ux-pro-max` — style *Data-Dense Dashboard*, domaines `ux`, `chart`, `icons`.

**Décision de conception explicite (prompt §34, §1) : AXORA-ERP24 n'est pas une resklinisation d'ERP3602.** La structure fonctionnelle (groupes de navigation, permissions, pattern shell/topbar/sidebar) est reprise comme référence éprouvée ; la charte visuelle est **redéfinie** avec la palette officielle imposée par le mandat : `#1E3A8A`, `#2563EB`, `#111827`, `#BFC3C9`, `#FFFFFF`, typographie `Montserrat` + `Inter` — à la place de la charte royal-blue/silver/navy propre à ERP3602.

---

## 1. Principes directeurs

| # | Principe | Application concrète |
|---|---|---|
| 1 | **Premium enterprise SaaS** | Surfaces nettes, hiérarchie typographique stricte, pas de skeuomorphisme, densité maîtrisée plutôt que blancs excessifs |
| 2 | **Dense mais lisible** | Grille d'espacement compacte (§3.3), tables à haute densité d'information avec zones de respiration calibrées, jamais de texte < 4.5:1 |
| 3 | **Rapide** | Pas d'animation bloquante, transitions 120–220ms, skeleton states, pas de spinners plein écran après le premier chargement |
| 4 | **Cohérent** | Un seul design system source de vérité (tokens), zéro composant dupliqué par module |
| 5 | **Accessible** | Clavier complet, focus visible, contrastes AA, `prefers-reduced-motion`, structure sémantique (§9) |
| 6 | **Responsive** | Desktop grand écran → laptop → tablette → smartphone, table→card fallback (§7) |
| 7 | **Clair / sombre** | Deux thèmes tokenisés au même niveau de qualité, jamais un thème « secondaire » moins soigné |
| 8 | **Honnête** | Aucune donnée fictive non étiquetée `DEMO`, aucun bouton non câblé, aucun état vide sans explication ni action (prompt §34, §46) |

---

## 2. Charte de marque AXORA-ERP24

### 2.1 Couleurs de référence (imposées par le mandat)

| Rôle | Hex | Usage |
|---|---|---|
| `axora-primary-deep` | `#1E3A8A` | Bleu institutionnel profond — headers de marque, fonds de sidebar en clair, texte de marque en sombre |
| `axora-primary` | `#2563EB` | Bleu d'action — boutons primaires, liens, focus ring, éléments actifs de navigation |
| `axora-ink` | `#111827` | Quasi-noir — texte principal en mode clair, fond d'application en mode sombre |
| `axora-silver` | `#BFC3C9` | Gris neutre — bordures, séparateurs, texte tertiaire, icônes inactives |
| `axora-white` | `#FFFFFF` | Blanc pur — fond de cartes en clair, texte principal en sombre |

Ces cinq couleurs sont les **ancres de marque**. Toutes les rampes de token (§3.1) sont dérivées mathématiquement de ces ancres afin de garder une identité reconnaissable à travers les 26 modules, plutôt que d'importer une palette générique de dashboard.

### 2.2 Typographie de marque

- **Montserrat** (Google Fonts, `wght 500/600/700/800`) — titres de marque, `h1`/`h2` de page, logotype, valeurs KPI en gros corps. Caractère géométrique et autoritaire, cohérent avec un logo à monogramme anguleux.
- **Inter** (Google Fonts, `wght 400/500/600`, variable) — corps de texte, libellés de formulaire, tables, navigation, UI dense. Choisie pour sa lisibilité à petite taille (10–13px) indispensable à la densité du style *Data-Dense Dashboard*.
- Import :
```css
@import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@500;600;700;800&family=Inter:wght@400;500;600&display=swap');
```
- Règle stricte : **Montserrat n'est jamais utilisée en dessous de 14px ni pour du texte de table** (elle dégrade la lisibilité dense) ; **Inter n'est jamais utilisée pour les titres de niveau produit** (`h1` de Command Center, splash de login) afin de préserver la reconnaissance de marque.

### 2.3 Différenciation explicite vs. ERP3602

| Aspect | ERP3602 (`brand-charter.css`) | AXORA-ERP24 (ce document) |
|---|---|---|
| Ancre primaire | `#2b7ff2` (royal blue monogramme) | `#2563EB` (imposé par le mandat) |
| Ancre profonde | `#032a86` / navy `#050b16` | `#1E3A8A` / ink `#111827` |
| Neutre | Silver chrome `#9aa4b4`→`#f6f9fb` | Silver `#BFC3C9` |
| Police display | Segoe UI Variable Display | Montserrat |
| Police texte | Inter | Inter (conservée — bon choix technique, repris intentionnellement) |
| Mode par défaut | Sombre uniquement (`.axora-premium-dark` forcé) | Clair **et** sombre au même niveau de finition, bascule utilisateur persistée |

L'architecture CSS (fichier de charte chargé en dernier, tokens `--ax-*` scellant boutons/inputs/tables/status pills, jamais de `!important` sur transition/animation pour ne pas casser `prefers-reduced-motion`) est un pattern **repris** car techniquement solide — seules les valeurs de couleur et de police changent.

---

## 3. Design tokens

### 3.1 Rampes de couleur (dérivées des ancres §2.1)

#### Bleu de marque (`--ax-blue-*`)
| Token | Hex | Rôle |
|---|---|---|
| `--ax-blue-50` | `#EFF4FE` | Fond de survol très léger, badges info |
| `--ax-blue-100` | `#DCE6FC` | Fond de sélection légère (tables, listes) |
| `--ax-blue-200` | `#B7CBFA` | Bordure active légère |
| `--ax-blue-300` | `#8DACF3` | Icône secondaire active |
| `--ax-blue-400` | `#5C86EC` | Hover sur bouton secondaire |
| `--ax-blue-500` | `#2563EB` | **Primaire** — CTA, liens, focus, item actif |
| `--ax-blue-600` | `#1E4FC7` | Hover sur bouton primaire |
| `--ax-blue-700` | `#1E3A8A` | **Marque profonde** — sidebar claire, topbar sombre, texte de marque |
| `--ax-blue-800` | `#182F6E` | Fond de sidebar en mode sombre |
| `--ax-blue-900` | `#122352` | Dégradés de fond, hairline de marque |

#### Neutres / encre (`--ax-ink-*`, dérivés de `#111827` et `#BFC3C9`)
| Token | Hex | Rôle |
|---|---|---|
| `--ax-ink-0` | `#FFFFFF` | Blanc pur |
| `--ax-ink-50` | `#F7F8FA` | Fond d'application (clair) |
| `--ax-ink-100` | `#EEF0F3` | Fond de carte alternée, zébrage table |
| `--ax-ink-200` | `#DEE1E6` | Bordure standard (clair) |
| `--ax-ink-300` | `#BFC3C9` | **Silver de marque** — bordures fortes, texte tertiaire/désactivé |
| `--ax-ink-400` | `#9AA1AC` | Icônes inactives, placeholders |
| `--ax-ink-500` | `#6B7280` | Texte secondaire (clair) |
| `--ax-ink-600` | `#4B5563` | Texte secondaire (sombre-sur-clair fort) |
| `--ax-ink-700` | `#374151` | Texte primaire sur fond clair (alternative) |
| `--ax-ink-800` | `#1F2937` | Sidebar/topbar en clair (fond sombre local), surfaces élevées en sombre |
| `--ax-ink-900` | `#111827` | **Encre de marque** — texte principal (clair), fond d'application (sombre) |
| `--ax-ink-950` | `#0B0F17` | Fond d'app le plus profond (sombre), zones d'emphase |

#### Sémantique (mêmes rôles clair/sombre, contrastes vérifiés AA)
| Rôle | Clair (fond `#FFFFFF`/`#F7F8FA`) | Sombre (fond `#111827`/`#0B0F17`) |
|---|---|---|
| Succès | texte `#0F7A4E` / fond `#E7F6EF` / bordure `#B7E4CE` | texte `#4ADE94` / fond `rgba(74,222,148,.14)` / bordure `rgba(74,222,148,.35)` |
| Avertissement | texte `#92620B` / fond `#FEF3DC` / bordure `#F6D999` | texte `#F5C469` / fond `rgba(245,196,105,.14)` / bordure `rgba(245,196,105,.35)` |
| Danger | texte `#B91C2C` / fond `#FCE8EA` / bordure `#F3B7BE` | texte `#FF8A96` / fond `rgba(255,138,150,.14)` / bordure `rgba(255,138,150,.35)` |
| Info | texte `#1E4FC7` / fond `#EFF4FE` / bordure `#B7CBFA` | texte `#8DACF3` / fond `rgba(141,172,243,.14)` / bordure `rgba(141,172,243,.35)` |
| Neutre/DEMO | texte `#4B5563` / fond `#EEF0F3` / bordure `#DEE1E6` | texte `#BFC3C9` / fond `rgba(191,195,201,.12)` / bordure `rgba(191,195,201,.30)` |

Le badge `DEMO` (prompt §42) utilise systématiquement le style **Neutre** + une icône dédiée, jamais une couleur sémantique (succès/danger) qui laisserait croire à un état métier.

### 3.2 Typographie — échelle

| Token | Taille / interligne | Police | Usage |
|---|---|---|---|
| `--ax-text-display` | 28px / 34px, 800 | Montserrat | `h1` Command Center, écran de login |
| `--ax-text-h1` | 22px / 28px, 700 | Montserrat | Titre de page de module |
| `--ax-text-h2` | 17px / 24px, 650 | Montserrat | Titre de panneau/section |
| `--ax-text-h3` | 14px / 20px, 650 | Inter | Sous-section, en-tête de carte KPI |
| `--ax-text-body` | 13px / 20px, 400 | Inter | Corps de texte standard |
| `--ax-text-dense` | 12.5px / 18px, 400 | Inter | Cellules de table, listes denses |
| `--ax-text-caption` | 11px / 16px, 500, `tracking .04em` | Inter | Libellés de champ, badges, légendes |
| `--ax-text-eyebrow` | 10.5px / 14px, 700, `tracking .14em`, uppercase | Inter | Sur-titre de section (motif repris d'ERP3602, recoloré marque) |

Taille de base navigateur non forcée (respect du zoom utilisateur / Dynamic Type web) ; toutes les tailles ci-dessus sont en `rem` dans l'implémentation, exprimées en px ici pour lisibilité.

### 3.3 Espacement — densité dashboard (dial density = 9/10)

| Token | Valeur | Usage |
|---|---|---|
| `--ax-space-1` | 4px | Gap icône/texte, padding interne badge |
| `--ax-space-2` | 8px | Gap entre champs de formulaire courts |
| `--ax-space-3` | 12px | Padding interne carte compacte, gap toolbar |
| `--ax-space-4` | 16px | Padding standard de panneau/carte |
| `--ax-space-5` | 20px | Gap entre cartes d'une grille KPI |
| `--ax-space-6` | 24px | Marge de section (au sein d'une page module) |
| `--ax-space-8` | 32px | Séparation entre grands blocs de page |
| `--ax-space-12` | 48px | Marge de page desktop grand écran uniquement |

Grille dense pour tables/formulaires (8px), grille standard pour zones de respiration entre panneaux (16–24px) — jamais l'espacement marketing (48–96px) d'une landing page à l'intérieur du shell applicatif.

### 3.4 Rayons, élévation, focus

| Token | Valeur |
|---|---|
| `--ax-radius-field` | 8px (inputs, boutons) |
| `--ax-radius-control` | 8px (chips, pills interactifs) |
| `--ax-radius-card` | 14px (panneaux, cartes KPI) |
| `--ax-radius-sheet` | 18px (modales, drawers, login card) |
| `--ax-shadow-1` | `0 1px 2px rgba(17,24,39,.06), 0 6px 16px rgba(17,24,39,.06)` (clair) / `0 1px 2px rgba(0,0,0,.5), 0 8px 22px rgba(0,0,0,.30)` (sombre) |
| `--ax-shadow-2` | élévation modale/drawer, x2 l'intensité de `shadow-1` |
| `--ax-ring` | `0 0 0 3px rgba(37,99,235,.45)` — anneau de focus clavier, identique clair/sombre pour prévisibilité |

### 3.5 Mouvement (dial motion = 3/10, sobre)

- Durée standard : 150–220ms, `ease-out` (`cubic-bezier(0.16,1,0.3,1)` pour les entrées de panneaux/drawers).
- Révélation de contenu (chargement de liste, apparition de carte) : `opacity 0→1` + `translateY(8px→0)`, jamais plus de 12px de déplacement (motif *Scroll Reveal Subtle* de la recherche `--design-system`).
- **Sortie plus rapide que l'entrée** (règle générale UX) : fermeture de modale/menu ≤ 120ms.
- `@media (prefers-reduced-motion: reduce)` désactive tout déplacement et toute rotation (spinners inclus) — état final rendu directement, motif déjà présent dans `brand-charter.css` (`ax-state-spinner`) à reprendre à l'identique.
- Aucune animation n'utilise `!important` sur `transition`/`animation` (pour ne jamais bloquer la surcharge accessibilité).

---

## 4. Composants (inventaire du design system)

Bibliothèque interne unique (`@axora/ui` ou équivalent), zéro duplication par module (prompt §34 anti-pattern « composants dupliqués »).

### 4.1 Structure & layout
- **AppShell** : sidebar rétractable + topbar + zone de contenu + zone d'état (skip-link, live region pour annonces).
- **Sidebar** (voir §5.2) : rétractable (icône-seule ↔ étendue), sections regroupées, item actif avec indicateur de bordure gauche (`3px solid --ax-blue-500`).
- **Topbar** : breadcrumb, sélecteur de contexte (organisation/société/projet), recherche globale, notifications, avatar/menu utilisateur, bascule clair/sombre.
- **Panel/Card** : conteneur standard de contenu (bordure 1px `--ax-ink-200`/sombre équivalent, `--ax-radius-card`, `--ax-shadow-1`).
- **PageHeader** : `--ax-text-eyebrow` + `--ax-text-h1` + actions contextuelles alignées à droite.

### 4.2 Navigation & découverte
- **CommandPalette** (`⌘K` / `Ctrl+K`) : recherche unifiée, résultats groupés par domaine (entités métier §6.4, actions, navigation), navigation clavier complète, fermeture `Esc`, focus restitué à l'élément déclencheur à la fermeture.
- **ModuleLauncher** : grille filtrable des 26 modules groupés (repris du pattern `module-launcher.tsx`/`module-catalog.ts` — filtrage strict par permission côté client **en plus** du filtrage serveur, jamais à la place).
- **Breadcrumbs** : présents dès 3 niveaux de profondeur (règle ux-guidelines), jamais sur les vues plates.
- **GlobalSearch** : champ topbar avec auto-complétion débattue (« debounced »), état « Aucun résultat » toujours accompagné d'une suggestion actionnable, jamais un écran vide.
- **ContextSwitcher** : organisation → société → projet, revérifié serveur à chaque changement (jamais une confiance aveugle au choix client — cf. `security.md` §2.1).

### 4.3 Données
- **DataTable dense** : en-têtes triables, colonnes redimensionnables, sélection de ligne, pagination serveur, zébrage `--ax-ink-100`, hover `rgba(--ax-blue-500, .06)`, ligne d'action au survol. Fallback carte en mobile (§7.2).
- **KanbanBoard**, **CalendarView**, **GanttView**, **MapView** (quand pertinent — chantiers géolocalisés, actifs, flotte) : mêmes tokens de couleur/statut que la table, jamais une palette parallèle.
- **ChartWidgets** : bibliothèque recommandée par la skill `ui-ux-pro-max` (`Chart.js`/`Recharts`/`ApexCharts` pour tendances ; `D3`/SVG custom pour KPI bullet/gauge) — jamais deux librairies de charts concurrentes dans le même produit.
- **KPI Card** : valeur en Montserrat 700 dégradée marque (`--ax-blue-700`→`--ax-blue-500`, motif repris de `.ax-kpi > strong`), variation (delta) en couleur sémantique + icône, jamais couleur seule.
- **StatusPill** : `PASS`/`PARTIAL`/`FAIL`/`BLOCKED`/`NOT TESTED`/`NOT VERIFIED`/`DEMO` (vocabulaire imposé prompt §46) — mapping strict vers les tokens sémantiques §3.1, jamais de libellé de statut sans pill correspondante codée.

### 4.4 Formulaires & actions
- **Input/Select/Textarea/DatePicker** : label toujours visible (jamais placeholder-only), état erreur inline + focus automatique sur premier champ en erreur après soumission multi-erreurs (résumé d'erreurs lié, cf. §9).
- **Button** (primary/secondary/ghost/destructive) : `--ax-radius-field`, `cursor:pointer`, état disabled visuellement distinct et non cliquable, jamais un bouton visuellement actif qui ne fait rien (anti-pattern prompt §34).
- **ApprovalAction** : pattern dédié pour le Workflow Engine (M22) — bouton d'action + confirmation + motif obligatoire pour rejet, tracé côté serveur.
- **Toast/Banner** : notification non bloquante (toast, 4–6s, pause au survol) vs. blocage (banner persistant pour erreur de chargement de page).

### 4.5 États partagés (repris du pattern `ax-state-*` d'ERP3602, retokenisés marque)
`EmptyState`, `LoadingState`, `ErrorState`, `PermissionDeniedState`, `PrerequisiteState`, `ContextRequiredState` — six états obligatoires, chacun avec titre + message actionnable + action quand pertinente. Aucun écran vide sans explication (prompt §34).

---

## 5. Architecture de navigation — 26 modules

### 5.1 Principe d'organisation

La navigation reprend le pattern éprouvé d'ERP3602 (groupes de menu au survol/clic dans la topbar + sidebar rétractable pour la navigation intra-domaine) mais réorganisée autour des **26 modules du mandat AXORA-ERP24** (`product-backlog.md` §3, IDs M01–M26), en 8 domaines de premier niveau au lieu des 7 groupes ERP3602 — la Gestion de parc (M18) et les Sous-traitants (M19) n'ont pas d'équivalent dédié côté ERP3602 et reçoivent leur propre emplacement plutôt que d'être noyés.

| Domaine (niveau 1, sidebar) | Modules (niveau 2) | Codes courts |
|---|---|---|
| **Command Center** (racine, pas un domaine replié) | Tableau de bord personnalisable | `HOME` |
| **Commercial** | M02 CRM & Commercial · M04 DQE/BOQ/BPU · Devis & Contrats (issu de M02) | `CRM` `DQE` `OFF` |
| **Projets & Construction** | M03 Projets/WBS/Budget · M05 Achats · M06 Stock & Logistique · M09 Field/Chantier | `PRJ` `ACH` `STK` `FLD` |
| **Ingénierie** | M13 MEP · M14 BIM/IFC/Revit · M10 GED (documents techniques) | `MEP` `BIM` `GED` |
| **Qualité & Actifs** | M11 QHSE · M12 Commissioning · M15 Assets/GMAO | `HSE` `CX` `AST` |
| **Smart & Énergie** | M16 Smart Building/GTB · M17 Énergie · M18 Gestion de parc | `BMS` `ENR` `FLT` |
| **Finance & RH** | M07 Finance · M08 RH · M19 Sous-traitants | `FIN` `RH` `SUB` |
| **Data & Automatisation** | M22 Workflow Engine · M23 Automatisation · M24 AI/Copilot · M25 Analytics/BI · M26 API & Intégrations | `FLOW` `AUTO` `AI` `BI` `API` |
| **Administration** | M01 Core (orgs/rôles/RBAC/audit) · M20 Portail Client · M21 Portail Fournisseur | `ADM` `EXT-C` `EXT-F` |

Note : M01 (Core) et le Design System/Command Center (X-UX) ne sont pas un « module au même titre que les autres » — M01 alimente transversalement le RBAC de tous les autres (menus filtrés par permission dès le rendu), et le Command Center est la racine `/`.

### 5.2 Sidebar rétractable — spécification

- **États** : `étendue` (240px, libellé + icône + badge de compteur) et `rétractée` (64px, icône seule + tooltip au survol/focus, libellé accessible conservé en `aria-label`). Bascule mémorisée en préférence utilisateur (persistée serveur, pas seulement `localStorage`, pour cohérence multi-appareil).
- **Structure** : logo/marque en tête → item Command Center → 8 groupes de domaine, chacun expansible (chevron) révélant les modules de niveau 2 → pied de sidebar avec bascule clair/sombre + lien Paramètres.
- **Item actif** : bordure gauche 3px `--ax-blue-500` + fond `--ax-blue-50` (clair) / `rgba(37,99,235,.14)` (sombre), jamais la couleur seule comme indicateur (icône + libellé restent visibles).
- **Filtrage par permission** : un domaine sans aucun module accessible à l'utilisateur courant est **retiré**, jamais grisé (éviter la frustration d'un item visible mais interdit) — sauf cas explicite « accès sur demande » du Portail (§5.5).
- **Clavier** : `Tab`/`Shift+Tab` parcourt les items dans l'ordre visuel, `Enter`/`Space` active, flèche haut/bas navigue au sein d'un groupe déplié (pattern menu ARIA), `Esc` referme un groupe déplié et rend le focus au déclencheur.
- **Raccourci global** : `Ctrl/Cmd + B` bascule étendue/rétractée (n'entre jamais en conflit avec les raccourcis navigateur — à valider par test manuel avant activation).

### 5.3 Topbar

De gauche à droite : bouton toggle sidebar (mobile/tablette) → breadcrumb du module courant → **recherche globale** (champ persistant desktop ≥1280px, icône+overlay en dessous) → **Command Palette** (bouton avec raccourci affiché `Ctrl K`) → sélecteur de contexte organisation/société/projet → notifications (badge compteur) → favoris/historique → bascule clair/sombre → menu utilisateur.

Sur les largeurs < 1280px, la recherche globale se réduit à une icône ouvrant un overlay plein-largeur (pas de champ tronqué illisible).

### 5.4 Command Palette (`Ctrl/Cmd+K`)

Recherche unifiée, résultats groupés dans cet ordre de priorité (pertinence décroissante pour un usage enterprise dense) :
1. **Actions rapides** (« Créer un devis », « Nouvelle demande d'achat » — filtrées par permission d'écriture) ;
2. **Navigation** (modules/pages, ex. « Stock », « QHSE ») ;
3. **Entités métier** (résultats réels, filtrés par permission de lecture — cf. §6.4) ;
4. **Aide/documentation** (si un référentiel d'aide est branché).

Chaque groupe limité à 5 résultats visibles + lien « voir tout » si dépassement. Navigation 100% clavier (`↑`/`↓`/`Enter`/`Esc`), focus restitué à la fermeture, `aria-live` annonce le nombre de résultats après frappe (débattue ~180ms).

### 5.5 Portails externes (M20/M21)

Rendus dans un **shell distinct**, sans sidebar des 26 modules internes (cohérent avec le pattern ERP3602 `excludedRoute` sur `/portal*`) : topbar minimale (logotype + nom de l'organisation cliente/fournisseur + déconnexion), navigation propre au portail (Projets/Documents/Factures pour client ; Consultations/Commandes/Factures pour fournisseur). Jamais de fuite de la structure interne des 26 modules vers un compte externe.

### 5.6 Impression / signature (`SIG`)

Les vues d'impression (`/outputs/*/print`) restent **hors charte applicative** : fond blanc, texte `#111` forcé, aucune ombre/anneau de focus, aucun spinner (motif déjà correct dans `brand-charter.css` §7 `@media print` — à reprendre à l'identique pour AXORA-ERP24).

---

## 6. Command Center (page d'accueil)

### 6.1 Principe

Reprend le pattern fonctionnel de `command-center.tsx` (chargement réel de session, contextes, santé API — jamais de placeholder statique) mais avec la nouvelle charte et une grille de widgets personnalisable (prompt §35 « tableau de bord personnalisable »).

### 6.2 Grille de widgets

- Grille responsive `auto-fill, minmax(260px, 1fr)` en desktop dense, colonnes réduites progressivement (§7.1).
- Chaque widget = une **KPI Card** (valeur + delta + sparkline optionnelle) ou un **module tuile** (accès rapide + 1 métrique clé), jamais un widget vide sans donnée réelle connectée (prompt §35 : « chaque indicateur doit être connecté à une donnée réelle »).
- Widgets visibles filtrés strictement par permission (un widget Finance n'apparaît pas pour un rôle sans `finance.read`).
- Mode édition : glisser-déposer + masquer/afficher par widget, disposition persistée par utilisateur.

### 6.3 Contenu par défaut (selon permissions, prompt §35)

CA, opportunités, projets actifs, budget, trésorerie, dépenses, commandes, stock, effectifs, présence, tâches, incidents, NCR, maintenance, consommation énergétique, alertes, validations en attente — chaque bloc route vers le module source au clic (jamais un widget « cul-de-sac »).

### 6.4 Entités indexées par la recherche globale / Command Palette

Client, fournisseur, contact, projet, devis, facture, commande, employé, document, équipement, actif, intervention, RFI, NCR (liste imposée prompt §36) — chaque type de résultat porte une icône et un badge de type dans la palette pour scan visuel rapide en contexte dense.

---

## 7. Responsive & mobile

### 7.1 Points de rupture

| Breakpoint | Cible | Comportement shell |
|---|---|---|
| ≥1440px | Grand écran / poste métier | Sidebar étendue par défaut, grille KPI 4+ colonnes, recherche topbar en champ complet |
| 1024–1439px | Laptop | Sidebar étendue ou rétractée selon préférence, grille KPI 3 colonnes |
| 768–1023px | Tablette | Sidebar rétractée par défaut (icône-seule) ou masquée en drawer, grille KPI 2 colonnes, gouttières horizontales augmentées |
| 480–767px | Grand smartphone / tablette portrait | Sidebar en drawer plein-hauteur (overlay), topbar compactée (recherche → icône), grille KPI 1 colonne |
| <480px | Smartphone | Idem + tables → cartes (§7.2), actions groupées dans un menu contextuel bas de carte |

### 7.2 Tables denses → cartes mobiles

Sous 640px, toute `DataTable` bascule en **liste de cartes** : chaque ligne devient une carte avec libellé/valeur empilés, action principale visible, actions secondaires dans un menu `⋯`. Jamais de défilement horizontal forcé sur une table métier critique (anti-pattern explicite prompt §34 « tableaux inutilisables sur mobile ») — le défilement horizontal reste acceptable uniquement pour des tableaux de comparaison volontairement larges (ex. comparatif fournisseurs) avec colonne de libellé fixée (`position: sticky`).

### 7.3 Terrain / Field (M09)

Le module Field (chantier) est mobile-first par nature (prompt §16) : formulaires courts en une colonne, boutons pleine largeur ≥44px de hauteur, capture photo native, indicateur explicite de mode hors-ligne (bandeau persistant, jamais une icône discrète) avec file d'attente de synchronisation visible et contrôlable par l'utilisateur.

---

## 8. Accessibilité (prompt §55)

- **Clavier** : 100% des actions opérables sans souris ; ordre de tabulation = ordre visuel ; aucun piège de focus (menus, modales, command palette) ; focus restitué à la fermeture de tout overlay.
- **Contraste** : texte normal ≥4.5:1, texte large/UI non-textuelle ≥3:1 — vérifié indépendamment en clair **et** en sombre (jamais une valeur supposée valable dans les deux à partir d'un seul test), y compris pour les tokens sémantiques §3.1.
- **Structure sémantique** : hiérarchie de titres séquentielle (`h1`→`h2`→`h3`, jamais de saut), landmarks (`nav`, `main`, `aside`), skip-link vers `#main-content` (motif déjà présent `ax-skip-link`, à reprendre).
- **Formulaires** : label visible systématique, message d'erreur inline lié (`aria-describedby`) + focus + résumé d'erreurs lié après échec de soumission multi-champs.
- **Icônes** : décoratives → `aria-hidden="true"` ; significatives seules → texte alternatif ; interactives → nom accessible + état (`aria-pressed`/`aria-expanded`/`aria-selected`) annoncé.
- **Mouvement** : `prefers-reduced-motion: reduce` supprime tout déplacement/rotation, y compris les spinners d'état de chargement.
- **Zones tactiles** : ≥44×44px sur tout contrôle interactif, y compris en densité dashboard (le padding cliquable peut dépasser la taille visuelle de l'icône).
- **Authentification** : formulaires de connexion compatibles gestionnaires de mots de passe et collage, alternative non cognitive au MFA (cf. `security.md` §3) documentée avant activation obligatoire du MFA.

---

## 9. Thèmes clair / sombre — mapping de tokens

| Rôle sémantique | Clair | Sombre |
|---|---|---|
| Fond d'application | `--ax-ink-50` `#F7F8FA` | `--ax-ink-950` `#0B0F17` |
| Fond de carte/panneau | `--ax-ink-0` `#FFFFFF` | `--ax-ink-900` `#111827` (surface), `--ax-ink-800` pour éléments élevés |
| Fond de sidebar/topbar | `--ax-blue-700` `#1E3A8A` (marque, sur texte blanc) | `--ax-ink-950` avec liseré `--ax-blue-800` |
| Texte principal | `--ax-ink-900` `#111827` | `--ax-ink-0` `#FFFFFF` |
| Texte secondaire | `--ax-ink-500` `#6B7280` | `--ax-ink-300` `#BFC3C9` |
| Bordure standard | `--ax-ink-200` `#DEE1E6` | `rgba(191,195,201,.16)` |
| Action primaire | `--ax-blue-500` `#2563EB` | `--ax-blue-400` `#5C86EC` (contraste renforcé sur fond sombre) |
| Focus ring | `--ax-ring` (identique) | `--ax-ring` (identique — prévisibilité) |

Bascule utilisateur (topbar) avec 3 états : `Clair` / `Sombre` / `Système` (suit `prefers-color-scheme`), persistée côté serveur (préférence utilisateur), appliquée sans flash (classe de thème posée avant hydratation).

---

## 10. Vues spécialisées (prompt §34)

| Vue | Modules principaux | Règle de conception |
|---|---|---|
| **Tableau** | Tous (défaut universel) | Densité §3.3, fallback carte mobile §7.2 |
| **Kanban** | M02 Pipeline commercial, M03 Tâches projet, M05 Demandes d'achat, M11 NCR | Colonnes = statuts métier réels (pas de statut décoratif), compteur par colonne, glisser-déposer avec alternative clavier |
| **Calendrier** | M03 Jalons, M08 Présence/congés, M12 Essais planifiés | Vue mois/semaine/jour, code couleur = statut sémantique §3.1 |
| **Gantt** | M03 Planning/WBS, M13/M14 Coordination MEP/BIM | Dépendances visibles, chemin critique visuellement distinct, zoom clavier |
| **Graphique** | M25 Analytics/BI, KPI Command Center | Cf. §4.3 — bibliothèque unique, alternative tabulaire toujours disponible (A11y fallback) |
| **Carte** | M09 Field (chantiers géolocalisés), M18 Flotte, M16 Smart Building (sites) | Uniquement quand une donnée de géolocalisation réelle existe — jamais une carte décorative sans donnée |

---

## 11. Anti-patterns interdits (prompt §34, §46 + ui-ux-pro-max)

- Écrans vides sans explication ni action → toujours `EmptyState` (§4.5).
- Faux boutons / boutons non fonctionnels → tout contrôle rendu doit être câblé ou explicitement `disabled` avec raison visible.
- Données fictives présentées comme réelles → badge `DEMO` neutre obligatoire (§3.1), jamais mélangées aux données de production dans le même tableau sans marquage ligne par ligne.
- Composants dupliqués par module → un seul design system source, revue obligatoire avant tout nouveau composant « local ».
- Couleurs incohérentes → usage exclusif des tokens §3 ; aucune couleur hexadécimale codée en dur dans les composants.
- Tableaux inutilisables sur mobile → fallback carte obligatoire (§7.2).
- Couleur seule comme porteur d'information (statuts, graphiques multi-séries, cartes thermiques) → toujours doublée d'un libellé, motif ou icône.
- Placeholder-only comme label de champ → label toujours visible.
- Animation qui ignore `prefers-reduced-motion` → interdit sans exception, y compris spinners et carrousels.
- Mélange filled/outline d'icônes au même niveau hiérarchique, tailles d'icônes arbitraires → un seul style par niveau, tailles tokenisées (`--ax-icon-sm/md/lg`).
- Zone tactile <44px → interdit même en densité dashboard.
- Confiance au contexte client (`companyId`/`projectId` transmis par le front) pour filtrer l'affichage sans revérification serveur → jamais (cf. `security.md`).
- Déclarer un composant/écran « terminé » sans les six états partagés (§4.5) implémentés quand applicables.

---

## 12. Suites recommandées (hors périmètre de ce document)

1. Traduire ce document en fichier de tokens exécutable (`design-tokens.json` ou variables CSS `:root`/`[data-theme="dark"]`) par l'agent AXORA-ERP24-CORE avant tout composant UI.
2. Construire l'AppShell (sidebar, topbar, command palette) comme premier livrable transversal — il conditionne l'intégration des 26 modules.
3. Valider chaque composant du §4 contre la checklist de pré-livraison de la skill `ui-ux-pro-max` (contraste, focus, `prefers-reduced-motion`, responsive 375/768/1024/1440) avant de le déclarer `IMPLEMENTED_NOT_VERIFIED`.
4. Aucune affirmation `PASS`/`VERIFIED` sur ce design system tant qu'un audit automatisé (axe-core ou équivalent) et une revue manuelle clavier n'ont pas été exécutés sur l'implémentation réelle.

---

**Statut de ce document : `SPEC` — conception uniquement, aucune implémentation livrée, aucun fichier source modifié.**
