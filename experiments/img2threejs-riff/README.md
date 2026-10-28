# Essai visuel Riff / Tommy avec img2threejs

Prototype isolé, construit à partir du deuxième personnage de l'image de référence simplifiée. L'ancien modèle Brawl n'est pas utilisé dans ce modèle. Le modèle livré dans le jeu et l'APK 3D-0.7 ne sont pas remplacés.

État : **essai de sculpture, non accepté visuellement**. Le contrôle de la description passe; le contrôle de volume sur quatre angles passe. La comparaison de silhouette avec la référence échoue (IoU 0,6024 au cadrage testé). Il ne faut pas présenter ce nombre comme un score de ressemblance perceptuelle. Le cadrage et la pose diffèrent aussi. Visage, vêtements, chaussures et pose demandent encore du travail. Aucun rig n'est lié à ce prototype; pas de validation Android ou multijoueur. 68 216 triangles et 42 objets dessinés au test PC : budget mobile non atteint.

## Ouvrir le test local

Depuis la racine de BrawlAcademy3D :

    node experiments/img2threejs-riff/serve.mjs

Puis ouvrir http://127.0.0.1:4185 . La dépendance de développement Three.js 0.160.0 doit exister dans `.private/img2-preview/package` (tarball officiel npm, aucun compte ni clé). Le serveur écoute uniquement sur la boucle locale; aucune donnée de compte ou de serveur de jeu n'est utilisée.

## Sources et reprise

- `sculpt-spec.json` : description actuelle et paramètres des contours, détails et modules. Source d'autorité du modèle.
- `createRiffModel.ts` / `.js` : véritable factory Three.js procédurale; pas une image sur une carte plane.
- `refine-emitter.cjs` : adaptations explicites du générateur (courbes d'accessoires, sections anatomiques horizontales, surface du visage, proportions, tatouage conforme). À exécuter depuis la racine du projet, après génération, une seule fois par génération.
- `state.json` : progression locale des étapes img2threejs; aucun passage visuel déclaré accepté. Reprendre avec `forge/next.py --state ...` depuis le checkout img2threejs.
- `reference-isolated.png` : crop analytique de l'image de concept déjà retenue, fond isolé par masque déterministe; `segmentation.json` décrit ce traitement. Le concept original et le crop non isolé sont conservés. Aucun pixel du concept n'est projeté sur le modèle.
- `geometry-check.mjs` : exécute la factory réelle dans Three.js, vérifie les indices et nombres finis ainsi que la présence des pièces. Ne prouve ni ressemblance, ni bonne animation.
- `front.png`, `right.png`, `rear.png`, `left.png` : captures réelles du navigateur; `diagnostic-*.json` / `turntable.json` : résultats non modifiés des contrôles.
- `author-spec.py`, `author-v2.py`, `spec-first-rejected.json`, `blockout-01.png` : historique du premier essai rejeté, **ne pas réexécuter pour reconstruire l'état courant**.

Module futur : corps, tête, cheveux, casquette, chandail/manches, pantalon, chaussures, lunettes et accessoires identifiés séparément. Aucun menu de personnalisation ajouté au jeu.

## Outil et licences

img2threejs 2.0.0, source https://github.com/img2threejs/img2threejs , commit `3e7099e1b7fe93e187e06db4bdbe1e1906c21a28`, Apache-2.0 (copie de licence jointe). Son module character 0.2.0 est installé pour la future étape d'animation; les étapes d'animation restent en attente. Three.js r160 : MIT. Le personnage de référence est le concept Brawl généré dans cette conversation, et non un asset de jeu tiers.

Les fichiers `experiments/` sont exclus des prochaines APK. Aucun changement au backend ni à la base de données.
