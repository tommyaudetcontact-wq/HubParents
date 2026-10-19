# Déplacements, actions et navigation

Les déplacements autonomes utilisent une file de points de passage interpolée image par image. Chaque segment occupe l’intervalle de simulation d’une seconde, au lieu d’être parcouru rapidement puis suivi d’une pause. Les nouvelles destinations sont ajoutées à la file ; le temps restant d’une image sert au segment suivant. Les points de passage conservent le trajet libre autour des obstacles. Le joueur, son partenaire et le chien ont chacun leur position affichée. Les commandes manuelles et la synchronisation des visites restent en place.

Une petite barre verte apparaît au-dessus de la tête pendant l’exécution d’une action. Elle représente toutes les étapes de l’action (par exemple ingrédients, cuisine et repas), avance visuellement entre les mises à jour et suit la position affichée. Elle se cache pendant les trajets, à la fin, après annulation et au décès. Son animation ne donne aucune récompense et ne déclenche aucun appel serveur supplémentaire.

La navigation Vie / Maison / Personnage / Plus est fixée au bas du viewport, avec une marge pour la zone de sécurité du téléphone, dans la vue intégrée comme en plein écran. L’ancien menu supérieur reste caché même en plein écran.

Validation : 34 suites, 316 groupes automatisés, DOM et services Google simulés, Canvas natif. Tests des segments successifs, virages sans arrêt, files indépendantes, progression et annulation des actions. Pas de validation dans un navigateur réel ou sur téléphone.

Installation : remplacer le site GitHub Pages par le contenu de Brawl-Academie-GitHub-Pages.zip. Ces corrections visuelles ne modifient pas Apps Script ; conserver la version 11 installée pour la progression des cartes. Si la version 11 n’a pas encore été installée, suivre PROGRESSION-CARTES.md pour mettre à jour le site et Apps Script ensemble.
