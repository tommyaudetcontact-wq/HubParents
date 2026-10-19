# Menus portrait et collection Signature

## Maison : la scène reste accessible

L’interface reprend la hiérarchie des références fournies, dans les couleurs et dessins existants : ressources compactes en haut, habitants à gauche, quatre raccourcis en bas (Vie, Maison, Personnage, Plus). Un seul panneau de navigation ou d’outils est ouvert à la fois. La barre d’état des habitants reste visible et peut déplier toutes les jauges.

Maison regroupe inventaire, pièces/terrain, déplacement, décoration et mobilier. Personnage donne accès à l’apparence, la garde-robe, les skins et la boutique de style. Plus rassemble foyer, amis/visites, bibliothèque, cartes, études et réglages. Les invitations et mini-jeux restent accessibles dans Amis et visites. Les réglages conservent tous les modes de murs, le plein écran, l’enregistrement, les brouillons et la sortie.

L’inventaire possède dix catégories visuelles. Choisir un meuble replie le catalogue et prépare son placement. Les actions d’un objet s’ouvrent dans un panneau non modal inférieur : la maison peut encore être déplacée/zoomée. Les commandes de cuisine, soins, lumière, bibliothèque et rangement conservent leurs règles actuelles. Construction garde ses outils de terrain, pièces, murs, portes/fenêtres et historique. Aucun nouveau mode de caméra ou changement d’orientation forcé n’est ajouté ; le portrait reste le format principal.

Dans l’éditeur, les visages, traits et vêtements se choisissent visuellement avec un aperçu, des catégories et des pages de douze choix. Les coupes et habits proposés sont ceux possédés ; les traits restent gratuits. Les couleurs et la présentation restent réglables. Changer d’onglet conserve les réglages en cours.

## Collection Signature : 50 $ virtuels chacun

| Référence initiale | Nom dans le jeu |
|---|---|
| M. Shadows | Riff Nocturne |
| Sabrina Carpenter | Éclat de Scène |
| Michael Jackson | Danseur Écarlate |
| John Wick | Minuit Élégant |
| Master Chief | Sentinelle Olive |
| Anna | Aurore des Vallées |
| Elsa | Gardienne du Givre |

Les illustrations sont dessinées dans le moteur Canvas existant, sans reprendre les photos. Les modèles ont des détails propres, sans logos, numéros d’uniforme ni armes. Riff garde une casquette retournée et des lunettes ; Sentinelle est sans arme.

Les anciens skins sont retirés du catalogue et de l’inventaire utilisable. Un ancien skin équipé revient à Mon personnage ; les vêtements, coiffures et couleurs personnalisés restent conservés. Mon personnage est le choix gratuit pour retrouver son look habituel. Les nouveaux skins sont des tenues complètes : personnaliser son apparence ou sa garde-robe revient au personnage habituel. Aucun remboursement des anciens skins n’est appliqué.

Ces noms sont des propositions créatives, pas une recherche d’antériorité ni une garantie « copyright proof ». Le nom seul ne neutralise pas les droits sur un personnage reconnaissable : voir [OMPI — Character Merchandising](https://www.wipo.int/documents/d/copyright/docs-en-wo_inf_108.pdf).

## Mise à jour

Installer le nouveau site **et** remplacer le code Apps Script par **Code-complet.gs**, puis publier une nouvelle version du déploiement existant. Le statut /exec doit indiquer **version: 10**. Ne pas réinitialiser la feuille ni recréer les comptes. Le catalogue côté serveur doit être mis à jour pour reconnaître les nouveaux achats à 50 $.

## Vérification

31 suites, 287 groupes automatisés. Les nouveaux tests couvrent les catégories et les fonctions conservées, l’exclusivité des panneaux, les actions non modales, la galerie des coupes possédées, les prix et l’idempotence des achats, la migration des anciens skins et les sept silhouettes différentes. Les rendus Canvas ont été inspectés. Les services Google et le DOM sont simulés ; aucun essai réel sur téléphone ni déploiement distant n’a été effectué.
