# Riff / Tommy - modele image anime

Modele original du deuxieme personnage du concept, integre au skin Riff dans le prototype 3D. La version 2D et les 31 autres skins gardent leur dessin actuel.

La direction visuelle a ete acceptee par l'utilisateur : voir user-acceptance.json. Cette acceptation ne transforme pas l'ancien diagnostic de silhouette (IoU 0,6024) en controle reussi. Les captures statiques et diagnostics historiques sont conserves tels quels.

L'apercu animated.html utilise le veritable moteur de personnage du jeu, le meme modele et le meme ragdoll Cannon que l'APK. Le modele contient 44 360 sommets / 79 812 triangles, regroupes en 13 lots partageant un squelette. Le test city-three-riff-image-tests.cjs mesure les poids, la liaison au repos, la geometrie preservee et les deplacements reels sur 285 poses. Les mains sont connectees aux avant-bras; les doigts ont une morphologie de prise. Le crane et les cheveux arriere sont fermes et les jambes utilisent des contours lisses. Le skate garde une posture de cote et le fusil une prise a deux mains.

Les genoux physiques sont des charnieres limitees a 0-2,6 radians, avec correction apres chaque pas de simulation. city-three-physics-tests.mjs mesure les angles pendant 5 760 images sur 24 chutes. Aucun test sur telephone Android physique n'a ete effectue; les performances mobiles doivent encore etre observees en jeu.

## Ouvrir le test local

Depuis la racine de BrawlAcademy3D :

    node experiments/img2threejs-riff/serve.mjs

Puis ouvrir http://127.0.0.1:4185 . La dépendance de développement Three.js 0.160.0 doit exister dans `.private/img2-preview/package` (tarball officiel npm, aucun compte ni clé). Le serveur écoute uniquement sur la boucle locale; aucune donnée de compte ou de serveur de jeu n'est utilisée.

## Sources et reprise

