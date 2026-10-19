# Mise à jour Mobilier, Prestige et Mobile

Le site reste statique, compatible avec GitHub Pages ; toutes les données partagées restent dans votre Google Sheets + Apps Script.

## Installer cette version

1. Remplacer les fichiers GitHub par le contenu décompressé de Brawl-Academie-GitHub-Pages.zip. Conserver index.html à la racine, ainsi que assets, vendor et .nojekyll.
2. Remplacer le contenu de Code.gs dans votre Apps Script par le nouveau Code-complet.gs, puis Déployer > Gérer les déploiements > crayon > Nouvelle version > Déployer. Mettre à jour le même déploiement conserve l’URL. Ne pas ajouter aussi les huit modules séparés.
3. Actualiser le site (Ctrl+F5). Aucun initializeBrawl à relancer sur la feuille déjà installée. Les comptes et données sont conservés. Le statut /exec de cette version affiche version: 4.

Les nouvelles règles doivent être installées sur le serveur aussi : changer seulement les fichiers GitHub conserverait les anciennes récompenses côté Google.

## Nouveautés

- 48 familles de mobilier, 12 palettes et 8 variantes de style, soit 4 608 références générées, en plus des objets de départ et accessoires pour chien. Les modèles ont été redessinés : lits avec matelas et oreillers, fauteuils, bibliothèques, aquariums, cuisines, salle de bain, berceaux, échecs, télescopes, instruments, flippers, etc. Les variantes partagent des modèles ; ce ne sont pas 4 608 objets sculptés individuellement. Les possessions et identifiants existants sont conservés.
- Formes et détails inspirés des catégories du wiki Sims 2 fourni ; modèles dessinés pour ce jeu, sans import des sprites Sims. Ce catalogue couvre 48 familles d’objets et ne prétend pas reproduire tous les objets et extensions des Sims 2. Source : https://sims.fandom.com/wiki/Category:Objects_in_The_Sims_2 . Certaines pages détaillées du wiki n’étaient pas accessibles pendant la recherche.
- Objets affichés en volume avec leurs composants triés en profondeur. Les rotations recalculent le rendu. Les aperçus se centrent et adaptent leur échelle pour garder l’objet entier visible. Des caches limités réduisent les calculs pendant le déplacement.
- Davantage de meubles utilisables pour les besoins : repas, repos, hygiène et plaisir. La maison conserve les habitants semi-autonomes, les commandes manuelles, les pièces/portes/fenêtres, le terrain, les textures et la décoration. Il s’agit d’une simulation familiale simplifiée, sans tous les métiers, relations, étages et systèmes des Sims 2.
- Objectif par défaut de 20 minutes actives et 80 XP par jour, cinq journées par semaine. L’ancien réglage standard de 25 minutes devient 20 ; un choix parent personnalisé différent est conservé. Les parents peuvent choisir une durée de 20 à 120 minutes.
- Chaque étape monétaire donne au moins 3 $. Les étapes exclusivement mobilier/carte restent sans argent. L’ultime quotidien donne 10 $ par défaut, une carte et un meuble choisi dans les meubles non possédés. Si l’inventaire est complet, le meuble est remplacé par 3 $. L’ultime hebdomadaire conserve trois cartes, 20 $ et l’activité parent.
- Niveaux de prestige dans chaque discipline, l’écriture, les tâches, les combats, la collection, la construction et les soins. Pas de bonus d’argent ou de puissance. Les anciennes réussites sont reprises pour les disciplines, l’écriture et les tâches ; les nouveaux compteurs de combat/construction/collection/soins commencent avec cette version. Les anciens détails non conservés ne peuvent pas être reconstitués exactement.
- Statistiques des autres enfants depuis Parcours. Les profils de la famille sont visibles ; les autres familles apparaissent uniquement lorsque leur parent coche le partage des niveaux/statistiques. Courriel, âge, notes, solde, maison, programme et dictées ne font pas partie du résumé partagé. Le partage ne donne jamais accès au profil complet.
- Cadeaux parent : catalogue entier avec recherche, catégories, aperçu des objets/cartes et pagination. Chaque meuble, BD, vêtement ou carte peut être offert gratuitement. Les conditions d’adoption et de placement restent nécessaires pour les animaux. Les cartes sont séparées de l’inventaire mobilier.
- Trois envies d’achats à choisir depuis la fenêtre d’un article en boutique, affichées à l’accueil pour visualiser le prochain objectif.
- Interface plus affirmée : encre/vert forêt, doré, boutons plus sobres et panneaux moins arrondis, en gardant la palette lumineuse et la lisibilité du style précédent.

## Téléphone et maison

Sur la scène, pincer avec deux doigts zoome et déplacer deux doigts déplace la caméra. Les deux doigts ne déclenchent ni marche ni placement d’objet. Un doigt reste disponible pour marcher, choisir un objet ou dessiner une pièce ; le joystick reste disponible.

La barre des besoins reste visible en compact. Le bouton Besoins ouvre le choix du personnage et les commandes ; +/− et le bouton cible règlent/recentrent la vue. La molette zoome aussi sur ordinateur. Le plein écran utilise la hauteur du téléphone et la scène adapte sa résolution.

## Vérification

176 groupes de tests automatisés réussis, dont 10 groupes pour les nouvelles règles, niveaux, géométrie, rotation, gestes à deux doigts, statistiques privées et cadeaux. Une planche PNG des 48 familles de meubles a été rendue avec Canvas natif et inspectée. L’assemblage des formulaires et les services Google sont simulés. Le comportement tactile, le rendu complet des écrans et la connexion Google réelle doivent encore être vérifiés sur votre téléphone/site ; aucune validation visuelle en navigateur n’est revendiquée.
