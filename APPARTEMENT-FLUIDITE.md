# Appartement : fluidité, clics et rotations — API 16

Cette archive est cumulative. Installer le site et le serveur API 16 ensemble : la vitesse des trajets automatiques a changé dans la simulation partagée.

## Rendu

Le canvas utilise une résolution physique adaptée à la densité de l’écran, tout en gardant un monde logique stable de 1 000 unités. Le zoom, les clics, le placement et les poignées utilisent ces coordonnées logiques. Les textures prennent aussi en compte la densité ; les trop grandes surfaces passent au dessin vectoriel.

Les portions fixes de la scène sont mémorisées entre les acteurs et les portes qui s’ouvrent. Leurs positions dans l’ordre de profondeur sont conservées. Les changements de caméra, de meuble, de lumière, de décoration et de transparence des murs invalident les couches concernées. Le budget des couches est borné à 6 millions de pixels ; au-delà, le rendu direct reste utilisé. Pendant cette capture, les caches de chaque meuble et de chaque dalle sont évités pour ne pas doubler inutilement la mémoire. Les gestes de caméra regroupent leurs dessins sur les images d’animation.

## Interaction

La sélection des meubles teste leurs faces projetées, et non toute une boîte rectangulaire vide. Un meuble touché a priorité sur la sélection d’un personnage. Les points sont convertis selon la même caméra que le dessin, y compris sur écran haute densité. La zone de sélection des personnages est resserrée.

Les rotations se font par 90°. Le rendu utilise une vue de projection isolée, sans modifier la projection de la maison. Les caches géométriques distinguent aussi leur base de projection. La rotation conserve la position de placement et le quadrillage ; une rotation devenue invalide reste en aperçu rouge jusqu’à correction. Les anciennes orientations intermédiaires sont arrondies lorsque le meuble est sélectionné pour modification.

La marche contrôlée passe de 2,7 à 3,8 cases par seconde ; les trajets automatiques passent de une à deux cases par seconde, avec interpolation cohérente.

Un indicateur apparaît pour les requêtes qui durent plus de 180 ms et disparaît à la fin, même sur erreur. Dans la maison, il utilise la zone de sauvegarde du HUD ; ailleurs, un indicateur global. Les sondages de présence ne le déclenchent pas.

Boutique est directement dans la barre du bas, avec Vie, Maison, Personnage et Plus. Les nombreux divans existants sont accessibles sous la catégorie Divans / canapés ; aucun doublon ajouté.

## Validation

44 suites, 405 groupes réussis. Onze nouveaux groupes vérifient les rotations et la géométrie réellement dessinée, le déplacement d’un lit avec cache chaud, les faces cliquables, la priorité meuble/personnage, la conversion de caméra haute densité, la résolution physique du canvas, l’absence de nouveaux dessins de meubles pendant la marche, la comparaison du décor mémorisé avec le rendu direct, la vitesse partagée, les attentes concurrentes et la boutique. Tests Canvas natif, DOM, Google et WebRTC simulés. Aucune mesure sur un téléphone réel.

## Installation

Remplacer le site par les fichiers de Brawl-Academie-GitHub-Pages.zip. Remplacer le serveur Apps Script par Code-complet.gs de Installation-Apps-Script.zip et publier une nouvelle version du déploiement existant. Conserver le même déploiement et sa même URL. Cette version demande API 16 pour garder la simulation du navigateur et celle du serveur identiques.