- `sculpt-spec.json` : description actuelle et paramètres des contours, détails et modules. Source d'autorité du modèle.
- `createRiffModel.ts` / `.js` : véritable factory Three.js procédurale; pas une image sur une carte plane.
- `refine-emitter.cjs` : adaptations explicites du générateur (courbes d'accessoires, sections anatomiques horizontales, surface du visage, proportions, tatouage conforme). À exécuter depuis la racine du projet, après génération, une seule fois par génération.
- `state.json` : progression locale des étapes img2threejs; historique automatique distinct de user-acceptance.json. Reprendre avec `forge/next.py --state ...` depuis le checkout img2threejs.
- `reference-isolated.png` : crop analytique de l'image de concept déjà retenue, fond isolé par masque déterministe; `segmentation.json` décrit ce traitement. Le concept original et le crop non isolé sont conservés. Aucun pixel du concept n'est projeté sur le modèle.
- `geometry-check.mjs` : exécute la factory réelle dans Three.js, vérifie les indices et nombres finis ainsi que la présence des pièces. Ne prouve ni ressemblance, ni bonne animation.
- `front.png`, `right.png`, `rear.png`, `left.png` : captures réelles du navigateur; `diagnostic-*.json` / `turntable.json` : résultats non modifiés des contrôles.
- `author-spec.py`, `author-v2.py`, `spec-first-rejected.json`, `blockout-01.png` : historique du premier essai rejeté, **ne pas réexécuter pour reconstruire l'état courant**.

Module futur : corps, tête, cheveux, casquette, chandail/manches, pantalon, chaussures, lunettes et accessoires identifiés séparément. Aucun menu de personnalisation ajouté au jeu.

## Outil et licences

img2threejs 2.0.0, source https://github.com/img2threejs/img2threejs , commit `3e7099e1b7fe93e187e06db4bdbe1e1906c21a28`, Apache-2.0 (copie de licence jointe). Son module character 0.2.0 guide la liaison et la mesure des animations; aucun controle non mesure n'est declare reussi. Three.js r160 : MIT. Le personnage de référence est le concept Brawl généré dans cette conversation, et non un asset de jeu tiers.

Les fichiers `experiments/` sont exclus des prochaines APK. Aucun changement au backend ni à la base de données.

## Correction 3D-0.9

La validation 0.8 limitait l'angle physique mais ne mesurait pas la direction de flexion du maillage affiche. Les contraintes coniques utilisent maintenant une reference de torsion commune au repos, les genoux conservent leur plan de charniere, et le rendu conserve les quaternions complets des membres. Le test ajoute 12 flexions sous quatre orientations et 960 images physiques jusqu'aux os du rendu, en comparant le tibia au dos de sa propre cuisse. Les anciens tests physiques seuls ne sont pas une preuve de cette correction visuelle.

Le jogging est melange progressivement avec la marche a partir de la vitesse reelle (55-105 unites/s). Le stick faible garde la marche; le stick pousse donne une foulee plus ample, des bras plies et une phase aerienne. La vitesse de deplacement et le protocole reseau restent inchanges.

Le volume arriere de la casquette et la coque de cheveux couvrent le crane arrondi; aucun ordre de dessin artificiel ne masque le defaut.

Les pieds disposent de deux os independants du mollet pour garder les semelles paralleles au deck. Les appuis du skate restent sous le bassin. Les prises de guidon utilisent les dimensions reelles des poignees du vehicule et une fermeture des doigts en arc, avec opposition du pouce. Les pouces sont remodelees dans la surface continue de chaque main. L'apercu affiche les vrais vehicules et propose une vue large et une pause pour inspection.

Reference de jogging observee : https://www.youtube.com/watch?v=pBReToVqB7M (SIPRC, University of Calgary), et points techniques https://www.ucalgary.ca/shred-injuries/all-sports/football/figure-8-jogging . Le coude garde environ 90 degres; le mouvement vient des epaules, amplitude reduite a 17 degres. Les mains se ferment doucement pendant le jogging et se relachent pendant la marche.

Les nouveaux decks de skate ont une forme arrondie, nose/tail releves, un bord bois, un dessous colore distinct du grip et de petits trucks/roues. La trottinette a un deck etroit et un guidon ajuste a la taille du personnage. Les prises et appuis du pilote suivent ces dimensions.

## 3D-0.10 - locomotion a phases de contact

L'ancien pendule de jambes et les avant-bras presque paralleles ont ete remplaces par un cycle original dans city-three-locomotion.js. References visuelles consultees : GTA IV / The Lost and Damned et GTA V, sections vers 1:46 et 2:06 de https://www.youtube.com/watch?v=Jv0tLVbGXP4 . Ces images de gameplay servent de reference de posture et de rythme; les poses et la geometrie restent originales.

Le cycle comporte contact, charge, poussee, retour du talon derriere le bassin puis preparation du prochain appui. Les genoux ne montent plus haut que 33,57 unites de rig au test, contre 30,38 au repos. Un pied est en appui pendant 84 % du cycle. Les semelles reelles sont mesurees apres deformation : leur point bas reste entre 0,386 et 0,400 unite pendant l'appui. Le moteur utilise l'enveloppe convexe des semelles deja gelees pour ajuster cheville et inclinaison, sans changer les buffers de geometrie.

Bassin et epaules ont une petite contre-rotation; les coudes ne sont plus verrouilles a 90 degres (la note 0.9 est historique). La flexion est mesuree sur le cycle, les mains restent legerement fermees et les poignets restent de leur cote. Le melange marche/jog depend de la vitesse existante, sans modification de deplacement ni du protocole multijoueur.

L'apercu dispose d'un sol, d'un ralenti, d'un curseur de cycle et d'un enregistrement canvas WebM de trois secondes. Le sol de diagnostic et ces controles sont exclus de l'APK. La video sur le Bureau est une capture du moteur, pas une generation d'images.

Le cycle de jambes est aussi utilise lors des deplacements avec une arme ordinaire, tout en conservant la visee et les mains de cette arme. Les poses speciales (masse, lancer prepare, ragdoll et conduite) gardent leur routage.

Correction supplementaire avant publication 0.10 : le col des bottes et les lacets hauts sont attaches au mollet, avec transition ponderee vers le pied sur la cheville. La semelle garde son os independant. 408 poses supplementaires couvrent 17 armes et mesurent le maintien des prises a deux mains ainsi que le balancement du bras libre avec pistolet/objets a lancer. La deviation du col de botte par rapport au mollet est mesuree sur les sommets affiches; les semelles plantees restent sur le plan 0,400 unite.

Dans l'apercu, Course armee et le selecteur permettent de verifier chaque arme. Les attaques preparees et les outils de travail gardent leurs poses speciales.
