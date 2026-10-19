# Modèles de mobilier et nouveaux personnages — livraison du 17 octobre 2026

## Personnages

Silhouettes humaines plus élancées, têtes plus petites, visage avec nez, sourcils et mâchoire, vêtements ombrés et marche animée. Le rendu reste un dessin Canvas intégré à cet univers ; il ne s’agit pas du moteur 3D des Sims. Tous les personnages humains, les visiteurs, le partenaire et les aperçus boutique utilisent le nouveau dessin. Les têtes animales et robots restent compatibles avec leur rendu existant.

Dans **Boutiques > Style et personnalisation > Personnaliser mes couleurs et mon look**, choisir tête, cheveux, haut, bas et chaussures séparément. Les 20 coupes ont des dessins distincts ; 8 hauts, 6 bas, 6 chaussures et 6 visages humains sont combinables. Les éléments supplémentaires s’achètent dans leurs catégories. Les couleurs des cheveux, de peau, du haut, du bas et des chaussures sont libres, sans achat de couleur. Les vêtements déjà possédés et les looks sauvegardés restent valides. Le diamant sélectionné et la zone de sélection suivent la nouvelle hauteur du personnage.

## Mobilier : 25 modèles physiques par type

1 200 modèles dans 48 types de meubles. Les 25 aquariums sont des compositions différentes : colonne, angle, table basse, mur de bulles, pont, paludarium, îlot, etc. Les lits proposent simples, doubles, superposés, mezzanines et baldaquins. Les autres familles déclinent leurs formats et leurs constructions. Les anciens meubles possédés restent utilisables ; les anciennes variantes par couleur ne remplissent plus la boutique.

À l’achat, choisir les couleurs d’origine, une palette prédéfinie ou les cinq couleurs manuellement. Une palette coûte 1 $ une seule fois, puis s’applique librement à d’autres modèles. Les couleurs manuelles sont incluses. Le prix total est affiché avant confirmation et validé côté serveur. Dans **Décorer > Recolorer un meuble**, modifier les finitions d’un meuble possédé. Les couleurs sont enregistrées avec la maison et transmises à ses visiteurs.

## Appartement et achats

**Placer** enregistre l’emplacement prévisualisé puis désélectionne le meuble. Si la sauvegarde échoue, l’emplacement précédent est conservé et on peut réessayer.

**Besoins** ouvre et réduit les commandes ; **Vie** revient au déplacement et ouvre les besoins. Les confirmations restent dans la scène, visibles en plein écran. Le zoom à deux doigts et le déplacement de la vue restent disponibles.

Les achats affichent **Achat en cours…** immédiatement lors de la confirmation. Le bouton est bloqué pendant la sauvegarde. Une nouvelle tentative du même achat après une réponse réseau perdue réutilise son identifiant pour éviter un double débit. La boutique calcule sa liste une seule fois par rendu et utilise des index de possession pour les grandes collections. Le délai réseau réel dépend encore de Google Apps Script ; il n’a pas été mesuré ici.

## Installation

Remplacer les fichiers GitHub par le contenu de **Brawl-Academie-GitHub-Pages.zip**. Remplacer tout Code.gs par **Code-complet.gs**, enregistrer et publier une nouvelle version du déploiement existant. Les règles de palettes et les nouveaux articles doivent être identiques des deux côtés. Aucun nouvel initializeBrawl n’est nécessaire sur une feuille déjà initialisée. Les familles et possessions sont conservées.

## Vérification

20 suites, 195 groupes : moteurs partagés, achats atomiques, palettes réutilisables, sauvegarde des couleurs, placement, HUD, réseau lent et réponse perdue simulés, coupes et vêtements distincts, couleurs et looks sauvegardés. Les planches de personnages, de 25 lits et de 25 aquariums ont été rendues en Canvas natif et inspectées. Aucun essai physique sur téléphone, aucun test visuel dans un navigateur réel et aucune connexion au déploiement Google du parent ne sont revendiqués.
