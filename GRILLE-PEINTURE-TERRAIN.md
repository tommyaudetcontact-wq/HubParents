# Grille, peinture et terrain — API 14

## Gestes et performances

Un doigt déplace la caméra ; deux doigts conservent le pincement pour zoomer et dézoomer. Le pincement à trois doigts fonctionne également. Pendant une sélection de peinture, un doigt sélectionne les dalles ; deux doigts permettent encore de déplacer et zoomer la vue sans peindre accidentellement.

La lumière ambiante passe de 0,09 à 0,28. Les assombrissements du sol sont moins opaques et utilisent quatre échantillons par dalle au lieu de seize. Le fond du terrain est mémorisé dans une seule image, les motifs de murs sont aussi mémorisés, et les aperçus de couleurs ne sont redessinés que lorsque leur matériau change. Lampes et fenêtres continuent d’éclairer les pièces ; les murs bloquent la lumière.

## Une case = une dalle

La grille de placement et celle de construction utilisent la même unité que les dalles. La subdivision en demi-cases est retirée. Le lit double occupe 2 × 2 dalles et l’aquarium rectangulaire 2 × 1. Les empreintes tournées restent alignées sur la grille. Le placement s’aimante aux dalles par défaut. Pendant un glissement avec la poignée à quatre flèches, l’icône reste exactement sous le doigt et le meuble garde un dégagement de 96 pixels au-dessus de son centre pour rester visible. Relâcher la poignée conserve l’aperçu ; le crochet confirme sa position. L’option de placement précis reste disponible.

Les hauteurs des murs, portes, meubles et habitants suivent la taille projetée des dalles. Le personnage reste légèrement réduit. Agrandir le terrain ne crée donc plus de personnage géant par rapport au mobilier. La commande de recentrage cadre la maison ; le dézoom permet d’explorer le terrain.

## Peinture

Les éditeurs Murs et Sol réunissent le motif, la couleur de base, la couleur secondaire et leur aperçu. Ils proposent 32 harmonies et l’option **Aucun motif**. Les motifs muraux sont projetés dans le plan du mur : leurs lignes suivent son inclinaison à l’écran.

Après **Peindre le sol**, le menu se masque. Toucher une dalle l’ajoute ou la retire de la sélection. Maintenir puis glisser trace un rectangle, limité aux sols construits. Les contours jaunes indiquent la sélection et les nouvelles couleurs restent visibles en aperçu. **Modifier** permet de remplacer la sélection par un nouveau rectangle. Le **✓ vert** confirme une seule modification ; le **✕ rouge** restaure intégralement le sol précédent. Le menu revient après confirmation ou annulation. Les murs utilisent la même confirmation, segment par segment. L’application à toute la maison passe aussi par un aperçu à confirmer.

## Terrain et déplacement de maison

À la première entrée après cette mise à jour, le côté du terrain est doublé : 7 × 7 devient **14 × 14**, soit quatre fois la surface. La maison garde ses dimensions, ses pièces, ses achats et ses finitions. La migration est rejouable sans doubler à nouveau le terrain. La limite d’agrandissement est maintenant de 40 × 40.

Dans **Maison → Construction → Terrain → Déplacer toute la maison**, glisser déplace ensemble les pièces, meubles, murs ajoutés ou retirés, portes, fenêtres, finitions et peintures. Les positions des habitants suivent le déplacement ; leurs trajets et actions en cours sont interrompus pour éviter de viser les anciens emplacements. Les déplacements hors du terrain sont refusés. Les personnages qui étaient dehors et dépasseraient les limites restent sur le terrain.

## Arène : informations et barres de cartes

Le bouton **ⓘ Infos** ouvre les règles détaillées, avec une fiche par action : coût, dégâts de base, bouclier, recharge, remplacement, statistiques, éléments, usure et XP. Cette consultation ne dépense pas de tour.

Les six cartes du combat montrent une barre de vie verte et une barre d’XP violette avec leurs valeurs et leur niveau. Les barres suivent les PV réellement restants et l’XP enregistrée. Au niveau 30, la barre d’XP est pleine et indique MAX. Dans la collection, la vie est explicitement celle du début du duel (60 PV) ; l’état à réparer reste distinct. L’XP est attribuée après le duel terminé.

## Installation et vérification

Remplacer le site **et** `Code-complet.gs`, puis publier une nouvelle version du déploiement Apps Script existant. Le statut `/exec` doit annoncer **version 14**. Ne pas réinitialiser la feuille ni recréer les comptes. Ces fichiers sont préparés localement ; ils ne sont pas déployés automatiquement.

38 suites, 362 groupes de tests : règles partagées, migrations, déplacements du foyer, sélection rectangulaire, annulation, confirmation unique, gestes concurrents, projection des motifs et réutilisation des images. Les tests utilisent un DOM simulé, un Canvas natif et des services Google simulés. Ils ne constituent pas une validation de fluidité sur un téléphone réel.
