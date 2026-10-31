# Atelier des véhicules de la ville

Prévisualisation indépendante : **aucun véhicule du jeu, backend ou APK n'a été remplacé**.
Le joueur veut examiner les nouveaux modèles avant leur intégration.

Depuis la racine du projet :

```powershell
node experiments/fleet-lab/serve.mjs
```

Ouvrir http://127.0.0.1:4193/ ; les concepts sont dans `references.html`.

## État actuel

- Berline : premier prototype à examiner. Carrosserie continue, quatre portes, habitacle,
  roues indépendantes, dommages progressifs de l'avant/arrière/flancs, vitrages cassables,
  capot/valise/portes détachables avec Cannon et réparation.
- Compacte : deux portes, hayon vitré, phares ronds et jantes huit branches ; peinture en réglage.
- SUV : quatre portes, hayon vitré, rails de toit et protections en cours de forme.
- Pickup : quatre portes, vraie caisse ouverte, hayon, pneus à pavés et deux essieux en cours de forme.
- Fourgon : cabine vitrée, côtés de chargement pleins, deux portes arrière et roues acier en cours de forme.
- Autobus : cinq vitrages par côté, dix sièges, entrée vitrée et marches en cours de forme.
- Pour ces cinq nouveaux modèles, les dégâts et le rig de destruction ne sont **pas encore activés**.
  Leurs passages de finition, interaction et optimisation restent ouverts ; les captures sont des travaux en cours.
- `model-gallery.html` permet de comparer les captures réelles et d’ouvrir chaque prototype 3D.
- Le muscle car et le tank approuvés restent inchangés.

## Contrôles

Glisser dans la vue pour tourner ; molette pour zoomer. Les boutons proposent les faces,
la rotation automatique, le mouvement des roues et trois éclairages. Cliquer une pièce
pour la sélectionner. Les impacts progressent de 25 % ; les vitrages cassent à 85 % et les
grands panneaux se détachent à 100 %. « Stabiliser débris » avance quatre secondes de physique
pour examiner leur position finale ; la simulation normale reste animée. « Réparer » restaure
la géométrie d'origine et enlève les débris. « Éclaté » sépare les assemblages pour leur inspection.

## Validation et limites

```powershell
node experiments/fleet-lab/model-tests.cjs
node experiments/fleet-lab/physics-tests.mjs
node experiments/fleet-lab/compact-tests.cjs
node experiments/fleet-lab/family-structure-tests.cjs
```

Les tests vérifient les géométries finies, les définitions immuables, les quatre portes complètes,
les pivots de roues, l'encastrement des jantes, six grands panneaux détachables, les éclats,
la restauration exacte après réparation et la chute/contact au sol de 30 corps physiques.
La couverture des 54 composants spécifiés passe également.

La berline optimisée utilise 25 940 triangles et 82 appels de rendu (83 avec le sol de l'atelier),
contre 38 368 triangles et 209 appels avant regroupement. Les identités de pièces et les pivots
sont conservés. **L'objectif initial de 45 appels pour un véhicule de trafic n'est pas encore
atteint : un LOD distant et un profilage en ville/mobile restent nécessaires avant intégration.**

Le contrôle photométrique global de la skill signale encore les lampes arrière rouges depuis
la vue avant, ainsi que les minuscules clignotants : ce diagnostic compare des couleurs de
composants à la palette globale de toute l'image et ne constitue pas une mesure de visibilité
par composant. Le contrôle de trous sur la vue avant confond aussi certaines lentilles grises
avec le fond. Les rapports bruts sont conservés ; ces contrôles ne sont pas déclarés passés.
Les vues avant/arrière/profils et les essais physiques sont disponibles comme preuves séparées.

`sculpt-spec.json`, `state.json` et les sous-dossiers `families/` conservent les observations,
les contrats de qualité et la progression de reconstruction. Le passage d'optimisation de la
berline reste ouvert ; les autres familles ont leur propre état. `generated-model.js` est le
jalon du générateur ; le modèle utilisé par l'atelier est l'adaptateur de surfaces analytiques
`road-model.js`, dont les paramètres sont enregistrés dans le spec. Ne pas relancer
`author-spec.py --reset-authoring` sur un spec déjà revu sans intention de réinitialisation.

Les captures comparatives utilisent maintenant des PNG transparents réels, un cadrage à rapport identique et une seconde capture sans éclairage/cartes. `fit-silhouette.cjs` ajuste uniquement la caméra sur les vrais triangles, sans étirer une capture ni modifier le modèle. Les références isolées sont des dérivés générés des planches originales, qui restent l’autorité de design ; elles ne sont pas présentées comme les mêmes pixels. Le contrôle colorimétrique de la compacte reste ouvert (Delta-E global), et aucun passage final n’est déclaré réussi pour elle.
