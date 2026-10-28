# Atelier du coupé jaune

Prototype local séparé du jeu et de l’APK. Ouvrir http://127.0.0.1:4186/.
Démarrage depuis la racine BrawlAcademy3D : `node experiments/img2threejs-coupe/serve.mjs`.
Le serveur utilise le runtime Three déjà installé dans `.private/img2-preview/package`.

## Essais disponibles

Roues articulées, braquage avant, impacts avant/côté, six vitres cassables, porte détachable, réparation. Les morceaux utilisent Cannon avec gravité et contact au sol. Il s’agit d’un banc mécanique, pas encore d’une conduite intégrée au jeu.

## Correction du 28 octobre

Profil avant sans bosse au-dessus de l’essieu ; bas de caisse conformant à la porte à la place du tube flottant. La surface du capot et les épaules des ailes restent séparées pour les dégâts, avec des bords raccordés.

Vérification : `node experiments/img2threejs-coupe/geometry-check.mjs`.
98 pièces, 45 290 triangles de géométrie, coordonnées finies. Huit contrôles mécaniques réussis, dont chute des débris pendant 10 secondes et restauration exacte des sommets.

## État visuel

Le modèle reste expérimental. Le rapprochement à l’image n’est pas encore validé : toit, montants arrière, jantes et matières restent à améliorer. Le pipeline img2threejs demeure en blockout, sans passage déclaré terminé. Les diagnostics historiques sont conservés avec leurs échecs ; ils ne constituent pas une acceptation du modèle.

`author-spec.py` est le script initial. Les corrections ultérieures sont dans `sculpt-spec.json` et `surfaces.js` ; ne pas régénérer le spec avec le script initial.

Runtime physique : Cannon-es (MIT), copié du runtime existant du projet. Génération procédurale depuis les images, sans extraction automatique de maillage.
