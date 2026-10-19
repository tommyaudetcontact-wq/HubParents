# Appartement, arène et skins — API 13

## Appartement

- Le confort et le cadre de vie ne sont plus affichés parmi les besoins ni pris en compte dans leurs alertes. Les six besoins visibles sont énergie, faim, hygiène, plaisir, toilettes et social ; eau et santé restent disponibles selon le membre.
- L’appartement remplit le viewport du navigateur sans déclencher son API plein écran. Un doigt glissé déplace la caméra ; trois doigts permettent de zoomer/dézoomer. Deux doigts ne déclenchent aucun placement. Les gestes explicites des outils de pièce et des poignées restent disponibles ; « Déplacer une pièce » déplace sa structure, son mobilier et ses finitions.
- L’éclairage ambiant sans lampe ni fenêtre passe de 25 % à 9 %. Les matériaux et les personnages sont davantage assombris ; les lampes et les fenêtres éclairent toujours selon les murs. Des nuances d’orientation et des ombres sur les raccords distinguent les coins.
- La grille de placement utilise des petites cases de demi-unité. Un lit double occupe 4 × 4 cases, un lit simple 2 × 4, un aquarium rectangulaire 2 × 1. Canapés, baignoires, tables, chaises, armoires et autres meubles disposent d’empreintes adaptées. Les collisions, rotations, sélections et réductions de pièces suivent ces dimensions. Les personnages sont réduits de 10 % dans l’appartement.
- Au premier accès après mise à jour, les placements sont adaptés sans retirer les achats. Les meubles déplacés sont recherchés près de leur position précédente ; ceux qui ne tiennent plus restent dans l’inventaire. La maison initiale devient une pièce redimensionnable lorsqu’elle n’avait encore aucune pièce définie. La migration est sauvegardée et rejouable sans duplication.
- Un achat de mobilier ouvre directement son aperçu de placement. Après confirmation, retour à la boutique d’origine ; depuis l’inventaire, retour à la même catégorie. La position horizontale des catégories est conservée. Les modèles de portes achetés passent à leur outil de pose sur mur.
- L’aperçu valide/invalide mélange 30 % de vert ou de rouge aux couleurs d’origine au lieu de les remplacer. Les confirmations et erreurs apparaissent en haut, dans la zone réservée, plutôt qu’en bas des menus.
- La peinture remplit toute la pièce accessible depuis la case choisie, y compris une pièce définie par des cloisons. Les portes délimitent les pièces pour la peinture. Les aperçus montrent la texture, la couleur de base et la couleur secondaire. Huit palettes décoratives sont proposées ; les deux couleurs restent modifiables.
- Les sélecteurs de couleur proposent des nuanciers : 16 tons de peau naturels, 20 teintes de cheveux et 42 couleurs générales. Le choix manuel reste disponible.

## Collection Signature

Sept nouveaux modèles à 50 $ de monnaie du jeu chacun :

| Référence demandée | Nom dans le jeu |
| --- | --- |
| Shania Twain | Étoile du Rodéo |
| Avril Lavigne | Rebelle Améthyste |
| Crash Bandicoot | Mascotte Tropicale |
| Moana | Navigatrice des Îles |
| Buzz Lightyear | Patrouilleur Stellaire |
| Woody | Shérif des Prairies |
| Ryder | Capitaine Secours |

La Sentinelle Olive reçoit des épaulettes, genouillères, plaques et détails de casque supplémentaires. Les noms sont originaux ; aucune recherche de disponibilité de marque n’a été effectuée.

## Arène

Les deux portraits reprennent le skin ou l’apparence équipée au début du duel. Le nom, le skin et l’apparence publique sont échangés directement avec l’adversaire ; aucun solde ni donnée parentale n’est ajouté aux messages. Les anciens messages sans portrait restent acceptés avec un portrait neutre.

Le combat occupe le viewport mobile, avec dispositions portrait et paysage : cartes actives et réserves, nom des joueurs, tour, PV, énergie sur 6, nombre d’attaques simples possibles, bouclier et préparation. Les actions indiquent leurs dégâts et leur coût ; celles impossibles affichent le manque d’énergie. Les règles et derniers coups sont repliés dans un panneau accessible. Le protocole des coups et les règles de progression restent inchangés.

## Installation et validation

Remplacer le contenu du site par Brawl-Academie-GitHub-Pages.zip et le code Apps Script par Code-complet.gs. Publier une nouvelle version du déploiement existant : le statut /exec doit indiquer version 13. Ne pas réinitialiser la feuille et ne pas recréer les comptes.

36 suites / 345 groupes passent. Les nouveaux tests couvrent migration et empreintes, peinture par pièce, retour de menu et défilement, gestes, nouvelles silhouettes, portraits entre deux clients, règles d’arène et relecture serveur. Google, DOM et réseau sont simulés ; les images sont rendues sur Canvas natif et inspectées. Aucun navigateur réel ni téléphone n’a été utilisé pour valider la mise en page finale.
