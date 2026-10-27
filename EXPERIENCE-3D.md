# Brawl Academy 3D — essai Android

Cette branche `experiment/3d-third-person` contient un prototype 3D séparé. Le dépôt principal 2D, son serveur et sa publication Android ne sont pas remplacés.

## Installation

Installer `Brawl-Academy-3D.apk` depuis le dossier du même nom sur le Bureau. Android 8 minimum, WebGL requis. Le serveur habituel `Brawl-Serveur` doit fonctionner : les comptes, achats et parties utilisent toujours le serveur local du PC. Aucun retour à Supabase.

Identifiant Android : `com.brawlacademy.preview`. Les mises à jour 2D automatiques sont désactivées pour cette application expérimentale. Le script `PRODUIRE-NOUVELLE-VERSION.cmd` reconstruit et signe la prochaine version 3D ; il ne publie rien sur le serveur de production.

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

`npm run test:3d` exécute les trois suites 3D. `python scripts/build-android.py --bump` produit l'APK d'essai. Le générateur `scripts/build-original-character.py` utilise numpy et scikit-image pour régénérer `assets3d/brawl-character.js`, déjà livré dans les sources.

Bibliothèques : Three.js r160 (MIT), Cannon-es 0.20.0 (MIT). Licences dans `vendor/`. Les modèles téléchargés pendant la recherche ne sont pas utilisés, ni inclus dans l'APK ou dans Git.

## Retour à la 2D

Pour rejouer en 2D : ouvrir Brawl Ville avec son icône originale. Le code 2D reste dans le dépôt `HubParents`, au commit de départ `b0b4c4403b300314e44731b4a21fae37f2da39ff`.

Sauvegarde complète avant l'expérience : `C:/Users/recto/Desktop/Brawl-Backup-2D-2026-10-27` (source Git, serveur, bases SQLite vérifiées et APK). La demande « revenir à la 2D » désigne ce point, distinct de l'ancienne sauvegarde de la plateforme éducative.
