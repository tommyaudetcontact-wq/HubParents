# Correctifs mobile, zoom et motifs — site avec API 15

## Appartement et construction

La caméra autorise désormais une plage de zoom de **0,15× à 12×**, au lieu de 0,55× à 3×. Le pincement à **deux doigts** fonctionne dans l’appartement et en construction, autour du point situé entre les doigts. Les déplacements de caméra restent possibles en gros plan. Les boutons de zoom de construction utilisent la même caméra que le pincement.

Les motifs de murs et de sols se choisissent directement dans une **grille de vignettes**. Chaque motif est dessiné avec les couleurs de base et secondaire choisies ; les vignettes se mettent à jour quand ces couleurs changent. Le motif sélectionné est encadré et l’option **Aucun motif** possède aussi sa vignette. La liste de mots est remplacée par cette grille. Choisir un motif ne sauvegarde pas de peinture : la sélection de surface et la confirmation restent distinctes.

## Arène sur mobile

Chaque profil est placé à gauche de son équipe, à côté de la carte active. Les deux réserves sont de petites vignettes à droite. Le cadre conserve les proportions de l’image et s’ajuste à la place disponible.

La grille principale impose des colonnes pouvant rétrécir et une largeur minimale nulle à ses enfants, notamment au journal : une longue ligne de résultat ne peut plus élargir les colonnes. Les annonces, projectiles et particules d’attaque sont isolés dans une couche absolue, limitée à l’écran et extérieure à la grille. Le jeu conserve ainsi ses dimensions pendant l’attaque.

## Installation

Les archives actuelles incluent tous les changements précédents. Ces correctifs concernent le site ; le serveur reste en **API 15**. Si cette API n’a pas encore été installée, remplacer aussi `Code-complet.gs` et publier une nouvelle version du déploiement Apps Script existant. Ne pas réinitialiser les données.

## Validation

40 suites, 378 groupes de tests : zoom éloigné et rapproché, coordonnées tactiles, pincement à deux doigts en construction sans action involontaire, 48 aperçus de motifs sur Canvas natif, sélection sans sauvegarde, profils à gauche des équipes et isolation des effets d’attaque. Les autres tests de comptes, duels, progression et appartement restent inclus.

Validation avec DOM et services simulés et rendu Canvas natif. Le rendu et la fluidité sur un téléphone réel restent à vérifier.
