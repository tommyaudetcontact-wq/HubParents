# Arène tactique — API 15

Cette version inclut toutes les modifications de l’API 14, même si cette mise à jour n’a pas encore été installée.

## Présentation

Chaque équipe présente sa carte active en grand, avec ses deux réserves en petites vignettes à droite. Le cadre suit le rapport largeur/hauteur réel de l’image et la hauteur disponible, avec un faible padding, au lieu d’étirer les petites cartes dans de grands cadres vides. Les barres de vie et d’XP sont conservées ; les vignettes ont des jauges compactes. Le bouton Informations décrit toutes les règles actualisées.

Une carte mise K.O. cède automatiquement la grande place à une carte vivante, sans coût d’énergie ni tour supplémentaire. La carte éliminée reste dans les petites réserves, assombrie, désaturée et marquée K.O./HORS JEU. Quand toute l’équipe est K.O., le combat est terminé.

Les cartes ne sont plus des boutons de remplacement. **Changer de carte** ouvre un choix séparé ; ouvrir ou annuler ce choix ne dépense rien. Confirmer utilise le tour et retire **1 énergie à la carte entrante**, avec un minimum de 0. La carte sortante ne récupère plus d’énergie. Les PV et effets sont conservés.

## Actions et équilibre

| Action | Énergie | Effet |
|---|---:|---|
| Attaque | −1 | 16 dégâts de base |
| Pouvoir | −3 | 26 dégâts de base |
| Perce-bouclier | −2 | 14 dégâts de base ; 75 % de réussite contre un bouclier |
| Bouclier | +2, maximum 6 | 12 points de protection contre le prochain coup ; interdit deux fois de suite |
| Recharger | +3, maximum 6 | Prépare +6 dégâts sur le prochain coup, sans cumul |
| Changer de carte | −1 à la carte entrante | Utilise le tour ; aucun soin |

Les coûts et gains figurent dans de grands badges contrastés. Les 12 points de protection ont aussi une indication visible.

**Perce-bouclier** : face à un bouclier, la réussite ignore et retire le bouclier. En cas d’échec, le coup ne fait aucun dégât et le bouclier est conservé ; l’énergie et l’éventuelle préparation sont consommées. L’annonce de réussite ou d’échec apparaît dans le combat, la notification et le journal. Sans bouclier adverse, cette action touche normalement mais reste moins rentable que l’attaque simple. La défense adverse s’applique toujours.

Le tirage est partagé entre les deux joueurs et rejoué à l’identique par le serveur pour vérifier le bilan. Les anciens clients de duel sont refusés (protocole 5) pour éviter des règles différentes entre les deux côtés.

L’équilibre est contrôlé sur les coûts, les limites d’énergie, le malus de changement et les dégâts moyens : Perce-bouclier donne un avantage risqué contre un bouclier, tandis qu’Attaque reste plus rentable sans protection adverse. Un essai sur 10 000 graines donne 7 527 réussites, proche du taux annoncé de 75 %. Cela ne remplace pas des retours de parties réelles.

## Installation et validation

Mettre à jour le site **et** `Code-complet.gs` ensemble, puis publier une nouvelle version du déploiement Apps Script existant. `/exec` doit annoncer **version 15**. Ne pas réinitialiser la feuille ni les comptes. Les archives sont cumulatives ; aucune installation préalable de l’API 14 n’est nécessaire.

La suite dédiée couvre les deux résultats de Perce-bouclier, son taux, les malus et changements après K.O., le choix via bouton, le redimensionnement proportionnel, les barres, les coûts et le rejeu identique. Les tests utilisent DOM et pairs simulés, avec les autres suites de rendu Canvas natif. L’affichage et la fluidité restent à vérifier sur un véritable téléphone.
