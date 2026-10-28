# Brawl Academy 3D — essai Android

Cette branche `experiment/3d-third-person` contient un prototype 3D séparé. Le dépôt principal 2D, son serveur et sa publication Android ne sont pas remplacés.

## Installation

Installer `Brawl-Academy-3D.apk` depuis le dossier du même nom sur le Bureau. Android 8 minimum, WebGL requis. Le serveur habituel `Brawl-Serveur` doit fonctionner : les comptes, achats et parties utilisent toujours le serveur local du PC. Aucun retour à Supabase.

Identifiant Android : `com.brawlacademy.preview`. À partir de 3D-0.4, les nouvelles versions 3D sont vérifiées au démarrage, au retour dans l’application et toutes les deux minutes. Le manifeste et l’APK sont publiés sur GitHub Pages, même quand le serveur du PC est éteint. Le téléchargement est contrôlé par taille, SHA-256, identifiant et signature Android. Android demande confirmation avant l’installation. Une installation manuelle de 3D-0.4 est nécessaire pour les anciens essais, qui ne contenaient pas encore ce mécanisme. Le canal 2D reste séparé. Le script `PRODUIRE-NOUVELLE-VERSION.cmd` reconstruit et signe la prochaine version 3D ; il ne publie rien sur le serveur de production.

## Réalisation

- Rendu Three.js avec caméra à la troisième personne, profondeur réelle, ombres, matériaux, enseignes et sols texturés.
- Personnage original : surface continue, squelette articulé et peau déformable. Modèle généré par notre script, sans modèle tiers téléchargé. Cheveux, couleurs de vêtements, yeux, uniformes, casques et outils adaptés au rendu 3D.
- Véhicules originaux : carrosseries continues, vitres, roues animées, modèles de voitures, motos, planches, trottinettes, monster trucks, autobus et tanks. Les règles et étapes de dégâts restent celles du jeu.
- Maison et mobilier en volumes 3D. La caméra de construction conserve les coordonnées de l'éditeur, son cercle de manipulation et le tracé de pièces/murs.
- Adaptateurs pour les onze mini-jeux rendus sur canvas ; bracelets et menus conservent leur interface interactive.
- Membres du ragdoll avec corps rigides Cannon et contraintes. Décors mobiles avec volumes, gravité, collisions et rotation sur trois axes. L'hôte conserve l'autorité et transmet les orientations des décors.
- Aspiration courbée en profondeur, objets aspirés qui rétrécissent, soldats 3D et débris physiques.

## Validation et limites

Les tests `test:3d` vérifient la continuité du personnage, les transformations de véhicules, onze scènes de mini-jeux, la construction, l'aspiration, les ragdolls contraints et les échanges de positions/orientations des décors. Les régressions ciblées couvrent aussi la construction, les meubles, les transitions skate, les armes et les parties simulées sur six clients avec délai réseau.

Vérifications réelles dans le navigateur : déplacement et caméra, conduite, hockey, trampoline, sélection/déplacement/validation d'un meuble et création d'une pièce en 3D. Aucune erreur console observée pendant ces parcours. Une scène de rue en portrait sur ce PC affichait environ 59 images/s, 219 appels de rendu et 141 472 triangles ; ce n'est pas une mesure Android.

Ce prototype n'a pas été validé sur deux téléphones physiques. Les poses des membres du ragdoll sont calculées localement autour du déplacement autoritaire partagé, plutôt que de transmettre chaque os. Les contacts de véhicules gardent la simulation du jeu existant ; ce n'est pas un nouveau simulateur automobile complet. Plusieurs particules, indicateurs et effets spéciaux restent dessinés dans le HUD projeté. Les costumes, visages, animations et familles de véhicules demandent encore une passe artistique avant un produit fini. L'inspiration GTA concerne les proportions et les silhouettes ; aucune qualité graphique équivalente n'est annoncée.

## Développement

