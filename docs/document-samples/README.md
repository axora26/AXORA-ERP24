# Exemples de documents AXORA ERP24

> **DÉMONSTRATION — données fictives.** Ces fichiers illustrent les modèles générés par AXORA ERP24. Ils ne constituent ni des pièces comptables ni des justificatifs légaux. Les identifiants légaux absents restent indiqués `[à renseigner]`.

Générés par `node scripts/generate-document-samples.mjs`.

| Fichier | Usage | Pages | Taille |
|---|---|---:|---:|
| [01-devis.pdf](./01-devis.pdf) | Proposition commerciale chiffrée pour un chantier. | 1 | 180027 octets |
| [02-facture-client.pdf](./02-facture-client.pdf) | Facturation d'une prestation achevée. | 1 | 179848 octets |
| [03-situation-travaux.pdf](./03-situation-travaux.pdf) | Facturation d'avancement avec retenue et récupération d'avance. | 1 | 180204 octets |
| [04-avoir-client.pdf](./04-avoir-client.pdf) | Correction partielle d'une facture client. | 1 | 179796 octets |
| [05-bon-commande-fournisseur.pdf](./05-bon-commande-fournisseur.pdf) | Commande de matériaux auprès d'un fournisseur. | 1 | 179726 octets |
| [06-bon-reception.pdf](./06-bon-reception.pdf) | Constat de réception physique d'une commande fournisseur. | 1 | 179470 octets |
| [07-bon-retour-fournisseur.pdf](./07-bon-retour-fournisseur.pdf) | Retour physique de matériaux non conformes. | 1 | 179337 octets |
| [08-avoir-fournisseur.pdf](./08-avoir-fournisseur.pdf) | Valorisation financière d'un retour fournisseur. | 1 | 179714 octets |
| [09-bon-sortie-stock.pdf](./09-bon-sortie-stock.pdf) | Transfert de matériaux du dépôt vers un chantier. | 1 | 179814 octets |
| [10-fiche-presence-mensuelle.pdf](./10-fiche-presence-mensuelle.pdf) | Synthèse journalière de présence d'un ouvrier sur chantier. | 1 | 180354 octets |
| [11-feuille-temps-hebdomadaire.pdf](./11-feuille-temps-hebdomadaire.pdf) | Imputation hebdomadaire des heures par chantier et activité. | 1 | 179973 octets |
| [12-bulletin-paie.pdf](./12-bulletin-paie.pdf) | Bulletin illustratif avec rubriques administrées et cumuls. | 2 | 181808 octets |
| [13-rapport-journalier-chantier.pdf](./13-rapport-journalier-chantier.pdf) | Compte rendu quotidien des travaux, effectifs et incidents. | 1 | 180457 octets |
| [14-pv-reception-travaux.pdf](./14-pv-reception-travaux.pdf) | Réception contradictoire des travaux et suivi des réserves. | 1 | 180093 octets |

## Contrôles

Chaque PDF doit être contrôlé avec le script AXORA `verify_pdf.py` avant livraison. Les aperçus rasterisés se trouvent dans `previews/` lorsqu'ils ont été générés.
