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

`npm run test:3d` exécute les cinq suites 3D. `python scripts/build-android.py --bump` produit l'APK d'essai. Le générateur `scripts/build-original-character.py` utilise numpy et scikit-image pour régénérer `assets3d/brawl-character.js`, déjà livré dans les sources.

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

## Pilote de validation — Riff de Tommy

Le test suivant est limité au skin `skin-riff-nocturne`, équipé par Tommy au début du travail. Aucun identifiant de compte n’est nécessaire dans le client. Les autres modèles restent sur la version 3D-0.6 jusqu’à validation du joueur.

Contrainte de conception : conserver un squelette commun et des éléments séparés (corps, chandail, pantalon, chaussures, cheveux, couvre-chef, lunettes, accessoires) pour permettre des skins et vêtements futurs. Ne pas ajouter de menu, de boutique ou de persistance de personnalisation dans ce test. Les animations, points de prise des armes et positions physiques restent partagés avec les modes existants. Le crâne du pilote est attaché rigidement à l’os de tête pour rester aligné avec les lunettes et la casquette en ragdoll.


Livraison du pilote : **3D-0.7**, limité à Riff Nocturne. Validation : tests 3D généraux, identité des skins, régions modulaires et animations de Riff, physique des ragdolls et rig partagé. Les 31 géométries hors pilote ont été comparées à 3D-0.6 et sont identiques. Les mains sont séparées des cuisses dans la topologie et leurs poids ne dépendent plus des os des jambes. La longueur visuelle du cou est limitée dans les poses de conduite du pilote. Les vérifications WebGL comprennent repos, marche, conduite et chute; aucun appareil Android physique n’est connecté à cette machine pour la validation finale.

En attente de l’avis du joueur sur l’APK avant d’étendre ce travail aux autres skins. Les menus et fonctionnalités de personnalisation futurs ne sont pas ajoutés.

## Véhicules — 3D-0.11

Carrosseries routières originales par famille : capot long des classiques, pavillon bas des sportives, cabine des utilitaires, benne ouverte des pickups et châssis surélevé des monster trucks. Les passages de roues sont ouverts, les panneaux séparés et l’habitacle reste visible après arrachement. Les vitres se fissurent puis disparaissent ; les six zones de dégâts existantes pilotent des déformations réversibles, sans changer les sauvegardes ni le protocole. Les débris de carrosserie ont une épaisseur et conservent leurs rotations physiques. Les motos, skates et trottinettes conservent leurs modèles et ancrages de pilote.

Conduite routière : direction moins sensible à haute vitesse, glissement latéral distinct du frein à main, freinage avant marche arrière, accélération progressive, effet modéré des dégâts avant sur le moteur et des flancs sur l’adhérence. Petits transferts de poids visuels ; impacts moins enclins à catapulter la voiture ; propulsion maintenue sur les roues encore en contact. Le tank perd moins d’élan sur les zombies en fonction de sa masse. Les vitesses des activités, améliorations, rampes, dégâts persistants, retour des épaves et autorité hôte sont conservés.

Atelier local : `http://127.0.0.1:4185/vehicles.html`, sélecteur de véhicules, chocs et réparation, conduite WASD/flèches, espace pour le frein à main. Les modèles sont ceux du jeu. Cet atelier reste exclu de l’APK.

Validation : 106 suites existantes et nouvelles, avec reprise des régressions corrigées ; tests de freinage, dérive, marche arrière, usure, rejeu hôte/invité exact et 30/120 Hz. Les corps rigides conservent la simulation arcade du jeu : il ne s’agit pas d’un simulateur de pneus/suspensions complet. Essai sur téléphone et ressenti à la manette à valider par le joueur.

## Proportions et habitacle — 3D-0.12

Les voitures routières et les monster trucks passent à une échelle de 1,4 ; empreinte de collision, centre de rotation et panneaux détachés suivent la taille du modèle. Capots galbés avec sommets partagés, flancs bombés, pavillons arrondis et passages de roues intégrés remplacent les surfaces trop plates et les baguettes détachées. Les capots et portes pivotent maintenant sur leurs charnières.

Vitres bleu clair transparentes : sièges, tableau de bord, colonne de direction et volant sont visibles. Les joueurs conservent leur personnage et leurs vêtements dans une pose assise ; le pilote se transforme avec la carrosserie pendant les rotations. Les voitures stationnées restent vides. La pose utilise les squelettes existants, sans modification des sommets ni des poids du personnage. 840 configurations mesurées : longueurs de membres conservées, genoux vers l’avant, mains sur le volant et dégagement de la tête.

À la sortie des rampes, le mouvement angulaire est conservé. Un départ proche du bord donne du roulis vers le côté qui perd son support ; les sauts centrés gardent une impulsion de tangage modérée. Les rampes de ville, de test et de course utilisent la même règle déterministe.

Les régressions couvrent véhicules, dégâts, gravité, rampes, poses, prédiction, activités et police ; simulations complètes à six clients et migration d’hôte. Une immunité indue du conducteur à pied, héritée du délai de réapparition de son épave, a également été corrigée. Essais dans le navigateur ; aucune validation sur téléphone physique annoncée.

Dernière finition 3D-0.13 : les optiques et leurs encadrements restent dans les ailes ; calandre resserrée sur la face avant pour supprimer les petits débordements aux coins.