`npm run test:3d` exécute les quatre suites 3D. `python scripts/build-android.py --bump` produit l'APK d'essai. Le générateur `scripts/build-original-character.py` utilise numpy et scikit-image pour régénérer `assets3d/brawl-character.js`, déjà livré dans les sources.

Bibliothèques : Three.js r160 (MIT), Cannon-es 0.20.0 (MIT). Licences dans `vendor/`. Les modèles téléchargés pendant la recherche ne sont pas utilisés, ni inclus dans l'APK ou dans Git.

## Retour à la 2D

Pour rejouer en 2D : ouvrir Brawl Ville avec son icône originale. Le code 2D reste dans le dépôt `HubParents`, au commit de départ `b0b4c4403b300314e44731b4a21fae37f2da39ff`.

Sauvegarde complète avant l'expérience : `C:/Users/recto/Desktop/Brawl-Backup-2D-2026-10-27` (source Git, serveur, bases SQLite vérifiées et APK). La demande « revenir à la 2D » désigne ce point, distinct de l'ancienne sauvegarde de la plateforme éducative.

## Corrections 3D-0.4

Proportions du personnage revues avec retargeting conservant les mains et pieds, carrosseries et roues retravaillées, vrais pilotes éjectés rendus dans les parcours et en ville, outils distincts, départ des tirs aligné sur les armes sans changer la simulation. Terrains mis en cache, scènes de tennis/hockey/Tailblazer et autres activités mieux différenciées. Vérifications réelles dans le navigateur : pilote moto éjecté et ragdoll sur le terrain, chute PNJ séparée de sa moto, hockey, tennis et Tailblazer. La validation sur appareils Android physiques reste à faire.

## Identité des personnages — 3D-0.5

Les visages et les motifs des vêtements proviennent désormais des dessins 2D originaux de chaque skin. Les 31 costumes de collection ont leurs définitions propres : capuches, casquettes, chapeaux, couronnes, lunettes, armures, capes, robes et jupes. Les coupes de cheveux possèdent des volumes distincts. Les accessoires sont rattachés au squelette et regroupés par matériau pour limiter les appels de rendu. La simulation et les possessions des joueurs restent inchangées.

`city-three-identity-tests.cjs` vérifie les 32 skins, les visages distincts, les pièces caractéristiques des costumes, les poses animées, les coiffures, l’occlusion arrière du masque et la conservation exacte des dessins 2D. La comparaison visuelle dans le navigateur affiche le dessin original à côté du modèle 3D. Cette passe restaure les traits distinctifs; elle ne constitue pas une validation artistique par le joueur ni un test Android physique.

## Direction héroïque stylisée — 3D-0.6

Nouvelle direction inspirée des proportions et des matériaux stylisés de Fortnite : silhouette athlétique, visage sculpté avec de vrais yeux, iris, paupières, sourcils et lèvres, coiffures en mèches volumétriques, traits féminins affinés, armures à plaques biseautées et visières opaques. Les illustrations 2D ne sont plus projetées sur le corps ou le visage. Les motifs de costume sont des pièces et des surfaces courbes en 3D, aux couleurs de chaque identité Brawl. Les choix de visage modifient la géométrie et les traits, pas une image collée.

Les détails opaques d’une tête ou d’un costume sont fusionnés avec couleurs par sommet. Les tests des 32 skins imposent moins de 18 objets dessinés par personnage et vérifient l’absence de texture de personnage projetée, les poses, les accessoires et l’occlusion arrière du masque. Le volume physique et la simulation de déplacement restent partagés avec les modes existants. Une pose de repos asymétrique est réservée au rendu 3D.

Référence visuelle consultée : https://www.fortnite.com/news/outfit-art-update (Epic Games). Modèles et code créés pour Brawl; aucune ressource Fortnite intégrée. Les vérifications sur PC ne remplacent pas l’essai sur Android ni la validation artistique du joueur.
