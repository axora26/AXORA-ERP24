# AXORA ERP24 — Design system maître

## Direction visuelle

AXORA ERP24 est une plateforme de gestion d’entreprise et de chantier. L’interface doit inspirer la maîtrise opérationnelle : une base claire, des surfaces calmes, une hiérarchie lisible et des actions explicites. La marque utilise un bleu profond pour la navigation et un bleu vif pour les actions principales.

## Tokens de marque

| Usage | Token | Valeur |
| --- | --- | --- |
| Navigation et titres forts | `--ax-navy` | `#1E3A8A` |
| Action principale et liens | `--ax-blue` | `#2563EB` |
| Texte principal | `--ax-ink` | `#111827` |
| Bordures et séparateurs | `--ax-border` | `#BFC3C9` |
| Fond applicatif | `--ax-canvas` | `#F6F8FC` |
| Surface | `--ax-surface` | `#FFFFFF` |
| Succès | `--ax-success` | `#067647` |
| Avertissement | `--ax-warning` | `#B54708` |
| Erreur | `--ax-danger` | `#B42318` |

Les contrastes de texte et de contrôles doivent rester conformes WCAG 2.1 AA. Les couleurs métier sont réservées aux états, aux indicateurs et aux actions ; elles ne servent pas de décoration sans signification.

## Typographie

- **Montserrat** pour les titres de page, les chiffres de synthèse et les repères imprimés.
- **Inter** pour le corps, les tableaux, les formulaires et les messages d’état.
- Titres de page : 28–32 px, poids 700–800.
- Titres de panneau : 15–18 px, poids 700.
- Corps : 12–14 px, hauteur de ligne 1,45–1,6.
- Chiffres financiers : tabulaires, jamais tronqués ; les montants gardent leur devise.

## Composants et interaction

- `.btn-primary` est réservé à l’action principale d’une vue ; hauteur minimale 36 px, 44 px sur les parcours tactiles.
- `.btn-secondary` sert aux actions complémentaires et `.btn-ghost` aux actions de ligne réversibles.
- Les formulaires affichent un libellé permanent, un état de validation et une erreur proche du champ.
- Les modales piègent le focus, restaurent le focus sur le déclencheur et restent utilisables au clavier.
- Les tableaux sont enveloppés dans une zone `overflow-x: auto`, conservent une première colonne lisible et exposent l’état vide.
- Les onglets restent sur une seule ligne et défilent horizontalement sur petit écran.
- Toute action distante expose un état chargement, succès ou erreur ; aucune action destructive n’est silencieuse.

## Responsive

Les vues sont contrôlées aux largeurs 375, 390, 768, 1024 et 1440 px.

- À 375–390 px : navigation dans un tiroir, actions empilées, formulaires sur une colonne, cartes de métriques en une colonne.
- À 768 px : grilles en deux colonnes quand l’espace le permet ; les tableaux restent défilables sans déformer les montants.
- À 1024–1440 px : shell avec navigation persistante, grilles de synthèse équilibrées et densité confortable.
- Aucun composant ne doit provoquer de débordement horizontal global ; seuls les tableaux, graphiques et historiques peuvent défiler dans leur propre conteneur.
- Les zones tactiles font au moins 44 px et les états `:focus-visible` sont toujours visibles.

## Impression et documents

Les factures, avoirs, commandes, réceptions, feuilles de temps et rapports utilisent un gabarit A4 AXORA : logo, société émettrice, coordonnées, référence, date, tableau lisible, totaux et pied de page. Les actions d’écran sont masquées à l’impression. Les signatures internes affichent l’empreinte et le QR de vérification sans les présenter comme une signature qualifiée eIDAS.

## Accessibilité et mouvement

Les contrôles ont un nom accessible, les tableaux ont des en-têtes, les graphiques ont une alternative textuelle et les messages utilisent `role="status"` ou `role="alert"` selon leur urgence. Les animations respectent `prefers-reduced-motion: reduce` et ne doivent jamais être nécessaires pour comprendre une donnée.
