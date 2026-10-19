# Appartement : rendu et placement — 19 octobre 2026

Correctif du site, compatible avec le serveur API 15. Archives cumulatives.

- Le fond visible du gros plan est mémorisé pendant les déplacements et actions. Il est recalculé lorsque la caméra, le sol ou les sources de lumière changent. Les caches des meubles retirent les anciennes entrées sans tout vider.
- Le diamant est plus petit, placé juste au-dessus de la tête et mis à l’échelle avec le personnage. Les poignées des portes sont retirées ; leur ouverture automatique est conservée.
- Les motifs des murs utilisent une hauteur verticale et une largeur en unités du mur. Les rectangles restent debout, les lignes suivent la projection du mur et le motif garde sa phase aux fenêtres. Les bandes d’ombre artificielles aux raccords ont été supprimées.
- Les joints artificiels du sol sont atténués, le quadrillage d’aide reste discret pendant le placement. L’éclairage du sol utilise une couche continue par dalle.
- Les éditeurs Murs et Sol regroupent aperçu, commande Peindre, galerie de motifs et harmonies. Les couleurs personnalisées restent accessibles. Une seule zone de défilement ; pas de grandes palettes répétées pour chaque champ.
- Les commandes de placement entourent l’encombrement projeté du meuble avec un cercle. Elles restent hors du meuble et évitent de se recouvrir. Si un gros plan couvre toute la place disponible, les commandes impossibles à placer sont retirées et les commandes de la barre restent disponibles ; dézoomer redonne de la place au cercle.
- Les cases occupées par la future position sont légèrement vertes ou rouges dans les deux vues. Les dimensions et rotations sont prises en compte. La teinte du meuble conserve davantage ses couleurs originales. La poignée de déplacement suit toujours le doigt.

Validation : 42 suites, 391 groupes ; Canvas natif, DOM, Google et WebRTC simulés. Pas de test sur téléphone réel. La suite apartment-finish-tests.cjs couvre la séparation des commandes sur plusieurs largeurs mobiles, le cas sans place disponible, le diamant, les raccords de motifs, les joints du sol, les menus et la réutilisation du fond au zoom. Les tests précédents restent inclus.

Installation : remplacer les fichiers du site avec Brawl-Academie-GitHub-Pages.zip. Le serveur n’a pas changé si l’API 15 est déjà installée ; pour une installation plus ancienne, utiliser aussi le Code-complet.gs fourni et republier le déploiement existant.
