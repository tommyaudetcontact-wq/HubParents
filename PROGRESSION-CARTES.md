# Progression des cartes — API 11

Chaque carte achetée commence au niveau 1, avec 1 point disponible. Les anciennes cartes sans progression sont migrées au niveau 1. Les cartes déjà entraînées gardent leurs statistiques.

- Niveaux 1 à 10 : 1 point par niveau.
- Niveaux 11 à 20 : 2 points par niveau.
- Niveaux 21 à 30 : 3 points par niveau.
- Maximum : niveau 30, 60 points au total, y compris celui du niveau 1.

La collection affiche le niveau, l’XP et les statistiques. Choisir « Distribuer » puis confirmer affecte les points à l’attaque, la défense ou la résistance. Un point d’attaque ajoute 0,5 dégât, arrondi au plus proche ; un point de défense retranche 0,35 dégât, arrondi au supérieur. La résistance réduit l’usure de 8 à un minimum de 1 par combat. La réparation coûte toujours 1 $ et conserve la progression.

Un combat terminé rapporte 30 XP en victoire, 25 en égalité, 20 en défaite aux cartes qui ont participé. Le passage suivant demande 30 + 10 × (niveau − 1) XP. L’XP excédentaire est conservée jusqu’au niveau 30. Un abandon ne donne pas d’XP. Le serveur recalcule le bilan des coups avant d’appliquer XP et usure ; les doubles envois sont ignorés. Les duels entre joueurs n’utilisent pas un serveur de jeu autoritaire.

Les bots prennent le niveau et la répartition moyenne de ton trio, avec dégâts à 92 %, 100 % ou 108 %. Le mode automatique choisit entre ces trois variantes. Le niveau, l’XP, les points disponibles, les statistiques et l’état suivent chaque carte échangée dans les deux sens.

Remplacer le site et Code-complet.gs, puis publier une nouvelle version Apps Script (statut version 11). Ne pas réinitialiser la feuille. Les deux joueurs d’un duel doivent utiliser le site mis à jour (protocole 4).
