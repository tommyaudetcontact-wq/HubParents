# Atelier du coupé jaune

Prototype local séparé du jeu et de l’APK. Ouvrir http://127.0.0.1:4186/.
Démarrage depuis la racine BrawlAcademy3D : `node experiments/img2threejs-coupe/serve.mjs`.
Le serveur utilise le runtime Three déjà installé dans `.private/img2-preview/package`.

## Essais disponibles

Roues articulées, braquage avant, impacts avant/côté, six vitres cassables, porte détachable, réparation. Les morceaux utilisent Cannon avec gravité et contact au sol. Il s’agit d’un banc mécanique, pas encore d’une conduite intégrée au jeu.

## Correction du 28 octobre

Profil avant sans bosse au-dessus de l’essieu ; bas de caisse conformant à la porte à la place du tube flottant. La surface du capot et les épaules des ailes restent séparées pour les dégâts, avec des bords raccordés.

Vérification : `node experiments/img2threejs-coupe/geometry-check.mjs`.
109 pièces, 48 768 triangles de géométrie, coordonnées finies. Dix-sept contrôles mécaniques réussis, dont chute des débris pendant 10 secondes et restauration exacte des sommets.

## État visuel

Le modèle reste expérimental. Le rapprochement à l’image n’est pas encore validé : toit, montants arrière, jantes et matières restent à améliorer. Le pipeline img2threejs demeure en blockout, sans passage déclaré terminé. Les diagnostics historiques sont conservés avec leurs échecs ; ils ne constituent pas une acceptation du modèle.

`author-spec.py` est le script initial. Les corrections ultérieures sont dans `sculpt-spec.json` et `surfaces.js` ; ne pas régénérer le spec avec le script initial.

Runtime physique : Cannon-es (MIT), copié du runtime existant du projet. Génération procédurale depuis les images, sans extraction automatique de maillage.

## Raccords et dégâts progressifs

Les montants sont des sections aplaties. Les jantes et moyeux restent dans l’épaisseur des flancs des pneus. Le cadre propre à la porte, sa vitre, sa garniture, son rétroviseur et sa poignée partent ensemble ; les montants structurels du pare-brise et du toit restent sur la caisse.

Les boutons d’impact touchent les ensembles avant/arrière. Le capot et la valise se plient, puis se détachent au quatrième impact dans leur zone. Les dégâts sont indépendants par zone. Les compartiments moteur et coffre ont un fond et des parois intérieures ; les sièges reposent sur des socles et les portes ont des garnitures raccordées à la tôle.

## Corrections vitrage et doublures

La vitre de custode rejoint désormais le même corps physique que la porte. Toutes les surfaces fixes non roulantes partagent les champs de déformation avant et arrière, calculés depuis les sommets d’origine. Le plancher suit le contour inférieur de la coque et les doublures restent en retrait du panneau extérieur. Les impacts dans une autre zone ne réinitialisent plus les dégâts précédents.

Régression vérifiée sur quatre intensités : plancher en retrait à l’avant et à l’arrière, doublure du coffre en retrait, conservation des dommages cumulés, présence réelle de la vitre de custode dans le groupe mobile de porte. Nouvelle vue « Capot vu de dessus » pour vérifier sa forme effilée et ses raccords.
